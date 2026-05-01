// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./interfaces/IAgentDataVerifier.sol";
import "./interfaces/IAgentRegistry.sol";

/**
 * @title AgentRegistry
 * @notice ERC-721 Agent NFT with optional encrypted private metadata (ERC-7857 style) and ERC-8004 metadata.
 *
 * Features:
 *   - Single mint function that handles both plain ERC-721 and encrypted-data tokens.
 *   - secureTransfer() validates a TEE re-encryption proof before transferring.
 *   - Role-based access: DEFAULT_ADMIN_ROLE only.
 *   - Holders of DEFAULT_ADMIN_ROLE can mint without paying the mint fee.
 *   - URI priority: custom per-token → baseURI+id → first dataDescription.
 */
contract AgentRegistry is
    IAgentRegistry,
    AccessControl,
    ReentrancyGuard,
    Pausable,
    ERC721,
    EIP712
{
    // ─── Roles ────────────────────────────────────────────────────────────────
    // Only DEFAULT_ADMIN_ROLE (from AccessControl) is used.

    // ─── ERC-8004 ─────────────────────────────────────────────────────────────

    bytes32 private constant SET_AGENT_WALLET_TYPEHASH =
        keccak256(
            "SetAgentWallet(uint256 agentId,address newWallet,uint256 deadline)"
        );

    // ─── Storage ──────────────────────────────────────────────────────────────

    address public admin;
    uint256 public mintFee;
    string public baseURI;

    mapping(uint256 => address) public creators;

    uint256 private _nextTokenId;
    IAgentDataVerifier private _verifier;

    mapping(uint256 => string) private _customURIs;
    mapping(uint256 => IntelligentData[]) private _intelligentDataOf;
    mapping(uint256 => address) private _tokenVerifier;

    // Authorized relayers (e.g., ENSAgentRegistry for custodial transfers)
    mapping(address => bool) public isRelayer;

    // ERC-8004: metadata URI and agent wallet
    mapping(uint256 => string) private _metadataUri;
    mapping(uint256 => address) private _agentWallet;

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(
        string memory name_,
        string memory symbol_,
        address admin_,
        address verifierAddr
    ) ERC721(name_, symbol_) EIP712("AgentRegistry", "1") {
        require(admin_ != address(0), "Invalid admin address");

        admin = admin_;
        if (verifierAddr != address(0)) {
            _verifier = IAgentDataVerifier(verifierAddr);
        }

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setAdmin(address newAdmin) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newAdmin != address(0), "Invalid admin address");
        address oldAdmin = admin;
        if (oldAdmin == newAdmin) return;
        admin = newAdmin;
        _grantRole(DEFAULT_ADMIN_ROLE, newAdmin);
        _revokeRole(DEFAULT_ADMIN_ROLE, oldAdmin);
        emit AdminChanged(oldAdmin, newAdmin);
    }

    // ─── Verifier ─────────────────────────────────────────────────────────────

    function verifier() external view override returns (IAgentDataVerifier) {
        return _verifier;
    }

    function setVerifier(
        address newVerifier
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newVerifier != address(0), "Zero address");
        address oldVerifier = address(_verifier);
        _verifier = IAgentDataVerifier(newVerifier);
        emit VerifierUpdated(oldVerifier, newVerifier);
    }

    function setRelayer(
        address relayer,
        bool authorized
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        isRelayer[relayer] = authorized;
    }

    // ─── Mint ─────────────────────────────────────────────────────────────────

    /**
     * @inheritdoc IAgentRegistry
     * @dev Callers with DEFAULT_ADMIN_ROLE pay no fee.
     *      publicMetadataUri is the ERC-721 tokenURI (with image, description, traits).
     *      metadataUri is the ERC-8004 metadata registry file URI (uploaded to 0G).
     *      All agents use the global verifier set on this contract.
     */
    function mint(
        address to,
        string calldata publicMetadataUri,
        string calldata metadataUri,
        IntelligentData[] calldata newDatas
    )
        external
        payable
        override
        nonReentrant
        whenNotPaused
        returns (uint256 tokenId)
    {
        require(to != address(0), "Zero address recipient");

        bool privileged = hasRole(DEFAULT_ADMIN_ROLE, msg.sender);
        if (!privileged) {
            require(msg.value >= mintFee, "Insufficient mint fee");
        }

        tokenId = _nextTokenId;
        _safeMint(to, _nextTokenId);

        if (bytes(publicMetadataUri).length > 0) {
            _customURIs[tokenId] = publicMetadataUri;
        }

        if (bytes(metadataUri).length > 0) {
            _metadataUri[tokenId] = metadataUri;
        }

        creators[tokenId] = msg.sender;

        // Set intelligent data if provided
        if (newDatas.length > 0) {
            _setIntelligentData(tokenId, newDatas);
        }

        // ERC-8004: set initial agent wallet to recipient and emit Registered
        _agentWallet[tokenId] = to;
        emit AgentWalletSet(tokenId, to);
        emit Registered(tokenId, publicMetadataUri, to);

        // Refund any excess payment
        if (!privileged && msg.value > mintFee) {
            (bool ok, ) = payable(msg.sender).call{value: msg.value - mintFee}(
                ""
            );
            require(ok, "Refund failed");
        }

        _nextTokenId++;

        return tokenId;
    }

    // ─── Secure Transfer ──────────────────────────────────────────────────────

    /// @inheritdoc IAgentRegistry
    function secureTransfer(
        uint256 tokenId,
        address to,
        bytes32[] calldata newDataHashes,
        bytes calldata /* sealedKey */,
        bytes calldata proof
    ) external override nonReentrant {
        require(to != address(0), "Zero address recipient");

        address from = ownerOf(tokenId);
        IntelligentData[] storage datas = _intelligentDataOf[tokenId];
        require(
            newDataHashes.length == datas.length,
            "Invalid data hash count"
        );

        // If there is encrypted data, TEE proof verification is mandatory.
        if (datas.length > 0) {
            // Only owner or authorized relayer (e.g. ENSAgentRegistry) can transfer with proof
            require(
                msg.sender == from || isRelayer[msg.sender],
                "Not authorized"
            );

            address tv = address(_verifier);
            require(tv != address(0), "No verifier configured");

            bytes32[] memory oldDataHashes = new bytes32[](datas.length);
            for (uint256 i = 0; i < datas.length; i++) {
                oldDataHashes[i] = datas[i].dataHash;
            }

            TransferValidityProof[] memory proofs = abi.decode(
                proof,
                (TransferValidityProof[])
            );
            TransferValidityProofOutput[] memory outputs = IAgentDataVerifier(
                tv
            ).verifyTransferValidity(proofs);
            require(outputs.length == datas.length, "Proof count mismatch");

            bytes[] memory sealedKeys = new bytes[](outputs.length);
            for (uint256 i = 0; i < outputs.length; i++) {
                require(
                    outputs[i].oldDataHash == datas[i].dataHash,
                    "Old data hash mismatch"
                );
                require(
                    outputs[i].newDataHash == newDataHashes[i],
                    "New data hash mismatch"
                );
                require(
                    outputs[i].accessAssistant == to ||
                        outputs[i].accessAssistant == from,
                    "Access assistant mismatch"
                );
                sealedKeys[i] = outputs[i].sealedKey;
            }

            for (uint256 i = 0; i < datas.length; i++) {
                if (newDataHashes[i] != bytes32(0)) {
                    datas[i].dataHash = newDataHashes[i];
                }
            }

            _transfer(from, to, tokenId);

            if (sealedKeys.length > 0) {
                emit PublishedSealedKey(to, tokenId, sealedKeys);
            }
        } else {
            // Plain ERC-721 without encrypted data — only owner can transfer.
            require(msg.sender == from, "Not owner");
            _transfer(from, to, tokenId);
        }
    }

    // ─── Data Accessors ───────────────────────────────────────────────────────

    function intelligentDataOf(
        uint256 tokenId
    ) external view override returns (IntelligentData[] memory) {
        _requireOwned(tokenId);
        return _intelligentDataOf[tokenId];
    }

    function tokenVerifier(
        uint256 tokenId
    ) external view override returns (address) {
        return _tokenVerifier[tokenId];
    }

    function updateIntelligentData(
        uint256 tokenId,
        IntelligentData[] calldata newDatas
    ) external whenNotPaused {
        require(ownerOf(tokenId) == msg.sender, "Not owner");
        require(newDatas.length > 0, "Empty data array");
        _setIntelligentData(tokenId, newDatas);
    }

    /// @dev Internal helper to set intelligent data without ownership checks.
    function _setIntelligentData(
        uint256 tokenId,
        IntelligentData[] calldata newDatas
    ) internal {
        delete _intelligentDataOf[tokenId];
        for (uint256 i = 0; i < newDatas.length; i++) {
            _intelligentDataOf[tokenId].push(newDatas[i]);
        }
        emit IntelligentDataSet(tokenId, _intelligentDataOf[tokenId]);
    }

    function getMetadataUri(
        uint256 tokenId
    ) external view override returns (string memory) {
        _requireOwned(tokenId);
        return _metadataUri[tokenId];
    }

    // ─── URI ──────────────────────────────────────────────────────────────────

    function tokenURI(
        uint256 tokenId
    ) public view override returns (string memory) {
        _requireOwned(tokenId);

        string memory custom = _customURIs[tokenId];
        if (bytes(custom).length > 0) return custom;

        if (bytes(baseURI).length > 0) {
            return string(abi.encodePacked(baseURI, Strings.toString(tokenId)));
        }

        IntelligentData[] storage datas = _intelligentDataOf[tokenId];
        if (datas.length > 0 && bytes(datas[0].dataDescription).length > 0) {
            return datas[0].dataDescription;
        }

        return "";
    }

    function setBaseURI(
        string calldata newBaseURI
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        string memory old = baseURI;
        baseURI = newBaseURI;
        emit BaseURIUpdated(old, newBaseURI);
    }

    function setTokenURI(
        uint256 tokenId,
        string calldata newURI
    ) external override {
        require(ownerOf(tokenId) == msg.sender, "Not owner");
        _customURIs[tokenId] = newURI;
        emit TokenURIUpdated(tokenId, newURI);
    }

    function setMetadataURI(
        uint256 tokenId,
        string calldata newURI
    ) external override {
        require(ownerOf(tokenId) == msg.sender, "Not owner");
        _metadataUri[tokenId] = newURI;
        emit MetadataURIUpdated(tokenId, newURI);
    }

    // ─── Creator ──────────────────────────────────────────────────────────────

    function creatorOf(uint256 tokenId) external view returns (address) {
        return creators[tokenId];
    }

    function setCreator(
        uint256 tokenId,
        address creator
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _requireOwned(tokenId);
        creators[tokenId] = creator;
        emit CreatorSet(tokenId, creator);
    }

    // ─── Fee Management ───────────────────────────────────────────────────────

    function getMintFee() external view override returns (uint256) {
        return mintFee;
    }

    function setMintFee(
        uint256 newMintFee
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 old = mintFee;
        mintFee = newMintFee;
        emit MintFeeUpdated(old, newMintFee);
    }

    // ─── Pause ────────────────────────────────────────────────────────────────

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ─── ERC-8004: Agent Wallet ───────────────────────────────────────────────

    function getAgentWallet(
        uint256 agentId
    ) external view override returns (address) {
        return _agentWallet[agentId];
    }

    function setAgentWallet(
        uint256 agentId,
        address newWallet,
        uint256 deadline,
        bytes calldata signature
    ) external override {
        require(ownerOf(agentId) == msg.sender, "Not owner");
        require(newWallet != address(0), "Zero address");
        require(block.timestamp <= deadline, "Signature expired");
        bytes32 structHash = keccak256(
            abi.encode(SET_AGENT_WALLET_TYPEHASH, agentId, newWallet, deadline)
        );
        address signer = ECDSA.recover(_hashTypedDataV4(structHash), signature);
        require(signer == newWallet, "Invalid wallet signature");
        _agentWallet[agentId] = newWallet;
        emit AgentWalletSet(agentId, newWallet);
    }

    function unsetAgentWallet(uint256 agentId) external override {
        require(ownerOf(agentId) == msg.sender, "Not owner");
        delete _agentWallet[agentId];
        emit AgentWalletSet(agentId, address(0));
    }

    // ─── Misc ─────────────────────────────────────────────────────────────────

    function totalSupply() external view returns (uint256) {
        return _nextTokenId;
    }

    /// @dev Clear agentWallet on transfer (ERC-8004 requirement).
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = super._update(to, tokenId, auth);
        // ERC-8004: clear verified wallet on transfer so new owner must re-verify
        if (from != address(0) && to != address(0)) {
            delete _agentWallet[tokenId];
            emit AgentWalletSet(tokenId, address(0));
        }
        return from;
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721, AccessControl, IERC165) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
