/**
 * useSchoolChat.js
 * 
 * Real-time chat hook for Schools using Supabase Realtime subscriptions.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, isSupabaseConfigured } from "../services/supabaseClient";
import { getSchoolMessages, sendSchoolMessage, deleteSchoolMessage } from "../services/schoolsApi";

/**
 * Hook providing real-time school chat functionality.
 * Subscribes to Supabase Realtime for new messages.
 */
export function useSchoolChat(schoolId, enabled = true) {
  const queryClient = useQueryClient();
  const [realtimeMessages, setRealtimeMessages] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const channelRef = useRef(null);

  // Fetch initial messages
  const {
    data: initialResult,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["school-chat", schoolId],
    queryFn: () => getSchoolMessages(schoolId, { limit: 50 }),
    enabled: enabled && !!schoolId,
    staleTime: 10 * 1000,
  });

  const initialMessages = initialResult?.data || [];

  // Subscribe to Realtime channel for new messages
  useEffect(() => {
    if (!enabled || !schoolId || !isSupabaseConfigured()) return;

    const channel = supabase
      .channel(`school:${schoolId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "school_chat",
          filter: `school_id=eq.${schoolId}`,
        },
        (payload) => {
          const newMsg = payload.new;
          // Add to realtime messages if not already in initial fetch
          setRealtimeMessages((prev) => {
            // Deduplicate
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "school_chat",
          filter: `school_id=eq.${schoolId}`,
        },
        (payload) => {
          // Handle message deletion (soft delete)
          if (payload.new.is_deleted) {
            setRealtimeMessages((prev) =>
              prev.filter((m) => m.id !== payload.new.id)
            );
            // Also invalidate cached messages
            queryClient.invalidateQueries({ queryKey: ["school-chat", schoolId] });
          }
        }
      )
      .subscribe((status) => {
        setIsConnected(status === "SUBSCRIBED");
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      setIsConnected(false);
      setRealtimeMessages([]);
    };
  }, [schoolId, enabled, queryClient]);

  // Combine initial + realtime messages, deduplicated
  const allMessages = [...initialMessages];
  for (const rtMsg of realtimeMessages) {
    if (!allMessages.some((m) => m.id === rtMsg.id)) {
      allMessages.push(rtMsg);
    }
  }
  // Sort chronologically
  allMessages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  // Send message callback
  const send = useCallback(
    async (body) => {
      if (!body?.trim()) return { error: "Empty message" };
      const result = await sendSchoolMessage(schoolId, body.trim());
      if (result.data) {
        // Optimistic add (will deduplicate with Realtime)
        setRealtimeMessages((prev) => [...prev, result.data]);
      }
      return result;
    },
    [schoolId]
  );

  // Delete message callback (moderation)
  const deleteMessage = useCallback(
    async (messageId) => {
      const result = await deleteSchoolMessage(messageId);
      if (!result.error) {
        setRealtimeMessages((prev) => prev.filter((m) => m.id !== messageId));
        queryClient.invalidateQueries({ queryKey: ["school-chat", schoolId] });
      }
      return result;
    },
    [schoolId, queryClient]
  );

  return {
    messages: allMessages,
    isLoading,
    error,
    isConnected,
    send,
    deleteMessage,
    refetch,
  };
}
