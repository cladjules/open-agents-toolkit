// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

interface ITextResolver {
    function setText(bytes32 node, string calldata key, string calldata value) external;

    function text(bytes32 node, string calldata key) external view returns (string memory);
}
