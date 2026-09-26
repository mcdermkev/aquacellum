/**
 * privyWallet.js — deterministic wallet selection for a Privy session.
 *
 * WHY THIS EXISTS
 *
 * AuthContext resolved the active address with the expression
 *
 *     wallets.find(w => w.walletClientType === "privy") || wallets[0]
 *
 * duplicated in seven places. That expression has three defects which together
 * let one human write data under two different wallet addresses:
 *
 *   1. ARRAY-ORDER DEPENDENCE. `|| wallets[0]` means "whichever wallet the SDK
 *      happened to list first". With two wallets on one Privy user the winner is
 *      arbitrary, and because the seven call sites each evaluated it
 *      independently, the SIGNING wallet could differ from the `account` string
 *      the app recorded as owner.
 *   2. HYDRATION DEPENDENCE. It was evaluated as soon as Privy reported
 *      `authenticated`, which can be before `useWallets()` has populated. The
 *      early pass fell through to `privyUser.wallet.address` (Privy's own
 *      "most recently linked" pointer) and a later pass used the array — two
 *      different answers inside one session, with no first-write-wins guard.
 *   3. NO PRIMARY SIGNAL. Privy already designates a primary wallet on the user
 *      object. Nothing consulted it.
 *
 * WHY IT MATTERS MORE THAN IT LOOKS
 *
 * Ownership in this app is keyed by wallet address almost everywhere:
 * `profiles.wallet_address` and `user_xp_profiles.wallet_address` are PRIMARY
 * KEYs, `breeder_profiles.wallet_address` is a PK carrying the storefront slug,
 * `seller_stripe_accounts.wallet_address` is UNIQUE and maps to the Stripe
 * account, and `aquadex_listings.seller_address` / `orders.seller_wallet` are
 * loose text with no FK. Dexie reads are all scoped
 * `where("ownerAddress").equals(account)`.
 *
 * So an address that changes mid-session does not fail loudly. It silently
 * splits one person's inventory, orders, XP, storefront and payout mapping
 * across two identities, and `ensureProfile()` will happily INSERT the second
 * one. That is why selection has to be a pure deterministic function rather
 * than an inline expression evaluated wherever it happens to be needed.
 *
 * WHAT THIS DOES NOT DO
 *
 * It does not merge or alias two wallets. If a person genuinely has two Privy
 * identities — for example an email-OTP user and a Google-OAuth user for the
 * same email address, which Privy treats as two separate users unless account
 * linking is enabled — then each session only ever sees its own single wallet,
 * and no client-side function can tell they are the same human. That is an
 * identity problem, fixed at the Privy configuration layer plus a data
 * migration. See `showcase_owner_principals` / `showcase_owner_wallets` for the
 * one place in this codebase that already models person-with-many-wallets.
 */

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function isUsableWallet(candidate) {
  return (
    Boolean(candidate) &&
    typeof candidate.address === "string" &&
    EVM_ADDRESS.test(candidate.address)
  );
}

function isEmbedded(candidate) {
  return candidate?.walletClientType === "privy";
}

/**
 * Deterministically choose the wallet object representing this Privy session.
 *
 * Precedence:
 *   1. Embedded (`walletClientType === "privy"`) wallets, if any exist. An
 *      external wallet is only ever chosen when there is no embedded one, so a
 *      connected MetaMask can never quietly become the Privy session identity.
 *   2. Among the candidates, Privy's own primary pointer (`privyUser.wallet`)
 *      when that address is present in the list.
 *   3. Otherwise the lowest address, lexically. Arbitrary, but STABLE — the
 *      property that matters is that repeated evaluations within a session and
 *      across reloads agree with each other.
 *
 * @param {Array<{address?: string, walletClientType?: string}>} wallets - from `useWallets()`
 * @param {object|null} privyUser - from `usePrivy()`, used only as a tie-break
 * @returns {object|null} the chosen wallet object, or null when there is none
 */
export function selectPrivyWallet(wallets, privyUser = null) {
  const usable = Array.isArray(wallets) ? wallets.filter(isUsableWallet) : [];
  if (usable.length === 0) return null;

  const embedded = usable.filter(isEmbedded);
  const pool = embedded.length > 0 ? embedded : usable;
  if (pool.length === 1) return pool[0];

  const primary = privyUser?.wallet?.address;
  if (typeof primary === "string" && EVM_ADDRESS.test(primary)) {
    const target = primary.toLowerCase();
    const match = pool.find((w) => w.address.toLowerCase() === target);
    if (match) return match;
  }

  return [...pool].sort((a, b) =>
    a.address.toLowerCase().localeCompare(b.address.toLowerCase())
  )[0];
}

/**
 * Resolve the address for this session, reporting WHERE it came from.
 *
 * `source: "wallets"` is authoritative — it came from the hydrated `useWallets()`
 * list. `source: "user"` is PROVISIONAL: the array had not hydrated yet, so we
 * fell back to the Privy user object to keep the session usable. The caller is
 * expected to allow a provisional address to be upgraded to an authoritative
 * one, and to refuse an authoritative -> different-authoritative swap.
 *
 * @returns {{address: string|null, source: "wallets"|"user"|null}}
 */
export function resolveSessionWallet(wallets, privyUser = null) {
  const chosen = selectPrivyWallet(wallets, privyUser);
  if (chosen) return { address: chosen.address, source: "wallets" };

  if (isUsableWallet(privyUser?.wallet)) {
    return { address: privyUser.wallet.address, source: "user" };
  }

  const linked = Array.isArray(privyUser?.linkedAccounts)
    ? privyUser.linkedAccounts.filter((a) => a?.type === "wallet" && isUsableWallet(a))
    : [];
  if (linked.length > 0) {
    const embedded = linked.filter(isEmbedded);
    const pool = embedded.length > 0 ? embedded : linked;
    const sorted = [...pool].sort((a, b) =>
      a.address.toLowerCase().localeCompare(b.address.toLowerCase())
    );
    return { address: sorted[0].address, source: "user" };
  }

  return { address: null, source: null };
}

/**
 * Does this Privy user PROVABLY have no wallet yet?
 *
 * Deliberately conservative: an absent `privyUser` returns false, because
 * "I cannot see a wallet" is not the same claim as "there is no wallet". The
 * only caller is the embedded-wallet recovery path, and answering true while
 * Privy state is still loading is exactly what minted duplicate wallets.
 */
export function hasNoLinkedWallet(privyUser, wallets) {
  if (!privyUser) return false;
  if (Array.isArray(wallets) && wallets.some(isUsableWallet)) return false;
  if (isUsableWallet(privyUser.wallet)) return false;
  const linked = privyUser.linkedAccounts;
  if (
    Array.isArray(linked) &&
    linked.some((a) => a?.type === "wallet" && isUsableWallet(a))
  ) {
    return false;
  }
  return true;
}

/**
 * Find the wallet object matching a known address, case-insensitively.
 *
 * Signing paths use this instead of re-running `selectPrivyWallet`, so the
 * wallet that signs is by construction the wallet recorded in `account` rather
 * than a second independent guess at "the current wallet".
 */
export function findWalletByAddress(wallets, address) {
  if (!Array.isArray(wallets) || typeof address !== "string") return null;
  const target = address.toLowerCase();
  return wallets.find((w) => isUsableWallet(w) && w.address.toLowerCase() === target) || null;
}

/** True when two addresses refer to the same wallet, ignoring casing/nullish. */
export function isSameAddress(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  return a.toLowerCase() === b.toLowerCase();
}
