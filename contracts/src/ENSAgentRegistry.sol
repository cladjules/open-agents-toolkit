// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IAgentRegistry.sol";
import { IntelligentData } from "./interfaces/IAgentRegistry.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

/**
 * @title ENSAgentRegistry
 * @notice ENS-native agent registry with built-in cross-chain ownership mirror.
 *
 * Identity is derived from ENS namehash nodes. This contract is the ERC-721 custodian
 * of AgentRegistry NFTs; logical ownership is mirrored from Sepolia ENS via KeeperHub.
 * All agent metadata lives in AgentRegistry (ERC-721) — this contract only tracks the
 * node↔tokenId mapping and the cross-chain ownership mirror.
 */
contract ENSAgentRegistry is Ownable, IERC721Receiver {
    struct MirrorRecord {
        address owner;
        uint64 updatedAt;
    }

    // Linked AgentRegistry (ERC-721, on 0G). Optional — set address(0) to skip minting.
    IAgentRegistry public immutable agentRegistry;

    // KeeperHub executor address allowed to call mirrorOwner().
    address public keeper;

    // Cross-chain ownership mirror: populated by KeeperHub / owner.
    mapping(bytes32 => MirrorRecord) private _mirroredOwner;

    // ENS node ↔ AgentRegistry token link
    mapping(bytes32 => uint256) public nodeToTokenId;
    mapping(uint256 => bytes32) public tokenIdToNode;

    event OwnerMirrored(bytes32 indexed node, address indexed newOwner, address indexed caller);
    event AgentTransferred(bytes32 indexed node, address indexed from, address indexed to, uint256 tokenId);
    event AgentRegistered(bytes32 indexed node, address indexed owner, uint256 tokenId);

    error NotENSOwner(bytes32 node, address caller);
    error AlreadyRegistered(bytes32 node);
    error NotRegistered(bytes32 node);
    error MintFeeRequired();
    error NotKeeper();
    error NotRelayCaller();

    constructor(address agentRegistry_) Ownable(msg.sender) {
        agentRegistry = IAgentRegistry(agentRegistry_);
    }

    modifier onlyOwnerOrKeeper() {
        if (msg.sender != owner() && msg.sender != keeper) revert NotKeeper();
        _;
    }

    modifier onlyRelayCaller(address futureOwner) {
        if (msg.sender != owner() && msg.sender != keeper && msg.sender != futureOwner) {
            revert NotRelayCaller();
        }
        _;
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    function setKeeper(address newKeeper) external onlyOwner {
        keeper = newKeeper;
    }

    // ── Cross-chain mirror ───────────────────────────────────────────────────

    /**
     * @notice Called by KeeperHub executor (or owner) after an ENS name transfer on Sepolia.
     */
    function mirrorOwner(bytes32 node, address newOwner) external onlyOwnerOrKeeper {
        _mirroredOwner[node] = MirrorRecord({ owner: newOwner, updatedAt: uint64(block.timestamp) });
        emit OwnerMirrored(node, newOwner, msg.sender);
    }

    // ── Ownership resolution ─────────────────────────────────────────────────

    function ownerOfNode(bytes32 node) public view returns (address) {
        return _mirroredOwner[node].owner;
    }

    function _isOwnerOrNodeOwner(bytes32 node, address account) internal view returns (bool) {
        return account == owner() || ownerOfNode(node) == account;
    }

    /**
     * @notice Register an agent by minting an AgentRegistry NFT.
     * @param node               ENS namehash of the agent's ENS name.
     * @param publicMetadataUri  ERC-721 tokenURI (public metadata for the NFT).
     * @param metadataUri        URI to the agent's encrypted payload on 0G Storage.
     */
    function registerAgent(
        bytes32 node,
        string calldata publicMetadataUri,
        string calldata metadataUri,
        IntelligentData[] calldata newDatas
    ) external payable {
        if (!_isOwnerOrNodeOwner(node, msg.sender)) revert NotENSOwner(node, msg.sender);
        if (nodeToTokenId[node] != 0) revert AlreadyRegistered(node);

        // Mint AgentRegistry NFT and record the bidirectional link.
        if (address(agentRegistry) != address(0)) {
            uint256 fee = agentRegistry.getMintFee();
            if (msg.value < fee) revert MintFeeRequired();
            // Mint to this contract as custodian; logical owner tracked in _mirroredOwner.
            uint256 tokenId = agentRegistry.mint{ value: fee }(msg.sender, publicMetadataUri, metadataUri, newDatas);
            // Set initial logical owner.
            _mirroredOwner[node] = MirrorRecord({ owner: msg.sender, updatedAt: uint64(block.timestamp) });
            emit OwnerMirrored(node, msg.sender, address(this));
            nodeToTokenId[node] = tokenId;
            tokenIdToNode[tokenId] = node;

            // Refund excess
            if (msg.value > fee) {
                (bool ok, ) = payable(msg.sender).call{ value: msg.value - fee }("");
                require(ok, "Refund failed");
            }

            emit AgentRegistered(node, msg.sender, tokenId);
        }
    }

    // ── Relayer transfer ──────────────────────────────────────────────────────

    /**
     * @notice Atomically transfer an agent via TEE proof verification.
     * @dev Callable by owner, keeper, or the future owner (to). Calls AgentRegistry.secureTransfer()
     *      to verify the TEE proof, transfer the NFT, and update the mirror ownership.
     * @param node     ENS namehash of the agent.
     * @param to       New owner address.
     * @param newDataHashes  Updated data hashes (from TEE re-encryption); pass empty to keep current hashes.
     * @param proof    ABI-encoded TransferValidityProof[] (verified by the agent's verifier contract).
     */
    function relayTransfer(
        bytes32 node,
        address to,
        bytes32[] calldata newDataHashes,
        bytes calldata proof
    ) external onlyRelayCaller(to) {
        uint256 tokenId = nodeToTokenId[node];
        if (tokenId == 0) revert NotRegistered(node);

        address from = _mirroredOwner[node].owner;
        if (address(agentRegistry) != address(0)) {
            agentRegistry.secureTransfer(tokenId, to, newDataHashes, "", proof);
            // Remove from custody maps — new owner holds the NFT directly.
            delete nodeToTokenId[node];
            delete tokenIdToNode[tokenId];
        }

        // Update mirror to reflect the transfer.
        _mirroredOwner[node] = MirrorRecord({ owner: to, updatedAt: uint64(block.timestamp) });
        emit OwnerMirrored(node, to, msg.sender);
        emit AgentTransferred(node, from, to, tokenId);
    }

    /// @inheritdoc IERC721Receiver
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    function _toHexString(address addr) internal pure returns (string memory) {
        bytes memory data = abi.encodePacked(addr);
        bytes memory hexChars = "0123456789abcdef";
        bytes memory str = new bytes(42);
        str[0] = "0";
        str[1] = "x";
        for (uint256 i = 0; i < 20; i++) {
            str[2 + i * 2] = hexChars[uint8(data[i] >> 4)];
            str[3 + i * 2] = hexChars[uint8(data[i] & 0x0f)];
        }
        return string(str);
    }

    function _uint256ToString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    /**
     * @notice Request Sepolia ENS text record sync via relayer.
     */
    function mirrorTextRecord(bytes32 node, address resolver, string calldata key, string calldata value) external {
        if (!_isOwnerOrNodeOwner(node, msg.sender)) revert NotENSOwner(node, msg.sender);
        if (nodeToTokenId[node] == 0) revert NotRegistered(node);
    }
}
