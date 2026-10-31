// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AgentRegistry
/// @notice Minimal on-chain directory of PayMesh provider agents on HashKey Chain.
/// @dev Identity + discovery ONLY. This contract holds no funds, has no payable functions and does not
///      implement any payment logic: payments are processed and settled by HSP. No personal/customer
///      data belongs here -- `metadataURI` should point to public, non-sensitive agent metadata.
///
///      Trust model:
///        * `agentId` is chosen by the registrant (PayMesh derives it from the agent's UUID).
///        * The registrant (msg.sender) becomes the owner; only the owner can modify the entry.
///        * There is no admin / upgrade / pause key. The registry is permissionless; PayMesh's backend
///          independently VERIFIES an entry (owner vs. agent wallet) before trusting it.
contract AgentRegistry {
    struct Agent {
        address owner;
        bytes32 categoryId; // e.g. bytes32("crypto_research") -- a reference, not an enforced enum
        string metadataURI; // public metadata reference (e.g. https:// or ipfs://)
        bool active;
        uint64 registeredAt;
    }

    uint256 public constant MAX_METADATA_URI_LENGTH = 512;

    mapping(bytes32 => Agent) private _agents;
    uint256 public agentCount;

    event AgentRegistered(
        bytes32 indexed agentId, address indexed owner, bytes32 indexed categoryId, string metadataURI
    );
    event AgentMetadataUpdated(bytes32 indexed agentId, bytes32 categoryId, string metadataURI);
    event AgentStatusChanged(bytes32 indexed agentId, bool active);
    event AgentOwnershipTransferred(bytes32 indexed agentId, address indexed previousOwner, address indexed newOwner);

    error InvalidAgentId();
    error AlreadyRegistered(bytes32 agentId);
    error NotRegistered(bytes32 agentId);
    error NotAgentOwner(bytes32 agentId, address caller);
    error InvalidCategory();
    error MetadataTooLong(uint256 length, uint256 max);
    error ZeroAddress();

    modifier onlyAgentOwner(bytes32 agentId) {
        Agent storage a = _agents[agentId];
        if (a.owner == address(0)) revert NotRegistered(agentId);
        if (a.owner != msg.sender) revert NotAgentOwner(agentId, msg.sender);
        _;
    }

    /// @notice Register a new agent. The caller becomes its owner. New agents start active.
    function registerAgent(bytes32 agentId, bytes32 categoryId, string calldata metadataURI) external {
        if (agentId == bytes32(0)) revert InvalidAgentId();
        if (categoryId == bytes32(0)) revert InvalidCategory();
        _checkMetadata(metadataURI);
        if (_agents[agentId].owner != address(0)) revert AlreadyRegistered(agentId);

        _agents[agentId] = Agent({
            owner: msg.sender,
            categoryId: categoryId,
            metadataURI: metadataURI,
            active: true,
            registeredAt: uint64(block.timestamp)
        });
        unchecked {
            ++agentCount;
        }
        emit AgentRegistered(agentId, msg.sender, categoryId, metadataURI);
    }

    /// @notice Update the category reference and metadata pointer.
    function updateMetadata(bytes32 agentId, bytes32 categoryId, string calldata metadataURI)
        external
        onlyAgentOwner(agentId)
    {
        if (categoryId == bytes32(0)) revert InvalidCategory();
        _checkMetadata(metadataURI);
        Agent storage a = _agents[agentId];
        a.categoryId = categoryId;
        a.metadataURI = metadataURI;
        emit AgentMetadataUpdated(agentId, categoryId, metadataURI);
    }

    /// @notice Enable or disable the agent's registration.
    function setActive(bytes32 agentId, bool active) external onlyAgentOwner(agentId) {
        Agent storage a = _agents[agentId];
        if (a.active != active) {
            a.active = active;
            emit AgentStatusChanged(agentId, active);
        }
    }

    /// @notice Hand the registration to a new owner wallet (e.g. key rotation).
    function transferAgentOwnership(bytes32 agentId, address newOwner) external onlyAgentOwner(agentId) {
        if (newOwner == address(0)) revert ZeroAddress();
        address previous = _agents[agentId].owner;
        _agents[agentId].owner = newOwner;
        emit AgentOwnershipTransferred(agentId, previous, newOwner);
    }

    // ------------------------------------------------------------------ views
    function isRegistered(bytes32 agentId) external view returns (bool) {
        return _agents[agentId].owner != address(0);
    }

    function getAgent(bytes32 agentId) external view returns (Agent memory) {
        Agent memory a = _agents[agentId];
        if (a.owner == address(0)) revert NotRegistered(agentId);
        return a;
    }

    function ownerOf(bytes32 agentId) external view returns (address) {
        address o = _agents[agentId].owner;
        if (o == address(0)) revert NotRegistered(agentId);
        return o;
    }

    function isActive(bytes32 agentId) external view returns (bool) {
        return _agents[agentId].active;
    }

    function _checkMetadata(string calldata uri) private pure {
        uint256 len = bytes(uri).length;
        if (len > MAX_METADATA_URI_LENGTH) revert MetadataTooLong(len, MAX_METADATA_URI_LENGTH);
    }
}
