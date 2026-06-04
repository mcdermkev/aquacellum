/**
 * useSchools.js
 * 
 * TanStack Query hooks for Schools (Clubs) system.
 */

import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import {
  createSchool,
  getSchoolBySlug,
  getSchoolById,
  listSchools,
  getMySchools,
  updateSchool,
  joinSchool,
  leaveSchool,
  getSchoolMembers,
  getMySchoolRole,
  updateMemberRole,
  removeMember,
  getSchoolChallenges,
  createChallenge,
} from "../services/schoolsApi";
import { getCurrentWallet } from "../services/supabaseClient";

/**
 * Fetch all schools with optional type filter and search.
 */
export function useSchoolDirectory({ type, search } = {}) {
  return useInfiniteQuery({
    queryKey: ["schools", "directory", type, search],
    queryFn: ({ pageParam }) => listSchools({ type, search, cursor: pageParam, limit: 20 }),
    getNextPageParam: (lastPage) => {
      if (!lastPage.data || lastPage.data.length < 20) return undefined;
      return lastPage.data[lastPage.data.length - 1].created_at;
    },
    initialPageParam: undefined,
    staleTime: 60 * 1000,
  });
}

/**
 * Fetch schools the current user belongs to.
 */
export function useMySchools() {
  const walletAddress = getCurrentWallet();

  return useQuery({
    queryKey: ["schools", "mine", walletAddress],
    queryFn: () => getMySchools(),
    enabled: !!walletAddress,
    staleTime: 30 * 1000,
  });
}

/**
 * Fetch a single school by slug.
 */
export function useSchool(slug) {
  return useQuery({
    queryKey: ["schools", "detail", slug],
    queryFn: () => getSchoolBySlug(slug),
    enabled: !!slug,
    staleTime: 30 * 1000,
  });
}

/**
 * Fetch a single school by ID.
 */
export function useSchoolById(schoolId) {
  return useQuery({
    queryKey: ["schools", "detail-id", schoolId],
    queryFn: () => getSchoolById(schoolId),
    enabled: !!schoolId,
    staleTime: 30 * 1000,
  });
}

/**
 * Fetch current user's role in a school.
 */
export function useMySchoolRole(schoolId) {
  const walletAddress = getCurrentWallet();

  return useQuery({
    queryKey: ["schools", "role", schoolId, walletAddress],
    queryFn: () => getMySchoolRole(schoolId),
    enabled: !!schoolId && !!walletAddress,
    staleTime: 30 * 1000,
  });
}

/**
 * Fetch members of a school.
 */
export function useSchoolMembers(schoolId) {
  return useQuery({
    queryKey: ["schools", "members", schoolId],
    queryFn: () => getSchoolMembers(schoolId),
    enabled: !!schoolId,
    staleTime: 30 * 1000,
  });
}

/**
 * Fetch challenges for a school.
 */
export function useSchoolChallenges(schoolId, { status } = {}) {
  return useQuery({
    queryKey: ["schools", "challenges", schoolId, status],
    queryFn: () => getSchoolChallenges(schoolId, { status }),
    enabled: !!schoolId,
    staleTime: 30 * 1000,
  });
}

/**
 * Mutation: Create a new school.
 */
export function useCreateSchool() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createSchool,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schools"] });
    },
  });
}

/**
 * Mutation: Join a school.
 */
export function useJoinSchool() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (schoolId) => joinSchool(schoolId),
    onSuccess: (_, schoolId) => {
      queryClient.invalidateQueries({ queryKey: ["schools"] });
    },
  });
}

/**
 * Mutation: Leave a school.
 */
export function useLeaveSchool() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (schoolId) => leaveSchool(schoolId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schools"] });
    },
  });
}

/**
 * Mutation: Update a school (Founder).
 */
export function useUpdateSchool() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ schoolId, updates }) => updateSchool(schoolId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schools"] });
    },
  });
}

/**
 * Mutation: Update member role.
 */
export function useUpdateMemberRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ schoolId, targetWallet, newRole }) =>
      updateMemberRole(schoolId, targetWallet, newRole),
    onSuccess: (_, { schoolId }) => {
      queryClient.invalidateQueries({ queryKey: ["schools", "members", schoolId] });
    },
  });
}

/**
 * Mutation: Remove a member.
 */
export function useRemoveMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ schoolId, targetWallet }) => removeMember(schoolId, targetWallet),
    onSuccess: (_, { schoolId }) => {
      queryClient.invalidateQueries({ queryKey: ["schools", "members", schoolId] });
      queryClient.invalidateQueries({ queryKey: ["schools", "detail-id", schoolId] });
    },
  });
}

/**
 * Mutation: Create a challenge.
 */
export function useCreateChallenge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ schoolId, ...challengeData }) => createChallenge(schoolId, challengeData),
    onSuccess: (_, { schoolId }) => {
      queryClient.invalidateQueries({ queryKey: ["schools", "challenges", schoolId] });
    },
  });
}
