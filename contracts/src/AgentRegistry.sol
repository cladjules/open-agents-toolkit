// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IERC7857.sol";

/**
 * @title AgentRegistry
 * @notice Unified ERC-8004 Agent Identity Registry + ERC-7857 Intelligent Digital Asset.
 *
 * Each registered agent is a single ERC-721 token that carries:
 *   - ERC-8004: public profile URI, on-chain key/value metadata, and a dedicated
 *     agent wallet (EIP-712 / ERC-1271 proof of control, auto-cleared on transfer).
 *   - ERC-7857: optional encrypted private metadata anchored on-chain, usage
 *     authorisation, access delegation, cloning, and re-encryption on secure transfer.
 *
 * Agents registered without private data (via register()) behave as plain ERC-721
 * tokens — standard transferFrom works normally.  Agents minted with an
 * IAgentDataVerifier (via mint()) require secureTransfer() for ownership changes;
 * plain transferFrom is blocked when a verifier is set.
 */
contract AgentRegistry is IERC7857, ERC721URIStorage, EIP712, ReentrancyGuard {
    // ─── ERC-8004 Types ───────────────────────────────────────────────────────

    struct MetadataEntry {
        string metadataKey;
        bytes metadataValue;
    }

    // ─── ERC-7857 Types ───────────────────────────────────────────────────────

    struct AgentData {
        bytes32 encryptedDataHash;
        address verifier;
        uint256 mintedAt;
    }

    // ─── Constants ────────────────────────────────────────────────────────────

    bytes32 private constant SET_AGENT_WALLET_TYPEHASH =
        keccak256("SetAgentWallet(uint256 agentId,address newWallet,uint256 deadline)");

    string private constant AGENT_WALLET_KEY = "agentWallet";

    bytes4 private constant ERC1271_MAGIC_VALUE = 0x1626ba7e;

    uint256 private constant MAX_AUTHORIZATIONS = 100;

    // ─── Storage ──────────────────────────────────────────────────────────────

    uint256 private _nextTokenId;

    // ERC-8004
    mapping(uint256 => mapping(string => bytes)) private _metadata;
    mapping(uint256 => address) private _agentWallets;

    // ERC-7857 private data
    mapping(uint256 => AgentData) private _agentData;
    mapping(uint256 => IntelligentData[]) private _intelligentData;
    mapping(uint256 => address) public tokenCreator;
    mapping(uint256 => uint256) public cloneSource;

    // ERC-7857 authorization
    mapping(uint256 => address[]) private _authorizedUsers;
    mapping(uint256 => mapping(address => bool)) private _isAuthorizedUser;
    mapping(address => uint256[]) private _authorizedTokens;
    mapping(address => mapping(uint256 => bool)) private _isAuthorizedToken;

    // ERC-7857 delegation
    mapping(address => address) public delegatedAssistant;

    // Guard: set true inside secureTransfer/iTransferFrom to allow _update past the verifier check
    bool private _inSecureTransfer;

    // ─── ERC-8004 Events ──────────────────────────────────────────────────────

    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy);
    event MetadataSet(
        uint256 indexed agentId,
        string indexed indexedMetadataKey,
        string metadataKey,
        bytes metadataValue
    );

    // ─── Errors ───────────────────────────────────────────────────────────────

    // ERC-8004
    error NotTokenOwnerOrOperator(uint256 agentId, address caller);
    error EmptyURI();
    error ReservedKey();
    error SignatureExpired();
    error InvalidSignature();

    // ERC-7857
    error NotTokenOwner(uint256 tokenId, address caller);
    error InvalidVerifier();
    error VerificationFailed(uint256 tokenId);
    error EmptyHash();
    error AlreadyAuthorized();
    error NotAuthorized();
    error MaxAuthorizationsReached();
    error SecureTransferRequired(uint256 tokenId);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor() ERC721("AgentIdentity", "AGID") EIP712("AgentRegistry", "1") {}

    // ─── ERC-8004 Registration ────────────────────────────────────────────────

    /// @notice Register a new agent; agentURI is set later via setAgentURI().
    function register() external nonReentrant returns (uint256 agentId) {
        return _doRegister(msg.sender, "", new MetadataEntry[](0), bytes32(0), address(0));
    }

    /// @notice Register a new agent with an agentURI.
    function register(string calldata agentURI) external nonReentrant returns (uint256 agentId) {
        return _doRegister(msg.sender, agentURI, new MetadataEntry[](0), bytes32(0), address(0));
    }

    /// @notice Register a new agent with an agentURI and extra on-chain metadata.
    function register(
        string calldata agentURI,
        MetadataEntry[] calldata metadata
    ) external nonReentrant returns (uint256 agentId) {
        return _doRegister(msg.sender, agentURI, metadata, bytes32(0), address(0));
    }

    // ─── ERC-7857 Minting ─────────────────────────────────────────────────────

    /// @inheritdoc IERC7857
    function mint(
        address to,
        string calldata publicMetadataUri,
        bytes32 encryptedDataHash,
        address verifier
    ) external nonReentrant returns (uint256 tokenId) {
        if (bytes(publicMetadataUri).length == 0) revert EmptyURI();
        if (encryptedDataHash == bytes32(0)) revert EmptyHash();
        if (verifier == address(0)) revert InvalidVerifier();
        return _doRegister(to, publicMetadataUri, new MetadataEntry[](0), encryptedDataHash, verifier);
    }

    /// @inheritdoc IERC7857
    function iMint(
        address to,
        IntelligentData[] calldata datas
    ) external payable nonReentrant returns (uint256 tokenId) {
        tokenId = ++_nextTokenId;
        _safeMint(to, tokenId);
        _initAgentWallet(tokenId, to);
        _setIntelligentData(tokenId, datas);
        tokenCreator[tokenId] = msg.sender;
    }

    function _doRegister(
        address to,
        string memory agentURI,
        MetadataEntry[] memory metadata,
        bytes32 encryptedDataHash,
        address verifier
    ) internal returns (uint256 agentId) {
        agentId = ++_nextTokenId;
        _safeMint(to, agentId);

        if (bytes(agentURI).length > 0) {
            _setTokenURI(agentId, agentURI);
        }

        _initAgentWallet(agentId, to);

        for (uint256 i; i < metadata.length; ++i) {
            if (_isReservedKey(metadata[i].metadataKey)) revert ReservedKey();
            _metadata[agentId][metadata[i].metadataKey] = metadata[i].metadataValue;
            emit MetadataSet(agentId, metadata[i].metadataKey, metadata[i].metadataKey, metadata[i].metadataValue);
        }

        if (encryptedDataHash != bytes32(0)) {
            _agentData[agentId] = AgentData({
                encryptedDataHash: encryptedDataHash,
                verifier: verifier,
                mintedAt: block.timestamp
            });
            tokenCreator[agentId] = msg.sender;
            emit AgentMinted(agentId, to, encryptedDataHash);
        }

        emit Registered(agentId, agentURI, to);
    }

    function _initAgentWallet(uint256 agentId, address owner) internal {
        _agentWallets[agentId] = owner;
        bytes memory walletBytes = abi.encodePacked(owner);
        _metadata[agentId][AGENT_WALLET_KEY] = walletBytes;
        emit MetadataSet(agentId, AGENT_WALLET_KEY, AGENT_WALLET_KEY, walletBytes);
    }

    // ─── ERC-8004 URI & Metadata ──────────────────────────────────────────────

    function setAgentURI(uint256 agentId, string calldata newURI) external {
        if (!_isOwnerOrOperator(agentId, msg.sender)) revert NotTokenOwnerOrOperator(agentId, msg.sender);
        if (bytes(newURI).length == 0) revert EmptyURI();
        _setTokenURI(agentId, newURI);
        emit URIUpdated(agentId, newURI, msg.sender);
    }

    function getMetadata(uint256 agentId, string memory metadataKey) external view returns (bytes memory) {
        return _metadata[agentId][metadataKey];
    }

    function setMetadata(uint256 agentId, string memory metadataKey, bytes memory metadataValue) external {
        if (!_isOwnerOrOperator(agentId, msg.sender)) revert NotTokenOwnerOrOperator(agentId, msg.sender);
        if (_isReservedKey(metadataKey)) revert ReservedKey();
        _metadata[agentId][metadataKey] = metadataValue;
        emit MetadataSet(agentId, metadataKey, metadataKey, metadataValue);
    }

    // ─── ERC-8004 Agent Wallet ────────────────────────────────────────────────

    /**
     * @notice Set a dedicated agent wallet, proved by an EIP-712 signature from newWallet.
     */
    function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes calldata signature) external {
        if (!_isOwnerOrOperator(agentId, msg.sender)) revert NotTokenOwnerOrOperator(agentId, msg.sender);
        if (block.timestamp > deadline) revert SignatureExpired();

        bytes32 structHash = keccak256(abi.encode(SET_AGENT_WALLET_TYPEHASH, agentId, newWallet, deadline));
        bytes32 digest = _hashTypedDataV4(structHash);

        bool valid;
        if (newWallet.code.length > 0) {
            try IERC1271(newWallet).isValidSignature(digest, signature) returns (bytes4 magic) {
                valid = (magic == ERC1271_MAGIC_VALUE);
            } catch {
                valid = false;
            }
        } else {
            valid = (ECDSA.recover(digest, signature) == newWallet);
        }
        if (!valid) revert InvalidSignature();

        _agentWallets[agentId] = newWallet;
        bytes memory walletBytes = abi.encodePacked(newWallet);
        _metadata[agentId][AGENT_WALLET_KEY] = walletBytes;
        emit MetadataSet(agentId, AGENT_WALLET_KEY, AGENT_WALLET_KEY, walletBytes);
    }

    function getAgentWallet(uint256 agentId) external view returns (address) {
        return _agentWallets[agentId];
    }

    function unsetAgentWallet(uint256 agentId) external {
        if (!_isOwnerOrOperator(agentId, msg.sender)) revert NotTokenOwnerOrOperator(agentId, msg.sender);
        delete _agentWallets[agentId];
        delete _metadata[agentId][AGENT_WALLET_KEY];
        emit MetadataSet(agentId, AGENT_WALLET_KEY, AGENT_WALLET_KEY, "");
    }

    // ─── ERC-7857 Transfers ───────────────────────────────────────────────────

    /// @inheritdoc IERC7857
    function secureTransfer(
        uint256 tokenId,
        address to,
        bytes32 newDataHash,
        bytes calldata sealedKey,
        bytes calldata proof
    ) external nonReentrant {
        address currentOwner = ownerOf(tokenId);
        if (currentOwner != msg.sender) revert NotTokenOwner(tokenId, msg.sender);
        if (newDataHash == bytes32(0)) revert EmptyHash();

        AgentData storage data = _agentData[tokenId];
        if (data.verifier != address(0)) {
            bool valid = IAgentDataVerifier(data.verifier).verifyReEncryption(
                tokenId,
                currentOwner,
                to,
                data.encryptedDataHash,
                newDataHash,
                proof
            );
            if (!valid) revert VerificationFailed(tokenId);
        }

        data.encryptedDataHash = newDataHash;

        _inSecureTransfer = true;
        _transfer(currentOwner, to, tokenId);
        _inSecureTransfer = false;
        _clearAuthorizations(tokenId);

        emit SealedKeyPublished(tokenId, to, sealedKey);
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
        _inSecureTransfer = true;
        _transfer(from, to, tokenId);
        _inSecureTransfer = false;
        _clearAuthorizations(tokenId);
        emit IntelligentTransfer(from, to, tokenId);
    }

    // ─── ERC-7857 Cloning ─────────────────────────────────────────────────────

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
        _initAgentWallet(newTokenId, to);

        IntelligentData[] storage src = _intelligentData[tokenId];
        for (uint256 i = 0; i < src.length; i++) {
            _intelligentData[newTokenId].push(src[i]);
        }
        cloneSource[newTokenId] = tokenId;
        tokenCreator[newTokenId] = tokenCreator[tokenId];

        emit IntelligentClone(from, to, tokenId, newTokenId);
    }

    // ─── ERC-7857 Data Management ─────────────────────────────────────────────

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

    // ─── ERC-7857 Authorization ───────────────────────────────────────────────

    /// @inheritdoc IERC7857
    function authorizeUsage(uint256 tokenId, address user) external {
        require(ownerOf(tokenId) == msg.sender, "Not the owner");
        if (_isAuthorizedUser[tokenId][user]) revert AlreadyAuthorized();
        if (_authorizedUsers[tokenId].length >= MAX_AUTHORIZATIONS) revert MaxAuthorizationsReached();

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
                if (_authorizedUsers[tokenIds[i]].length >= MAX_AUTHORIZATIONS) revert MaxAuthorizationsReached();
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

    // ─── ERC-7857 Delegation ──────────────────────────────────────────────────

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

    // ─── ERC-721 Transfer Hook ────────────────────────────────────────────────

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        // Block plain transferFrom for tokens that have a verifier set.
        // Mints (_ownerOf == address(0)) and burns (to == address(0)) are always allowed.
        if (
            _ownerOf(tokenId) != address(0) &&
            to != address(0) &&
            _agentData[tokenId].verifier != address(0) &&
            !_inSecureTransfer
        ) revert SecureTransferRequired(tokenId);

        address from = super._update(to, tokenId, auth);

        // ERC-8004: clear agentWallet on transfer (not on mint or burn)
        if (from != address(0) && to != address(0)) {
            delete _agentWallets[tokenId];
            delete _metadata[tokenId][AGENT_WALLET_KEY];
            emit MetadataSet(tokenId, AGENT_WALLET_KEY, AGENT_WALLET_KEY, "");
        }

        return from;
    }

    // ─── Misc ─────────────────────────────────────────────────────────────────

    function totalSupply() external view returns (uint256) {
        return _nextTokenId;
    }

    // ─── Internal Helpers ─────────────────────────────────────────────────────

    function _setIntelligentData(uint256 tokenId, IntelligentData[] calldata datas) internal {
        delete _intelligentData[tokenId];
        for (uint256 i = 0; i < datas.length; i++) {
            _intelligentData[tokenId].push(datas[i]);
        }
        emit IntelligentDataSet(tokenId, _intelligentData[tokenId]);
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
            emit UsageRevoked(tokenId, user);
        }
        delete _authorizedUsers[tokenId];
    }

    function _isReservedKey(string memory key) internal pure returns (bool) {
        return keccak256(bytes(key)) == keccak256(bytes(AGENT_WALLET_KEY));
    }

    function _isOwnerOrOperator(uint256 agentId, address caller) internal view returns (bool) {
        address owner = ownerOf(agentId);
        return owner == caller || isApprovedForAll(owner, caller) || getApproved(agentId) == caller;
    }

    // ─── ERC-165 ──────────────────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId) public view override(ERC721URIStorage) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
