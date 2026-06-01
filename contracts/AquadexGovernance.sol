// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./AquadexManager.sol";

/**
 * @title AquadexGovernance
 * @dev Outlines a voting structure to transition addSpecies from an exclusive curator modifier
 * to a decentralized community consensus mechanism.
 */
contract AquadexGovernance {

    // --- Custom Errors (Gas-Optimized Revert Paths) ---

    error ZeroAddress();
    error EmptyScientificName();
    error EmptyCommonName();
    error VotingEnded();
    error ProposalAlreadyExecuted();
    error NoTokensProvided();
    error CallerNotTokenOwner();
    error TokenAlreadyVoted();
    error VotingStillActive();
    error ProposalNotPassed();

    // --- Structs ---
    
    struct Proposal {
        uint256 proposalId;
        string scientificName;
        string commonName;
        string canonicalIpfsUri;
        AquadexStorage.CareLevel careLevel;
        int16 minTempCelsiusX10;
        int16 maxTempCelsiusX10;
        uint8 minPhX10;
        uint8 maxPhX10;
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 endTime;
        bool executed;
        address proposer;
    }

    // --- State Variables ---

    AquadexManager public immutable aquadexManager;
    uint256 public nextProposalId;
    uint256 public votingPeriod; // in seconds

    mapping(uint256 => Proposal) public proposals;
    // proposalId => (tokenId => hasVoted)
    mapping(uint256 => mapping(uint256 => bool)) public hasVoted;

    // --- Events ---

    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        string commonName,
        uint256 endTime
    );
    event Voted(uint256 indexed proposalId, uint256 indexed tokenId, bool support, address indexed voter);
    event ProposalExecuted(uint256 indexed proposalId, uint256 indexed speciesId);

    // --- Constructor ---

    constructor(address _aquadexManager, uint256 _votingPeriod) {
        if (_aquadexManager == address(0)) revert ZeroAddress();
        aquadexManager = AquadexManager(_aquadexManager);
        votingPeriod = _votingPeriod > 0 ? _votingPeriod : 1 days;
        nextProposalId = 1;
    }

    // --- External Functions ---

    /**
     * @dev Proposes a new species to be added to the Master Species Catalog.
     */
    function proposeSpecies(
        string calldata scientificName,
        string calldata commonName,
        string calldata canonicalIpfsUri,
        AquadexStorage.CareLevel careLevel,
        int16 minTempCelsiusX10,
        int16 maxTempCelsiusX10,
        uint8 minPhX10,
        uint8 maxPhX10
    ) external returns (uint256) {
        if (bytes(scientificName).length == 0) revert EmptyScientificName();
        if (bytes(commonName).length == 0) revert EmptyCommonName();

        uint256 proposalId = nextProposalId++;
        uint256 endTime = block.timestamp + votingPeriod;

        proposals[proposalId] = Proposal({
            proposalId: proposalId,
            scientificName: scientificName,
            commonName: commonName,
            canonicalIpfsUri: canonicalIpfsUri,
            careLevel: careLevel,
            minTempCelsiusX10: minTempCelsiusX10,
            maxTempCelsiusX10: maxTempCelsiusX10,
            minPhX10: minPhX10,
            maxPhX10: maxPhX10,
            votesFor: 0,
            votesAgainst: 0,
            endTime: endTime,
            executed: false,
            proposer: msg.sender
        });

        emit ProposalCreated(proposalId, msg.sender, commonName, endTime);
        return proposalId;
    }

    /**
     * @dev Casts votes using specific Specimen ERC-721 token IDs.
     * 1 token = 1 vote. Each token can only vote once per proposal.
     */
    function vote(uint256 proposalId, uint256[] calldata tokenIds, bool support) external {
        Proposal storage proposal = proposals[proposalId];
        if (block.timestamp >= proposal.endTime) revert VotingEnded();
        if (proposal.executed) revert ProposalAlreadyExecuted();
        if (tokenIds.length == 0) revert NoTokensProvided();

        uint256 voteWeight = 0;
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            if (aquadexManager.ownerOf(tokenId) != msg.sender) revert CallerNotTokenOwner();
            if (hasVoted[proposalId][tokenId]) revert TokenAlreadyVoted();

            hasVoted[proposalId][tokenId] = true;
            voteWeight++;
            emit Voted(proposalId, tokenId, support, msg.sender);
        }

        if (support) {
            proposal.votesFor += voteWeight;
        } else {
            proposal.votesAgainst += voteWeight;
        }
    }

    /**
     * @dev Executes a passed proposal, adding the species to the Master Species Catalog.
     * The AquadexManager's curator role MUST be set to this contract's address.
     */
    function executeProposal(uint256 proposalId) external returns (uint256) {
        Proposal storage proposal = proposals[proposalId];
        if (block.timestamp < proposal.endTime) revert VotingStillActive();
        if (proposal.executed) revert ProposalAlreadyExecuted();
        if (proposal.votesFor <= proposal.votesAgainst) revert ProposalNotPassed();

        proposal.executed = true;

        uint256 speciesId = aquadexManager.addSpecies(
            proposal.scientificName,
            proposal.commonName,
            proposal.canonicalIpfsUri,
            proposal.careLevel,
            proposal.minTempCelsiusX10,
            proposal.maxTempCelsiusX10,
            proposal.minPhX10,
            proposal.maxPhX10
        );

        emit ProposalExecuted(proposalId, speciesId);
        return speciesId;
    }
}
