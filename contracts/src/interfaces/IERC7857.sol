// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IERC7857
 * @notice Unified interface for ERC-7857 AI Agent NFTs with privacy-preserving
 *         encrypted metadata ("Intelligent Data").
 *
 *         Combines the core spec, usage-authorization extension, and
 *         cloning extension into a single interface, following the 0g AgenticID
 *         reference implementation.
 *
 *         Encrypted data is stored off-chain (IPFS / Arweave).  On transfer,
 *         the data is re-encrypted for the new owner; cryptographic proofs
 *         are validated on-chain via an IAgentDataVerifier (TEE / ZKP).
 */
interface IERC7857 {
    // ─── Structs ──────────────────────────────────────────────────────────────

    /// @notice A single entry of private on-chain metadata.
    struct IntelligentData {
        string dataDescription;
        bytes32 dataHash; // keccak256 of the encrypted blob
    }

    /// @notice Access proof component of a transfer-validity proof.
    struct AccessProof {
        bytes targetPublicKey;
        bytes signature;
    }

    /// @notice Ownership proof component of a transfer-validity proof.
    struct OwnershipProof {
        bytes sealedKey;
        bytes signature;
        uint256 nonce;
    }

    /// @notice Bundled proof passed to iTransferFrom / iCloneFrom.
    struct TransferValidityProof {
        AccessProof accessProof;
        OwnershipProof ownershipProof;
    }

    // ─── Events — core ────────────────────────────────────────────────────────

    event AgentMinted(uint256 indexed tokenId, address indexed owner, bytes32 encryptedDataHash);
    event AgentTransferred(uint256 indexed tokenId, address indexed from, address indexed to);
    event EncryptedDataUpdated(uint256 indexed tokenId, bytes32 newHash);
    event IntelligentDataSet(uint256 indexed tokenId, IntelligentData[] data);
    event IntelligentTransfer(address indexed from, address indexed to, uint256 indexed tokenId);

    // ─── Events — authorization ───────────────────────────────────────────────

    event UsageAuthorized(uint256 indexed tokenId, address indexed user);
    event UsageRevoked(uint256 indexed tokenId, address indexed user);
    event DelegateAccessSet(address indexed owner, address indexed assistant);

    // ─── Events — cloning ─────────────────────────────────────────────────────

    event IntelligentClone(address indexed from, address indexed to, uint256 indexed sourceTokenId, uint256 newTokenId);

    // ─── Minting ──────────────────────────────────────────────────────────────

    /**
     * @notice Mint with explicit URI, hash, and a pluggable verifier.
     * @param to                 Recipient address.
     * @param publicMetadataUri  IPFS/Arweave URI to the public metadata JSON.
     * @param encryptedDataHash  keccak256 of the encrypted private metadata blob.
     * @param verifier           Address of the IAgentDataVerifier contract.
     * @return tokenId           The newly minted token ID.
     */
    function mint(
        address to,
        string calldata publicMetadataUri,
        bytes32 encryptedDataHash,
        address verifier
    ) external returns (uint256 tokenId);

    /**
     * @notice Mint with an array of IntelligentData entries.
     * @dev    mintFee (if > 0) must be sent as msg.value.
     */
    function iMint(address to, IntelligentData[] calldata datas) external payable returns (uint256 tokenId);

    // ─── Events — secure transfer ─────────────────────────────────────────────

    /// @notice Emitted by secureTransfer so the new owner can locate their sealed key on-chain.
    event SealedKeyPublished(uint256 indexed tokenId, address indexed to, bytes sealedKey);

    // ─── Transfers ────────────────────────────────────────────────────────────

    /**
     * @notice Transfer with TEE/ZKP re-encryption proof.
     * @param tokenId     Token being transferred.
     * @param to          New owner.
     * @param newDataHash keccak256 of metadata re-encrypted for `to` (replaces old hash on-chain).
     * @param sealedKey   New encryption key sealed with the receiver's public key (emitted for receiver).
     * @param proof       65-byte ECDSA oracle attestation over (tokenId, from, to, oldDataHash, newDataHash).
     */
    function secureTransfer(
        uint256 tokenId,
        address to,
        bytes32 newDataHash,
        bytes calldata sealedKey,
        bytes calldata proof
    ) external;

    /// @notice Transfer using structured TransferValidityProofs (0g AgenticID style).
    function iTransferFrom(address from, address to, uint256 tokenId, TransferValidityProof[] calldata proofs) external;

    // ─── Cloning ──────────────────────────────────────────────────────────────

    /// @notice Duplicate an agent's IntelligentData to a new token for a different owner.
    function iCloneFrom(
        address from,
        address to,
        uint256 tokenId,
        TransferValidityProof[] calldata proofs
    ) external returns (uint256 newTokenId);

    // ─── Data management ──────────────────────────────────────────────────────

    /// @notice Replace the encrypted data hash.  Only token owner.
    function updateEncryptedData(uint256 tokenId, bytes32 newHash) external;

    /// @notice Returns the primary encrypted data hash.
    function getEncryptedDataHash(uint256 tokenId) external view returns (bytes32);

    /// @notice Returns the IAgentDataVerifier address for a token.
    function getVerifier(uint256 tokenId) external view returns (address);

    /// @notice Returns all IntelligentData entries for a token.
    function getIntelligentDatas(uint256 tokenId) external view returns (IntelligentData[] memory);

    // ─── Authorization ────────────────────────────────────────────────────────

    /// @notice Grant usage rights to an address without transferring ownership.
    function authorizeUsage(uint256 tokenId, address user) external;

    function revokeAuthorization(uint256 tokenId, address user) external;

    function batchAuthorizeUsage(uint256[] calldata tokenIds, address user) external;

    function isAuthorizedUser(uint256 tokenId, address user) external view returns (bool);

    function authorizedUsersOf(uint256 tokenId) external view returns (address[] memory);

    function authorizedTokensOf(address user) external view returns (uint256[] memory);

    /// @notice Delegate usage-management rights to an assistant address.
    function delegateAccess(address assistant) external;

    function revokeDelegateAccess() external;
}

// ─────────────────────────────────────────────────────────────────────────────
// IAgentDataVerifier — Pluggable proof verifier
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @title IAgentDataVerifier
 * @notice Pluggable verifier called during secureTransfer.
 *         Implementations: TEEVerifier, ZKPVerifier.
 */
interface IAgentDataVerifier {
    /**
     * @param tokenId       The token being transferred.
     * @param from          Current owner.
     * @param to            New owner.
     * @param oldDataHash   The current on-chain encrypted data hash.
     * @param newDataHash   The re-encrypted data hash for the new owner.
     * @param proof         Opaque proof bytes (TEE attestation or ZK proof).
     * @return valid        True iff the proof is valid.
     */
    function verifyReEncryption(
        uint256 tokenId,
        address from,
        address to,
        bytes32 oldDataHash,
        bytes32 newDataHash,
        bytes calldata proof
    ) external view returns (bool valid);
}
