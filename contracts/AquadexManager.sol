// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./AquadexStorage.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/**
 * @title AquadexManager
 * @dev Main execution layer contract for the Aquadex protocol.
 * Implements logic for species catalog curation, tank registration, water parameters logging,
 * ERC-721 specimen minting, specimen tracking, and spawning logs.
 */
contract AquadexManager is AquadexStorage, ERC721 {

    // --- Custom Errors (Gas-Optimized Revert Paths) ---

    error TokenNonexistent();
    error EmptyScientificName();
    error SpeciesNotFound();
    error SpeciesInactive();
    error CuratorZeroAddress();
    error TankNameEmpty();
    error ParentUnitInactive();
    error CallerNotParentOwner();
    error TankInactive();
    error CallerNotTankOwner();
    error CallerNotSpecimenOwner();
    error SireNotFound();
    error DamNotFound();
    error SpawnNotFound();
    error CallerNotSireOwner();
    error CallerNotDamOwner();
    error Unauthorized();
    error ParentSpeciesMismatch();

    // --- Constructor ---

    constructor() ERC721("Aquadex Specimen", "AQSP") {
        // Both constructors are executed automatically.
        // Curator role is initialized in AquadexStorage constructor.
    }

    // --- Metadata Override ---

    /**
     * @dev Overrides ERC-721 tokenURI to return the specific specimen's IPFS metadata URI.
     */
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        if (specimens[tokenId].specimenId == 0) revert TokenNonexistent();
        return specimens[tokenId].ipfsMetadataUri;
    }

    // --- Curator Catalog Functions ---

    /**
     * @dev Adds a new canonical species to the master catalog.
     * Only callable by the curation address.
     */
    function addSpecies(
        string calldata scientificName,
        string calldata commonName,
        string calldata canonicalIpfsUri,
        CareLevel careLevel,
        int16 minTempCelsiusX10,
        int16 maxTempCelsiusX10,
        uint8 minPhX10,
        uint8 maxPhX10
    ) external onlyCurator returns (uint256) {
        if (bytes(scientificName).length == 0) revert EmptyScientificName();
        
        uint256 newSpeciesId = nextSpeciesId++;
        
        speciesCatalog[newSpeciesId] = Species({
            speciesId: newSpeciesId,
            scientificName: scientificName,
            commonName: commonName,
            canonicalIpfsUri: canonicalIpfsUri,
            careLevel: careLevel,
            minTempCelsiusX10: minTempCelsiusX10,
            maxTempCelsiusX10: maxTempCelsiusX10,
            minPhX10: minPhX10,
            maxPhX10: maxPhX10,
            active: true
        });
        
        emit SpeciesAdded(newSpeciesId, scientificName, commonName, canonicalIpfsUri);
        return newSpeciesId;
    }

    /**
     * @dev Updates an existing species catalog entry.
     * Only callable by the curation address.
     */
    function updateSpecies(
        uint256 speciesId,
        string calldata scientificName,
        string calldata commonName,
        string calldata canonicalIpfsUri,
        CareLevel careLevel,
        int16 minTempCelsiusX10,
        int16 maxTempCelsiusX10,
        uint8 minPhX10,
        uint8 maxPhX10,
        bool active
    ) external onlyCurator {
        if (speciesId == 0 || speciesId >= nextSpeciesId) revert SpeciesNotFound();
        
        Species storage s = speciesCatalog[speciesId];
        s.scientificName = scientificName;
        s.commonName = commonName;
        s.canonicalIpfsUri = canonicalIpfsUri;
        s.careLevel = careLevel;
        s.minTempCelsiusX10 = minTempCelsiusX10;
        s.maxTempCelsiusX10 = maxTempCelsiusX10;
        s.minPhX10 = minPhX10;
        s.maxPhX10 = maxPhX10;
        s.active = active;
        
        emit SpeciesUpdated(speciesId, scientificName, commonName, canonicalIpfsUri);
    }

    /**
     * @dev Transfers curatorship of the protocol to a new address.
     * Only callable by the current curator.
     */
    function transferCuratorship(address newCurator) external onlyCurator {
        if (newCurator == address(0)) revert CuratorZeroAddress();
        emit CuratorUpdated(curator, newCurator);
        curator = newCurator;
    }

    // --- Tank Registry Functions ---

    /**
     * @dev Registers a new aquarium system under the caller's ownership.
     */
    function registerTank(
        string calldata name,
        TankType tankType,
        uint32 volumeLiters
    ) external returns (uint256) {
        return registerTank(name, tankType, volumeLiters, ContainmentType.Tank, 0, "", "", "");
    }

    /**
     * @dev Registers a new aquarium system with containment, nested parent reference, and location tracking.
     */
    function registerTank(
        string calldata name,
        TankType tankType,
        uint32 volumeLiters,
        ContainmentType containment,
        uint256 parentUnitId,
        string memory facility,
        string memory room,
        string memory rack
    ) public returns (uint256) {
        if (bytes(name).length == 0) revert TankNameEmpty();
        
        if (parentUnitId != 0) {
            if (!tanks[parentUnitId].active) revert ParentUnitInactive();
            if (tanks[parentUnitId].owner != msg.sender) revert CallerNotParentOwner();
        }
        
        uint256 newTankId = nextTankId++;
        
        tanks[newTankId] = Tank({
            tankId: newTankId,
            owner: msg.sender,
            name: name,
            tankType: tankType,
            volumeLiters: volumeLiters,
            creationTimestamp: block.timestamp,
            active: true,
            containment: containment,
            parentUnitId: parentUnitId,
            facility: facility,
            room: room,
            rack: rack
        });
        
        ownerTanks[msg.sender].push(newTankId);
        
        emit TankRegisteredExtended(
            newTankId,
            msg.sender,
            name,
            tankType,
            volumeLiters,
            containment,
            parentUnitId,
            facility,
            room,
            rack
        );
        return newTankId;
    }

    /**
     * @dev Logs a new water parameter snapshot for an active tank.
     * Only callable by the tank owner.
     */
    function logWaterParameters(
        uint256 tankId,
        int16 tempCelsiusX10,
        uint8 phX10,
        uint16 salinitySgX10000,
        uint16 ammoniaPpmX100,
        uint16 nitritePpmX100,
        uint16 nitratePpmX100,
        string calldata notes
    ) external {
        if (!tanks[tankId].active) revert TankInactive();
        if (tanks[tankId].owner != msg.sender) revert CallerNotTankOwner();
        
        WaterParameterLog memory log = WaterParameterLog({
            timestamp: block.timestamp,
            tempCelsiusX10: tempCelsiusX10,
            phX10: phX10,
            salinitySgX10000: salinitySgX10000,
            ammoniaPpmX100: ammoniaPpmX100,
            nitritePpmX100: nitritePpmX100,
            nitratePpmX100: nitratePpmX100,
            notes: notes
        });
        
        tankParameterLogs[tankId].push(log);
        uint256 logIndex = tankParameterLogs[tankId].length - 1;
        
        emit WaterParametersLogged(tankId, logIndex, tempCelsiusX10, phX10);
    }

    // --- Specimen Management (ERC-721) ---

    /**
     * @dev Mints a new Specimen token linked to the Master Species Catalog.
     * The minted specimen is owned by the caller.
     */
    function mintSpecimen(
        uint256 speciesId,
        uint256 birthTimestamp,
        address breeder,
        uint256 currentTankId,
        uint256 sireId,
        uint256 damId,
        string calldata ipfsMetadataUri
    ) external returns (uint256) {
        // Validate species in Master Catalog
        if (speciesId == 0 || speciesId >= nextSpeciesId) revert SpeciesNotFound();
        if (!speciesCatalog[speciesId].active) revert SpeciesInactive();

        // Validate target tank if set
        if (currentTankId != 0) {
            if (!tanks[currentTankId].active) revert TankInactive();
            if (tanks[currentTankId].owner != msg.sender) revert CallerNotTankOwner();
        }

        // Validate parental references if present
        if (sireId != 0) {
            if (specimens[sireId].specimenId == 0) revert SireNotFound();
        }
        if (damId != 0) {
            if (specimens[damId].specimenId == 0) revert DamNotFound();
        }

        uint256 newTokenId = ++totalSpecimensMinted;

        specimens[newTokenId] = Specimen({
            specimenId: newTokenId,
            speciesId: speciesId,
            birthTimestamp: birthTimestamp,
            breeder: breeder,
            currentTankId: currentTankId,
            sireId: sireId,
            damId: damId,
            ipfsMetadataUri: ipfsMetadataUri,
            status: SpecimenStatus.Active
        });

        // Update breed index mapping
        breedToSpecimens[speciesId].push(newTokenId);

        // Safe mint the token to the sender
        _safeMint(msg.sender, newTokenId);

        emit SpecimenRegistered(newTokenId, speciesId, msg.sender, ipfsMetadataUri);

        // If tank ID is specified, associate specimen to tank
        if (currentTankId != 0) {
            uint256[] storage tankSpecs = tankSpecimenIds[currentTankId];
            specimenTankIndex[newTokenId] = tankSpecs.length;
            tankSpecs.push(newTokenId);
            emit SpecimenMovedToTank(newTokenId, currentTankId);
        }

        return newTokenId;
    }

    /**
     * @dev Moves a specimen to a different tank.
     * The caller must own the specimen, and must own the target tank (if not 0).
     */
    function moveSpecimenToTank(uint256 specimenId, uint256 newTankId) external {
        if (ownerOf(specimenId) != msg.sender) revert CallerNotSpecimenOwner();
        
        if (newTankId != 0) {
            if (!tanks[newTankId].active) revert TankInactive();
            if (tanks[newTankId].owner != msg.sender) revert CallerNotTankOwner();
        }

        uint256 oldTankId = specimens[specimenId].currentTankId;
        if (oldTankId == newTankId) {
            return; // No state change needed
        }

        // Clean up from old tank
        _removeSpecimenFromTank(specimenId, oldTankId);

        // Add to new tank mapping if not 0
        if (newTankId != 0) {
            uint256[] storage tankSpecs = tankSpecimenIds[newTankId];
            specimenTankIndex[specimenId] = tankSpecs.length;
            tankSpecs.push(specimenId);
        }

        specimens[specimenId].currentTankId = newTankId;

        emit SpecimenMovedToTank(specimenId, newTankId);
    }

    /**
     * @dev Updates the active status of a specimen (e.g. Rehomed, Deceased).
     * Only callable by the specimen owner.
     */
    function updateSpecimenStatus(uint256 specimenId, SpecimenStatus status) external {
        if (ownerOf(specimenId) != msg.sender) revert CallerNotSpecimenOwner();
        
        specimens[specimenId].status = status;
        emit SpecimenStatusUpdated(specimenId, status);
        
        // If deceased or rehomed, clear from tank registry tracking
        if (status != SpecimenStatus.Active) {
            uint256 oldTankId = specimens[specimenId].currentTankId;
            if (oldTankId != 0) {
                _removeSpecimenFromTank(specimenId, oldTankId);
                specimens[specimenId].currentTankId = 0;
                emit SpecimenMovedToTank(specimenId, 0);
            }
        }
    }

    // --- Spawn & Lineage Logs ---

    /**
     * @dev Initiates a new breeding SpawnRecord.
     * Parents (Sire/Dam) must be owned by the caller if specified.
     * Spawning tank must be owned by the caller if specified.
     */
    function initiateSpawn(
        uint256 sireId,
        uint256 damId,
        uint256 tankId,
        string calldata ipfsLogUri
    ) external returns (uint256) {
        if (sireId != 0) {
            if (ownerOf(sireId) != msg.sender) revert CallerNotSireOwner();
        }
        if (damId != 0) {
            if (ownerOf(damId) != msg.sender) revert CallerNotDamOwner();
        }
        if (tankId != 0) {
            if (!tanks[tankId].active) revert TankInactive();
            if (tanks[tankId].owner != msg.sender) revert CallerNotTankOwner();
        }

        uint256 newSpawnId = nextSpawnId++;
        
        SpawnRecord storage record = spawnRecords[newSpawnId];
        record.spawnId = newSpawnId;
        record.sireId = sireId;
        record.damId = damId;
        record.spawnTimestamp = block.timestamp;
        record.tankId = tankId;
        record.hatchTimestamp = 0;
        record.ipfsLogUri = ipfsLogUri;
        record.status = SpawnStatus.Egg;

        emit SpawnLogged(newSpawnId, sireId, damId, tankId, SpawnStatus.Egg);
        return newSpawnId;
    }

    /**
     * @dev Updates the developmental status and hatch timing of a spawn event.
     */
    function updateSpawnStatus(
        uint256 spawnId,
        SpawnStatus status,
        uint256 hatchTimestamp
    ) external {
        SpawnRecord storage record = spawnRecords[spawnId];
        if (record.spawnId == 0) revert SpawnNotFound();
        
        // Authorization check: Caller must own either parent or the tank the spawn occurred in
        if (record.sireId != 0) {
            if (ownerOf(record.sireId) != msg.sender) revert CallerNotSireOwner();
        } else if (record.damId != 0) {
            if (ownerOf(record.damId) != msg.sender) revert CallerNotDamOwner();
        } else if (record.tankId != 0) {
            if (tanks[record.tankId].owner != msg.sender) revert CallerNotTankOwner();
        } else {
            if (msg.sender != curator) revert Unauthorized();
        }

        record.status = status;
        if (status == SpawnStatus.Fry && record.hatchTimestamp == 0) {
            record.hatchTimestamp = hatchTimestamp != 0 ? hatchTimestamp : block.timestamp;
        }

        emit SpawnStatusUpdated(spawnId, status);
    }

    /**
     * @dev Registers a new specimen as an offspring of an existing SpawnRecord.
     * Offspring is automatically assigned to the breeding spawn's tank.
     */
    function registerSpawnOffspring(
        uint256 spawnId,
        uint256 speciesId,
        uint256 birthTimestamp,
        string calldata ipfsMetadataUri
    ) external returns (uint256) {
        SpawnRecord storage record = spawnRecords[spawnId];
        if (record.spawnId == 0) revert SpawnNotFound();

        // Authorization check: Caller must own either parent or the tank the spawn occurred in
        if (record.sireId != 0) {
            if (ownerOf(record.sireId) != msg.sender) revert CallerNotSireOwner();
        } else if (record.damId != 0) {
            if (ownerOf(record.damId) != msg.sender) revert CallerNotDamOwner();
        } else if (record.tankId != 0) {
            if (tanks[record.tankId].owner != msg.sender) revert CallerNotTankOwner();
        } else {
            if (msg.sender != curator) revert Unauthorized();
        }

        // Validate species catalog details
        if (speciesId == 0 || speciesId >= nextSpeciesId) revert SpeciesNotFound();
        if (!speciesCatalog[speciesId].active) revert SpeciesInactive();

        // Validate biological parent species mismatch
        if (record.sireId != 0) {
            if (specimens[record.sireId].speciesId != speciesId) revert ParentSpeciesMismatch();
        }
        if (record.damId != 0) {
            if (specimens[record.damId].speciesId != speciesId) revert ParentSpeciesMismatch();
        }

        uint256 newTokenId = ++totalSpecimensMinted;

        specimens[newTokenId] = Specimen({
            specimenId: newTokenId,
            speciesId: speciesId,
            birthTimestamp: birthTimestamp,
            breeder: msg.sender,
            currentTankId: record.tankId,
            sireId: record.sireId,
            damId: record.damId,
            ipfsMetadataUri: ipfsMetadataUri,
            status: SpecimenStatus.Active
        });

        // Update breed index mapping
        breedToSpecimens[speciesId].push(newTokenId);

        // Safe mint to breeder/caller
        _safeMint(msg.sender, newTokenId);

        // Record offspring in spawn
        record.offspringIds.push(newTokenId);

        emit SpecimenRegistered(newTokenId, speciesId, msg.sender, ipfsMetadataUri);
        emit OffspringAddedToSpawn(spawnId, newTokenId);

        // Put offspring into breeding tank tracker
        if (record.tankId != 0) {
            uint256[] storage tankSpecs = tankSpecimenIds[record.tankId];
            specimenTankIndex[newTokenId] = tankSpecs.length;
            tankSpecs.push(newTokenId);
            emit SpecimenMovedToTank(newTokenId, record.tankId);
        }

        return newTokenId;
    }

    /**
     * @dev Records a new spawn event log (egg/clutch observation).
     */
    function logSpawnEvent(
        uint256 speciesId, 
        uint256 eggCount, 
        string memory notesHash
    ) external returns (uint256) {
        _nextSpawnId++;
        spawnLogs[_nextSpawnId] = SpawnLog({
            spawnId: _nextSpawnId,
            speciesId: speciesId,
            breeder: msg.sender,
            eggCount: eggCount,
            eventTimestamp: block.timestamp,
            notesIpfsHash: notesHash
        });
        return _nextSpawnId;
    }

    // --- View Functions for Breed/Species Gallery ---

    /**
     * @dev Returns the total number of registered specimens for a breed. Helpful for pagination.
     */
    function getSpecimensCountByBreed(uint256 speciesId) external view returns (uint256) {
        return breedToSpecimens[speciesId].length;
    }

    /**
     * @dev Returns all specimen token IDs registered under a specific species ID (breed).
     */
    function getSpecimensByBreed(uint256 speciesId) external view returns (uint256[] memory) {
        return breedToSpecimens[speciesId];
    }

    // --- Internal Helpers ---

    /**
     * @dev O(1) swap-and-pop function to clean up array references when moving/removing specimens.
     */
    function _removeSpecimenFromTank(uint256 specimenId, uint256 tankId) internal {
        if (tankId == 0) return;
        
        uint256[] storage tankSpecs = tankSpecimenIds[tankId];
        uint256 indexToRemove = specimenTankIndex[specimenId];
        uint256 lastIndex = tankSpecs.length - 1;
        
        if (indexToRemove != lastIndex) {
            uint256 lastSpecimenId = tankSpecs[lastIndex];
            tankSpecs[indexToRemove] = lastSpecimenId;
            specimenTankIndex[lastSpecimenId] = indexToRemove;
        }
        
        tankSpecs.pop();
        delete specimenTankIndex[specimenId];
    }
}
