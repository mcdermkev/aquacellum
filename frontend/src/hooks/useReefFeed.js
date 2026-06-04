/**
 * useReefFeed.js
 * 
 * TanStack Query hooks for The Reef social feed.
 * Provides infinite scroll pagination for Following and Discover feeds.
 */

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getFollowingFeed,
  getDiscoverFeed,
  getCurrentsByAuthor,
  createCurrent,
  deleteCurrent,
  toggleReaction,
  getReactions,
  postComment,
  getComments,
} from "../services/reefApi";
import { getCurrentWallet } from "../services/supabaseClient";

/**
 * Hook for the Following feed (Tankmates + watched tanks).
 * Infinite scroll with cursor-based pagination.
 */
export function useFollowingFeed(enabled = true) {
  const walletAddress = getCurrentWallet();

  return useInfiniteQuery({
    queryKey: ["reef", "following", walletAddress],
    queryFn: ({ pageParam }) =>
      getFollowingFeed(walletAddress, { cursor: pageParam, limit: 20 }),
    getNextPageParam: (lastPage) => {
      if (!lastPage.data || lastPage.data.length < 20) return undefined;
      return lastPage.data[lastPage.data.length - 1].created_at;
    },
    initialPageParam: undefined,
    enabled: enabled && !!walletAddress,
    staleTime: 60 * 1000, // 1 minute
    refetchOnWindowFocus: true,
  });
}

/**
 * Hook for the Discover feed (all public Currents).
 */
export function useDiscoverFeed(enabled = true) {
  return useInfiniteQuery({
    queryKey: ["reef", "discover"],
    queryFn: ({ pageParam }) =>
      getDiscoverFeed({ cursor: pageParam, limit: 20 }),
    getNextPageParam: (lastPage) => {
      if (!lastPage.data || lastPage.data.length < 20) return undefined;
      return lastPage.data[lastPage.data.length - 1].created_at;
    },
    initialPageParam: undefined,
    enabled,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Hook for a specific user's Currents (profile page).
 */
export function useUserCurrents(walletAddress, enabled = true) {
  return useInfiniteQuery({
    queryKey: ["reef", "user-currents", walletAddress],
    queryFn: ({ pageParam }) =>
      getCurrentsByAuthor(walletAddress, { cursor: pageParam, limit: 20 }),
    getNextPageParam: (lastPage) => {
      if (!lastPage.data || lastPage.data.length < 20) return undefined;
      return lastPage.data[lastPage.data.length - 1].created_at;
    },
    initialPageParam: undefined,
    enabled: enabled && !!walletAddress,
    staleTime: 60 * 1000,
  });
}

/**
 * Mutation hook for creating a new Current.
 * Optimistically prepends to the discover and following feeds.
 */
export function useCreateCurrent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createCurrent,
    onSuccess: (result) => {
      if (result.data) {
        // Invalidate feeds to show new post
        queryClient.invalidateQueries({ queryKey: ["reef", "following"] });
        queryClient.invalidateQueries({ queryKey: ["reef", "discover"] });
        queryClient.invalidateQueries({ queryKey: ["reef", "user-currents"] });
      }
    },
  });
}

/**
 * Mutation hook for deleting a Current.
 */
export function useDeleteCurrent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteCurrent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reef"] });
    },
  });
}

/**
 * Mutation hook for toggling reactions.
 */
export function useToggleReaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ currentId, emoji }) => toggleReaction(currentId, emoji),
    onSuccess: (_, variables) => {
      // Invalidate the specific current's reactions
      queryClient.invalidateQueries({
        queryKey: ["reef", "reactions", variables.currentId],
      });
    },
  });
}

/**
 * Hook to fetch reactions for a Current.
 */
export function useReactions(currentId, enabled = true) {
  return useInfiniteQuery({
    queryKey: ["reef", "reactions", currentId],
    queryFn: () => getReactions(currentId),
    getNextPageParam: () => undefined, // Not paginated
    initialPageParam: undefined,
    enabled: enabled && !!currentId,
    staleTime: 30 * 1000,
  });
}

/**
 * Mutation hook for posting comments.
 */
export function usePostComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ currentId, body, parentCommentId }) =>
      postComment(currentId, body, parentCommentId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["reef", "comments", variables.currentId],
      });
    },
  });
}

/**
 * Hook to fetch comments for a Current.
 */
export function useComments(currentId, enabled = true) {
  return useInfiniteQuery({
    queryKey: ["reef", "comments", currentId],
    queryFn: () => getComments(currentId),
    getNextPageParam: () => undefined,
    initialPageParam: undefined,
    enabled: enabled && !!currentId,
    staleTime: 30 * 1000,
  });
}
