/**
 * useMessages.js
 * 
 * TanStack Query hooks + Supabase Realtime for DM conversations.
 */

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getMyConversations,
  getTotalUnreadCount,
  getMessages,
  sendMessage,
  markConversationRead,
  getOrCreateConversation,
} from "../services/messagesApi";
import { supabase, isSupabaseConfigured, getCurrentWallet } from "../services/supabaseClient";

/**
 * Hook to get all conversations for the current user.
 */
export function useConversations(enabled = true) {
  return useQuery({
    queryKey: ["messages", "conversations"],
    queryFn: async () => {
      const { data, error } = await getMyConversations();
      if (error) throw new Error(typeof error === "string" ? error : error.message);
      return data;
    },
    enabled: enabled && isSupabaseConfigured() && !!getCurrentWallet(),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
}

/**
 * Hook to get total unread DM count (for badge display).
 */
export function useUnreadDMCount(enabled = true) {
  return useQuery({
    queryKey: ["messages", "unread-count"],
    queryFn: getTotalUnreadCount,
    enabled: enabled && isSupabaseConfigured() && !!getCurrentWallet(),
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
  });
}

/**
 * Hook to get messages in a conversation + realtime updates.
 */
export function useConversationMessages(conversationId, enabled = true) {
  const [realtimeMessages, setRealtimeMessages] = useState([]);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["messages", "thread", conversationId],
    queryFn: async () => {
      const { data, error } = await getMessages(conversationId);
      if (error) throw new Error(typeof error === "string" ? error : error.message);
      return data;
    },
    enabled: enabled && !!conversationId && isSupabaseConfigured(),
    staleTime: 10 * 1000,
  });

  // Realtime subscription for new messages
  useEffect(() => {
    if (!conversationId || !enabled || !isSupabaseConfigured()) return;

    const channel = supabase
      .channel(`dm:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          setRealtimeMessages((prev) => [...prev, payload.new]);
          // Also invalidate unread counts
          queryClient.invalidateQueries({ queryKey: ["messages", "unread-count"] });
          queryClient.invalidateQueries({ queryKey: ["messages", "conversations"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, enabled, queryClient]);

  // Merge query data + realtime additions
  const allMessages = [
    ...(query.data || []),
    ...realtimeMessages.filter(
      (rm) => !(query.data || []).some((qm) => qm.id === rm.id)
    ),
  ];

  // Reset realtime buffer when query refetches
  useEffect(() => {
    if (query.data) {
      setRealtimeMessages([]);
    }
  }, [query.dataUpdatedAt]);

  return {
    messages: allMessages,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}

/**
 * Mutation to send a message.
 */
export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ conversationId, body }) => sendMessage(conversationId, body),
    onSuccess: (result, vars) => {
      if (result.data) {
        queryClient.invalidateQueries({ queryKey: ["messages", "thread", vars.conversationId] });
        queryClient.invalidateQueries({ queryKey: ["messages", "conversations"] });
      }
    },
  });
}

/**
 * Mutation to mark a conversation as read.
 */
export function useMarkConversationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (conversationId) => markConversationRead(conversationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages", "unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["messages", "conversations"] });
    },
  });
}

/**
 * Hook to open/create a conversation with a target user.
 */
export function useOpenConversation() {
  return useMutation({
    mutationFn: (targetWallet) => getOrCreateConversation(targetWallet),
  });
}
