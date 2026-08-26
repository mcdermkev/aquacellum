/**
 * Authenticated Reef trust operations.
 *
 * Mentorship state and the community moderation queue are deliberately routed
 * through the server. The browser never supplies the acting wallet and never
 * receives service-role database access; the API derives identity from the
 * verified Privy session and applies keeper-role authorization where required.
 */

import { buildReefTrustMessage } from "./reefTrustProof";

const API_BASE = import.meta.env.VITE_API_BASE || "/api";

let sessionTokenGetter = null;
let walletSignerGetter = null;

export function setSessionTokenGetter(getter) {
  sessionTokenGetter = typeof getter === "function" ? getter : null;
}

export function setWalletSignerGetter(getter) {
  walletSignerGetter = typeof getter === "function" ? getter : null;
}

async function request(action, { method = "GET", params, body } = {}) {
  let token;
  try {
    token = sessionTokenGetter ? await sessionTokenGetter() : null;
  } catch (error) {
    return { success: false, error: error.message || "Could not resolve the signed-in session" };
  }

  if (!token) return { success: false, error: "Sign in to use Reef trust features", status: 401 };
  if (!walletSignerGetter) return { success: false, error: "Connect your account wallet to use Reef trust features", status: 401 };

  let walletProof;
  try {
    const timestamp = Date.now();
    const signer = await walletSignerGetter();
    const walletAddress = (await signer.getAddress()).toLowerCase();
    const signature = await signer.signMessage(buildReefTrustMessage({ action, method, timestamp, body }));
    walletProof = { walletAddress, signature, timestamp };
  } catch (error) {
    return { success: false, error: error.message || "Could not verify the connected wallet", status: 401 };
  }

  const query = new URLSearchParams({ action, ...(params || {}) });
  const response = await fetch(`${API_BASE}/storefront-detail?${query.toString()}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Reef-Wallet": walletProof.walletAddress,
      "X-Reef-Timestamp": String(walletProof.timestamp),
      "X-Reef-Signature": walletProof.signature,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      success: false,
      error: data.error || `Request failed (${response.status})`,
      status: response.status,
    };
  }
  return { success: true, ...data };
}

export function fetchModerationQueue(filter = "pending") {
  return request("reef-moderation", { params: { filter } });
}

export function moderateFlag(flagId, action) {
  return request("reef-moderation", {
    method: "POST",
    body: { flagId, action },
  });
}

export async function submitContentReport(report) {
  const result = await request("reef-report", { method: "POST", body: report });
  return { error: result.success ? null : result.error };
}

export function fetchReviewReports(filter = "pending") {
  return request("review-reports", { params: { filter } });
}

export function moderateReview(reportId, action) {
  return request("moderate-review", {
    method: "POST",
    body: { reportId, action },
  });
}

export function reportReview(reviewId, reason, details) {
  return request("report-review", {
    method: "POST",
    body: { reviewId, reason, details },
  });
}

export async function createExpertAuditOnServer(audit) {
  const result = await request("expert-audits", { method: "POST", body: audit });
  return result.success
    ? { data: result.audit, error: null }
    : { data: null, error: result.error };
}

export async function fetchMentorships() {
  const result = await request("mentorships");
  return result.success
    ? { data: result.mentorships, error: null }
    : { data: { asMentor: [], asMentee: [] }, error: result.error };
}

export async function fetchAvailableMentors() {
  const result = await request("mentors");
  return result.success
    ? { data: result.mentors || [], error: null }
    : { data: [], error: result.error };
}

async function mutateMentorship(body) {
  const result = await request("mentorships", { method: "POST", body });
  if (!result.success) throw new Error(result.error || "Mentorship request failed");
  return { data: result.mentorship || result.profile || null, error: null };
}

export function requestMentorshipFromServer(mentorWallet, message = "") {
  return mutateMentorship({ action: "request", mentorWallet, message });
}

export function acceptMentorshipOnServer(mentorshipId) {
  return mutateMentorship({ action: "accept", mentorshipId });
}

export function declineMentorshipOnServer(mentorshipId) {
  return mutateMentorship({ action: "decline", mentorshipId });
}

export function endMentorshipOnServer(mentorshipId) {
  return mutateMentorship({ action: "end", mentorshipId });
}

export function setAcceptingMenteesOnServer(accepting) {
  return mutateMentorship({ action: "toggle", accepting: Boolean(accepting) });
}
