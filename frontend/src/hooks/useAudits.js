/**
 * useAudits.js
 * 
 * TanStack Query hooks for Expert Audits and Mentorship.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createAudit,
  getAuditsForUser,
  getAuditsByAuditor,
  getAuditsForCurrent,
  markAuditXpAwarded,
  requestAudit,
  getAuditRequests,
  claimAuditRequest,
  completeAuditRequest,
  cancelAuditRequest,
  requestMentorship,
  acceptMentorship,
  endMentorship,
  getMentorships,
  toggleAcceptingMentees,
  getAvailableMentors,
} from "../services/auditsApi";
import { getCurrentWallet } from "../services/supabaseClient";

// ─────────────────────────────────────────────────────────────────────────────
// EXPERT AUDITS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch audits received by a user.
 */
export function useAuditsReceived(walletAddress, enabled = true) {
  return useQuery({
    queryKey: ["audits", "received", walletAddress],
    queryFn: () => getAuditsForUser(walletAddress),
    enabled: enabled && !!walletAddress,
    staleTime: 60 * 1000,
  });
}

/**
 * Fetch audits given by a user.
 */
export function useAuditsGiven(walletAddress, enabled = true) {
  return useQuery({
    queryKey: ["audits", "given", walletAddress],
    queryFn: () => getAuditsByAuditor(walletAddress),
    enabled: enabled && !!walletAddress,
    staleTime: 60 * 1000,
  });
}

/**
 * Fetch audits for a specific Current (displayed on CurrentCard).
 */
export function useAuditsForCurrent(currentId, enabled = true) {
  return useQuery({
    queryKey: ["audits", "current", currentId],
    queryFn: () => getAuditsForCurrent(currentId),
    enabled: enabled && !!currentId,
    staleTime: 60 * 1000,
  });
}

/**
 * Mutation: Create an expert audit with XP triggering.
 */
export function useCreateAudit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createAudit,
    onSuccess: (result) => {
      if (result.data) {
        queryClient.invalidateQueries({ queryKey: ["audits"] });
        queryClient.invalidateQueries({ queryKey: ["reef"] });

        // Trigger XP for both parties via the global bridge
        if (window.triggerXpTracking) {
          // +25 Prestige XP for auditor
          window.triggerXpTracking(25, "Expert Audit Given");
          // +50 Prestige XP for recipient (handled via notification trigger server-side,
          // but we also trigger locally for the auditor's companion progression)
        }
      }
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT REQUESTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch audit requests (for the auditor queue).
 */
export function useAuditRequests(enabled = true) {
  return useQuery({
    queryKey: ["audits", "requests"],
    queryFn: () => getAuditRequests({ forAuditor: true }),
    enabled,
    staleTime: 30 * 1000,
  });
}

/**
 * Mutation: Request an audit on a Current.
 */
export function useRequestAudit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: requestAudit,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["audits", "requests"] });
    },
  });
}

/**
 * Mutation: Claim an audit request.
 */
export function useClaimAuditRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: claimAuditRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["audits", "requests"] });
    },
  });
}

/**
 * Mutation: Cancel an audit request.
 */
export function useCancelAuditRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: cancelAuditRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["audits", "requests"] });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MENTORSHIP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch mentorships for the current user.
 */
export function useMentorships(walletAddress, enabled = true) {
  return useQuery({
    queryKey: ["mentorships", walletAddress],
    queryFn: () => getMentorships(walletAddress),
    enabled: enabled && !!walletAddress,
    staleTime: 60 * 1000,
  });
}

/**
 * Fetch available mentors.
 */
export function useAvailableMentors(enabled = true) {
  return useQuery({
    queryKey: ["mentors", "available"],
    queryFn: () => getAvailableMentors(),
    enabled,
    staleTime: 60 * 1000,
  });
}

/**
 * Mutation: Request mentorship.
 */
export function useRequestMentorship() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ mentorWallet, message }) => requestMentorship(mentorWallet, message),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mentorships"] });
    },
  });
}

/**
 * Mutation: Accept mentorship (mentor action).
 */
export function useAcceptMentorship() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: acceptMentorship,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mentorships"] });
    },
  });
}

/**
 * Mutation: End mentorship.
 */
export function useEndMentorship() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: endMentorship,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mentorships"] });
    },
  });
}

/**
 * Mutation: Toggle accepting mentees.
 */
export function useToggleAcceptingMentees() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (accepting) => toggleAcceptingMentees(accepting),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reef", "profile"] });
    },
  });
}
