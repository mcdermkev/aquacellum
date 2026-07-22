/**
 * Web2 language invariant for the Task 20 review UI copy
 * (docs/TASK_20_REVIEWS_SPEC.md §6 acceptance criterion 7): every new
 * review-facing string (reputation labels, badges, moderation copy,
 * composer labels, order-receipt review section) must be free of
 * PROHIBITED_TERMS, matching the established invariant test style
 * (orderCopy.test.js, addOnPresenter.test.js, listingFlowCopy.test.js).
 *
 * These strings live inline in JSX (not a dedicated copy module), so this
 * test enumerates the literal new-UI strings directly.
 */
import { describe, it, expect } from "vitest";
import { containsProhibitedTerm } from "../services/orderCopy.js";
import { reputationSummary } from "../services/reviewAggregation.js";

const REVIEW_FLOW_STRINGS = [
  // SellerReputation.jsx
  "Seller Reputation",
  "Reviews",
  "Verified purchase",
  "No reviews yet — be the first to leave one after your order arrives!",
  "No published reviews yet.",
  "Live arrival / health",
  "Accuracy",
  "Packaging",
  "Communication",
  "Fulfillment",
  "Seller response",
  "Thank the buyer or clarify anything — this is shown publicly.",
  "Post response",
  "Report this review",
  "Report review",
  "Respond",
  // ReviewComposer.jsx
  "How did it go?",
  "Leave a review",
  "Overall rating",
  "Overall",
  "Tell other buyers about it (optional)",
  "Written review (optional)",
  "Post review",
  "Submit review",
  // ReviewModerationPanel.jsx
  "Review Reports",
  "Dismiss report",
  "Hide review",
  "Queue is clear",
  "No pending review reports.",
  // OrderReceipt.jsx review section
  "Your review",
  "You can leave a review once your fish arrives.",
  "Review available after arrival is confirmed.",
];

describe("Task 20 review-flow copy — Web2 language invariant", () => {
  it("every new UI string is free of PROHIBITED_TERMS", () => {
    for (const text of REVIEW_FLOW_STRINGS) {
      expect(containsProhibitedTerm(text), `string: "${text}"`).toBe(false);
    }
  });

  it("every reputationSummary label (across every count/average permutation) is free of PROHIBITED_TERMS", () => {
    for (const count of [0, 1, 2, 3, 10, 50]) {
      for (const average of [0, 1, 2, 2.5, 3, 3.5, 4, 4.5, 5]) {
        const { label } = reputationSummary({ count, average });
        expect(containsProhibitedTerm(label), `count=${count} average=${average} label="${label}"`).toBe(false);
      }
    }
  });
});
