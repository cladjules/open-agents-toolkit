// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

interface IAgentDataVerifier {
    function verifySignature(
        uint256 tokenId,
        address from,
        address to,
        bytes32 oldDataHash,
        bytes32 newDataHash,
        bytes calldata proof
    ) external view returns (bool valid);

    function verifyValidation(
        uint256 agentId,
        bytes32 requestHash,
        uint8 response,
        bytes calldata proof
    ) external view returns (bool valid);
}
