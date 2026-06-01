// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./AquadexManager.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title AquadexMarketplace
 * @dev Implements secure escrow-based trading of specimen tokens with a 4% fee split directed
 * to the marine Conservation, ecosystem, and founders treasuries. Safe transfers are built using the Checks-Effects-Interactions (CEI) standard.
 */
contract AquadexMarketplace is IERC721Receiver, AccessControl {

    // --- Custom Errors (Gas-Optimized Revert Paths) ---

    error ZeroAddress();
    error PriceZero();
    error CallerNotOwner();
    error ListingNotActive();
    error CallerNotSeller();
    error InsufficientPayment();
    error QuantityZero();
    error QuantityExceedsAvailable();
    error IncorrectPayment();
    error EscrowAlreadyResolved();
    error NotShippingFulfillment();
    error NotInPersonFulfillment();
    error Unauthorized();
    error InvalidCommitment();
    error TransferFailed();
    error MaxBatchExceeded();
    error EmptyTokenList();
    error SellerMismatch();
    error NotShippingListing();
    error EscrowNotLocked();
    error EscrowNotDispatched();
    error TrackingEmpty();
    error SafetyWindowNotElapsed();
    error SafetyWindowPassed();
    error NotInDispute();
    error InvalidRefundStatus();
    error InvalidAddress();
    error EventInactive();
    error EventWindowClosed();
    error BatchQuantityExceeded();
    error CallerNotAdmin();
    error CallerNotCurator();

    // --- Enums & Structs ---

    enum EscrowState { LOCKED, RELEASED, REFUNDED }

    struct Listing {
        uint256 tokenId;
        address seller;
        uint256 price;
        uint256 shippingFee;
        bool active;
        bool isShipping;
    }

    enum ShippingStatus { LOCKED, DISPATCHED, RELEASED, DISPUTED, REFUNDED }

    struct ShippingEscrow {
        uint256 tokenId;
        address buyer;
        address seller;
        uint256 price;
        uint256 shippingFee;
        uint256 amountLocked;
        string trackingNumber;
        uint256 dispatchTimestamp;
        ShippingStatus status;
    }

    struct BatchListing {
        uint256 listingId;
        uint256 spawnId;      // References the original spawn event
        uint256 quantity;     // Number of available juveniles
        uint256 pricePerFish; // Price in Wei
        address seller;
        bool isActive;
    }

    struct EscrowPurchase {
        uint256 purchaseId;
        uint256 listingId;
        address buyer;
        uint256 quantity;
        uint256 amountLocked;
        bytes32 commitmentHash; // cryptographically secure commit-reveal hash
        EscrowState state;
        uint8 fulfillmentType; // 0 = Shipping, 1 = In-Person
    }

    // --- State Variables ---

    AquadexManager public immutable aquadexManager;
    
    address public marineConservationTreasury;
    address public ecosystemTreasury;
    address public kevin;
    address public steve;
    address public coFounder;

    address public operationalDevelopmentWallet;

    struct LiveEvent {
        uint256 eventId;
        uint256 startTime;
        uint256 endTime;
        bool active;
    }
    mapping(uint256 => LiveEvent) public liveEvents;

    bytes32 public constant COUNCIL_MEMBER_ROLE = keccak256("COUNCIL_MEMBER_ROLE");
    uint256 public constant TOTAL_FEE_BPS = 400; // 4.0% fee
    uint256 private constant MAX_BATCH_CHECKOUT_SIZE = 6;

    mapping(uint256 => Listing) public listings;
    mapping(uint256 => BatchListing) public batchListings;
    uint256 internal _nextBatchListingId;

    mapping(uint256 => EscrowPurchase) public escrowPurchases;
    uint256 internal _nextPurchaseId;

    // Convenient lookup from spawnId to its active listing
    mapping(uint256 => uint256) public spawnToListing;

    mapping(uint256 => ShippingEscrow) public shippingEscrows;
    uint256 public constant SHIPPING_SAFETY_WINDOW = 3 days;

    // --- Events ---

    event SpecimenListed(uint256 indexed tokenId, address indexed seller, uint256 price);
    event ListingCancelled(uint256 indexed tokenId, address indexed seller);
    event SpecimenPurchased(
        uint256 indexed tokenId, 
        address indexed seller, 
        address indexed buyer, 
        uint256 price, 
        uint256 fee
    );
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    event ShippingListingCreated(uint256 indexed tokenId, address indexed seller, uint256 price, uint256 shippingFee);
    event ShippingPurchaseCreated(uint256 indexed tokenId, address indexed buyer, uint256 amountLocked);
    event ShippingDispatched(uint256 indexed tokenId, string trackingNumber, uint256 dispatchTimestamp);
    event ShippingEscrowReleased(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 amount);
    event ShippingEscrowRefunded(uint256 indexed tokenId, address indexed buyer, uint256 amount);
    event ShippingDisputed(uint256 indexed tokenId);

    event BatchListed(
        uint256 indexed listingId,
        uint256 indexed spawnId,
        uint256 quantity,
        uint256 pricePerFish,
        address indexed seller
    );
    event BatchPurchased(
        uint256 indexed purchaseId,
        uint256 indexed listingId,
        address indexed buyer,
        uint256 quantity,
        uint256 amountLocked
    );
    event EscrowReleased(
        uint256 indexed purchaseId,
        address indexed seller,
        address indexed buyer,
        uint256 amount
    );
    event EscrowRefunded(
        uint256 indexed purchaseId,
        address indexed buyer,
        uint256 amount
    );
    event BatchListingCancelled(uint256 indexed listingId, address indexed seller);

    event XPEarned(address indexed user, uint256 amount, string reason);

    // --- Constructor ---

    constructor(
        address _aquadexManager,
        address _marineConservationTreasury,
        address _ecosystemTreasury,
        address _kevin,
        address _steve,
        address _coFounder
    ) {
        if (_aquadexManager == address(0)) revert ZeroAddress();
        if (_marineConservationTreasury == address(0)) revert ZeroAddress();
        if (_ecosystemTreasury == address(0)) revert ZeroAddress();
        if (_kevin == address(0)) revert ZeroAddress();
        if (_steve == address(0)) revert ZeroAddress();
        if (_coFounder == address(0)) revert ZeroAddress();

        aquadexManager = AquadexManager(_aquadexManager);
        marineConservationTreasury = _marineConservationTreasury;
        ecosystemTreasury = _ecosystemTreasury;
        kevin = _kevin;
        steve = _steve;
        coFounder = _coFounder;

        operationalDevelopmentWallet = _coFounder;
        liveEvents[1] = LiveEvent({
            eventId: 1,
            startTime: block.timestamp - 1 days,
            endTime: block.timestamp + 7 days,
            active: true
        });

        _grantRole(DEFAULT_ADMIN_ROLE, _kevin);
        _grantRole(DEFAULT_ADMIN_ROLE, _steve);
        _grantRole(DEFAULT_ADMIN_ROLE, _coFounder);

        _grantRole(COUNCIL_MEMBER_ROLE, _kevin);
        _grantRole(COUNCIL_MEMBER_ROLE, _steve);
        _grantRole(COUNCIL_MEMBER_ROLE, _coFounder);

        emit TreasuryUpdated(address(0), _ecosystemTreasury);
    }

    // --- Internal Helpers ---

    /**
     * @dev Distributes the collected protocol fee according to the testnet fee split:
     *
     *   ┌─────────────────────────────────────────────────────────────────────────┐
     *   │  TESTNET FEE DISTRIBUTION (4% of transaction price)                    │
     *   ├──────────────────────────────┬──────────────────────────────────────────┤
     *   │  Bucket                      │  Routing                                 │
     *   ├──────────────────────────────┼──────────────────────────────────────────┤
     *   │  65% Operations              │  → kevin (testnet holding wallet)        │
     *   │  (Marine Conservation +      │    0xc42eD9F8Fc56F89380a8eD337169899f425Dc934 │
     *   │   Ecosystem/Dev Treasury)    │                                          │
     *   ├──────────────────────────────┼──────────────────────────────────────────┤
     *   │  35% Co-Founder Split        │  Divided equally among 3 founder slots:  │
     *   │                              │  • kevin  (slot 1)                       │
     *   │                              │  • steve  (slot 2)                       │
     *   │                              │  • kevin  (slot 3 — testnet placeholder) │
     *   │                              │  Dust (rounding remainder) → slot 3      │
     *   └──────────────────────────────┴──────────────────────────────────────────┘
     *
     *  CEI: all state changes happen before this call; only ETH transfers here.
     */
    function _distributeFees(uint256 totalFee) internal {
        if (totalFee == 0) return;

        // 65% → operations holding wallet (kevin, testnet)
        // 35% → co-founder split (3 equal slots; dust to slot 3)
        uint256 opsShare      = (totalFee * 65) / 100;
        uint256 foundersShare = totalFee - opsShare; // avoids rounding dust at top level

        // Operations bucket → kevin acting as testnet holding environment
        if (opsShare > 0) {
            (bool successOps, ) = payable(marineConservationTreasury).call{value: opsShare}("");
            if (!successOps) revert TransferFailed();
        }

        // Co-founder bucket → 3 equal slots; remainder dust goes to slot 3 (coFounder)
        if (foundersShare > 0) {
            uint256 sharePerFounder = foundersShare / 3;
            uint256 dust = foundersShare - (sharePerFounder * 2); // slot 3 absorbs dust

            (bool successK, ) = payable(kevin).call{value: sharePerFounder}("");
            if (!successK) revert TransferFailed();

            (bool successS, ) = payable(steve).call{value: sharePerFounder}("");
            if (!successS) revert TransferFailed();

            (bool successCF, ) = payable(coFounder).call{value: dust}("");
            if (!successCF) revert TransferFailed();
        }
    }

    // --- External Functions ---

    /**
     * @dev Lists a specimen for sale, transferring custody into the marketplace's escrow.
     * Seller must have approved the marketplace first on the token contract.
     */
    function listSpecimen(uint256 tokenId, uint256 price) external {
        if (price == 0) revert PriceZero();
        if (aquadexManager.ownerOf(tokenId) != msg.sender) revert CallerNotOwner();

        // Escrow Lockup: transfer the token to this contract
        aquadexManager.transferFrom(msg.sender, address(this), tokenId);

        listings[tokenId] = Listing({
            tokenId: tokenId,
            seller: msg.sender,
            price: price,
            shippingFee: 0,
            active: true,
            isShipping: false
        });

        emit SpecimenListed(tokenId, msg.sender, price);
    }

    /**
     * @dev Cancels a listing and returns the specimen from escrow back to the seller.
     */
    function cancelListing(uint256 tokenId) external {
        Listing storage listing = listings[tokenId];
        if (!listing.active) revert ListingNotActive();
        if (listing.seller != msg.sender) revert CallerNotSeller();

        listing.active = false;
        delete listings[tokenId];

        // Return token from escrow to seller
        aquadexManager.safeTransferFrom(address(this), msg.sender, tokenId);

        emit ListingCancelled(tokenId, msg.sender);
    }

    /**
     * @dev Purchases a listed specimen. strictly adheres to Checks-Effects-Interactions standard.
     */
    function purchaseSpecimen(uint256 tokenId) external payable {
        Listing storage listing = listings[tokenId];
        if (!listing.active) revert ListingNotActive();
        if (msg.value < listing.price) revert InsufficientPayment();

        address seller = listing.seller;
        uint256 price = listing.price;

        // Effects: delete listing before external transfers (CEI)
        listing.active = false;
        delete listings[tokenId];

        // Compute 4% protocol fee using BPS
        uint256 fee = (price * TOTAL_FEE_BPS) / 10000;
        uint256 sellerProceeds = price - fee;

        // Interactions:
        // 1. Transfer Specimen to buyer
        aquadexManager.safeTransferFrom(address(this), msg.sender, tokenId);

        // 2. Transfer proceeds to seller
        (bool successSeller, ) = payable(seller).call{value: sellerProceeds}("");
        if (!successSeller) revert TransferFailed();

        // 3. Distribute fees
        _distributeFees(fee);

        // 4. Refund excess payment if any
        if (msg.value > price) {
            uint256 excess = msg.value - price;
            (bool successRefund, ) = payable(msg.sender).call{value: excess}("");
            if (!successRefund) revert TransferFailed();
        }

        emit SpecimenPurchased(tokenId, seller, msg.sender, price, fee);
        emit XPEarned(msg.sender, 100, "Purchase Specimen");
        emit XPEarned(seller, 150, "Sale Settled");
    }

    /**
     * @dev Creates a batch listing of juvenile fish directly from an on-chain spawn log.
     */
    function createBatchListing(
        uint256 spawnId,
        uint256 quantity,
        uint256 pricePerFish
    ) external returns (uint256) {
        if (quantity == 0) revert QuantityZero();
        if (pricePerFish == 0) revert PriceZero();

        // Verify msg.sender is the original breeder of the spawn log
        (, , address breeder, , , ) = aquadexManager.spawnLogs(spawnId);
        if (breeder != msg.sender) revert CallerNotOwner();

        _nextBatchListingId++;
        uint256 listingId = _nextBatchListingId;

        batchListings[listingId] = BatchListing({
            listingId: listingId,
            spawnId: spawnId,
            quantity: quantity,
            pricePerFish: pricePerFish,
            seller: msg.sender,
            isActive: true
        });

        spawnToListing[spawnId] = listingId;

        emit BatchListed(listingId, spawnId, quantity, pricePerFish, msg.sender);
        return listingId;
    }

    /**
     * @dev Purchases a quantity of juveniles from a batch listing, locking the deposit into escrow.
     */
    function purchaseBatch(uint256 listingId, uint256 quantity) external payable returns (uint256) {
        BatchListing storage listing = batchListings[listingId];
        if (!listing.isActive) revert ListingNotActive();
        if (quantity == 0) revert QuantityZero();
        if (quantity > listing.quantity) revert QuantityExceedsAvailable();

        uint256 totalPrice = quantity * listing.pricePerFish;
        if (msg.value != totalPrice) revert IncorrectPayment();

        // Effects
        listing.quantity -= quantity;
        if (listing.quantity == 0) {
            listing.isActive = false;
        }

        _nextPurchaseId++;
        uint256 purchaseId = _nextPurchaseId;

        escrowPurchases[purchaseId] = EscrowPurchase({
            purchaseId: purchaseId,
            listingId: listingId,
            buyer: msg.sender,
            quantity: quantity,
            amountLocked: totalPrice,
            commitmentHash: bytes32(0),
            state: EscrowState.LOCKED,
            fulfillmentType: 0
        });

        emit BatchPurchased(purchaseId, listingId, msg.sender, quantity, totalPrice);
        return purchaseId;
    }

    /**
     * @dev Purchases a quantity of juveniles from a batch listing for in-person pickup,
     * locking the deposit into escrow with a 4-digit PIN.
     */
    function purchaseInPerson(uint256 listingId, uint256 quantity, bytes32 commitmentHash) external payable returns (uint256) {
        BatchListing storage listing = batchListings[listingId];
        if (!listing.isActive) revert ListingNotActive();
        if (quantity == 0) revert QuantityZero();
        if (quantity > listing.quantity) revert QuantityExceedsAvailable();

        uint256 totalPrice = quantity * listing.pricePerFish;
        if (msg.value != totalPrice) revert IncorrectPayment();

        // Effects
        listing.quantity -= quantity;
        if (listing.quantity == 0) {
            listing.isActive = false;
        }

        _nextPurchaseId++;
        uint256 purchaseId = _nextPurchaseId;

        escrowPurchases[purchaseId] = EscrowPurchase({
            purchaseId: purchaseId,
            listingId: listingId,
            buyer: msg.sender,
            quantity: quantity,
            amountLocked: totalPrice,
            commitmentHash: commitmentHash,
            state: EscrowState.LOCKED,
            fulfillmentType: 1
        });

        emit BatchPurchased(purchaseId, listingId, msg.sender, quantity, totalPrice);
        return purchaseId;
    }

    /**
     * @dev Releases the locked escrow funds to the seller, taking a 4% fee split. Only for shipping.
     */
    function releaseEscrow(uint256 purchaseId) external {
        EscrowPurchase storage purchase = escrowPurchases[purchaseId];
        if (purchase.state != EscrowState.LOCKED) revert EscrowAlreadyResolved();
        if (purchase.fulfillmentType != 0) revert NotShippingFulfillment();

        // Authorization: only buyer or curator
        if (msg.sender != purchase.buyer && msg.sender != aquadexManager.curator()) revert Unauthorized();

        purchase.state = EscrowState.RELEASED;

        uint256 amount = purchase.amountLocked;
        uint256 fee = (amount * TOTAL_FEE_BPS) / 10000;
        uint256 sellerProceeds = amount - fee;

        BatchListing storage listing = batchListings[purchase.listingId];

        // Pay seller
        (bool successSeller, ) = payable(listing.seller).call{value: sellerProceeds}("");
        if (!successSeller) revert TransferFailed();

        // Distribute fees
        _distributeFees(fee);

        emit EscrowReleased(purchaseId, listing.seller, purchase.buyer, amount);
        emit XPEarned(purchase.buyer, 100, "Purchase Batch");
        emit XPEarned(listing.seller, 150, "Sale Settled");
    }

    /**
     * @notice Releases escrowed funds for an in-person (face-to-face) juvenile fish pickup,
     *         verified through a Commit-Reveal PIN handshake.
     *
     * @dev Commit-Reveal Mechanics:
     *      1. COMMIT PHASE — During `purchaseInPerson`, the buyer submits a `commitmentHash`
     *         computed off-chain as `keccak256(abi.encodePacked(pin, salt, buyerAddress))`.
     *         This hash is stored in the `EscrowPurchase.commitmentHash` field.
     *      2. REVEAL PHASE — At physical handoff, the seller (or an authorized party) calls
     *         this function with the raw `pin`, `salt`, and the `inEventZone` flag.
     *         The contract recomputes the hash and verifies it matches the stored commitment.
     *
     *      Fee Schedule:
     *      ┌──────────────────┬────────┬────────────────────────────────────────────┐
     *      │ Context          │ Fee    │ Distribution                               │
     *      ├──────────────────┼────────┼────────────────────────────────────────────┤
     *      │ Standard (remote)│ 4% BPS │ 25% Marine Conservation, 40% Ecosystem,    │
     *      │                  │ (400)  │ 35% Founders (split 3-way, dust → coFounder)│
     *      ├──────────────────┼────────┼────────────────────────────────────────────┤
     *      │ Event Zone       │ 2% BPS │ 100% → operationalDevelopmentWallet        │
     *      │                  │ (200)  │ (supports on-site event logistics)         │
     *      └──────────────────┴────────┴────────────────────────────────────────────┘
     *
     *      Invariant Conditions for Successful Release:
     *      - `purchase.state` MUST be `EscrowState.LOCKED` (not already released/refunded).
     *      - `purchase.fulfillmentType` MUST be `1` (in-person, not shipping).
     *      - The recomputed `keccak256(abi.encodePacked(pin, salt, purchase.buyer))` MUST
     *        exactly match the stored `purchase.commitmentHash`.
     *
     *      CEI Compliance:
     *      - CHECKS: State, fulfillment type, and commitment hash are validated first.
     *      - EFFECTS: `purchase.state` is set to `RELEASED` before any external call.
     *      - INTERACTIONS: Ether transfers to seller and fee recipients occur last.
     *
     * @param purchaseId The ID of the `EscrowPurchase` record to release.
     * @param pin The raw numeric PIN provided by the buyer at handoff.
     * @param salt The cryptographic salt used during the original commitment hash generation.
     * @param inEventZone If true, applies the reduced 2% event-zone fee routed entirely
     *                    to the `operationalDevelopmentWallet`; otherwise applies the
     *                    standard 4% fee split across conservation and founder treasuries.
     */
    function secureInPersonRelease(uint256 purchaseId, uint256 pin, bytes32 salt, bool inEventZone) external {
        EscrowPurchase storage purchase = escrowPurchases[purchaseId];
        if (purchase.state != EscrowState.LOCKED) revert EscrowAlreadyResolved();
        if (purchase.fulfillmentType != 1) revert NotInPersonFulfillment();
        if (keccak256(abi.encodePacked(pin, salt, purchase.buyer)) != purchase.commitmentHash) revert InvalidCommitment();

        purchase.state = EscrowState.RELEASED;

        uint256 amount = purchase.amountLocked;
        uint256 feeBps = inEventZone ? 200 : TOTAL_FEE_BPS;
        uint256 fee = (amount * feeBps) / 10000;
        uint256 sellerProceeds = amount - fee;

        BatchListing storage listing = batchListings[purchase.listingId];

        // Pay seller
        (bool successSeller, ) = payable(listing.seller).call{value: sellerProceeds}("");
        if (!successSeller) revert TransferFailed();

        // Distribute fees
        if (inEventZone) {
            (bool successDev, ) = payable(operationalDevelopmentWallet).call{value: fee}("");
            if (!successDev) revert TransferFailed();
        } else {
            _distributeFees(fee);
        }

        emit EscrowReleased(purchaseId, listing.seller, purchase.buyer, amount);
        emit XPEarned(purchase.buyer, 100, "Purchase Batch In-Person");
        emit XPEarned(listing.seller, 150, "Sale Settled");
    }

    /**
     * @dev Refunds the locked escrow funds back to the buyer in full.
     */
    function refundEscrow(uint256 purchaseId) external {
        EscrowPurchase storage purchase = escrowPurchases[purchaseId];
        if (purchase.state != EscrowState.LOCKED) revert EscrowAlreadyResolved();

        BatchListing storage listing = batchListings[purchase.listingId];

        // Authorization: only seller or curator
        if (msg.sender != listing.seller && msg.sender != aquadexManager.curator()) revert Unauthorized();

        purchase.state = EscrowState.REFUNDED;

        uint256 amount = purchase.amountLocked;

        // Refund buyer
        (bool successBuyer, ) = payable(purchase.buyer).call{value: amount}("");
        if (!successBuyer) revert TransferFailed();

        emit EscrowRefunded(purchaseId, purchase.buyer, amount);
    }

    /**
     * @dev Cancels an active batch listing.
     */
    function cancelBatchListing(uint256 listingId) external {
        BatchListing storage listing = batchListings[listingId];
        if (!listing.isActive) revert ListingNotActive();
        if (listing.seller != msg.sender) revert CallerNotSeller();

        listing.isActive = false;
        emit BatchListingCancelled(listingId, msg.sender);
    }

    /**
     * @dev Required IERC721Receiver implementation to accept safe transfers.
     */
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return this.onERC721Received.selector;
    }

    /**
     * @dev Lists a specimen specifying a fixed shipping fee parameter.
     */
    function createShippingListing(uint256 tokenId, uint256 price, uint256 shippingFee) external {
        if (price == 0) revert PriceZero();
        if (aquadexManager.ownerOf(tokenId) != msg.sender) revert CallerNotOwner();

        // Escrow Lockup: transfer the token to this contract
        aquadexManager.transferFrom(msg.sender, address(this), tokenId);

        listings[tokenId] = Listing({
            tokenId: tokenId,
            seller: msg.sender,
            price: price,
            shippingFee: shippingFee,
            active: true,
            isShipping: true
        });

        emit ShippingListingCreated(tokenId, msg.sender, price, shippingFee);
    }

    /**
     * @dev Purchases a shipping-enabled listing, locking subtotal + shipping fee in escrow.
     */
    function purchaseShippingListing(uint256 tokenId) external payable {
        Listing storage listing = listings[tokenId];
        if (!listing.active) revert ListingNotActive();
        if (!listing.isShipping) revert NotShippingListing();
        uint256 totalPrice = listing.price + listing.shippingFee;
        if (msg.value < totalPrice) revert InsufficientPayment();

        address seller = listing.seller;
        uint256 price = listing.price;
        uint256 shippingFee = listing.shippingFee;

        // Effects: delete listing before transfers (CEI)
        listing.active = false;
        delete listings[tokenId];

        shippingEscrows[tokenId] = ShippingEscrow({
            tokenId: tokenId,
            buyer: msg.sender,
            seller: seller,
            price: price,
            shippingFee: shippingFee,
            amountLocked: totalPrice,
            trackingNumber: "",
            dispatchTimestamp: 0,
            status: ShippingStatus.LOCKED
        });

        // Refund any excess payment to buyer
        if (msg.value > totalPrice) {
            uint256 excess = msg.value - totalPrice;
            (bool successRefund, ) = payable(msg.sender).call{value: excess}("");
            if (!successRefund) revert TransferFailed();
        }

        emit ShippingPurchaseCreated(tokenId, msg.sender, totalPrice);
    }

    /**
     * @dev Seller dispatches order with tracking details, activating transit safety window.
     */
    function dispatchShipping(uint256 tokenId, string calldata trackingNumber) external {
        ShippingEscrow storage escrow = shippingEscrows[tokenId];
        if (escrow.status != ShippingStatus.LOCKED) revert EscrowNotLocked();
        if (msg.sender != escrow.seller) revert CallerNotSeller();
        if (bytes(trackingNumber).length == 0) revert TrackingEmpty();

        escrow.trackingNumber = trackingNumber;
        escrow.dispatchTimestamp = block.timestamp;
        escrow.status = ShippingStatus.DISPATCHED;

        emit ShippingDispatched(tokenId, trackingNumber, block.timestamp);
    }

    /**
     * @dev Releases the shipping escrow funds to the seller (96% split + shipping fee) and treasury targets (4%).
     */
    function releaseShippingEscrow(uint256 tokenId) external {
        ShippingEscrow storage escrow = shippingEscrows[tokenId];
        if (escrow.status != ShippingStatus.DISPATCHED) revert EscrowNotDispatched();

        // Authorization: buyer at any time, seller after safety window
        if (msg.sender == escrow.buyer) {
            // Buyer is allowed
        } else if (msg.sender == escrow.seller) {
            if (block.timestamp < escrow.dispatchTimestamp + SHIPPING_SAFETY_WINDOW) revert SafetyWindowNotElapsed();
        } else {
            revert Unauthorized();
        }

        escrow.status = ShippingStatus.RELEASED;

        uint256 price = escrow.price;
        uint256 shippingFee = escrow.shippingFee;
        
        // Fee split math: 4% of price subtotal
        uint256 fee = (price * TOTAL_FEE_BPS) / 10000;
        uint256 sellerProceeds = price - fee + shippingFee;

        // Interactions:
        // 1. Transfer Specimen token to the buyer
        aquadexManager.safeTransferFrom(address(this), escrow.buyer, tokenId);

        // 2. Pay seller
        (bool successSeller, ) = payable(escrow.seller).call{value: sellerProceeds}("");
        if (!successSeller) revert TransferFailed();

        // 3. Distribute fees
        _distributeFees(fee);

        emit ShippingEscrowReleased(tokenId, escrow.seller, escrow.buyer, escrow.amountLocked);
        emit XPEarned(escrow.buyer, 100, "Purchase Shipping Specimen");
        emit XPEarned(escrow.seller, 150, "Sale Settled");
    }

    /**
     * @dev Buyer disputes shipment before safety window expires.
     */
    function disputeShipping(uint256 tokenId) external {
        ShippingEscrow storage escrow = shippingEscrows[tokenId];
        if (escrow.status != ShippingStatus.DISPATCHED) revert EscrowNotDispatched();
        if (msg.sender != escrow.buyer) revert Unauthorized();
        if (block.timestamp >= escrow.dispatchTimestamp + SHIPPING_SAFETY_WINDOW) revert SafetyWindowPassed();

        escrow.status = ShippingStatus.DISPUTED;
        emit ShippingDisputed(tokenId);
    }

    /**
     * @dev Curator resolves dispute by refunding buyer or releasing to seller.
     */
    function resolveShippingDispute(uint256 tokenId, bool refundBuyer) external {
        if (msg.sender != aquadexManager.curator()) revert CallerNotCurator();
        ShippingEscrow storage escrow = shippingEscrows[tokenId];
        if (escrow.status != ShippingStatus.DISPUTED) revert NotInDispute();

        if (refundBuyer) {
            escrow.status = ShippingStatus.REFUNDED;
            
            // Return token from escrow to seller
            aquadexManager.safeTransferFrom(address(this), escrow.seller, tokenId);

            // Refund full amount locked (subtotal + shippingFee) to buyer
            (bool successBuyer, ) = payable(escrow.buyer).call{value: escrow.amountLocked}("");
            if (!successBuyer) revert TransferFailed();

            emit ShippingEscrowRefunded(tokenId, escrow.buyer, escrow.amountLocked);
        } else {
            escrow.status = ShippingStatus.RELEASED;

            uint256 price = escrow.price;
            uint256 shippingFee = escrow.shippingFee;
            uint256 fee = (price * TOTAL_FEE_BPS) / 10000;
            uint256 sellerProceeds = price - fee + shippingFee;

            // Transfer specimen to buyer
            aquadexManager.safeTransferFrom(address(this), escrow.buyer, tokenId);

            // Pay seller
            (bool successSeller, ) = payable(escrow.seller).call{value: sellerProceeds}("");
            if (!successSeller) revert TransferFailed();

            // Distribute fees
            _distributeFees(fee);

            emit ShippingEscrowReleased(tokenId, escrow.seller, escrow.buyer, escrow.amountLocked);
            emit XPEarned(escrow.seller, 150, "Dispute Resolved");
        }
    }

    /**
     * @dev Seller or Curator issues refund voluntary.
     */
    function refundShippingEscrow(uint256 tokenId) external {
        ShippingEscrow storage escrow = shippingEscrows[tokenId];
        if (escrow.status != ShippingStatus.LOCKED && escrow.status != ShippingStatus.DISPATCHED) revert InvalidRefundStatus();
        if (msg.sender != escrow.seller && msg.sender != aquadexManager.curator()) revert Unauthorized();

        escrow.status = ShippingStatus.REFUNDED;

        // Return token from escrow to seller
        aquadexManager.safeTransferFrom(address(this), escrow.seller, tokenId);

        // Refund full amount locked (subtotal + shippingFee) to buyer
        (bool successBuyer, ) = payable(escrow.buyer).call{value: escrow.amountLocked}("");
        if (!successBuyer) revert TransferFailed();

        emit ShippingEscrowRefunded(tokenId, escrow.buyer, escrow.amountLocked);
    }

    /**
     * @dev Purchases multiple specimens from the same seller, consolidating shipping fees and routing payments.
     */
    function purchaseMultipleSpecimens(uint256[] calldata tokenIds) external payable {
        if (tokenIds.length > MAX_BATCH_CHECKOUT_SIZE) revert MaxBatchExceeded();
        // Outside the loop, verify the array is not empty
        if (tokenIds.length == 0) revert EmptyTokenList();

        // Read the shippingFee of the first token as the consolidated shipping fee
        uint256 firstTokenId = tokenIds[0];
        address seller = listings[firstTokenId].seller;
        uint256 consolidatedShippingFee = listings[firstTokenId].shippingFee;

        // Initialize local trackers
        uint256 totalSpecimenPrice = 0;
        uint256 totalSellerPayout = 0;
        uint256 totalTreasuryFee = 0;

        // Inside the loop
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            Listing storage listing = listings[tokenId];
            
            // Verify each listing is active
            if (!listing.active) revert ListingNotActive();
            // Verify each listing shares the exact same seller address as the first token
            if (listing.seller != seller) revert SellerMismatch();

            uint256 price = listing.price;
            totalSpecimenPrice += price;

            // Deactivate it
            listing.active = false;
            delete listings[tokenId];

            // Safely transfer the token to the buyer
            aquadexManager.safeTransferFrom(address(this), msg.sender, tokenId);

            // Calculate the 4% treasury split and 96% seller split of the specimen price using BPS
            uint256 fee = (price * TOTAL_FEE_BPS) / 10000;
            uint256 sellerProceeds = price - fee;

            // Add those to local trackers
            totalSellerPayout += sellerProceeds;
            totalTreasuryFee += fee;

            emit SpecimenPurchased(tokenId, seller, msg.sender, price, fee);
            emit XPEarned(msg.sender, 100, "Purchase Specimen");
            emit XPEarned(seller, 150, "Sale Settled");
        }

        // Outside and after the loop concludes, verify msg.value equals or is greater than total specimen price plus consolidated shipping fee
        uint256 totalCost = totalSpecimenPrice + consolidatedShippingFee;
        if (msg.value < totalCost) revert InsufficientPayment();

        // Execute consolidated external value transfers
        // 1. Transfer the accumulated seller payout plus the single shipping fee to the seller
        (bool successSeller, ) = payable(seller).call{value: totalSellerPayout + consolidatedShippingFee}("");
        if (!successSeller) revert TransferFailed();

        // 2. Distribute the accumulated treasury fees
        _distributeFees(totalTreasuryFee);

        // Refund any excess msg.value to the buyer
        if (msg.value > totalCost) {
            uint256 excess = msg.value - totalCost;
            (bool successRefund, ) = payable(msg.sender).call{value: excess}("");
            if (!successRefund) revert TransferFailed();
        }
    }

    function setOperationalDevelopmentWallet(address _wallet) external {
        if (!hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) revert CallerNotAdmin();
        if (_wallet == address(0)) revert InvalidAddress();
        operationalDevelopmentWallet = _wallet;
    }

    function setLiveEvent(uint256 eventId, uint256 startTime, uint256 endTime, bool active) external {
        if (!hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) revert CallerNotAdmin();
        liveEvents[eventId] = LiveEvent(eventId, startTime, endTime, active);
    }

    /**
     * @notice Executes a zero-fee, cash-settled specimen transfer during a sanctioned live event.
     *
     * @dev Cash Handshake Flow:
     *      This function supports two distinct transfer paths:
     *
     *      Path A — `fromEscrow = true` (Escrowed Listing):
     *        The specimen is already held in this contract's custody via a prior `listSpecimen`
     *        or `createShippingListing` call. The listing is deactivated, deleted, and the
     *        token is safe-transferred directly from the contract to the buyer.
     *
     *      Path B — `fromEscrow = false` (Direct Wallet Transfer):
     *        The specimen is still in the seller's wallet. A direct `transferFrom` moves
     *        it to the buyer. Optionally, if `batchListingId != 0`, the matching batch
     *        listing's available quantity is decremented (auto-deactivating at zero).
     *
     *      Fee Schedule: 0% — No protocol fees are deducted for cash handshake transactions.
     *      XP Awards: Double XP event bonuses (200 buyer / 300 seller) are emitted.
     *
     *      Invariant Conditions:
     *      - The referenced `LiveEvent` MUST be active and within its time window.
     *      - `buyer` MUST NOT be the zero address.
     *      - The caller MUST be the seller (either listing owner or token owner).
     *
     *      CEI Compliance:
     *      - CHECKS: Event validity, buyer address, ownership/listing status validated first.
     *      - EFFECTS: Listing deactivation and deletion occur before token transfer.
     *      - INTERACTIONS: Token transfers (safeTransferFrom / transferFrom) occur last.
     *
     * @param tokenId The ERC-721 token ID of the specimen being transferred.
     * @param buyer The recipient address for the specimen.
     * @param eventId The ID of the sanctioned live event authorizing this cash sale.
     * @param fromEscrow If true, transfers the token from marketplace escrow; if false,
     *                   transfers directly from the seller's wallet.
     * @param batchListingId Optional batch listing ID to decrement (0 to skip).
     * @param batchQuantity The quantity to subtract from the batch listing (ignored if
     *                      `batchListingId` is 0).
     */
    function fulfillCashHandshake(
        uint256 tokenId,
        address buyer,
        uint256 eventId,
        bool fromEscrow,
        uint256 batchListingId,
        uint256 batchQuantity
    ) external {
        LiveEvent storage ev = liveEvents[eventId];
        if (!ev.active) revert EventInactive();
        if (block.timestamp < ev.startTime || block.timestamp > ev.endTime) revert EventWindowClosed();
        if (buyer == address(0)) revert InvalidAddress();

        if (fromEscrow) {
            Listing storage listing = listings[tokenId];
            if (!listing.active) revert ListingNotActive();
            if (listing.seller != msg.sender) revert CallerNotSeller();

            listing.active = false;
            delete listings[tokenId];

            aquadexManager.safeTransferFrom(address(this), buyer, tokenId);
        } else {
            if (aquadexManager.ownerOf(tokenId) != msg.sender) revert CallerNotOwner();
            aquadexManager.transferFrom(msg.sender, buyer, tokenId);

            if (batchListingId != 0 && batchQuantity > 0) {
                BatchListing storage batch = batchListings[batchListingId];
                if (batch.isActive && batch.seller == msg.sender) {
                    if (batchQuantity > batch.quantity) revert BatchQuantityExceeded();
                    batch.quantity -= batchQuantity;
                    if (batch.quantity == 0) {
                        batch.isActive = false;
                    }
                }
            }
        }

        emit SpecimenPurchased(tokenId, msg.sender, buyer, 0, 0);
        emit XPEarned(buyer, 200, "Cash Purchase Specimen (Event Double XP)");
        emit XPEarned(msg.sender, 300, "Cash Sale Settled (Event Double XP)");
    }
}
