// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IAgentDataVerifier.sol";

/**
 * @title TEEVerifier
 * @notice IAgentDataVerifier implementation that validates ECDSA attestations
 *         produced by Trusted Execution Environment (TEE) nodes.
 *
 * ## Intended oracle: 0G Compute Network (TDX providers)
 *
 *   0G Compute providers run inside Intel TDX enclaves with deterministic
 *   signing keys derived from enclave measurements.  Registering a 0G Compute
 *   TDX node's signing address as an oracle eliminates the need to operate a
 *   dedicated re-encryption server.
 *
 *   Off-chain flow (handled by the `compute` package):
 *     1. AgentNFT owner calls ZeroGComputeClient.requestReEncryption() with
 *        the AES content key and new owner's secp256k1 public key.
 *     2. The TDX enclave re-encrypts the content key for the new owner.
 *     3. The enclave signs keccak256(tokenId, from, to, oldDataHashes, newDataHashes)
 *        with its TDX ECDSA key using EIP-191 personalSign.
 *     4. The enclave returns newDataHashes, sealedKey, and the 65-byte proof.
 *     5. Caller passes all three to AgentNFT.secureTransfer().
 *
 *   On-chain flow (this contract):
 *     verifySignature() recovers the signer from the proof and checks
 *     it against the registered oracle set.
 *
 * ## Registering a 0G Compute oracle
 *
 *   After deployment, call `addOracle(tdxSigningAddress)` where
 *   `tdxSigningAddress` is the ECDSA address derived from the TDX enclave's
 *   public key (obtainable from the compute provider's attestation report).
 *
 * Note: In a production DCAP attestation deployment the proof would contain a
 * full TDX quote instead of a bare ECDSA signature.  This implementation uses
 * ECDSA for portability (easily swappable).
 */
contract TEEVerifier is IAgentDataVerifier, Ownable {
    // ─── Storage ──────────────────────────────────────────────────────────────

    /// @dev Authorised TEE oracle signers
    mapping(address => bool) private _oracles;

    /// @dev Replay protection for transfer-validity proofs.
    mapping(bytes32 => bool) private _usedProofs;
    mapping(bytes32 => uint256) private _proofTimestamps;

    uint256 public maxProofAge = 7 days;

    // ─── Events ───────────────────────────────────────────────────────────────

    event OracleAdded(address indexed oracle);
    event OracleRemoved(address indexed oracle);
    event MaxProofAgeUpdated(uint256 maxProofAge);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error NotOracle(address signer);
    error InvalidProofLength();

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor() Ownable(msg.sender) {}

    // ─── Admin ────────────────────────────────────────────────────────────────

    function addOracle(address oracle) external onlyOwner {
        _oracles[oracle] = true;
        emit OracleAdded(oracle);
    }

    function removeOracle(address oracle) external onlyOwner {
        _oracles[oracle] = false;
        emit OracleRemoved(oracle);
    }

    function updateMaxProofAge(uint256 newMaxProofAge) external onlyOwner {
        maxProofAge = newMaxProofAge;
        emit MaxProofAgeUpdated(newMaxProofAge);
    }

    function cleanExpiredProofs(bytes32[] calldata proofNonces) external {
        for (uint256 i = 0; i < proofNonces.length; i++) {
            bytes32 nonceHash = proofNonces[i];
            if (_usedProofs[nonceHash] && block.timestamp > _proofTimestamps[nonceHash] + maxProofAge) {
                delete _usedProofs[nonceHash];
                delete _proofTimestamps[nonceHash];
            }
        }
    }

    function isProofUsed(bytes32 nonceHash) external view returns (bool) {
        return _usedProofs[nonceHash];
    }

    // ─── IAgentDataVerifier ───────────────────────────────────────────────────

    /**
     * @inheritdoc IAgentDataVerifier
     *
     * @dev The proof is an ECDSA signature over:
     *   keccak256(abi.encode(tokenId, from, to, oldDataHashes, newDataHashes))
     *
     * Signed by an authorised TEE oracle using EIP-191 personalSign.
     * The TEE attests that:
     *   1. It received data identified by oldDataHashes
     *   2. Re-encrypted it to produce newDataHashes
     *   3. Sealed the new key for the receiver
     */
    function verifySignature(
        uint256 tokenId,
        address from,
        address to,
        bytes32[] calldata oldDataHashes,
        bytes32[] calldata newDataHashes,
        bytes calldata proof
    ) external view override returns (bool valid) {
        if (proof.length != 65) revert InvalidProofLength();

        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                keccak256(abi.encode(tokenId, from, to, oldDataHashes, newDataHashes))
            )
        );

        address signer = _recover(digest, proof);
        return _oracles[signer];
    }

    /**
     * @inheritdoc IAgentDataVerifier
     */
    function verifyTransferValidity(
        TransferValidityProof[] calldata proofs
    ) external override returns (TransferValidityProofOutput[] memory outputs) {
        outputs = new TransferValidityProofOutput[](proofs.length);

        for (uint256 i = 0; i < proofs.length; i++) {
            TransferValidityProof calldata proof = proofs[i];

            require(proof.accessProof.oldDataHash == proof.ownershipProof.oldDataHash, "Invalid oldDataHashes");
            require(proof.accessProof.newDataHash == proof.ownershipProof.newDataHash, "Invalid newDataHashes");

            bytes32 accessDigest = _toEthSigned(
                keccak256(
                    abi.encode(
                        proof.accessProof.oldDataHash,
                        proof.accessProof.newDataHash,
                        proof.accessProof.encryptedPubKey,
                        proof.accessProof.nonce
                    )
                )
            );
            address accessAssistant = _recover(accessDigest, proof.accessProof.proof);
            require(accessAssistant != address(0), "Invalid access assistant");

            bytes32 ownershipDigest = _toEthSigned(
                keccak256(
                    abi.encode(
                        proof.ownershipProof.oldDataHash,
                        proof.ownershipProof.newDataHash,
                        proof.ownershipProof.sealedKey,
                        proof.ownershipProof.encryptedPubKey,
                        proof.ownershipProof.nonce
                    )
                )
            );
            address oracleSigner = _recover(ownershipDigest, proof.ownershipProof.proof);
            require(_oracles[oracleSigner], "Invalid ownership proof");

            bytes32 accessNonceHash = keccak256(proof.accessProof.nonce);
            bytes32 ownershipNonceHash = keccak256(proof.ownershipProof.nonce);
            _checkAndMarkProof(accessNonceHash);
            _checkAndMarkProof(ownershipNonceHash);

            outputs[i] = TransferValidityProofOutput({
                oldDataHash: proof.accessProof.oldDataHash,
                newDataHash: proof.accessProof.newDataHash,
                sealedKey: proof.ownershipProof.sealedKey,
                encryptedPubKey: proof.ownershipProof.encryptedPubKey,
                wantedKey: proof.accessProof.encryptedPubKey,
                accessAssistant: accessAssistant,
                accessProofNonce: proof.accessProof.nonce,
                ownershipProofNonce: proof.ownershipProof.nonce
            });
        }
    }

    /**
     * @notice Verify a TEE-attested validation response.
     * @dev The oracle signs keccak256(abi.encodePacked(agentId, requestHash, response))
     *      using EIP-191 personalSign.  The 65-byte ECDSA signature is the proof.
     */
    function verifyValidation(
        uint256 agentId,
        bytes32 requestHash,
        uint8 response,
        bytes calldata proof
    ) external view returns (bool valid) {
        if (proof.length != 65) revert InvalidProofLength();

        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                keccak256(abi.encodePacked(agentId, requestHash, response))
            )
        );

        address signer = _recover(digest, proof);
        return _oracles[signer];
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    function _recover(bytes32 digest, bytes calldata sig) private pure returns (address) {
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        return ecrecover(digest, v, r, s);
    }

    function _toEthSigned(bytes32 messageHash) private pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
    }

    function _checkAndMarkProof(bytes32 nonceHash) private {
        require(!_usedProofs[nonceHash], "Proof already used");
        _usedProofs[nonceHash] = true;
        _proofTimestamps[nonceHash] = block.timestamp;
    }
}
