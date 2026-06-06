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
  getTideChatMessages,
  placeBid,
  getBidHistory,
  getHighestBid,
  getAuctionItems,
} from "../services/tidesApi";
import { supabase, getCurrentWallet, isSupabaseConfigured } from "../services/supabaseClient";

// ─────────────────────────────────────────────────────────────────────────────
// TIDE QUERIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch a single tide by ID.
 */
export function useTide(tideId) {
  return useQuery({
    queryKey: ["reef", "tide", tideId],
    queryFn: () => getTide(tideId),
    enabled: !!tideId && isSupabaseConfigured(),
    staleTime: 30 * 1000,
    select: (res) => res.data,
  });
}

/**
 * Fetch upcoming tides with filters.
 */
export function useUpcomingTides({ tideType, schoolId } = {}) {
  return useQuery({
    queryKey: ["reef", "tides", "upcoming", { tideType, schoolId }],
    queryFn: () => getUpcomingTides({ tideType, schoolId }),
    enabled: isSupabaseConfigured(),
    staleTime: 30 * 1000,
    select: (res) => res.data,
  });
}

/**
 * Fetch past tides.
 */
export function usePastTides() {
  return useQuery({
    queryKey: ["reef", "tides", "past"],
    queryFn: () => getPastTides(),
    enabled: isSupabaseConfigured(),
    staleTime: 60 * 1000,
    select: (res) => res.data,
  });
}

/**
 * Fetch tides the current user is attending.
 */
export function useMyTides() {
  const wallet = getCurrentWallet();
  return useQuery({
    queryKey: ["reef", "tides", "mine", wallet],
    queryFn: getMyTides,
    enabled: !!wallet && isSupabaseConfigured(),
    staleTime: 30 * 1000,
    select: (res) => res.data,
  });
}

/**
 * Fetch attendees for a tide.
 */
export function useTideAttendees(tideId) {
  return useQuery({
    queryKey: ["reef", "tide-attendees", tideId],
    queryFn: () => getTideAttendees(tideId),
    enabled: !!tideId && isSupabaseConfigured(),
    staleTime: 15 * 1000,
    select: (res) => res.data,
  });
}

/**
 * Get current user's RSVP for a tide.
 */
export function useMyRsvp(tideId) {
  const wallet = getCurrentWallet();
  return useQuery({
    queryKey: ["reef", "my-rsvp", tideId, wallet],
    queryFn: () => getMyRsvp(tideId),
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
    queryFn: () => getSwapSheet(tideId),
    enabled: !!tideId && isSupabaseConfigured(),
    staleTime: 30 * 1000,
    select: (res) => res.data,
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
      const { data } = await getTideChatMessages(tideId);
      if (!cancelled) {
        setMessages(data || []);
        setIsLoading(false);
      }
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

  return { messages, sendMessage, isLoading };
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
 * Hook for real-time auction bidding.
 */
export function useAuction(tideId, tokenId, enabled = true) {
  const [highestBid, setHighestBid] = useState(null);
  const [bidHistory, setBidHistory] = useState([]);
  const queryClient = useQueryClient();

  // Initial load
  useEffect(() => {
    if (!tideId || !tokenId || !enabled || !isSupabaseConfigured()) return;

    async function load() {
      const { data: high } = await getHighestBid(tideId, tokenId);
      const { data: history } = await getBidHistory(tideId, tokenId);
      setHighestBid(high);
      setBidHistory(history || []);
    }

    load();
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
          if (payload.new.token_id === tokenId) {
            // New bid came in — refresh
            setHighestBid(payload.new);
            setBidHistory((prev) => [payload.new, ...prev]);
          }
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
      return result;
    },
    [tideId, tokenId]
  );

  return { highestBid, bidHistory, submitBid };
}
