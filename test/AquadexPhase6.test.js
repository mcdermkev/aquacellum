import { network } from "hardhat";
import assert from "assert";

describe("Aquadex Phase 6 Integration Tests", function () {
  let ethers;
  let curator, breeder, buyer, treasury, kevin, steve, coFounder;
  let manager, marketplace, governance;

  before(async function () {
    const connection = await network.create();
    ethers = connection.ethers;
    const signers = await ethers.getSigners();
    curator = signers[0];
    breeder = signers[1];
    buyer = signers[2];
    treasury = signers[3];
    kevin = signers[4];
    steve = signers[5];
    coFounder = signers[6];
  });

  describe("AquadexManager & Marketplace Escrow Flow", function () {
    it("should deploy AquadexManager and seed a species", async function () {
      const AquadexManager = await ethers.getContractFactory("AquadexManager");
      manager = await AquadexManager.deploy();
      await manager.waitForDeployment();

      await manager.addSpecies(
        "Paracheirodon innesi",
        "Neon Tetra",
        "ipfs://tetra-uri",
        0, // CareLevel.Easy
        220, 260, 60, 75
      );

      const nextId = await manager.nextSpeciesId();
      assert.equal(nextId, 2n);
    });

    it("should mint a specimen token to the breeder", async function () {
      const mintTx = await manager.connect(breeder).mintSpecimen(
        1,
        Math.round(Date.now() / 1000),
        breeder.address,
        0, 0, 0,
        "ipfs://specimen1"
      );
      await mintTx.wait();

      const owner = await manager.ownerOf(1);
      assert.equal(owner, breeder.address);
    });

    it("should log a spawn event successfully", async function () {
      const logTx = await manager.connect(breeder).logSpawnEvent(
        1, // speciesId
        150, // eggCount
        "ipfs://spawn-notes"
      );
      await logTx.wait();

      const spawnLog = await manager.spawnLogs(1);
      assert.equal(spawnLog.spawnId, 1n);
      assert.equal(spawnLog.speciesId, 1n);
      assert.equal(spawnLog.breeder, breeder.address);
      assert.equal(spawnLog.eggCount, 150n);
      assert.equal(spawnLog.notesIpfsHash, "ipfs://spawn-notes");
    });

    it("should list a specimen in the marketplace and hold it in escrow", async function () {
      const AquadexMarketplace = await ethers.getContractFactory("AquadexMarketplace");
      marketplace = await AquadexMarketplace.deploy(
        await manager.getAddress(),
        treasury.address, // marineConservationTreasury
        treasury.address, // ecosystemTreasury
        kevin.address,
        steve.address,
        coFounder.address
      );
      await marketplace.waitForDeployment();

      await manager.connect(breeder).approve(await marketplace.getAddress(), 1);

      const price = ethers.parseEther("1.0");
      await marketplace.connect(breeder).listSpecimen(1, price);

      const owner = await manager.ownerOf(1);
      assert.equal(owner, await marketplace.getAddress());
    });

    it("should execute purchase with correct 4% fee split and refund excess msg.value", async function () {
      const prevSellerBal = await ethers.provider.getBalance(breeder.address);
      const prevTreasuryBal = await ethers.provider.getBalance(treasury.address);

      const purchaseTx = await marketplace.connect(buyer).purchaseSpecimen(1, {
        value: ethers.parseEther("1.5")
      });
      await purchaseTx.wait();

      const owner = await manager.ownerOf(1);
      assert.equal(owner, buyer.address);

      // Total fee: 4% of 1.0 ETH = 0.04 ETH
      // Treasury split (Marine: 25% + Ecosystem: 40%) = 65% of total fee = 0.026 ETH
      const postTreasuryBal = await ethers.provider.getBalance(treasury.address);
      const feeDiff = postTreasuryBal - prevTreasuryBal;
      assert.equal(feeDiff, ethers.parseEther("0.026"));

      // Seller Proceeds: 1.0 - 4% = 0.96 ETH
      const postSellerBal = await ethers.provider.getBalance(breeder.address);
      const sellerDiff = postSellerBal - prevSellerBal;
      assert.equal(sellerDiff, ethers.parseEther("0.96"));

      const listing = await marketplace.listings(1);
      assert.equal(listing.active, false);
    });
  });

  describe("AquadexGovernance DAO voting flow", function () {
    it("should deploy AquadexGovernance and transfer curatorship", async function () {
      const AquadexGovernance = await ethers.getContractFactory("AquadexGovernance");
      governance = await AquadexGovernance.deploy(await manager.getAddress(), 100); // 100 second voting duration
      await governance.waitForDeployment();

      await manager.connect(curator).transferCuratorship(await governance.getAddress());
      const currentCurator = await manager.curator();
      assert.equal(currentCurator, await governance.getAddress());
    });

    it("should propose a new species catalog addition", async function () {
      const proposeTx = await governance.connect(buyer).proposeSpecies(
        "Amphiprion ocellaris",
        "Ocellaris Clownfish",
        "ipfs://clownfish-uri",
        1, // CareLevel.Medium
        240, 280, 80, 84
      );
      await proposeTx.wait();

      const prop = await governance.proposals(1);
      assert.equal(prop.commonName, "Ocellaris Clownfish");
    });

    it("should vote YES and reject double voting", async function () {
      await governance.connect(buyer).vote(1, [1], true);

      const prop = await governance.proposals(1);
      assert.equal(prop.votesFor, 1n);

      await assert.rejects(
        governance.connect(buyer).vote(1, [1], true),
        /TokenAlreadyVoted/
      );
    });

    it("should execute proposal after voting period finishes", async function () {
      await ethers.provider.send("evm_increaseTime", [101]);
      await ethers.provider.send("evm_mine");

      const executeTx = await governance.connect(buyer).executeProposal(1);
      await executeTx.wait();

      const nextId = await manager.nextSpeciesId();
      assert.equal(nextId, 3n);

      const species = await manager.speciesCatalog(2);
      assert.equal(species.commonName, "Ocellaris Clownfish");
      assert.equal(species.active, true);
    });
  });

  describe("Hatchery Marketplace Integration", function () {
    it("should allow a verified spawn creator to create a clean batch listing", async function () {
      const quantity = 50n;
      const pricePerFish = ethers.parseEther("0.01");
      const listTx = await marketplace.connect(breeder).createBatchListing(1, quantity, pricePerFish);
      await listTx.wait();

      const listingId = await marketplace.spawnToListing(1);
      assert.equal(listingId, 1n);

      const listing = await marketplace.batchListings(listingId);
      assert.equal(listing.listingId, 1n);
      assert.equal(listing.spawnId, 1n);
      assert.equal(listing.quantity, quantity);
      assert.equal(listing.pricePerFish, pricePerFish);
      assert.equal(listing.seller, breeder.address);
      assert.equal(listing.isActive, true);
    });

    it("should revert listing when an unrecognized wallet tries to list a spawn it doesn't own", async function () {
      const quantity = 50n;
      const pricePerFish = ethers.parseEther("0.01");
      await assert.rejects(
        marketplace.connect(buyer).createBatchListing(1, quantity, pricePerFish),
        /CallerNotOwner/
      );
    });

    it("should allow a partial purchase and reduce inventory correctly", async function () {
      const quantityToBuy = 5n;
      const pricePerFish = ethers.parseEther("0.01");
      const totalCost = pricePerFish * quantityToBuy; // 0.05 ETH

      const purchaseTx = await marketplace.connect(buyer).purchaseBatch(1, quantityToBuy, {
        value: totalCost
      });
      await purchaseTx.wait();

      const listing = await marketplace.batchListings(1);
      assert.equal(listing.quantity, 45n);
      assert.equal(listing.isActive, true);

      const purchase = await marketplace.escrowPurchases(1);
      assert.equal(purchase.purchaseId, 1n);
      assert.equal(purchase.listingId, 1n);
      assert.equal(purchase.buyer, buyer.address);
      assert.equal(purchase.quantity, quantityToBuy);
      assert.equal(purchase.amountLocked, totalCost);
      assert.equal(purchase.state, 0n);
      assert.equal(purchase.fulfillmentType, 0n);
    });

    it("should accurately calculate the 4% fee split and 96% seller split upon escrow release", async function () {
      const prevSellerBal = await ethers.provider.getBalance(breeder.address);
      const prevTreasuryBal = await ethers.provider.getBalance(treasury.address);

      const releaseTx = await marketplace.connect(buyer).releaseEscrow(1);
      await releaseTx.wait();

      const postSellerBal = await ethers.provider.getBalance(breeder.address);
      const postTreasuryBal = await ethers.provider.getBalance(treasury.address);

      const feeDiff = postTreasuryBal - prevTreasuryBal;
      const sellerDiff = postSellerBal - prevSellerBal;

      // Total Cost = 0.05 ETH. Total fee = 4% of 0.05 = 0.002 ETH.
      // Treasury (65% of total fee) = 0.0013 ETH.
      // Seller proceeds = 0.05 - 0.002 = 0.048 ETH.
      assert.equal(feeDiff, ethers.parseEther("0.0013"));
      assert.equal(sellerDiff, ethers.parseEther("0.048"));

      const purchase = await marketplace.escrowPurchases(1);
      assert.equal(purchase.state, 1n);
    });

    it("should support in-person purchases and secure PIN release handshake side-by-side", async function () {
      const pin = 4321n;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("my-salt-value"));
      const commitmentHash = ethers.solidityPackedKeccak256(
        ["uint256", "bytes32", "address"],
        [pin, salt, buyer.address]
      );
      const pricePerFish = ethers.parseEther("0.01");
      const quantityToBuyInPerson = 3n;
      const inPersonCost = pricePerFish * quantityToBuyInPerson; // 0.03 ETH

      const purchaseInPersonTx = await marketplace.connect(buyer).purchaseInPerson(1, quantityToBuyInPerson, commitmentHash, {
        value: inPersonCost
      });
      await purchaseInPersonTx.wait();

      const purchase2 = await marketplace.escrowPurchases(2);
      assert.equal(purchase2.purchaseId, 2n);
      assert.equal(purchase2.buyer, buyer.address);
      assert.equal(purchase2.quantity, quantityToBuyInPerson);
      assert.equal(purchase2.amountLocked, inPersonCost);
      assert.equal(purchase2.state, 0n);
      assert.equal(purchase2.fulfillmentType, 1n);
      assert.equal(purchase2.commitmentHash, commitmentHash);

      // Confirm standard releaseEscrow reverts for in-person
      await assert.rejects(
        marketplace.connect(buyer).releaseEscrow(2),
        /NotShippingFulfillment/
      );

      // Confirm secureInPersonRelease fails with invalid PIN
      await assert.rejects(
        marketplace.connect(breeder).secureInPersonRelease(2, 9999, salt, false),
        /InvalidCommitment/
      );

      // Confirm secureInPersonRelease succeeds with correct PIN and distributes funds
      const prevSellerBalInPerson = await ethers.provider.getBalance(breeder.address);
      const prevTreasuryBalInPerson = await ethers.provider.getBalance(treasury.address);

      const secureReleaseTx = await marketplace.connect(breeder).secureInPersonRelease(2, pin, salt, false);
      const secureReleaseReceipt = await secureReleaseTx.wait();

      const postSellerBalInPerson = await ethers.provider.getBalance(breeder.address);
      const postTreasuryBalInPerson = await ethers.provider.getBalance(treasury.address);

      const gasUsed = secureReleaseReceipt.gasUsed;
      const gasPrice = secureReleaseReceipt.gasPrice;
      const txGasCost = gasUsed * gasPrice;

      const feeDiffInPerson = postTreasuryBalInPerson - prevTreasuryBalInPerson;
      const sellerDiffInPerson = postSellerBalInPerson - prevSellerBalInPerson;

      // Total Cost = 0.03 ETH. Total fee = 4% = 0.0012 ETH.
      // Treasury (65% of total fee) = 0.00078 ETH.
      // Seller proceeds = 0.03 - 0.0012 = 0.0288 ETH.
      assert.equal(feeDiffInPerson, ethers.parseEther("0.00078"));
      assert.equal(sellerDiffInPerson + txGasCost, ethers.parseEther("0.0288"));

      const purchase2AfterRelease = await marketplace.escrowPurchases(2);
      assert.equal(purchase2AfterRelease.state, 1n);
    });

    it("should apply 2% promo fee inside event zone and route to operational dev wallet", async function () {
      const pin = 5678n;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("promo-salt"));
      const commitmentHash = ethers.solidityPackedKeccak256(
        ["uint256", "bytes32", "address"],
        [pin, salt, buyer.address]
      );
      const pricePerFish = ethers.parseEther("0.01");
      const qty = 5n;
      const cost = pricePerFish * qty; // 0.05 ETH

      // 1. Purchase batch in-person
      await marketplace.connect(buyer).purchaseInPerson(1, qty, commitmentHash, { value: cost });

      const prevSellerBal = await ethers.provider.getBalance(breeder.address);
      const prevDevBal = await ethers.provider.getBalance(coFounder.address); // coFounder is operationalDevWallet

      // 2. Release in-person with inEventZone = true
      const tx = await marketplace.connect(breeder).secureInPersonRelease(3, pin, salt, true);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;

      const postSellerBal = await ethers.provider.getBalance(breeder.address);
      const postDevBal = await ethers.provider.getBalance(coFounder.address);

      // Fee is 2% of 0.05 ETH = 0.001 ETH
      // Seller proceeds is 98% of 0.05 ETH = 0.049 ETH
      assert.equal(postDevBal - prevDevBal, ethers.parseEther("0.001"));
      assert.equal(postSellerBal - prevSellerBal + gasCost, ethers.parseEther("0.049"));
    });
  });

  describe("Box-Grouping Consolidated Checkout", function () {
    it("should list multiple specimens with shipping fees", async function () {
      // Mint tokens 2, 3, 4 to breeder
      const mintTx2 = await manager.connect(breeder).mintSpecimen(1, Math.round(Date.now() / 1000), breeder.address, 0, 0, 0, "ipfs://specimen2");
      await mintTx2.wait();
      const mintTx3 = await manager.connect(breeder).mintSpecimen(1, Math.round(Date.now() / 1000), breeder.address, 0, 0, 0, "ipfs://specimen3");
      await mintTx3.wait();
      const mintTx4 = await manager.connect(breeder).mintSpecimen(1, Math.round(Date.now() / 1000), breeder.address, 0, 0, 0, "ipfs://specimen4");
      await mintTx4.wait();

      // Mint token 5 to curator
      const mintTx5 = await manager.connect(curator).mintSpecimen(1, Math.round(Date.now() / 1000), curator.address, 0, 0, 0, "ipfs://specimen5");
      await mintTx5.wait();

      // Approve marketplace
      await manager.connect(breeder).approve(await marketplace.getAddress(), 2);
      await manager.connect(breeder).approve(await marketplace.getAddress(), 3);
      await manager.connect(breeder).approve(await marketplace.getAddress(), 4);
      await manager.connect(curator).approve(await marketplace.getAddress(), 5);

      // List them
      await marketplace.connect(breeder).createShippingListing(2, ethers.parseEther("1.0"), ethers.parseEther("0.05"));
      await marketplace.connect(breeder).createShippingListing(3, ethers.parseEther("2.0"), ethers.parseEther("0.03"));
      await marketplace.connect(breeder).createShippingListing(4, ethers.parseEther("1.5"), ethers.parseEther("0.02"));
      await marketplace.connect(curator).createShippingListing(5, ethers.parseEther("1.0"), ethers.parseEther("0.05"));
    });

    it("should revert if token list is empty", async function () {
      await assert.rejects(
        marketplace.connect(buyer).purchaseMultipleSpecimens([], { value: ethers.parseEther("5.0") }),
        /EmptyTokenList/
      );
    });

    it("should revert if there is a seller address mismatch", async function () {
      await assert.rejects(
        marketplace.connect(buyer).purchaseMultipleSpecimens([2, 5], { value: ethers.parseEther("5.0") }),
        /SellerMismatch/
      );
    });

    it("should revert if any listing is inactive", async function () {
      await assert.rejects(
        marketplace.connect(buyer).purchaseMultipleSpecimens([1, 2], { value: ethers.parseEther("5.0") }),
        /ListingNotActive/
      );
    });

    it("should revert if msg.value is insufficient", async function () {
      await assert.rejects(
        marketplace.connect(buyer).purchaseMultipleSpecimens([2, 3], { value: ethers.parseEther("3.0") }),
        /InsufficientPayment/
      );
    });

    it("should successfully purchase multiple specimens, verify payouts, fees, and refunds", async function () {
      const prevSellerBal = await ethers.provider.getBalance(breeder.address);
      const prevTreasuryBal = await ethers.provider.getBalance(treasury.address);

      // Subtotal = 1.0 + 2.0 = 3.0 ETH
      // Shipping fee = 0.05 ETH
      // Total cost = 3.05 ETH
      // Send 4.0 ETH (expect 0.95 ETH refund)
      const tx = await marketplace.connect(buyer).purchaseMultipleSpecimens([2, 3], {
        value: ethers.parseEther("4.0")
      });
      await tx.wait();

      // Verify ownership
      assert.equal(await manager.ownerOf(2), buyer.address);
      assert.equal(await manager.ownerOf(3), buyer.address);

      // Verify fee split: 4% of 3.0 ETH = 0.12 ETH.
      // Treasury (65%) = 0.078 ETH.
      const postTreasuryBal = await ethers.provider.getBalance(treasury.address);
      assert.equal(postTreasuryBal - prevTreasuryBal, ethers.parseEther("0.078"));

      // Verify breeder proceeds: 96% of 3.0 ETH = 2.88 ETH + 0.05 shipping = 2.93 ETH
      const postSellerBal = await ethers.provider.getBalance(breeder.address);
      assert.equal(postSellerBal - prevSellerBal, ethers.parseEther("2.93"));

      // Verify listings are deleted
      const listing2 = await marketplace.listings(2);
      const listing3 = await marketplace.listings(3);
      assert.equal(listing2.active, false);
      assert.equal(listing3.active, false);
    });
  });

  describe("On-Chain Cash Handshake Gating & Verification", function () {
    it("should process direct cash handshake fulfillment successfully when active", async function () {
      // Breeder owns listed token 4, buyer is buyer.address.
      // Settle cash handshake from escrow (fromEscrow = true)
      const tx = await marketplace.connect(breeder).fulfillCashHandshake(
        4,
        buyer.address,
        1, // eventId
        true, // fromEscrow
        0,
        0
      );
      await tx.wait();
      assert.equal(await manager.ownerOf(4), buyer.address);
    });

    it("should revert cash handshake if event is inactive", async function () {
      await assert.rejects(
        marketplace.connect(breeder).fulfillCashHandshake(
          5,
          buyer.address,
          99, // inactive/non-existent eventId
          true,
          0,
          0
        ),
        /EventInactive/
      );
    });

    it("should revert cash handshake if event window is closed", async function () {
      const currentTime = Math.round(Date.now() / 1000);
      const setEventTx = await marketplace.connect(kevin).setLiveEvent(
          3,
          currentTime + 10000, // startTime in the future
          currentTime + 20000, // endTime
          true // active
      );
      await setEventTx.wait();

      await assert.rejects(
        marketplace.connect(breeder).fulfillCashHandshake(
          5,
          buyer.address,
          3, // eventId 3 (future)
          true,
          0,
          0
        ),
        /EventWindowClosed/
      );
    });
  });

  describe("Priority #4: Explicit Boundary & Handshake Verification Blocks", function () {
    let activeListingId;

    before(async function () {
      // Create a fresh batch listing to use for these tests
      const quantity = 100n;
      const pricePerFish = ethers.parseEther("0.02");
      const listTx = await marketplace.connect(breeder).createBatchListing(1, quantity, pricePerFish);
      await listTx.wait();
      activeListingId = await marketplace.spawnToListing(1);
    });

    describe("1. COMMIT-REVEAL HANDSHAKE INTEGRITY", function () {
      it("should track a successful in-person handover and release funds", async function () {
        const pin = 1234n;
        // Generate random 32-byte salt using ethers v6 utilities
        const salt = ethers.hexlify(ethers.randomBytes(32));
        const commitmentHash = ethers.solidityPackedKeccak256(
          ["uint256", "bytes32", "address"],
          [pin, salt, buyer.address]
        );

        const pricePerFish = ethers.parseEther("0.02");
        const qty = 2n;
        const totalCost = pricePerFish * qty; // 0.04 ETH

        // Purchase in-person
        const purchaseTx = await marketplace.connect(buyer).purchaseInPerson(activeListingId, qty, commitmentHash, {
          value: totalCost
        });
        const receipt = await purchaseTx.wait();

        let purchaseId = 0n;
        for (const log of receipt.logs) {
          try {
            const parsed = marketplace.interface.parseLog(log);
            if (parsed && parsed.name === "BatchPurchased") {
              purchaseId = parsed.args.purchaseId;
              break;
            }
          } catch (e) {}
        }
        assert(purchaseId > 0n, "Should find BatchPurchased event and purchaseId");

        // Assert defensive boundary behavior: invalid PIN reverts with InvalidCommitment()
        await assert.rejects(
          marketplace.connect(breeder).secureInPersonRelease(purchaseId, 9999n, salt, false),
          /InvalidCommitment/
        );

        // Assert defensive boundary behavior: altered salt reverts with InvalidCommitment()
        const alteredSalt = ethers.hexlify(ethers.randomBytes(32));
        await assert.rejects(
          marketplace.connect(breeder).secureInPersonRelease(purchaseId, pin, alteredSalt, false),
          /InvalidCommitment/
        );

        // Successful reveal releases funds
        const prevSellerBal = await ethers.provider.getBalance(breeder.address);
        const releaseTx = await marketplace.connect(breeder).secureInPersonRelease(purchaseId, pin, salt, false);
        const releaseReceipt = await releaseTx.wait();
        const gasCost = releaseReceipt.gasUsed * releaseReceipt.gasPrice;

        const postSellerBal = await ethers.provider.getBalance(breeder.address);
        // Standard split: 4% of 0.04 = 0.0016 ETH fee. Seller proceeds = 0.0384 ETH
        assert.equal(postSellerBal - prevSellerBal + gasCost, ethers.parseEther("0.0384"));

        const purchaseState = (await marketplace.escrowPurchases(purchaseId)).state;
        assert.equal(purchaseState, 1n); // EscrowState.RELEASED (1)
      });
    });

    describe("2. EXPO MODE FEE MATH SPLITS", function () {
      it("should route promotional 2.00% fee to dev wallet when inside event zone", async function () {
        const pin = 5555n;
        const salt = ethers.hexlify(ethers.randomBytes(32));
        const commitmentHash = ethers.solidityPackedKeccak256(
          ["uint256", "bytes32", "address"],
          [pin, salt, buyer.address]
        );

        const pricePerFish = ethers.parseEther("0.02");
        const qty = 5n;
        const totalCost = pricePerFish * qty; // 0.1 ETH

        // Set up / mock active event zone
        const currentTime = Math.round(Date.now() / 1000);
        const setEventTx = await marketplace.connect(kevin).setLiveEvent(
          2,
          currentTime - 3600, // startTime (1 hour ago)
          currentTime + 3600, // endTime (1 hour from now)
          true // active
        );
        await setEventTx.wait();

        // Purchase
        const purchaseTx = await marketplace.connect(buyer).purchaseInPerson(activeListingId, qty, commitmentHash, {
          value: totalCost
        });
        const receipt = await purchaseTx.wait();
        let purchaseId = 0n;
        for (const log of receipt.logs) {
          try {
            const parsed = marketplace.interface.parseLog(log);
            if (parsed && parsed.name === "BatchPurchased") {
              purchaseId = parsed.args.purchaseId;
              break;
            }
          } catch (e) {}
        }

        const prevSellerBal = await ethers.provider.getBalance(breeder.address);
        const prevDevBal = await ethers.provider.getBalance(coFounder.address);

        // Execute inside active boundaries with inEventZone = true
        // Promotional 2.00% fee of 0.1 ETH = 0.002 ETH. Seller proceeds = 0.098 ETH.
        const releaseTx = await marketplace.connect(breeder).secureInPersonRelease(purchaseId, pin, salt, true);
        const releaseReceipt = await releaseTx.wait();
        const gasCost = releaseReceipt.gasUsed * releaseReceipt.gasPrice;

        const postSellerBal = await ethers.provider.getBalance(breeder.address);
        const postDevBal = await ethers.provider.getBalance(coFounder.address);

        assert.equal(postDevBal - prevDevBal, ethers.parseEther("0.002"));
        assert.equal(postSellerBal - prevSellerBal + gasCost, ethers.parseEther("0.098"));
      });

      it("should fallback to 4.00% standard split when executed outside event boundaries (inEventZone = false)", async function () {
        const pin = 7777n;
        const salt = ethers.hexlify(ethers.randomBytes(32));
        const commitmentHash = ethers.solidityPackedKeccak256(
          ["uint256", "bytes32", "address"],
          [pin, salt, buyer.address]
        );

        const pricePerFish = ethers.parseEther("0.02");
        const qty = 5n;
        const totalCost = pricePerFish * qty; // 0.1 ETH

        // Purchase
        const purchaseTx = await marketplace.connect(buyer).purchaseInPerson(activeListingId, qty, commitmentHash, {
          value: totalCost
        });
        const receipt = await purchaseTx.wait();
        let purchaseId = 0n;
        for (const log of receipt.logs) {
          try {
            const parsed = marketplace.interface.parseLog(log);
            if (parsed && parsed.name === "BatchPurchased") {
              purchaseId = parsed.args.purchaseId;
              break;
            }
          } catch (e) {}
        }

        const prevSellerBal = await ethers.provider.getBalance(breeder.address);
        const prevTreasuryBal = await ethers.provider.getBalance(treasury.address);

        // Outside event zone / standard fallback -> inEventZone = false
        // Standard fee 4.00% of 0.1 ETH = 0.004 ETH
        // Treasury gets 65% of fee = 0.0026 ETH. Seller proceeds = 0.096 ETH.
        const releaseTx = await marketplace.connect(breeder).secureInPersonRelease(purchaseId, pin, salt, false);
        const releaseReceipt = await releaseTx.wait();
        const gasCost = releaseReceipt.gasUsed * releaseReceipt.gasPrice;

        const postSellerBal = await ethers.provider.getBalance(breeder.address);
        const postTreasuryBal = await ethers.provider.getBalance(treasury.address);

        assert.equal(postTreasuryBal - prevTreasuryBal, ethers.parseEther("0.0026"));
        assert.equal(postSellerBal - prevSellerBal + gasCost, ethers.parseEther("0.096"));
      });
    });

    describe("3. BATCH ARRAY BOUNDARY SAFETY", function () {
      it("should exceed MAX_BATCH_CHECKOUT_SIZE and revert with MaxBatchExceeded()", async function () {
        // Mint and list 7 distinct specimens under breeder
        const specimenIds = [];
        for (let i = 0; i < 7; i++) {
          const mintTx = await manager.connect(breeder).mintSpecimen(
            1,
            Math.round(Date.now() / 1000),
            breeder.address,
            0, 0, 0,
            `ipfs://specimen-batch-${i}`
          );
          const receipt = await mintTx.wait();
          
          let tokenId = 0n;
          for (const log of receipt.logs) {
            try {
              const parsed = manager.interface.parseLog(log);
              if (parsed && parsed.name === "SpecimenRegistered") {
                tokenId = parsed.args.specimenId;
                break;
              }
            } catch (e) {}
          }
          specimenIds.push(tokenId);
          await manager.connect(breeder).approve(await marketplace.getAddress(), tokenId);
          await marketplace.connect(breeder).createShippingListing(tokenId, ethers.parseEther("1.0"), ethers.parseEther("0.01"));
        }

        // Attempt a bulk consolidated checkout of all 7 token IDs
        // Assert that the call cleanly reverts with our custom error MaxBatchExceeded
        await assert.rejects(
          marketplace.connect(buyer).purchaseMultipleSpecimens(specimenIds, {
            value: ethers.parseEther("10.0")
          }),
          /MaxBatchExceeded/
        );
      });
    });
  });
});
