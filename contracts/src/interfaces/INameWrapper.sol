// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

interface INameWrapper {
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

    function ownerOf(uint256 id) external view returns (address);
}
