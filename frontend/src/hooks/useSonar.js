/**
 * useSonar.js
 * 
 * React hook for Sonar notifications.
 * Provides unread count, notification list, and mark-as-read actions.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from "../services/reefApi";
import { getCurrentWallet, isSupabaseConfigured, supabase } from "../services/supabaseClient";
import { useEffect } from "react";

/**
 * Hook for unread notification count (displayed on the bell icon).
 * Polls every 30 seconds and updates via Realtime subscription.
 */
export function useUnreadCount(enabled = true) {
  const walletAddress = getCurrentWallet();
  const queryClient = useQueryClient();

  // Real-time subscription for instant count updates
  useEffect(() => {
    if (!walletAddress || !isSupabaseConfigured() || !enabled) return;

    const channel = supabase
      .channel(`sonar:${walletAddress}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "sonar_notifications",
          filter: `recipient_wallet=eq.${walletAddress}`,
        },
        () => {
          // New notification arrived — increment count
          queryClient.invalidateQueries({
            queryKey: ["reef", "sonar-count", walletAddress],
          });
          queryClient.invalidateQueries({
            queryKey: ["reef", "sonar-list", walletAddress],
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [walletAddress, enabled, queryClient]);

  return useQuery({
    queryKey: ["reef", "sonar-count", walletAddress],
    queryFn: getUnreadCount,
    enabled: enabled && !!walletAddress && isSupabaseConfigured(),
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000, // Poll every 30s as fallback
  });
}

/**
 * Hook for the notification list.
 */
export function useNotifications({ limit = 20, unreadOnly = false } = {}) {
  const walletAddress = getCurrentWallet();

  return useQuery({
    queryKey: ["reef", "sonar-list", walletAddress, { limit, unreadOnly }],
    queryFn: () => getNotifications({ limit, unreadOnly }),
    enabled: !!walletAddress && isSupabaseConfigured(),
    staleTime: 15 * 1000,
  });
}

/**
 * Mutation to mark a single notification as read.
 */
export function useMarkRead() {
  const queryClient = useQueryClient();
  const walletAddress = getCurrentWallet();

  return useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["reef", "sonar-count", walletAddress],
      });
      queryClient.invalidateQueries({
        queryKey: ["reef", "sonar-list", walletAddress],
      });
    },
  });
}

/**
 * Mutation to mark all notifications as read.
 */
export function useMarkAllRead() {
  const queryClient = useQueryClient();
  const walletAddress = getCurrentWallet();

  return useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["reef", "sonar-count", walletAddress],
      });
      queryClient.invalidateQueries({
        queryKey: ["reef", "sonar-list", walletAddress],
      });
    },
  });
}
