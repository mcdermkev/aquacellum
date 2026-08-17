/**
 * useSuggestSpecies.js
 *
 * React Query bindings for the Breeders Council species curation flow.
 *
 * WHAT CHANGED AND WHY. This hook used to own a Dexie database
 * ('AquadexCurationDB') holding suggestions in the browser they were typed into.
 * That made the whole feature inert: a suggestion was invisible to every other
 * account and device, so the second founder could never review it, and
 * "approving" one wrote a row to the approving browser's own speciesManifest
 * with `speciesId = Date.now()` — a value the Add Fish picker can never read.
 *
 * Everything now goes through services/speciesCurationApi.js to a shared
 * Supabase-backed queue. The client holds no curation state of its own: it cannot
 * set a status, cannot decide who may vote, and cannot write the catalog. All
 * three are enforced in the database and the API layer.
 *
 * See docs/SPECIES_SUGGESTION_APPROVAL_SPEC.md.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listSuggestionQueue,
  submitSuggestion,
  castVote,
  promoteSuggestion,
} from "../services/speciesCurationApi";

export const SUGGESTIONS_QUERY_KEY = ["speciesSuggestions"];

/**
 * Takes no arguments, deliberately.
 *
 * It used to take `(walletAddress, existingSpecies)`: the wallet keyed the local
 * store and stamped `submitter`, and the species array fed a client-side
 * duplicate check. Both moved server-side. The acting wallet is now derived from
 * the verified Privy token — a client-supplied wallet is never trusted — and the
 * duplicate check runs against fishbase_master.json plus species_id_map on the
 * server, because the old in-browser check was trivially bypassable.
 *
 * The queue itself is shared and public, so it is not keyed by wallet either.
 */
export function useSuggestSpecies() {
  const queryClient = useQueryClient();

  const suggestionsQuery = useQuery({
    queryKey: SUGGESTIONS_QUERY_KEY,
    queryFn: async () => {
      const { suggestions } = await listSuggestionQueue();
      return suggestions || [];
    },
    // The queue is shared, so another founder's vote should show up without a
    // reload, but it changes rarely enough that polling would be wasteful.
    staleTime: 30 * 1000,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: SUGGESTIONS_QUERY_KEY });

  const addSuggestionMutation = useMutation({
    mutationFn: (formData) => submitSuggestion(formData),
    onSuccess: invalidate,
  });

  const voteMutation = useMutation({
    mutationFn: (args) => castVote(args),
    onSuccess: invalidate,
  });

  const promoteMutation = useMutation({
    mutationFn: (suggestionId) => promoteSuggestion(suggestionId),
    onSuccess: () => {
      invalidate();
      // A promoted species is now in the on-chain catalog, so the species lists
      // and the Add Fish picker are stale. Both read through these keys.
      queryClient.invalidateQueries({ queryKey: ["contractSpeciesLive"] });
      queryClient.invalidateQueries({ queryKey: ["contractSpeciesCache"] });
      // useSpeciesData caches with staleTime: Infinity and merges the authored
      // profile overlay inside its queryFn, so the reference catalog has to be
      // invalidated explicitly or a newly published species shows no card.
      queryClient.invalidateQueries({ queryKey: ["species"] });
    },
  });

  return {
    suggestionsQuery,

    suggestSpecies: addSuggestionMutation.mutateAsync,
    isSuggesting: addSuggestionMutation.isPending,

    castVote: voteMutation.mutateAsync,
    isVoting: voteMutation.isPending,

    promoteSpecies: promoteMutation.mutateAsync,
    isPromoting: promoteMutation.isPending,
  };
}
