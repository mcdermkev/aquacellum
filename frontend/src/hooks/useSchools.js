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
  listOfficialSchools,
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
  getSchoolPosts,
  createSchoolPost,
  updateSchoolPost,
  deleteSchoolPost,
  setSchoolPostPinned,
  toggleSchoolPostReaction,
  joinChallenge,
  leaveChallenge,
  getChallengeParticipants,
  submitChallengeEntry,
  getChallengeSubmissions,
  withdrawChallengeEntry,
  voteForChallengeEntry,
  finalizeChallenge,
  cancelChallenge,
  claimChallengeReward,
} from "../services/schoolsApi";
import { getCurrentWallet, isSupabaseConfigured } from "../services/supabaseClient";

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
 * Fetch official (platform-curated) master schools.
 */
export function useOfficialSchools() {
  return useQuery({
    queryKey: ["schools", "official"],
    queryFn: () => listOfficialSchools(),
    staleTime: 5 * 60 * 1000, // Cache for 5 min — these rarely change
  });
}

/**
 * Fetch schools the current user belongs to.
 */
export function useMySchools(walletOverride = null) {
  const walletAddress = walletOverride || getCurrentWallet();

  return useQuery({
    queryKey: ["schools", "mine", walletAddress],
    queryFn: () => getMySchools(),
    enabled: !!walletAddress && isSupabaseConfigured(),
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
export function useMySchoolRole(schoolId, walletOverride = null) {
  const walletAddress = walletOverride || getCurrentWallet();

  return useQuery({
    queryKey: ["schools", "role", schoolId, walletAddress],
    queryFn: () => getMySchoolRole(schoolId),
    enabled: !!schoolId && !!walletAddress && isSupabaseConfigured(),
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

// ─────────────────────────────────────────────────────────────────────────────
// SCHOOL POSTS — the feed
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A school's feed: pinned first, then newest.
 */
export function useSchoolPosts(schoolId) {
  return useQuery({
    queryKey: ["schools", "posts", schoolId],
    queryFn: () => getSchoolPosts(schoolId),
    enabled: !!schoolId && isSupabaseConfigured(),
    staleTime: 30 * 1000,
  });
}

/**
 * Every post mutation invalidates the same feed key, so pinning, reacting,
 * editing and deleting all reconcile through one path rather than each keeping
 * its own optimistic copy in sync.
 */
function usePostMutation(schoolId, mutationFn) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schools", "posts", schoolId] });
    },
  });
}

export function useCreateSchoolPost(schoolId) {
  return usePostMutation(schoolId, ({ body, imageUrl }) =>
    createSchoolPost(schoolId, { body, imageUrl })
  );
}

export function useUpdateSchoolPost(schoolId) {
  return usePostMutation(schoolId, ({ postId, body }) => updateSchoolPost(postId, { body }));
}

export function useDeleteSchoolPost(schoolId) {
  return usePostMutation(schoolId, ({ postId }) => deleteSchoolPost(postId));
}

export function useSetSchoolPostPinned(schoolId) {
  return usePostMutation(schoolId, ({ postId, pinned }) => setSchoolPostPinned(postId, pinned));
}

export function useToggleSchoolPostReaction(schoolId) {
  return usePostMutation(schoolId, ({ postId, emoji }) => toggleSchoolPostReaction(postId, emoji));
}

// ─────────────────────────────────────────────────────────────────────────────
// CHALLENGE LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

export function useChallengeParticipants(challengeId) {
  return useQuery({
    queryKey: ["schools", "challenge", challengeId, "participants"],
    queryFn: () => getChallengeParticipants(challengeId),
    enabled: !!challengeId && isSupabaseConfigured(),
    staleTime: 20 * 1000,
  });
}

export function useChallengeSubmissions(challengeId) {
  return useQuery({
    queryKey: ["schools", "challenge", challengeId, "submissions"],
    queryFn: () => getChallengeSubmissions(challengeId),
    enabled: !!challengeId && isSupabaseConfigured(),
    staleTime: 20 * 1000,
  });
}

/**
 * Any challenge write invalidates that challenge's participants and submissions,
 * plus the school's challenge list (finalizing rewrites `leaderboard` and
 * `finalized_at` on the challenge row itself).
 *
 * `schoolId` is needed because the challenge list is keyed by school, and a
 * finalize changes both.
 */
function useChallengeMutation(challengeId, schoolId, mutationFn) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schools", "challenge", challengeId] });
      queryClient.invalidateQueries({ queryKey: ["schools", "challenges", schoolId] });
    },
  });
}

export function useJoinChallenge(challengeId, schoolId) {
  return useChallengeMutation(challengeId, schoolId, () => joinChallenge(challengeId));
}

export function useLeaveChallenge(challengeId, schoolId) {
  return useChallengeMutation(challengeId, schoolId, () => leaveChallenge(challengeId));
}

export function useSubmitChallengeEntry(challengeId, schoolId) {
  return useChallengeMutation(challengeId, schoolId, (entry) =>
    submitChallengeEntry(challengeId, entry)
  );
}

export function useWithdrawChallengeEntry(challengeId, schoolId) {
  return useChallengeMutation(challengeId, schoolId, ({ submissionId }) =>
    withdrawChallengeEntry(submissionId)
  );
}

export function useVoteForEntry(challengeId, schoolId) {
  return useChallengeMutation(challengeId, schoolId, ({ submissionId }) =>
    voteForChallengeEntry(challengeId, submissionId)
  );
}

export function useFinalizeChallenge(challengeId, schoolId) {
  return useChallengeMutation(challengeId, schoolId, () => finalizeChallenge(challengeId));
}

export function useCancelChallenge(challengeId, schoolId) {
  return useChallengeMutation(challengeId, schoolId, () => cancelChallenge(challengeId));
}

export function useClaimChallengeReward(challengeId, schoolId) {
  return useChallengeMutation(challengeId, schoolId, () => claimChallengeReward(challengeId));
}
