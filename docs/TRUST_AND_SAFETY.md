# How Escrow & Handshakes Protect Your Operations

We built these protections because we know how much your reputation, your livestock, and your facility matter. For generations, the breeding community has run on trust, reputation, and handshakes. When trading high-value specimens, whether at regional swap meets or through parcel shipping, you need to know your transaction is private, your physical facility is secure, and your livestock is protected.

The Aquadex Protocol integrates these traditional values directly into its digital ledger, ensuring you are shielded from bad actors without needing to understand complex cryptocurrency mechanics.

---

## 1. Protecting Your Privacy: Proximity Fuzzing

Your home and breeding facility are your private sanctuaries. Displaying your exact physical address online puts your biosecurity, valuable breeding lines, and personal safety at risk. 

To prevent address harvesting, the Aquadex system uses **Off-Chain Centroid Fuzzing**:
- **Zone Boundaries**: Instead of displaying your exact coordinates on our proximity maps, your facility is shown as a fuzzed centroid within a **1-mile inner region** and a **3-mile outer zone**.
- **No Address Leaks**: The system calculates these fuzzed zones at the database level before it ever touches a web browser, ensuring your actual street address cannot be extracted by inspecting the map's code.
- **Local Handshakes**: Exact meeting points are coordinates arranged privately between you and the buyer, keeping your home address completely off the map.

---

## 2. In-Person Trades: The Commit-Reveal Security Box

When you meet another breeder at an expo or swap meet, you want to hand over your specimens and receive payment immediately, without worrying about someone canceling their payment or redirecting the transaction.

Aquadex secures local handshakes using an electronic equivalent of a **locked security box with a dual-key release (Commit-Reveal scheme)**.

### How it works:
1. **The Locked Security Box (Commit)**: When a buyer claims your listing, they lock their payment inside a secure digital box.
2. **The Cryptographic Lock**: At the same time, the buyer's device creates a unique digital signature (the "commitment") that locks the box. This lock can only be opened by a specific 4-digit PIN combined with a secret, random security code (the "salt"). Because the lock is created on the buyer's device, no snooping third party on the network can guess the PIN or intercept the funds.
3. **The Physical Handover (Reveal)**: You meet the buyer in person. You inspect the fish, and they inspect the stock.
4. **Instant Release**: Once both parties are happy with the fish, the buyer shows you the code. You scan or enter it, and the payment is released to you instantly. The transfer is final, secure, and cannot be front-run or canceled mid-handshake.

---

## 3. Shipping Deliveries: Transit Safety Windows

Shipping live fish is a logistics challenge. Delays, extreme weather, or carrier mishandling can put your specimens at risk. To ensure buyers pay only for live arrivals and sellers are protected from fraudulent claims, Aquadex implements a **Transit Safety Window**.

### How it works:
1. **Funds Locked in Escrow**: The buyer purchases your specimen online. The purchase cost and shipping fees are held in a secure escrow vault.
2. **Activating the Transit Window**: As the seller, you package the livestock and input the carrier tracking ID into the system. This action officially registers the shipment and activates a **3-day (72-hour) transit safety window**.
3. **The Recourse Period**: During these 3 days, the funds are safely locked. If the package is delayed, or if the specimens arrive in poor condition, the buyer has a guaranteed recourse window to file a claim and hold the funds in escrow while the issue is resolved.
4. **Automatic Release**: Once the specimens arrive safely, the buyer confirms receipt, and the escrow funds are immediately released to your wallet. If the buyer forgets to confirm delivery, the funds will automatically release to the seller after the 3-day transit window closes, ensuring you aren't left waiting for your payment indefinitely.

---

> [!IMPORTANT]
> ### Why These Protections Matter to Breeders
> - **Biosecurity Protection**: By fuzzing location parameters, Aquadex ensures that unauthorized visitors cannot harvest the exact location of your facility, preserving strict quarantine and biosecurity protocols.
> - **Reputation Integrity**: The commit-reveal handshake guarantees that every transaction is cryptographically linked to a verified swap meet or event handshake, proving the legitimacy of your breeding business and preserving your long-standing industry reputation.
