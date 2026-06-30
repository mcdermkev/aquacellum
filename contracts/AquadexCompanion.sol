// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AquadexCompanion
 * @dev Soulbound ERC-721 companion NFT for the Aquadex protocol.
 *
 * Each user mints exactly ONE Echo companion that:
 *   - Is non-transferable (soulbound)
 *   - Has unique generative DNA derived from wallet + block entropy
 *   - Evolves through 7 life stages based on sustained care
 *   - Develops personality axes over time
 *
 * Echo cannot be sold, traded, or transferred. She lives with her
 * owner's wallet forever.
 */
contract AquadexCompanion is ERC721, Ownable {

    // ─── Custom Errors ───────────────────────────────────────────────────
    error AlreadyHatched();
    error NotHatched();
    error Soulbound();
    error InsufficientXpToHatch();
    error NotTokenOwner();
    error InvalidStageTransition();
    error EvolutionRequirementsNotMet();
    error CallerNotRelayer();

    // ─── Enums ───────────────────────────────────────────────────────────

    enum Stage {
        Egg,        // 0
        Larva,      // 1
        Fry,        // 2
        Juvenile,   // 3
        Adult,      // 4
        Elder,      // 5
        Legendary   // 6
    }

    // ─── Structs ─────────────────────────────────────────────────────────

    /**
     * @dev Immutable DNA generated at mint. Drives all visual traits.
     */
    struct EchoDNA {
        uint256 seed;           // Master seed (keccak of wallet + block data)
        uint8 bodyShape;        // 0–7 (8 silhouettes)
        uint8 pattern;          // 0–11 (12 pattern types)
        uint8 finStyle;         // 0–9 (10 fin variants)
        uint8 eyeType;          // 0–5 (6 eye types)
        uint8 signatureMark;    // 0–19 (20 unique accents)
        uint16 baseHue;         // 0–359 (hue degrees)
        uint16 secondaryHue;    // 0–359 (accent hue)
    }

    /**
     * @dev Mutable on-chain state tracking Echo's growth and personality.
     */
    struct EchoState {
        Stage currentStage;         // Current life stage
        uint32 totalCareDays;       // Cumulative days with care actions
        uint16 longestStreak;       // All-time best streak
        uint16 speciesWitnessed;    // Unique species scanned/added
        uint16 rareMoments;         // Rare animation events triggered
        uint40 birthTimestamp;      // Block timestamp of mint
        uint40 lastEvolution;       // Timestamp of last stage change
        uint8 personalityNurturing;     // 0–100
        uint8 personalityAnalytical;    // 0–100
        uint8 personalityAdventurous;   // 0–100
        uint8 personalitySocial;        // 0–100
        uint8 personalityCalm;          // 0–100
        uint8 personalityCreative;      // 0–100
    }

    // ─── State Variables ─────────────────────────────────────────────────

    /// @dev Token ID counter (each user gets exactly one)
    uint256 private _nextTokenId;

    /// @dev Authorized relayer address for off-chain → on-chain state updates
    address public relayer;

    /// @dev Minimum XP required to hatch (checked off-chain, enforced by relayer)
    uint256 public constant HATCH_THRESHOLD = 500;

    /// @dev Mapping: wallet → token ID (0 means not minted)
    mapping(address => uint256) public echoOf;

    /// @dev Mapping: token ID → DNA (immutable after mint)
    mapping(uint256 => EchoDNA) public echoDna;

    /// @dev Mapping: token ID → mutable state
    mapping(uint256 => EchoState) public echoState;

    // ─── Events ──────────────────────────────────────────────────────────

    event EchoHatched(address indexed owner, uint256 indexed tokenId, uint256 seed);
    event EchoEvolved(uint256 indexed tokenId, Stage fromStage, Stage toStage);
    event EchoStatsUpdated(uint256 indexed tokenId, uint32 totalCareDays, uint16 longestStreak);
    event PersonalityUpdated(uint256 indexed tokenId);
    event RelayerUpdated(address indexed oldRelayer, address indexed newRelayer);

    // ─── Modifiers ───────────────────────────────────────────────────────

    modifier onlyRelayer() {
        if (msg.sender != relayer && msg.sender != owner()) revert CallerNotRelayer();
        _;
    }

    modifier onlyEchoOwner(uint256 tokenId) {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────

    constructor(address _relayer) ERC721("Aquadex Echo Companion", "ECHO") Ownable(msg.sender) {
        relayer = _relayer;
        _nextTokenId = 1; // Start at 1 (0 reserved as "no token")
    }

    // ─── Soulbound Override ──────────────────────────────────────────────

    /**
     * @dev Override _update to prevent all transfers. Echo is soulbound.
     * Only allows minting (from == address(0)) and burning (to == address(0)).
     */
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);

        // Allow minting (from zero) and burning (to zero) only
        if (from != address(0) && to != address(0)) {
            revert Soulbound();
        }

        return super._update(to, tokenId, auth);
    }

    // ─── Core Functions ──────────────────────────────────────────────────

    /**
     * @dev Hatch a new Echo companion. One per wallet, ever.
     * Called by the user directly when they reach 500 XP (validated client-side).
     * DNA is generated deterministically from wallet + block entropy.
     */
    function hatch() external returns (uint256 tokenId) {
        if (echoOf[msg.sender] != 0) revert AlreadyHatched();

        tokenId = _nextTokenId++;

        // Generate deterministic DNA from wallet + block entropy
        uint256 seed = uint256(
            keccak256(abi.encodePacked(msg.sender, block.timestamp, block.prevrandao))
        );

        // Derive traits from seed bytes
        EchoDNA memory dna = EchoDNA({
            seed: seed,
            bodyShape: uint8(seed % 8),
            pattern: uint8((seed >> 32) % 12),
            finStyle: uint8((seed >> 64) % 10),
            eyeType: uint8((seed >> 96) % 6),
            signatureMark: uint8((seed >> 128) % 20),
            baseHue: uint16((seed >> 160) % 360),
            secondaryHue: uint16((seed >> 192) % 360)
        });

        // Store DNA (immutable after this point)
        echoDna[tokenId] = dna;

        // Initialize state
        echoState[tokenId] = EchoState({
            currentStage: Stage.Egg,
            totalCareDays: 0,
            longestStreak: 0,
            speciesWitnessed: 0,
            rareMoments: 0,
            birthTimestamp: uint40(block.timestamp),
            lastEvolution: uint40(block.timestamp),
            personalityNurturing: 10,
            personalityAnalytical: 10,
            personalityAdventurous: 10,
            personalitySocial: 10,
            personalityCalm: 10,
            personalityCreative: 10
        });

        // Record ownership mapping
        echoOf[msg.sender] = tokenId;

        // Mint the soulbound token
        _mint(msg.sender, tokenId);

        emit EchoHatched(msg.sender, tokenId, seed);
    }

    /**
     * @dev Evolve Echo to the next stage. Called by relayer when requirements are met.
     * @param tokenId The Echo token to evolve
     * @param newStage The target stage (must be exactly currentStage + 1)
     */
    function evolve(uint256 tokenId, Stage newStage) external onlyRelayer {
        EchoState storage state = echoState[tokenId];
        if (state.birthTimestamp == 0) revert NotHatched();

        // Must be exactly one stage ahead
        if (uint8(newStage) != uint8(state.currentStage) + 1) {
            revert InvalidStageTransition();
        }

        // Validate requirements per stage
        if (newStage == Stage.Larva) {
            // 3 care days after hatch
            if (state.totalCareDays < 3) revert EvolutionRequirementsNotMet();
        } else if (newStage == Stage.Fry) {
            // 7-day streak achieved
            if (state.longestStreak < 7) revert EvolutionRequirementsNotMet();
        } else if (newStage == Stage.Juvenile) {
            // 30 care days (tank count checked off-chain)
            if (state.totalCareDays < 30) revert EvolutionRequirementsNotMet();
        } else if (newStage == Stage.Adult) {
            // 90 care days + 10 species
            if (state.totalCareDays < 90 || state.speciesWitnessed < 10) {
                revert EvolutionRequirementsNotMet();
            }
        } else if (newStage == Stage.Elder) {
            // 180 care days
            if (state.totalCareDays < 180) revert EvolutionRequirementsNotMet();
        } else if (newStage == Stage.Legendary) {
            // 365 care days
            if (state.totalCareDays < 365) revert EvolutionRequirementsNotMet();
        }

        Stage fromStage = state.currentStage;
        state.currentStage = newStage;
        state.lastEvolution = uint40(block.timestamp);

        emit EchoEvolved(tokenId, fromStage, newStage);
    }

    /**
     * @dev Update Echo's care statistics. Called by relayer periodically.
     * @param tokenId The Echo token
     * @param newTotalCareDays Updated cumulative care days
     * @param newLongestStreak Updated longest streak
     * @param newSpeciesWitnessed Updated species count
     */
    function updateStats(
        uint256 tokenId,
        uint32 newTotalCareDays,
        uint16 newLongestStreak,
        uint16 newSpeciesWitnessed
    ) external onlyRelayer {
        EchoState storage state = echoState[tokenId];
        if (state.birthTimestamp == 0) revert NotHatched();

        // Stats can only increase (anti-gaming)
        if (newTotalCareDays > state.totalCareDays) {
            state.totalCareDays = newTotalCareDays;
        }
        if (newLongestStreak > state.longestStreak) {
            state.longestStreak = newLongestStreak;
        }
        if (newSpeciesWitnessed > state.speciesWitnessed) {
            state.speciesWitnessed = newSpeciesWitnessed;
        }

        emit EchoStatsUpdated(tokenId, state.totalCareDays, state.longestStreak);
    }

    /**
     * @dev Increment rare moments counter. Called when user triggers a rare event.
     * @param tokenId The Echo token
     */
    function recordRareMoment(uint256 tokenId) external onlyRelayer {
        EchoState storage state = echoState[tokenId];
        if (state.birthTimestamp == 0) revert NotHatched();
        state.rareMoments++;
    }

    /**
     * @dev Update Echo's personality axes. Called monthly by relayer after
     * off-chain personality drift calculation.
     * @param tokenId The Echo token
     * @param nurturing New nurturing axis value (0–100)
     * @param analytical New analytical axis value (0–100)
     * @param adventurous New adventurous axis value (0–100)
     * @param social New social axis value (0–100)
     * @param calm New calm axis value (0–100)
     * @param creative New creative axis value (0–100)
     */
    function updatePersonality(
        uint256 tokenId,
        uint8 nurturing,
        uint8 analytical,
        uint8 adventurous,
        uint8 social,
        uint8 calm,
        uint8 creative
    ) external onlyRelayer {
        EchoState storage state = echoState[tokenId];
        if (state.birthTimestamp == 0) revert NotHatched();

        state.personalityNurturing = nurturing > 100 ? 100 : nurturing;
        state.personalityAnalytical = analytical > 100 ? 100 : analytical;
        state.personalityAdventurous = adventurous > 100 ? 100 : adventurous;
        state.personalitySocial = social > 100 ? 100 : social;
        state.personalityCalm = calm > 100 ? 100 : calm;
        state.personalityCreative = creative > 100 ? 100 : creative;

        emit PersonalityUpdated(tokenId);
    }

    // ─── View Functions ──────────────────────────────────────────────────

    /**
     * @dev Get the full DNA of an Echo.
     */
    function getDna(uint256 tokenId) external view returns (EchoDNA memory) {
        return echoDna[tokenId];
    }

    /**
     * @dev Get the full mutable state of an Echo.
     */
    function getState(uint256 tokenId) external view returns (EchoState memory) {
        return echoState[tokenId];
    }

    /**
     * @dev Get the token ID for a given wallet. Returns 0 if not hatched.
     */
    function getEchoByWallet(address wallet) external view returns (uint256) {
        return echoOf[wallet];
    }

    /**
     * @dev Check if a wallet has hatched an Echo.
     */
    function hasEcho(address wallet) external view returns (bool) {
        return echoOf[wallet] != 0;
    }

    /**
     * @dev Get full companion data in a single call (gas-efficient for frontend).
     */
    function getFullEcho(address wallet) external view returns (
        uint256 tokenId,
        EchoDNA memory dna,
        EchoState memory state
    ) {
        tokenId = echoOf[wallet];
        if (tokenId != 0) {
            dna = echoDna[tokenId];
            state = echoState[tokenId];
        }
    }

    // ─── Admin Functions ─────────────────────────────────────────────────

    /**
     * @dev Update the relayer address. Only owner.
     */
    function setRelayer(address newRelayer) external onlyOwner {
        address old = relayer;
        relayer = newRelayer;
        emit RelayerUpdated(old, newRelayer);
    }

    // ─── Token URI ───────────────────────────────────────────────────────

    /**
     * @dev Returns on-chain metadata as a data URI (no IPFS dependency).
     * Frontend renders the SVG from trait data — this provides basic metadata
     * for wallet display compatibility.
     */
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);

        EchoDNA memory dna = echoDna[tokenId];
        EchoState memory state = echoState[tokenId];

        // Return a minimal JSON metadata pointing to parametric rendering
        return string(abi.encodePacked(
            'data:application/json,{"name":"Echo #',
            _toString(tokenId),
            '","description":"A soulbound living companion from Aquadex. Evolves with care.",',
            '"attributes":[',
            '{"trait_type":"Stage","value":"', _stageName(state.currentStage), '"},',
            '{"trait_type":"Body Shape","value":"', _toString(dna.bodyShape), '"},',
            '{"trait_type":"Pattern","value":"', _toString(dna.pattern), '"},',
            '{"trait_type":"Fin Style","value":"', _toString(dna.finStyle), '"},',
            '{"trait_type":"Base Hue","value":"', _toString(dna.baseHue), '"},',
            '{"trait_type":"Care Days","value":"', _toString(uint256(state.totalCareDays)), '"}',
            ']}'
        ));
    }

    // ─── Internal Helpers ────────────────────────────────────────────────

    function _stageName(Stage s) internal pure returns (string memory) {
        if (s == Stage.Egg) return "Egg";
        if (s == Stage.Larva) return "Larva";
        if (s == Stage.Fry) return "Fry";
        if (s == Stage.Juvenile) return "Juvenile";
        if (s == Stage.Adult) return "Adult";
        if (s == Stage.Elder) return "Elder";
        return "Legendary";
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    /**
     * @dev Prevent approval operations (soulbound — no transfers possible).
     */
    function approve(address, uint256) public pure override {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }
}
