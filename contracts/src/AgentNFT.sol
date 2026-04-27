// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IERC7857.sol";

/**
 * @title AgentNFT
 * @notice ERC-7857 implementation — AI Agent NFTs with verifiable private metadata,
 *         usage authorization, access delegation, and cloning.
 *
 * Private metadata is stored encrypted off-chain (IPFS / Arweave).  The
 * keccak256 hash of the encrypted blob is stored on-chain as an integrity
 * anchor.  On transfer, a re-encryption proof is verified by the pluggable
 * IAgentDataVerifier before the ERC-721 transfer executes.
 */
contract AgentNFT is IERC7857, ERC721URIStorage, AccessControl, Pausable, ReentrancyGuard {
    // ─── Roles ────────────────────────────────────────────────────────────────

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // ─── Storage ──────────────────────────────────────────────────────────────

    uint256 private _nextTokenId;
    uint256 public mintFee;

    struct AgentData {
        bytes32 encryptedDataHash;
        address verifier;
        uint256 mintedAt;
    }

    mapping(uint256 => AgentData) private _agentData;
    mapping(uint256 => IntelligentData[]) private _intelligentData;
    mapping(uint256 => string) private _tokenURIs;
    mapping(uint256 => address) public tokenCreator;
    mapping(uint256 => uint256) public cloneSource;

    // Authorization
    mapping(uint256 => address[]) private _authorizedUsers;
    mapping(uint256 => mapping(address => bool)) private _isAuthorizedUser;
    mapping(address => uint256[]) private _authorizedTokens;
    mapping(address => mapping(uint256 => bool)) private _isAuthorizedToken;

    // Delegation
    mapping(address => address) public delegatedAssistant;

    // ─── Errors ───────────────────────────────────────────────────────────────

    error NotTokenOwner(uint256 tokenId, address caller);
    error InvalidVerifier();
    error VerificationFailed(uint256 tokenId);
    error EmptyHash();
    error EmptyURI();
    error AlreadyAuthorized();
    error NotAuthorized();
    error MaxAuthorizationsReached();

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(uint256 _mintFee) ERC721("AgentNFT", "AGNT") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
        mintFee = _mintFee;
    }

    // ─── Minting ──────────────────────────────────────────────────────────────

    /// @inheritdoc IERC7857
    function mint(
        address to,
        string calldata publicMetadataUri,
        bytes32 encryptedDataHash,
        address verifier
    ) external nonReentrant whenNotPaused returns (uint256 tokenId) {
        if (bytes(publicMetadataUri).length == 0) revert EmptyURI();
        if (encryptedDataHash == bytes32(0)) revert EmptyHash();
        if (verifier == address(0)) revert InvalidVerifier();

        tokenId = ++_nextTokenId;
        _safeMint(to, tokenId);
        _tokenURIs[tokenId] = publicMetadataUri;

        _agentData[tokenId] = AgentData({
            encryptedDataHash: encryptedDataHash,
            verifier: verifier,
            mintedAt: block.timestamp
        });
        tokenCreator[tokenId] = msg.sender;

        emit AgentMinted(tokenId, to, encryptedDataHash);
    }

    /// @inheritdoc IERC7857
    function iMint(
        address to,
        IntelligentData[] calldata datas
    ) external payable whenNotPaused returns (uint256 tokenId) {
        require(msg.value >= mintFee, "Insufficient mint fee");

        tokenId = ++_nextTokenId;
        _safeMint(to, tokenId);
        _setIntelligentData(tokenId, datas);
        tokenCreator[tokenId] = msg.sender;
    }

    /// @notice Role-gated mint with IntelligentData, no fee required.
    function iMintWithRole(
        address to,
        IntelligentData[] calldata datas,
        address _creator
    ) external onlyRole(MINTER_ROLE) returns (uint256 tokenId) {
        tokenId = ++_nextTokenId;
        _safeMint(to, tokenId);
        _setIntelligentData(tokenId, datas);
        tokenCreator[tokenId] = _creator;
    }

    // ─── Transfers ────────────────────────────────────────────────────────────

    /// @inheritdoc IERC7857
    function secureTransfer(uint256 tokenId, address to, bytes calldata reEncryptionProof) external nonReentrant {
        address currentOwner = ownerOf(tokenId);
        if (currentOwner != msg.sender) revert NotTokenOwner(tokenId, msg.sender);

        AgentData storage data = _agentData[tokenId];
        bool valid = IAgentDataVerifier(data.verifier).verifyReEncryption(
            tokenId,
            currentOwner,
            to,
            data.encryptedDataHash,
            reEncryptionProof
        );
        if (!valid) revert VerificationFailed(tokenId);

        _transfer(currentOwner, to, tokenId);
        _clearAuthorizations(tokenId);

        emit AgentTransferred(tokenId, currentOwner, to);
    }

    /// @inheritdoc IERC7857
    function iTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        TransferValidityProof[] calldata /* proofs */
    ) external {
        require(ownerOf(tokenId) == from, "Not the owner");
        require(
            msg.sender == from || isApprovedForAll(from, msg.sender) || getApproved(tokenId) == msg.sender,
            "Not authorized to transfer"
        );
        _transfer(from, to, tokenId);
        _clearAuthorizations(tokenId);
        emit IntelligentTransfer(from, to, tokenId);
    }

    // ─── Cloning ──────────────────────────────────────────────────────────────

    /// @inheritdoc IERC7857
    function iCloneFrom(
        address from,
        address to,
        uint256 tokenId,
        TransferValidityProof[] calldata /* proofs */
    ) external returns (uint256 newTokenId) {
        require(ownerOf(tokenId) == from, "Not the owner");
        require(
            msg.sender == from || isApprovedForAll(from, msg.sender) || getApproved(tokenId) == msg.sender,
            "Not authorized to clone"
        );

        newTokenId = ++_nextTokenId;
        _safeMint(to, newTokenId);

        IntelligentData[] storage src = _intelligentData[tokenId];
        for (uint256 i = 0; i < src.length; i++) {
            _intelligentData[newTokenId].push(src[i]);
        }
        cloneSource[newTokenId] = tokenId;
        tokenCreator[newTokenId] = tokenCreator[tokenId];

        emit IntelligentClone(from, to, tokenId, newTokenId);
    }

    // ─── Data management ──────────────────────────────────────────────────────

    /// @inheritdoc IERC7857
    function updateEncryptedData(uint256 tokenId, bytes32 newHash) external {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner(tokenId, msg.sender);
        if (newHash == bytes32(0)) revert EmptyHash();

        _agentData[tokenId].encryptedDataHash = newHash;
        emit EncryptedDataUpdated(tokenId, newHash);
    }

    /// @inheritdoc IERC7857
    function getEncryptedDataHash(uint256 tokenId) external view returns (bytes32) {
        return _agentData[tokenId].encryptedDataHash;
    }

    /// @inheritdoc IERC7857
    function getVerifier(uint256 tokenId) external view returns (address) {
        return _agentData[tokenId].verifier;
    }

    /// @inheritdoc IERC7857
    function getIntelligentDatas(uint256 tokenId) external view returns (IntelligentData[] memory) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        return _intelligentData[tokenId];
    }

    // ─── Authorization ────────────────────────────────────────────────────────

    /// @inheritdoc IERC7857
    function authorizeUsage(uint256 tokenId, address user) external {
        require(ownerOf(tokenId) == msg.sender, "Not the owner");
        if (_isAuthorizedUser[tokenId][user]) revert AlreadyAuthorized();
        if (_authorizedUsers[tokenId].length >= 100) revert MaxAuthorizationsReached();

        _authorizedUsers[tokenId].push(user);
        _isAuthorizedUser[tokenId][user] = true;
        _authorizedTokens[user].push(tokenId);
        _isAuthorizedToken[user][tokenId] = true;

        emit UsageAuthorized(tokenId, user);
    }

    /// @inheritdoc IERC7857
    function revokeAuthorization(uint256 tokenId, address user) external {
        require(ownerOf(tokenId) == msg.sender, "Not the owner");
        if (!_isAuthorizedUser[tokenId][user]) revert NotAuthorized();

        _isAuthorizedUser[tokenId][user] = false;

        address[] storage users = _authorizedUsers[tokenId];
        for (uint256 i = 0; i < users.length; i++) {
            if (users[i] == user) {
                users[i] = users[users.length - 1];
                users.pop();
                break;
            }
        }

        _isAuthorizedToken[user][tokenId] = false;
        uint256[] storage tokens = _authorizedTokens[user];
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == tokenId) {
                tokens[i] = tokens[tokens.length - 1];
                tokens.pop();
                break;
            }
        }

        emit UsageRevoked(tokenId, user);
    }

    /// @inheritdoc IERC7857
    function batchAuthorizeUsage(uint256[] calldata tokenIds, address user) external {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            require(ownerOf(tokenIds[i]) == msg.sender, "Not the owner");
            if (!_isAuthorizedUser[tokenIds[i]][user]) {
                if (_authorizedUsers[tokenIds[i]].length >= 100) revert MaxAuthorizationsReached();
                _authorizedUsers[tokenIds[i]].push(user);
                _isAuthorizedUser[tokenIds[i]][user] = true;
                emit UsageAuthorized(tokenIds[i], user);
            }
        }
    }

    /// @inheritdoc IERC7857
    function isAuthorizedUser(uint256 tokenId, address user) external view returns (bool) {
        return _isAuthorizedUser[tokenId][user];
    }

    /// @inheritdoc IERC7857
    function authorizedUsersOf(uint256 tokenId) external view returns (address[] memory) {
        return _authorizedUsers[tokenId];
    }

    /// @inheritdoc IERC7857
    function authorizedTokensOf(address user) external view returns (uint256[] memory) {
        return _authorizedTokens[user];
    }

    // ─── Delegation ───────────────────────────────────────────────────────────

    /// @inheritdoc IERC7857
    function delegateAccess(address assistant) external {
        delegatedAssistant[msg.sender] = assistant;
        emit DelegateAccessSet(msg.sender, assistant);
    }

    /// @inheritdoc IERC7857
    function revokeDelegateAccess() external {
        delete delegatedAssistant[msg.sender];
        emit DelegateAccessSet(msg.sender, address(0));
    }

    // ─── Token URI ────────────────────────────────────────────────────────────

    function setTokenURI(uint256 tokenId, string calldata uri) external {
        require(ownerOf(tokenId) == msg.sender || hasRole(OPERATOR_ROLE, msg.sender), "Not authorized");
        _tokenURIs[tokenId] = uri;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        string memory uri = _tokenURIs[tokenId];
        if (bytes(uri).length > 0) return uri;
        return super.tokenURI(tokenId);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setMintFee(uint256 newFee) external onlyRole(DEFAULT_ADMIN_ROLE) {
        mintFee = newFee;
    }

    function pause() external onlyRole(OPERATOR_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(OPERATOR_ROLE) {
        _unpause();
    }

    function withdraw() external onlyRole(DEFAULT_ADMIN_ROLE) {
        payable(msg.sender).transfer(address(this).balance);
    }

    /// @notice Returns the total number of minted tokens.
    function totalSupply() external view returns (uint256) {
        return _nextTokenId;
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _setIntelligentData(uint256 tokenId, IntelligentData[] calldata datas) internal {
        delete _intelligentData[tokenId];
        for (uint256 i = 0; i < datas.length; i++) {
            _intelligentData[tokenId].push(datas[i]);
        }
        emit IntelligentDataSet(tokenId, datas);
    }

    function _clearAuthorizations(uint256 tokenId) internal {
        address[] storage users = _authorizedUsers[tokenId];
        for (uint256 i = 0; i < users.length; i++) {
            address user = users[i];
            _isAuthorizedUser[tokenId][user] = false;
            _isAuthorizedToken[user][tokenId] = false;
            uint256[] storage tokens = _authorizedTokens[user];
            for (uint256 j = 0; j < tokens.length; j++) {
                if (tokens[j] == tokenId) {
                    tokens[j] = tokens[tokens.length - 1];
                    tokens.pop();
                    break;
                }
            }
        }
        delete _authorizedUsers[tokenId];
    }

    // ─── ERC-165 overrides ────────────────────────────────────────────────────

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721URIStorage, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
