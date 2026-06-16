/**
 * useTankCam.js
 * 
 * Hooks for Tank Cam features:
 * - Setup/teardown of a cam
 * - Fetching active cams for discovery
 * - Realtime viewer presence + reactions for a specific cam
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase, isSupabaseConfigured, getCurrentWallet } from "../services/supabaseClient";

/**
 * Hook to list active Tank Cams for the discovery feed.
 */
export function useTankCams(enabled = true) {
  return useQuery({
    queryKey: ["tank-cams", "active"],
    queryFn: async () => {
      const response = await fetch("/api/tank-cams?status=active&limit=20");
      const result = await response.json();
      if (result.error) throw new Error(result.error);
      return result.data || [];
    },
    enabled,
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 60 * 1000, // poll every minute for new cams
  });
}

/**
 * Hook to get the current user's Tank Cam(s).
 */
export function useMyTankCams(walletAddress, enabled = true) {
  return useQuery({
    queryKey: ["tank-cams", "mine", walletAddress],
    queryFn: async () => {
      if (!isSupabaseConfigured() || !walletAddress) return [];

      const { data, error } = await supabase
        .from("tank_cams")
        .select("*")
        .eq("owner_wallet", walletAddress)
        .order("created_at", { ascending: false });

      if (error) throw new Error(error.message);
      return data || [];
    },
    enabled: enabled && !!walletAddress && isSupabaseConfigured(),
    staleTime: 60 * 1000,
  });
}

/**
 * Mutation to create a new Tank Cam.
 */
export function useCreateTankCam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ walletAddress, tankId, tankName }) => {
      const response = await fetch("/api/tank-cam-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress, tankId, tankName }),
      });
      const result = await response.json();
      if (result.error) throw new Error(result.error);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tank-cams"] });
    },
  });
}

/**
 * Mutation to delete a Tank Cam.
 */
export function useDeleteTankCam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ walletAddress, camId, liveStreamId }) => {
      const response = await fetch("/api/tank-cam-setup", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress, camId, liveStreamId }),
      });
      const result = await response.json();
      if (result.error) throw new Error(result.error);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tank-cams"] });
    },
  });
}

/**
 * Hook for realtime viewer presence and reactions on a specific Tank Cam.
 * Uses Supabase Realtime Presence + Broadcast channels.
 */
export function useTankCamPresence(camId, enabled = true) {
  const [viewerCount, setViewerCount] = useState(0);
  const [reactions, setReactions] = useState([]); // [{id, emoji, timestamp}]
  const channelRef = useRef(null);
  const reactionIdRef = useRef(0);

  useEffect(() => {
    if (!camId || !enabled || !isSupabaseConfigured()) return;

    const walletAddress = getCurrentWallet();
    const channel = supabase.channel(`tank-cam:${camId}`, {
      config: { presence: { key: walletAddress || "anon" } },
    });

    // Track presence (viewer count)
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      const count = Object.keys(state).length;
      setViewerCount(count);
    });

    // Listen for broadcast reactions
    channel.on("broadcast", { event: "reaction" }, (payload) => {
      const { emoji } = payload.payload || {};
      if (emoji) {
        const id = ++reactionIdRef.current;
        setReactions((prev) => [...prev.slice(-20), { id, emoji, timestamp: Date.now() }]);

        // Auto-remove after animation (2.5s)
        setTimeout(() => {
          setReactions((prev) => prev.filter((r) => r.id !== id));
        }, 2500);
      }
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({
          wallet: walletAddress || "anon",
          joined_at: new Date().toISOString(),
        });
      }
    });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [camId, enabled]);

  const sendReaction = useCallback(
    (emoji) => {
      if (channelRef.current) {
        channelRef.current.send({
          type: "broadcast",
          event: "reaction",
          payload: { emoji },
        });
        // Also add locally for immediate feedback
        const id = ++reactionIdRef.current;
        setReactions((prev) => [...prev.slice(-20), { id, emoji, timestamp: Date.now() }]);
        setTimeout(() => {
          setReactions((prev) => prev.filter((r) => r.id !== id));
        }, 2500);
      }
    },
    []
  );

  return { viewerCount, reactions, sendReaction };
}
