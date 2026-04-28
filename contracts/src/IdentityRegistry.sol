// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title IdentityRegistry
 * @notice ERC-8004 Identity Registry — ERC-721 based agent identity registry.
 *
 * Each registered agent is an ERC-721 NFT whose tokenURI resolves to an
 * ERC-8004 registration file.  On-chain metadata (including a dedicated agent
 * wallet) is supported alongside the off-chain registration file.
 *
 * The agentWallet key is reserved and may only be updated via setAgentWallet()
 * (EIP-712 / ERC-1271 proof of control) or cleared via unsetAgentWallet().
 * It is automatically cleared on NFT transfer.
 */
contract IdentityRegistry is ERC721URIStorage, EIP712, ReentrancyGuard {
    // ─── Types ────────────────────────────────────────────────────────────────

    struct MetadataEntry {
        string metadataKey;
        bytes metadataValue;
    }

    // ─── Constants ────────────────────────────────────────────────────────────

    bytes32 private constant SET_AGENT_WALLET_TYPEHASH =
        keccak256("SetAgentWallet(uint256 agentId,address newWallet,uint256 deadline)");

    string private constant AGENT_WALLET_KEY = "agentWallet";

    bytes4 private constant ERC1271_MAGIC_VALUE = 0x1626ba7e;

    // ─── Storage ──────────────────────────────────────────────────────────────

    uint256 private _nextTokenId;

    /// @dev agentId => metadataKey => metadataValue
    mapping(uint256 => mapping(string => bytes)) private _metadata;

    /// @dev agentId => dedicated agent wallet address (mirrors _metadata["agentWallet"])
    mapping(uint256 => address) private _agentWallets;

    // ─── Events ───────────────────────────────────────────────────────────────

    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy);
    event MetadataSet(
        uint256 indexed agentId,
        string indexed indexedMetadataKey,
        string metadataKey,
        bytes metadataValue
    );

    // ─── Errors ───────────────────────────────────────────────────────────────

    error NotTokenOwnerOrOperator(uint256 agentId, address caller);
    error EmptyURI();
    error ReservedKey();
    error SignatureExpired();
    error InvalidSignature();

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor() ERC721("AgentIdentity", "AGID") EIP712("IdentityRegistry", "1") {}

    // ─── Registration ─────────────────────────────────────────────────────────

    /// @notice Register a new agent; agentURI is set later via setAgentURI().
    function register() external nonReentrant returns (uint256 agentId) {
        return _doRegister("", new MetadataEntry[](0));
    }

    /// @notice Register a new agent with an agentURI.
    function register(string calldata agentURI) external nonReentrant returns (uint256 agentId) {
        return _doRegister(agentURI, new MetadataEntry[](0));
    }

    /// @notice Register a new agent with an agentURI and extra on-chain metadata.
    function register(
        string calldata agentURI,
        MetadataEntry[] calldata metadata
    ) external nonReentrant returns (uint256 agentId) {
        return _doRegister(agentURI, metadata);
    }

    function _doRegister(string memory agentURI, MetadataEntry[] memory metadata) internal returns (uint256 agentId) {
        agentId = ++_nextTokenId;
        _safeMint(msg.sender, agentId);

        if (bytes(agentURI).length > 0) {
            _setTokenURI(agentId, agentURI);
        }

        // Reserve: agentWallet initialised to the owner's address.
        _agentWallets[agentId] = msg.sender;
        bytes memory walletBytes = abi.encodePacked(msg.sender);
        _metadata[agentId][AGENT_WALLET_KEY] = walletBytes;
        emit MetadataSet(agentId, AGENT_WALLET_KEY, AGENT_WALLET_KEY, walletBytes);

        for (uint256 i; i < metadata.length; ++i) {
            if (_isReservedKey(metadata[i].metadataKey)) revert ReservedKey();
            _metadata[agentId][metadata[i].metadataKey] = metadata[i].metadataValue;
            emit MetadataSet(agentId, metadata[i].metadataKey, metadata[i].metadataKey, metadata[i].metadataValue);
        }

        emit Registered(agentId, agentURI, msg.sender);
    }

    // ─── URI ──────────────────────────────────────────────────────────────────

    function setAgentURI(uint256 agentId, string calldata newURI) external {
        if (!_isOwnerOrOperator(agentId, msg.sender)) revert NotTokenOwnerOrOperator(agentId, msg.sender);
        if (bytes(newURI).length == 0) revert EmptyURI();
        _setTokenURI(agentId, newURI);
        emit URIUpdated(agentId, newURI, msg.sender);
    }

    // ─── On-chain Metadata ────────────────────────────────────────────────────

    function getMetadata(uint256 agentId, string memory metadataKey) external view returns (bytes memory) {
        return _metadata[agentId][metadataKey];
    }

    function setMetadata(uint256 agentId, string memory metadataKey, bytes memory metadataValue) external {
        if (!_isOwnerOrOperator(agentId, msg.sender)) revert NotTokenOwnerOrOperator(agentId, msg.sender);
        if (_isReservedKey(metadataKey)) revert ReservedKey();
        _metadata[agentId][metadataKey] = metadataValue;
        emit MetadataSet(agentId, metadataKey, metadataKey, metadataValue);
    }

    // ─── Agent Wallet ─────────────────────────────────────────────────────────

    /**
     * @notice Set a dedicated agent wallet, proved by an EIP-712 signature from newWallet.
     * @param agentId   The agent token ID.
     * @param newWallet Address to set as the agent wallet (must sign the EIP-712 message).
     * @param deadline  Unix timestamp after which the signature expires.
     * @param signature EIP-712 signature from newWallet (EOA) or ERC-1271 bytes (smart wallet).
     */
    function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes calldata signature) external {
        if (!_isOwnerOrOperator(agentId, msg.sender)) revert NotTokenOwnerOrOperator(agentId, msg.sender);
        if (block.timestamp > deadline) revert SignatureExpired();

        bytes32 structHash = keccak256(abi.encode(SET_AGENT_WALLET_TYPEHASH, agentId, newWallet, deadline));
        bytes32 digest = _hashTypedDataV4(structHash);

        bool valid;
        if (newWallet.code.length > 0) {
            // ERC-1271 smart-contract wallet
            try IERC1271(newWallet).isValidSignature(digest, signature) returns (bytes4 magic) {
                valid = (magic == ERC1271_MAGIC_VALUE);
            } catch {
                valid = false;
            }
        } else {
            // EOA
            valid = (ECDSA.recover(digest, signature) == newWallet);
        }
        if (!valid) revert InvalidSignature();

        _agentWallets[agentId] = newWallet;
        bytes memory walletBytes = abi.encodePacked(newWallet);
        _metadata[agentId][AGENT_WALLET_KEY] = walletBytes;
        emit MetadataSet(agentId, AGENT_WALLET_KEY, AGENT_WALLET_KEY, walletBytes);
    }

    function getAgentWallet(uint256 agentId) external view returns (address) {
        return _agentWallets[agentId];
    }

    function unsetAgentWallet(uint256 agentId) external {
        if (!_isOwnerOrOperator(agentId, msg.sender)) revert NotTokenOwnerOrOperator(agentId, msg.sender);
        delete _agentWallets[agentId];
        delete _metadata[agentId][AGENT_WALLET_KEY];
        emit MetadataSet(agentId, AGENT_WALLET_KEY, AGENT_WALLET_KEY, "");
    }

    // ─── ERC-721 Transfer Hook ────────────────────────────────────────────────

    /// @dev Automatically clears agentWallet on token transfer (not on mint/burn).
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = super._update(to, tokenId, auth);
        if (from != address(0) && to != address(0)) {
            delete _agentWallets[tokenId];
            delete _metadata[tokenId][AGENT_WALLET_KEY];
            emit MetadataSet(tokenId, AGENT_WALLET_KEY, AGENT_WALLET_KEY, "");
        }
        return from;
    }

    // ─── Misc ─────────────────────────────────────────────────────────────────

    function totalSupply() external view returns (uint256) {
        return _nextTokenId;
    }

    // ─── Internal Helpers ─────────────────────────────────────────────────────

    function _isReservedKey(string memory key) internal pure returns (bool) {
        return keccak256(bytes(key)) == keccak256(bytes(AGENT_WALLET_KEY));
    }

    function _isOwnerOrOperator(uint256 agentId, address caller) internal view returns (bool) {
        address owner = ownerOf(agentId);
        return owner == caller || isApprovedForAll(owner, caller) || getApproved(agentId) == caller;
    }

    // ─── ERC-165 ──────────────────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId) public view override(ERC721URIStorage) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
