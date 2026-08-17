import React from "react";
import { BreedersCouncil } from "./BreedersCouncil";

/**
 * CurationQueuePanel — the full-page ("🛠️ Curation Queue" tab) view of the
 * species curation queue.
 *
 * WHY THIS IS NOW A THIN WRAPPER. There used to be two separate queue UIs and
 * they disagreed, which is the whole reason the feature looked broken: this panel
 * had the Approve/Reject buttons but sat behind an on-chain `curator()` address
 * check that matched only the deployer wallet, while BreedersCouncil — the one
 * surface a founder could actually reach, inside the Council Portal modal —
 * received `updateSuggestionStatus` as a prop and never called it, so it rendered
 * a read-only status list. A founder saw a queue with no controls; the panel with
 * controls was invisible to them.
 *
 * Worse, this panel's approve handler called `relayAddSpecies`, which despite the
 * "dispatched directly to the Base L2 smart contract" copy sent no transaction at
 * all — it wrote a row to the approving browser's own IndexedDB with
 * `speciesId = Date.now()` and no contractAddress, a value the Add Fish picker
 * can never read. Approving was a private no-op.
 *
 * Both surfaces now render the same component against the same shared queue, so
 * they cannot drift apart again. Real approval goes through the council's vote
 * buttons (invariant enforced in Postgres) and publication goes through
 * `?action=promote`, which signs the on-chain `addSpecies` with the curator key
 * server-side.
 *
 * See docs/SPECIES_SUGGESTION_APPROVAL_SPEC.md.
 */
export function CurationQueuePanel({
  suggestionsQuery,
  castVote,
  isVoting,
  promoteSpecies,
  isPromoting,
  CARE_LEVEL_STRINGS,
  walletAccount,
  marketplaceAddress,
}) {
  return (
    <div className="glass-card" style={{ width: "100%", padding: "2rem", borderRadius: "var(--radius-sm)" }}>
      <BreedersCouncil
        walletAccount={walletAccount}
        suggestionsQuery={suggestionsQuery}
        castVote={castVote}
        isVoting={isVoting}
        promoteSpecies={promoteSpecies}
        isPromoting={isPromoting}
        CARE_LEVEL_STRINGS={CARE_LEVEL_STRINGS}
        marketplaceAddress={marketplaceAddress}
        isModalView={true}
      />
    </div>
  );
}
