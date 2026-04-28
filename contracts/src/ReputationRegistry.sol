// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IIdentityRegistryForReputation {
    function ownerOf(uint256 tokenId) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
    function getApproved(uint256 tokenId) external view returns (address);
}

/**
 * @title ReputationRegistry
 * @notice ERC-8004 Reputation Registry — on-chain feedback for registered agents.
 *
 * Feedback is a signed fixed-point value (int128 + valueDecimals) with optional
 * categorical tags, an endpoint URI, and a pointer to an off-chain JSON file.
 * Only value, valueDecimals, tag1, tag2, and isRevoked are stored; endpoint,
 * feedbackURI, and feedbackHash are emitted only.
 *
 * Multiple feedback entries per (agentId, clientAddress) are supported and
 * indexed by a 1-based feedbackIndex counter.  The agent owner and its
 * approved operators are prohibited from giving feedback.
 */
contract ReputationRegistry is ReentrancyGuard {
    // ─── Types ────────────────────────────────────────────────────────────────

    struct FeedbackRecord {
        int128 value;
        uint8 valueDecimals;
        string tag1;
        string tag2;
        bool isRevoked;
    }

    // ─── Storage ──────────────────────────────────────────────────────────────

    address private _identityRegistry;
    bool private _initialized;

    /// @dev agentId => clientAddress => feedbackIndex (1-based) => FeedbackRecord
    mapping(uint256 => mapping(address => mapping(uint64 => FeedbackRecord))) private _feedback;

    /// @dev agentId => clientAddress => highest feedbackIndex issued (= total entries)
    mapping(uint256 => mapping(address => uint64)) private _lastIndex;

    /// @dev agentId => ordered list of unique clientAddresses
    mapping(uint256 => address[]) private _clients;
    mapping(uint256 => mapping(address => bool)) private _hasClientEntry;

    /// @dev agentId => clientAddress => feedbackIndex => responder => has responded
    mapping(uint256 => mapping(address => mapping(uint64 => mapping(address => bool)))) private _hasResponded;
    /// @dev agentId => clientAddress => feedbackIndex => unique-responder count
    mapping(uint256 => mapping(address => mapping(uint64 => uint64))) private _responseCount;

    // ─── Events ───────────────────────────────────────────────────────────────

    event NewFeedback(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint64 feedbackIndex,
        int128 value,
        uint8 valueDecimals,
        string indexed indexedTag1,
        string tag1,
        string tag2,
        string endpoint,
        string feedbackURI,
        bytes32 feedbackHash
    );

    event FeedbackRevoked(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint64 indexed feedbackIndex
    );

    event ResponseAppended(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint64 feedbackIndex,
        address indexed responder,
        string responseURI,
        bytes32 responseHash
    );

    // ─── Errors ───────────────────────────────────────────────────────────────

    error AlreadyInitialized();
    error InvalidValueDecimals();
    error AgentOwnerCannotRate();
    error FeedbackNotFound();
    error EmptyClientAddresses();

    // ─── Initialize ───────────────────────────────────────────────────────────

    function initialize(address identityRegistry_) external {
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;
        _identityRegistry = identityRegistry_;
    }

    function getIdentityRegistry() external view returns (address) {
        return _identityRegistry;
    }

    // ─── Feedback ─────────────────────────────────────────────────────────────

    /**
     * @notice Submit feedback for a registered agent.
     * @param agentId       IdentityRegistry tokenId of the agent.
     * @param value         Signed fixed-point feedback value.
     * @param valueDecimals Decimal precision of value (0-18).
     * @param tag1          Optional primary tag (e.g. "starred").
     * @param tag2          Optional secondary tag.
     * @param endpoint      Optional endpoint the feedback relates to (emitted only).
     * @param feedbackURI   Optional off-chain feedback file URI (emitted only).
     * @param feedbackHash  Optional keccak256 of feedbackURI content (emitted only).
     */
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external nonReentrant {
        if (valueDecimals > 18) revert InvalidValueDecimals();

        // The feedback submitter MUST NOT be the agent owner or an approved operator.
        IIdentityRegistryForReputation reg = IIdentityRegistryForReputation(_identityRegistry);
        address agentOwner = reg.ownerOf(agentId);
        if (
            msg.sender == agentOwner ||
            reg.isApprovedForAll(agentOwner, msg.sender) ||
            reg.getApproved(agentId) == msg.sender
        ) revert AgentOwnerCannotRate();

        uint64 feedbackIndex = ++_lastIndex[agentId][msg.sender];

        if (!_hasClientEntry[agentId][msg.sender]) {
            _hasClientEntry[agentId][msg.sender] = true;
            _clients[agentId].push(msg.sender);
        }

        _feedback[agentId][msg.sender][feedbackIndex] = FeedbackRecord({
            value: value,
            valueDecimals: valueDecimals,
            tag1: tag1,
            tag2: tag2,
            isRevoked: false
        });

        emit NewFeedback(
            agentId,
            msg.sender,
            feedbackIndex,
            value,
            valueDecimals,
            tag1,
            tag1,
            tag2,
            endpoint,
            feedbackURI,
            feedbackHash
        );
    }

    /**
     * @notice Revoke a previously submitted feedback entry.
     * @dev Only the original clientAddress can revoke their own feedback.
     */
    function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external {
        if (feedbackIndex == 0 || _lastIndex[agentId][msg.sender] < feedbackIndex)
            revert FeedbackNotFound();
        _feedback[agentId][msg.sender][feedbackIndex].isRevoked = true;
        emit FeedbackRevoked(agentId, msg.sender, feedbackIndex);
    }

    /**
     * @notice Append a response to an existing feedback entry.
     * @dev Anyone may respond; each responder is counted once per entry.
     */
    function appendResponse(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex,
        string calldata responseURI,
        bytes32 responseHash
    ) external {
        if (feedbackIndex == 0 || _lastIndex[agentId][clientAddress] < feedbackIndex)
            revert FeedbackNotFound();
        if (!_hasResponded[agentId][clientAddress][feedbackIndex][msg.sender]) {
            _hasResponded[agentId][clientAddress][feedbackIndex][msg.sender] = true;
            ++_responseCount[agentId][clientAddress][feedbackIndex];
        }
        emit ResponseAppended(agentId, clientAddress, feedbackIndex, msg.sender, responseURI, responseHash);
    }

    // ─── Read Functions ───────────────────────────────────────────────────────

    /**
     * @notice Aggregate feedback for an agent from a specific set of clients.
     * @dev clientAddresses MUST be non-empty (Sybil protection).
     *      All values are normalised to 18 decimal places before summation.
     */
    function getSummary(
        uint256 agentId,
        address[] calldata clientAddresses,
        string calldata tag1,
        string calldata tag2
    ) external view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals) {
        if (clientAddresses.length == 0) revert EmptyClientAddresses();

        bool filterTag1 = bytes(tag1).length > 0;
        bool filterTag2 = bytes(tag2).length > 0;
        bytes32 tag1Hash = filterTag1 ? keccak256(bytes(tag1)) : bytes32(0);
        bytes32 tag2Hash = filterTag2 ? keccak256(bytes(tag2)) : bytes32(0);

        int256 normalizedSum;

        for (uint256 i; i < clientAddresses.length; ++i) {
            address client = clientAddresses[i];
            uint64 last = _lastIndex[agentId][client];
            for (uint64 j = 1; j <= last; ++j) {
                FeedbackRecord storage r = _feedback[agentId][client][j];
                if (r.isRevoked) continue;
                if (filterTag1 && keccak256(bytes(r.tag1)) != tag1Hash) continue;
                if (filterTag2 && keccak256(bytes(r.tag2)) != tag2Hash) continue;
                ++count;
                int256 norm = int256(r.value);
                uint8 d = r.valueDecimals;
                if (d < 18) {
                    norm = norm * int256(10 ** uint256(18 - d));
                }
                normalizedSum += norm;
            }
        }

        summaryValueDecimals = 18;
        summaryValue = int128(normalizedSum);
    }

    /**
     * @notice Read a single feedback entry.
     */
    function readFeedback(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex
    ) external view returns (
        int128 value,
        uint8 valueDecimals,
        string memory tag1,
        string memory tag2,
        bool isRevoked
    ) {
        FeedbackRecord storage r = _feedback[agentId][clientAddress][feedbackIndex];
        return (r.value, r.valueDecimals, r.tag1, r.tag2, r.isRevoked);
    }

    /**
     * @notice Read multiple feedback entries with optional filters.
     * @dev agentId is mandatory; all other parameters are optional filters.
     *      Revoked feedback is omitted by default (includeRevoked = false).
     */
    function readAllFeedback(
        uint256 agentId,
        address[] calldata clientAddresses,
        string calldata tag1,
        string calldata tag2,
        bool includeRevoked
    ) external view returns (
        address[] memory clients,
        uint64[] memory feedbackIndexes,
        int128[] memory values,
        uint8[] memory valueDecimalsList,
        string[] memory tag1s,
        string[] memory tag2s,
        bool[] memory revokedStatuses
    ) {
        bool filterTag1 = bytes(tag1).length > 0;
        bool filterTag2 = bytes(tag2).length > 0;
        bytes32 tag1Hash = filterTag1 ? keccak256(bytes(tag1)) : bytes32(0);
        bytes32 tag2Hash = filterTag2 ? keccak256(bytes(tag2)) : bytes32(0);

        address[] storage allClients = _clients[agentId];
        uint256 sourceLen = clientAddresses.length > 0 ? clientAddresses.length : allClients.length;

        // First pass: count matching entries.
        uint256 total;
        for (uint256 i; i < sourceLen; ++i) {
            address client = clientAddresses.length > 0 ? clientAddresses[i] : allClients[i];
            uint64 last = _lastIndex[agentId][client];
            for (uint64 j = 1; j <= last; ++j) {
                FeedbackRecord storage r = _feedback[agentId][client][j];
                if (!includeRevoked && r.isRevoked) continue;
                if (filterTag1 && keccak256(bytes(r.tag1)) != tag1Hash) continue;
                if (filterTag2 && keccak256(bytes(r.tag2)) != tag2Hash) continue;
                ++total;
            }
        }

        // Allocate result arrays.
        clients = new address[](total);
        feedbackIndexes = new uint64[](total);
        values = new int128[](total);
        valueDecimalsList = new uint8[](total);
        tag1s = new string[](total);
        tag2s = new string[](total);
        revokedStatuses = new bool[](total);

        // Second pass: populate results.
        uint256 idx;
        for (uint256 i; i < sourceLen; ++i) {
            address client = clientAddresses.length > 0 ? clientAddresses[i] : allClients[i];
            uint64 last = _lastIndex[agentId][client];
            for (uint64 j = 1; j <= last; ++j) {
                FeedbackRecord storage r = _feedback[agentId][client][j];
                if (!includeRevoked && r.isRevoked) continue;
                if (filterTag1 && keccak256(bytes(r.tag1)) != tag1Hash) continue;
                if (filterTag2 && keccak256(bytes(r.tag2)) != tag2Hash) continue;
                clients[idx] = client;
                feedbackIndexes[idx] = j;
                values[idx] = r.value;
                valueDecimalsList[idx] = r.valueDecimals;
                tag1s[idx] = r.tag1;
                tag2s[idx] = r.tag2;
                revokedStatuses[idx] = r.isRevoked;
                ++idx;
            }
        }
    }

    /**
     * @notice Get the number of unique responders for a feedback entry.
     * @dev If responders is non-empty, counts only those specific responders.
     */
    function getResponseCount(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex,
        address[] calldata responders
    ) external view returns (uint64 count) {
        if (responders.length > 0) {
            for (uint256 i; i < responders.length; ++i) {
                if (_hasResponded[agentId][clientAddress][feedbackIndex][responders[i]]) {
                    ++count;
                }
            }
        } else {
            count = _responseCount[agentId][clientAddress][feedbackIndex];
        }
    }

    /**
     * @notice Return all unique client addresses that have given feedback to agentId.
     */
    function getClients(uint256 agentId) external view returns (address[] memory) {
        return _clients[agentId];
    }

    /**
     * @notice Return the highest feedbackIndex issued by clientAddress for agentId.
     */
    function getLastIndex(uint256 agentId, address clientAddress) external view returns (uint64) {
        return _lastIndex[agentId][clientAddress];
    }
}
