/**
 * useTideStream.js
 * 
 * Hooks for Tide livestream management.
 * - Query stream state for a tide
 * - Create/end stream mutations
 * - Realtime status updates
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase, isSupabaseConfigured } from "../services/supabaseClient";

/**
 * Hook to get the stream state for a specific Tide.
 * Returns the tide_streams row (playbackId, status, etc.)
 */
export function useTideStream(tideId, enabled = true) {
  const [realtimeStatus, setRealtimeStatus] = useState(null);

  const query = useQuery({
    queryKey: ["tide-stream", tideId],
    queryFn: async () => {
      if (!isSupabaseConfigured() || !tideId) return null;

      const { data, error } = await supabase
        .from("tide_streams")
        .select("*")
        .eq("tide_id", tideId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== "PGRST116") {
        // PGRST116 = no rows found (not a real error)
        console.warn("[TideStream] Query error:", error);
      }

      return data || null;
    },
    enabled: enabled && !!tideId && isSupabaseConfigured(),
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
  });

  // Realtime subscription for status changes
  useEffect(() => {
    if (!tideId || !enabled || !isSupabaseConfigured()) return;

    const channel = supabase
      .channel(`tide-stream:${tideId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "tide_streams",
          filter: `tide_id=eq.${tideId}`,
        },
        (payload) => {
          setRealtimeStatus(payload.new.status);
          // Invalidate query to pick up full row
          query.refetch();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tideId, enabled]);

  // Merge realtime status with query data
  const streamData = query.data;
  const effectiveStatus = realtimeStatus || streamData?.status || null;

  return {
    stream: streamData,
    status: effectiveStatus,
    playbackId: streamData?.mux_playback_id || null,
    recordingPlaybackId: streamData?.recording_playback_id || null,
    isLive: effectiveStatus === "live",
    isLoading: query.isLoading,
  };
}

/**
 * Mutation to create a stream for a Tide (host only).
 */
export function useCreateTideStream() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ walletAddress, tideId }) => {
      const response = await fetch("/api/tide-stream-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress, tideId }),
      });
      const result = await response.json();
      if (result.error) throw new Error(result.error);
      return result;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["tide-stream", vars.tideId] });
    },
  });
}

/**
 * Mutation to end a Tide stream (host only).
 */
export function useEndTideStream() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ walletAddress, tideId, streamId }) => {
      const response = await fetch("/api/tide-stream-setup", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress, tideId, streamId }),
      });
      const result = await response.json();
      if (result.error) throw new Error(result.error);
      return result;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["tide-stream", vars.tideId] });
    },
  });
}
