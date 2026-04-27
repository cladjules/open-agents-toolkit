// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IERC7857.sol";

/**
 * @dev Always-pass verifier for testing — approves every re-encryption proof.
 */
contract AlwaysPassVerifier is IAgentDataVerifier {
    function verifyReEncryption(
        uint256,
        address,
        address,
        bytes32,
        bytes calldata
    ) external pure override returns (bool) {
        return true;
    }
}

/**
 * @dev Always-fail verifier for testing — rejects every re-encryption proof.
 */
contract AlwaysFailVerifier is IAgentDataVerifier {
    function verifyReEncryption(
        uint256,
        address,
        address,
        bytes32,
        bytes calldata
    ) external pure override returns (bool) {
        return false;
    }
}
