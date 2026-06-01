// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title AquadexStorage
 * @dev Core storage structures for the Aquadex protocol.
 * 
 * Provides structural definitions for:
 * 1. Admin-Curated Master Species Catalog
 * 2. Individual Specimen Registry (linked to ERC-721 IDs)
 * 3. Tank Registry (managing environments and water quality logs)
 * 4. Spawn & Lineage Log (mapping pedigree, parental pairs, and outcomes)
 */
contract AquadexStorage {

    // --- Custom Errors (Gas-Optimized Revert Paths) ---

    error CallerNotCurator();

    // --- Enums ---

    enum CareLevel {
        Easy,
        Medium,
        Difficult,
        Expert
    }

    enum SpecimenStatus {
        Active,
        Deceased,
        Rehomed
    }

    enum TankType {
        Freshwater,
        Saltwater,
        Brackish,
        Pond
    }

    enum ContainmentType {
        Tank,
        Tub,
        Basket
    }

    enum SpawnStatus {
        Egg,
        Fry,
        Raised,
        Failed
    }

    // --- Structures ---

    /**
     * @dev Structure representing a canonical aquatic species.
     * Managed exclusively by the curator/admin to ensure taxonomical standardisation.
     */
    struct Species {
        uint256 speciesId;
        string scientificName;      // e.g. "Paracheirodon innesi"
        string commonName;          // e.g. "Neon Tetra"
        string canonicalIpfsUri;    // IPFS URI containing canonical species details & photos
        CareLevel careLevel;
        int16 minTempCelsiusX10;    // e.g. 220 for 22.0°C
        int16 maxTempCelsiusX10;    // e.g. 265 for 26.5°C
        uint8 minPhX10;             // e.g. 60 for 6.0 pH
        uint8 maxPhX10;             // e.g. 75 for 7.5 pH
        bool active;                // Allows soft-deletion/deprecation by admin
    }

    /**
     * @dev Structure representing an individual specimen (fish/coral/invert).
     * The `specimenId` corresponds directly to its ERC-721 Token ID.
     */
    struct Specimen {
        uint256 specimenId;         // ERC-721 Token ID
        uint256 speciesId;          // Reference to the Master Species Catalog
        uint256 birthTimestamp;     // 0 if unknown/wild-caught
        address breeder;            // Wallet of breeder, or address(0) if unknown/wild-caught
        uint256 currentTankId;      // Reference to the tank registry (0 if unassigned)
        uint256 sireId;             // Father specimen token ID (0 if unknown)
        uint256 damId;              // Mother specimen token ID (0 if unknown)
        string ipfsMetadataUri;     // IPFS metadata URI containing specimen-specific attributes/images
        SpecimenStatus status;
    }

    /**
     * @dev Structure representing an individual tank (aquarium system).
     */
    struct Tank {
        uint256 tankId;
        address owner;              // Owner of the aquarium
        string name;                // e.g. "Nano Aquascape 30L"
        TankType tankType;
        uint32 volumeLiters;        // Tank volume in liters
        uint256 creationTimestamp;
        bool active;
        ContainmentType containment;
        uint256 parentUnitId;       // Reference to parent tankId (0 if top-level)
        string facility;
        string room;
        string rack;
    }

    /**
     * @dev Snapshot of chemical and environmental parameters for a specific tank.
     */
    struct WaterParameterLog {
        uint256 timestamp;
        int16 tempCelsiusX10;       // e.g. 245 for 24.5°C
        uint8 phX10;                // e.g. 74 for 7.4 pH
        uint16 salinitySgX10000;    // e.g. 10250 for 1.0250 SG (mainly saltwater)
        uint16 ammoniaPpmX100;      // e.g. 25 for 0.25 ppm
        uint16 nitritePpmX100;      // e.g. 10 for 0.10 ppm
        uint16 nitratePpmX100;      // e.g. 2000 for 20.0 ppm
        string notes;               // Dosing info, water change logs, general observations
    }

    /**
     * @dev Records a breeding attempt or event, establishing the lineage root.
     */
    struct SpawnRecord {
        uint256 spawnId;
        uint256 sireId;             // Sire (Father) specimen token ID
        uint256 damId;              // Dam (Mother) specimen token ID
        uint256 spawnTimestamp;
        uint256 tankId;             // Tank where the spawn occurred (0 if unknown)
        uint256 hatchTimestamp;     // 0 if not yet hatched or failed
        uint256[] offspringIds;     // Array of minted specimen token IDs resulting from this spawn
        string ipfsLogUri;          // IPFS URI with notes on parental conditioning, egg yield, etc.
        SpawnStatus status;
    }

    /**
     * @dev Structure representing a single spawning log event (eggs/clutches observed).
     */
    struct SpawnLog {
        uint256 spawnId;
        uint256 speciesId;      // Links to the breed code
        address breeder;        // Breeder wallet address
        uint256 eggCount;       // Number of eggs observed
        uint256 eventTimestamp; // Date of spawn event
        string notesIpfsHash;   // Optional notes on water parameters/diet used to trigger
    }

    // --- State Variables ---

    // Protocol Role
    address public curator;

    // Master Catalog Storage
    uint256 public nextSpeciesId;
    mapping(uint256 => Species) public speciesCatalog;

    // Specimen Storage
    uint256 public totalSpecimensMinted;
    mapping(uint256 => Specimen) public specimens;

    // Tank Registry Storage
    uint256 public nextTankId;
    mapping(uint256 => Tank) public tanks;
    
    // Tank logs: tankId => history of water parameter logs
    mapping(uint256 => WaterParameterLog[]) public tankParameterLogs;

    // Spawn & Lineage Storage
    uint256 public nextSpawnId;
    mapping(uint256 => SpawnRecord) public spawnRecords;

    // Spawn Log Storage (Egg/Spawn logging)
    uint256 internal _nextSpawnId;
    mapping(uint256 => SpawnLog) public spawnLogs;

    // --- Indexes & Indexes Helper Structures (For Gas-Efficient Lookups) ---
    
    // User's registered tanks: owner => list of tankIds
    mapping(address => uint256[]) public ownerTanks;
    
    // Specimens currently in a specific tank: tankId => list of specimenIds
    mapping(uint256 => uint256[]) public tankSpecimenIds;
    
    // Mapping from specimenId to its index in the tankSpecimenIds array (supports O(1) removal on move)
    mapping(uint256 => uint256) public specimenTankIndex;

    // Mapping from speciesId (breed) to the list of specimen token IDs
    mapping(uint256 => uint256[]) public breedToSpecimens;

    // --- Events ---

    event CuratorUpdated(address indexed previousCurator, address indexed newCurator);
    
    event SpeciesAdded(
        uint256 indexed speciesId, 
        string scientificName, 
        string commonName, 
        string canonicalIpfsUri
    );
    
    event SpeciesUpdated(
        uint256 indexed speciesId, 
        string scientificName, 
        string commonName, 
        string canonicalIpfsUri
    );

    event SpecimenRegistered(
        uint256 indexed specimenId, 
        uint256 indexed speciesId, 
        address indexed owner, 
        string ipfsMetadataUri
    );

    event SpecimenStatusUpdated(uint256 indexed specimenId, SpecimenStatus status);
    
    event SpecimenMovedToTank(uint256 indexed specimenId, uint256 indexed tankId);

    event TankRegistered(
        uint256 indexed tankId, 
        address indexed owner, 
        string name, 
        TankType tankType, 
        uint32 volumeLiters
    );

    event TankRegisteredExtended(
        uint256 indexed tankId,
        address indexed owner,
        string name,
        TankType tankType,
        uint32 volumeLiters,
        ContainmentType containment,
        uint256 indexed parentUnitId,
        string facility,
        string room,
        string rack
    );

    event TankDeactivated(uint256 indexed tankId);

    event WaterParametersLogged(
        uint256 indexed tankId, 
        uint256 logIndex, 
        int16 tempCelsiusX10, 
        uint8 phX10
    );

    event SpawnLogged(
        uint256 indexed spawnId, 
        uint256 indexed sireId, 
        uint256 indexed damId, 
        uint256 tankId, 
        SpawnStatus status
    );

    event SpawnStatusUpdated(uint256 indexed spawnId, SpawnStatus status);
    
    event OffspringAddedToSpawn(uint256 indexed spawnId, uint256 indexed offspringId);

    // --- Modifiers ---

    modifier onlyCurator() {
        if (msg.sender != curator) revert CallerNotCurator();
        _;
    }

    // --- Constructor ---

    /**
     * @dev Initialises storage and sets the designated primary curator.
     *      Kevin's wallet (0xc42eD9F8Fc56F89380a8eD337169899f425Dc934) is hardcoded
     *      as the curator for the testnet deployment, enforcing onlyCurator access
     *      control for all catalog actions regardless of the deployer address.
     */
    constructor() {
        // Hardcoded primary curator — Kevin (mcdermkev), Project Director
        address designatedCurator = 0xc42eD9F8Fc56F89380a8eD337169899f425Dc934;
        curator = designatedCurator;
        emit CuratorUpdated(address(0), designatedCurator);
        
        // Start counter IDs at 1. This reserves 0 as a default/unset indicator.
        nextSpeciesId = 1;
        nextTankId = 1;
        nextSpawnId = 1;
    }
}
