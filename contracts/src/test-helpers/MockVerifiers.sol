// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "../interfaces/IAgentDataVerifier.sol";

/**
 * @dev Always-pass verifier for testing — approves every re-encryption proof.
 */
contract AlwaysPassVerifier is IAgentDataVerifier {
    function verifyTransferValidity(
        TransferValidityProof[] calldata proofs
    ) external pure override returns (TransferValidityProofOutput[] memory outputs) {
        outputs = new TransferValidityProofOutput[](proofs.length);
        for (uint256 i = 0; i < proofs.length; i++) {
            outputs[i] = TransferValidityProofOutput({
                oldDataHash: proofs[i].accessProof.oldDataHash,
                newDataHash: proofs[i].accessProof.newDataHash,
                sealedKey: proofs[i].ownershipProof.sealedKey,
                encryptedPubKey: proofs[i].ownershipProof.encryptedPubKey,
                wantedKey: proofs[i].accessProof.encryptedPubKey,
                accessAssistant: address(0),
                accessProofNonce: proofs[i].accessProof.nonce,
                ownershipProofNonce: proofs[i].ownershipProof.nonce
            });
        }
    }

    function verifySignature(
        uint256,
        address,
        address,
        bytes32[] calldata,
        bytes32[] calldata,
        bytes calldata
    ) external pure override returns (bool) {
        return true;
    }

    function verifyValidation(
        uint256 agentId,
        bytes32 requestHash,
        uint8 response,
        bytes calldata proof
    ) external pure override returns (bool) {
        return true;
    }
}

/**
 * @dev Always-fail verifier for testing — rejects every re-encryption proof.
 */
contract AlwaysFailVerifier is IAgentDataVerifier {
    function verifyTransferValidity(
        TransferValidityProof[] calldata
    ) external pure override returns (TransferValidityProofOutput[] memory outputs) {
        revert("Invalid ownership proof");
    }

    function verifySignature(
        uint256,
        address,
        address,
        bytes32[] calldata,
        bytes32[] calldata,
        bytes calldata
    ) external pure override returns (bool) {
        return false;
    }

    function verifyValidation(
        uint256 agentId,
        bytes32 requestHash,
        uint8 response,
        bytes calldata proof
    ) external pure override returns (bool) {
        return false;
    }
}
