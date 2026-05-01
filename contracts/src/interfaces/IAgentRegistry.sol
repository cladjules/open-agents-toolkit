// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { IAgentDataVerifier } from "./IAgentDataVerifier.sol";
import { IERC721 } from "@openzeppelin/contracts/interfaces/IERC721.sol";

/// @dev Encrypted / intelligent data item attached to a token.
struct IntelligentData {
    string dataDescription;
    bytes32 dataHash;
}

/// @dev ERC-8004 on-chain metadata entry used during registration.
struct MetadataEntry {
    string metadataKey;
    bytes metadataValue;
}

/// @title IAgentRegistry
/// @notice Interface for the AgentRegistry ERC-721 / ERC-8004 Identity Registry contract.
interface IAgentRegistry is IERC721 {
    // ─── Events ───────────────────────────────────────────────────────────────

    event AdminChanged(address indexed oldAdmin, address indexed newAdmin);
    event CreatorSet(uint256 indexed tokenId, address indexed creator);
    event BaseURIUpdated(string oldBaseURI, string newBaseURI);
    event TokenURIUpdated(uint256 indexed tokenId, string newURI);
    event MetadataURIUpdated(uint256 indexed tokenId, string newURI);
    event VerifierUpdated(address indexed oldVerifier, address indexed newVerifier);
    event MintFeeUpdated(uint256 oldFee, uint256 newFee);
    event IntelligentDataSet(uint256 indexed tokenId, IntelligentData[] data);
    event PublishedSealedKey(address indexed to, uint256 indexed tokenId, bytes[] sealedKeys);
    /// @notice ERC-8004: emitted on agent registration (mint).
    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    /// @notice ERC-8004: emitted when the agent wallet is updated or cleared.
    event AgentWalletSet(uint256 indexed agentId, address indexed newWallet);

    // ─── Minting ──────────────────────────────────────────────────────────────

    /// @notice Mint an agent NFT.
    /// @param to Recipient address.
    /// @param publicMetadataUri Public metadata URI stored as ERC-721 tokenURI (with image, description, traits).
    /// @param metadataUri ERC-8004 metadata registry file URI (uploaded to 0G storage).
    /// @param newDatas Optional intelligent data (encrypted metadata) to attach at mint time.
    /// @return tokenId Newly minted token ID.
    function mint(
        address to,
        string calldata publicMetadataUri,
        string calldata metadataUri,
        IntelligentData[] calldata newDatas
    ) external payable returns (uint256 tokenId);

    // ─── Secure Transfer ──────────────────────────────────────────────────────

    /// @notice Transfer ownership with TEE-attested re-encryption proof.
    /// @param tokenId Token to transfer.
    /// @param to New owner.
    /// @param newDataHashes Hashes of the intelligent data items re-encrypted for the new owner.
    /// @param sealedKey Encrypted content key sealed for the new owner (logged off-chain).
    /// @param proof 65-byte ECDSA TEE proof over (tokenId, from, to, oldDataHashes, newDataHashes).
    function secureTransfer(
        uint256 tokenId,
        address to,
        bytes32[] calldata newDataHashes,
        bytes calldata sealedKey,
        bytes calldata proof
    ) external;

    // ─── Data Accessors ───────────────────────────────────────────────────────

    function intelligentDataOf(uint256 tokenId) external view returns (IntelligentData[] memory);

    function updateIntelligentData(uint256 tokenId, IntelligentData[] calldata newDatas) external;

    function tokenVerifier(uint256 tokenId) external view returns (address);

    function verifier() external view returns (IAgentDataVerifier);

    // ─── URI ──────────────────────────────────────────────────────────────────

    function setBaseURI(string calldata newBaseURI) external;

    function setTokenURI(uint256 tokenId, string calldata newURI) external;

    function getMetadataUri(uint256 tokenId) external view returns (string memory);

    // ─── Fee Management ───────────────────────────────────────────────────────

    function getMintFee() external view returns (uint256);

    function setMintFee(uint256 newMintFee) external;

    // ─── ERC-8004: Agent Wallet ───────────────────────────────────────────────

    /// @notice Return the currently set agent wallet (payment address).
    ///         Returns address(0) when unset (effectively the owner).
    function getAgentWallet(uint256 agentId) external view returns (address);

    /// @notice Set the agent wallet by proving control via EIP-712 signature.
    /// @param agentId   Token to update.
    /// @param newWallet New payment address (must sign the EIP-712 payload).
    /// @param deadline  Unix timestamp after which the signature is invalid.
    /// @param signature 65-byte ECDSA signature from newWallet.
    function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes calldata signature) external;

    /// @notice Clear the agent wallet back to address(0).
    function unsetAgentWallet(uint256 agentId) external;
}
