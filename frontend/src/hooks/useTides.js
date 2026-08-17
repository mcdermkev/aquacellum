/**
 * useTides.js
 * 
 * React hooks for Tides (Events) — queries, mutations, and realtime subscriptions.
 */

import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useState, useRef, useCallback } from "react";
import {
  getTide,
  getUpcomingTides,
  getPastTides,
  getMyTides,
  createTide,
  updateTide,
  cancelTide,
  rsvpTide,
  cancelRsvp,
  checkInToTide,
  getTideAttendees,
  getMyRsvp,
  getSwapSheet,
  updateBringingSpecies,
  sendTideChatMessage,
  postTideSystemMessage,
  getTideChatMessages,
  placeBid,
  getBidHistory,
  getHighestBid,
  getAuctionItems,
} from "../services/tidesApi";
import { supabase, getCurrentWallet, isSupabaseConfigured } from "../services/supabaseClient";

// ─────────────────────────────────────────────────────────────────────────────
// ERROR HANDLING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Unwrap a `{ data, error }` service envelope, THROWING on error.
 *
 * Every query below used to do `select: (res) => res.data`, which reads the data
 * out of the envelope and drops `res.error` on the floor. React Query never sees
 * a rejection, so `isError` stays false, nothing retries, nothing logs, and the
 * component renders its empty state.
 *
 * That is not a theoretical concern — it is exactly how this feature broke.
 * `getTideAttendees` ordered by a `created_at` column that did not exist, so
 * every request failed with Postgres 42703, and every tide reported
 * "Attendees (0) — No RSVPs yet" while real RSVP rows sat in the table. A silent
 * catch turned a loud schema error into a plausible-looking empty event.
 *
 * Throwing means a broken query now looks broken.
 */
async function unwrap(promise, label) {
  const res = await promise;

  // Services aren't perfectly uniform: a few return a bare value rather than an
  // envelope. Anything without an `error` key is passed through as-is.
  if (!res || typeof res !== "object" || !("error" in res)) return res ?? null;

  if (res.error) {
    const detail = typeof res.error === "string"
      ? res.error
      : res.error.message || res.error.code || JSON.stringify(res.error);
    const err = new Error(`${label}: ${detail}`);
    err.code = res.error?.code;
    err.cause = res.error;
    throw err;
  }

  return res.data ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// TIDE QUERIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch a single tide by ID.
 */
export function useTide(tideId) {
  return useQuery({
    queryKey: ["reef", "tide", tideId],
    queryFn: () => unwrap(getTide(tideId), "getTide"),
    enabled: !!tideId && isSupabaseConfigured(),
    staleTime: 30 * 1000,
  });
}

/**
 * Fetch upcoming tides with filters.
 */
export function useUpcomingTides({ tideType, schoolId } = {}) {
  return useQuery({
    queryKey: ["reef", "tides", "upcoming", { tideType, schoolId }],
    queryFn: () => unwrap(getUpcomingTides({ tideType, schoolId }), "getUpcomingTides"),
    enabled: isSupabaseConfigured(),
    staleTime: 30 * 1000,
  });
}

/**
 * Fetch past tides.
 */
export function usePastTides() {
  return useQuery({
    queryKey: ["reef", "tides", "past"],
    queryFn: () => unwrap(getPastTides(), "getPastTides"),
    enabled: isSupabaseConfigured(),
    staleTime: 60 * 1000,
  });
}

/**
 * Fetch tides the current user is attending.
 */
export function useMyTides(walletOverride = null) {
  const wallet = walletOverride || getCurrentWallet();
  return useQuery({
    queryKey: ["reef", "tides", "mine", wallet],
    queryFn: () => unwrap(getMyTides(), "getMyTides"),
    enabled: !!wallet && isSupabaseConfigured(),
    staleTime: 30 * 1000,
  });
}

/**
 * Fetch attendees for a tide.
 */
export function useTideAttendees(tideId) {
  return useQuery({
    queryKey: ["reef", "tide-attendees", tideId],
    queryFn: () => unwrap(getTideAttendees(tideId), "getTideAttendees"),
    enabled: !!tideId && isSupabaseConfigured(),
    staleTime: 15 * 1000,
  });
}

/**
 * Get current user's RSVP for a tide.
 */
export function useMyRsvp(tideId, walletOverride = null) {
  const wallet = walletOverride || getCurrentWallet();
  return useQuery({
    queryKey: ["reef", "my-rsvp", tideId, wallet],
    queryFn: () => unwrap(getMyRsvp(tideId), "getMyRsvp"),
    enabled: !!tideId && !!wallet && isSupabaseConfigured(),
    staleTime: 10 * 1000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TIDE MUTATIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new tide.
 */
export function useCreateTide() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createTide,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reef", "tides"] });
    },
  });
}

/**
 * Host control: take a tide LIVE (upcoming → live).
 *
 * This is the transition that actually "starts" the event: it unlocks the Live
 * Feed / Chat / check-in tabs (all gated on status === 'live') and fires the
 * notify_tide_live trigger that pings every RSVP'd attendee.
 *
 * To make the feed feel alive from the first second, it best-effort seeds a
 * system "we're live" message. That chat insert is RLS-gated to attendees, so we
 * first RSVP the host into their own event. Both seeding steps are non-critical —
 * a failure never blocks going live.
 */
export function useStartTide(tideId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await updateTide(tideId, { status: "live" });
      if (error) throw new Error(error.message || String(error));

      // Seed the live feed (best-effort — never block the host from going live).
      try {
        await rsvpTide(tideId, "going");
        await postTideSystemMessage(tideId, "🌊 The tide is live — welcome aboard! Drop a reaction and say hi.");
      } catch { /* seeding is non-critical */ }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reef", "tide", tideId] });
      queryClient.invalidateQueries({ queryKey: ["reef", "tides"] });
      queryClient.invalidateQueries({ queryKey: ["reef", "tide-attendees", tideId] });
    },
  });
}

/**
 * Host control: end a tide (live → ended). Posts a closing narration line before
 * flipping status so it lands while the feed is still live, then moves the tide
 * into its post-event (recap) state.
 */
export function useEndTide(tideId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      try {
        await postTideSystemMessage(tideId, "🌙 The tide has ended — thanks for riding the current with us.");
      } catch { /* non-critical */ }

      const { data, error } = await updateTide(tideId, { status: "ended" });
      if (error) throw new Error(error.message || String(error));
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reef", "tide", tideId] });
      queryClient.invalidateQueries({ queryKey: ["reef", "tides"] });
    },
  });
}

/**
 * RSVP to a tide.
 */
export function useRsvp(tideId) {
  const queryClient = useQueryClient();
  const wallet = getCurrentWallet();

  return useMutation({
    mutationFn: (status = "going") => rsvpTide(tideId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reef", "my-rsvp", tideId] });
      queryClient.invalidateQueries({ queryKey: ["reef", "tide-attendees", tideId] });
      queryClient.invalidateQueries({ queryKey: ["reef", "tide", tideId] });
      // Also the LISTS. TideCalendar renders "✓ Going" from `tide.my_rsvp`, which
      // arrives on the upcoming/mine list rows — without this the card you just
      // RSVP'd from keeps showing its RSVP button until something else
      // refetches, which reads as the click having done nothing.
      queryClient.invalidateQueries({ queryKey: ["reef", "tides"] });
    },
  });
}

/**
 * Cancel RSVP.
 */
export function useCancelRsvp(tideId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => cancelRsvp(tideId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reef", "my-rsvp", tideId] });
      queryClient.invalidateQueries({ queryKey: ["reef", "tide-attendees", tideId] });
      queryClient.invalidateQueries({ queryKey: ["reef", "tide", tideId] });
      queryClient.invalidateQueries({ queryKey: ["reef", "tides"] });
    },
  });
}

/**
 * Check in to a tide (Expo).
 */
export function useCheckIn(tideId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => checkInToTide(tideId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reef", "my-rsvp", tideId] });
      queryClient.invalidateQueries({ queryKey: ["reef", "tide-attendees", tideId] });
      queryClient.invalidateQueries({ queryKey: ["reef", "tides"] });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SWAP SHEET
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch the swap sheet for a tide.
 */
export function useSwapSheet(tideId) {
  return useQuery({
    queryKey: ["reef", "swap-sheet", tideId],
    queryFn: () => unwrap(getSwapSheet(tideId), "getSwapSheet"),
    enabled: !!tideId && isSupabaseConfigured(),
    staleTime: 30 * 1000,
  });
}

/**
 * Update what species the user is bringing.
 */
export function useUpdateBringing(tideId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (speciesList) => updateBringingSpecies(tideId, speciesList),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reef", "swap-sheet", tideId] });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TIDE CHAT — Realtime
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook for tide chat with real-time subscription.
 * Returns messages array, send function, and loading state.
 */
export function useTideChat(tideId, enabled = true) {
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const lastSentRef = useRef(0);
  const RATE_LIMIT_MS = 5000; // 1 message per 5 seconds

  // Initial load
  useEffect(() => {
    if (!tideId || !enabled || !isSupabaseConfigured()) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    async function loadMessages() {
      const { data, error } = await getTideChatMessages(tideId);
      if (cancelled) return;
      if (error) {
        console.error("[useTideChat] failed to load history:", error);
        setLoadError(typeof error === "string" ? error : error.message || "Could not load chat");
      } else {
        setLoadError(null);
        setMessages(data || []);
      }
      setIsLoading(false);
    }

    loadMessages();
    return () => { cancelled = true; };
  }, [tideId, enabled]);

  // Realtime subscription
  useEffect(() => {
    if (!tideId || !enabled || !isSupabaseConfigured()) return;

    const channel = supabase
      .channel(`tide-chat:${tideId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "tide_chat",
          filter: `tide_id=eq.${tideId}`,
        },
        async (payload) => {
          // Fetch the full message with profile data
          const { data } = await supabase
            .from("tide_chat")
            .select(`
              *,
              profile:author_wallet (
                wallet_address, display_name, avatar_url, companion_tier
              )
            `)
            .eq("id", payload.new.id)
            .single();

          if (data) {
            setMessages((prev) => [...prev, data]);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tideId, enabled]);

  // Send function with rate limiting
  const sendMessage = useCallback(async (body) => {
    const now = Date.now();
    if (now - lastSentRef.current < RATE_LIMIT_MS) {
      return { error: "Rate limited — wait 5 seconds between messages" };
    }

    lastSentRef.current = now;
    const { data, error } = await sendTideChatMessage(tideId, body);
    return { data, error };
  }, [tideId]);

  return { messages, sendMessage, isLoading, loadError };
}

// ─────────────────────────────────────────────────────────────────────────────
// TIDE LIVE FEED — Realtime
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook for the real-time live feed during active tides.
 * Aggregates: chat messages, trade ticker, Poseidon narration, check-ins.
 */
export function useTideLiveFeed(tideId, enabled = true) {
  const [feedItems, setFeedItems] = useState([]);
  const [newItemCount, setNewItemCount] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    if (!tideId || !enabled || !isSupabaseConfigured()) return;

    const channel = supabase
      .channel(`tide-live:${tideId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "tide_chat",
          filter: `tide_id=eq.${tideId}`,
        },
        (payload) => {
          const item = {
            id: payload.new.id,
            type: payload.new.is_system_message ? "narration" : "chat",
            data: payload.new,
            timestamp: payload.new.created_at,
          };

          if (isPaused) {
            setNewItemCount((c) => c + 1);
          }
          setFeedItems((prev) => [...prev, item]);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "tide_attendees",
          filter: `tide_id=eq.${tideId}`,
        },
        (payload) => {
          if (payload.new.rsvp_status === "checked_in") {
            const item = {
              id: `checkin-${payload.new.id}`,
              type: "check_in",
              data: payload.new,
              timestamp: payload.new.checked_in_at || new Date().toISOString(),
            };
            setFeedItems((prev) => [...prev, item]);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tideId, enabled, isPaused]);

  const resume = useCallback(() => {
    setIsPaused(false);
    setNewItemCount(0);
  }, []);

  const pause = useCallback(() => {
    setIsPaused(true);
  }, []);

  return { feedItems, newItemCount, isPaused, pause, resume };
}

// ─────────────────────────────────────────────────────────────────────────────
// AUCTION — Realtime
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compare two bids by amount. Returns >0 if `a` beats `b`.
 *
 * Amounts are integer US cents, so this is a plain numeric comparison. A
 * malformed amount loses rather than throwing, which keeps one bad row from
 * breaking the whole ticker.
 */
function compareBidAmount(a, b) {
  if (!a) return -1;
  if (!b) return 1;
  const av = Number(a.amount_cents ?? 0);
  const bv = Number(b.amount_cents ?? 0);
  if (!Number.isFinite(av)) return -1;
  if (!Number.isFinite(bv)) return 1;
  return av > bv ? 1 : av < bv ? -1 : 0;
}

/**
 * Hook for real-time auction bidding.
 */
export function useAuction(tideId, tokenId, enabled = true) {
  const [highestBid, setHighestBid] = useState(null);
  const [bidHistory, setBidHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // Initial load
  useEffect(() => {
    if (!tideId || !tokenId || !enabled || !isSupabaseConfigured()) return;

    let cancelled = false;

    async function load() {
      const [high, history] = await Promise.all([
        getHighestBid(tideId, tokenId),
        getBidHistory(tideId, tokenId),
      ]);
      if (cancelled) return;

      const failure = high.error || history.error;
      if (failure) {
        console.error("[useAuction] failed to load bid state:", failure);
        setLoadError(typeof failure === "string" ? failure : failure.message || "Could not load bids");
      } else {
        setLoadError(null);
      }

      setHighestBid(high.data ?? null);
      setBidHistory(history.data || []);
      setIsLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [tideId, tokenId, enabled]);

  // Realtime subscription for new bids
  useEffect(() => {
    if (!tideId || !tokenId || !enabled || !isSupabaseConfigured()) return;

    const channel = supabase
      .channel(`auction:${tideId}:${tokenId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "auction_bids",
          filter: `tide_id=eq.${tideId}`,
        },
        (payload) => {
          if (payload.new.token_id !== tokenId) return;

          setBidHistory((prev) =>
            prev.some((b) => b.id === payload.new.id) ? prev : [payload.new, ...prev]
          );

          // Only promote it if it actually beats the standing bid. The previous
          // version assigned every incoming bid straight to `highestBid`, so an
          // out-of-order or losing bid could visually "win" the lot.
          setHighestBid((prev) => (compareBidAmount(payload.new, prev) > 0 ? payload.new : prev));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tideId, tokenId, enabled]);

  const submitBid = useCallback(
    async (amountWei) => {
      const result = await placeBid(tideId, tokenId, amountWei);

      // Apply our own bid optimistically. Realtime only delivers INSERTs to
      // *other* subscribers reliably; without this the bidder can sit staring at
      // a stale "current bid" after a successful submit and assume it failed.
      if (!result.error && result.data) {
        setBidHistory((prev) =>
          prev.some((b) => b.id === result.data.id) ? prev : [result.data, ...prev]
        );
        setHighestBid((prev) => (compareBidAmount(result.data, prev) > 0 ? result.data : prev));
      }

      return result;
    },
    [tideId, tokenId]
  );

  return { highestBid, bidHistory, submitBid, isLoading, loadError };
}
