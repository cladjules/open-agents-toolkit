// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IERC7857.sol";

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
 *     3. The enclave signs keccak256(tokenId, from, to, encryptedDataHash)
 *        with its TDX ECDSA key using EIP-191 personalSign.
 *     4. The signature (65 bytes) is returned as the re-encryption proof.
 *     5. Caller passes the proof to AgentNFT.secureTransfer().
 *
 *   On-chain flow (this contract):
 *     verifyReEncryption() recovers the signer from the proof and checks
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

    // ─── Events ───────────────────────────────────────────────────────────────

    event OracleAdded(address indexed oracle);
    event OracleRemoved(address indexed oracle);

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

    // ─── IAgentDataVerifier ───────────────────────────────────────────────────

    /**
     * @inheritdoc IAgentDataVerifier
     *
     * @dev The proof is an ECDSA signature over:
     *   keccak256(abi.encodePacked(tokenId, from, to, encryptedDataHash))
     *
     * Signed by an authorised TEE oracle.
     */
    function verifyReEncryption(
        uint256 tokenId,
        address from,
        address to,
        bytes32 encryptedDataHash,
        bytes calldata proof
    ) external view override returns (bool valid) {
        if (proof.length != 65) revert InvalidProofLength();

        bytes32 digest = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", _buildHash(tokenId, from, to, encryptedDataHash))
        );

        address signer = _recover(digest, proof);
        return _oracles[signer];
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    function _buildHash(
        uint256 tokenId,
        address from,
        address to,
        bytes32 encryptedDataHash
    ) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(tokenId, from, to, encryptedDataHash));
    }

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
}
