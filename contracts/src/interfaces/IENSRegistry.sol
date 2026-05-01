// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

interface IENSRegistry {
    event NewOwner(bytes32 indexed node, bytes32 indexed label, address indexed owner);

    function owner(bytes32 node) external view returns (address);

    function resolver(bytes32 node) external view returns (address);
}
