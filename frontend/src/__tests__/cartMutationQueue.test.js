import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveQueuedMutationRevision } from "../services/cartStore.js";

const API_SOURCE = readFileSync(
  fileURLToPath(new URL("../../api/cart.js", import.meta.url)),
  "utf8",
);
const STORE_SOURCE = readFileSync(
  fileURLToPath(new URL("../services/cartStore.js", import.meta.url)),
  "utf8",
);
const CONTEXT_SOURCE = readFileSync(
  fileURLToPath(new URL("../contexts/CartContext.jsx", import.meta.url)),
  "utf8",
);
const MIGRATION_SOURCE = readFileSync(
  fileURLToPath(new URL("../../supabase/migrations/20260829_cart_merge_idempotency.sql", import.meta.url)),
  "utf8",
);

describe("same-tab cart mutation revision lineage", () => {
  it("uses the snapshot revision when there is no acknowledged predecessor", () => {
    expect(resolveQueuedMutationRevision(4, null)).toEqual({
      expectedRevision: 4,
      snapshotRevision: 4,
    });
  });

  it("advances overlapping descendants captured from the same base revision", () => {
    const firstAck = {
      snapshotRevision: 4,
      submittedRevision: 4,
      response: { ok: true, data: { revision: 5 } },
    };
    expect(resolveQueuedMutationRevision(4, firstAck)).toEqual({
      expectedRevision: 5,
      snapshotRevision: 4,
    });

    const secondAck = {
      snapshotRevision: 4,
      submittedRevision: 5,
      response: { ok: true, data: { revision: 6 } },
    };
    expect(resolveQueuedMutationRevision(4, secondAck)).toEqual({
      expectedRevision: 6,
      snapshotRevision: 4,
    });
  });

  it("advances A/B/C when C captures A's acknowledgement while B is in flight", () => {
    const aAck = {
      snapshotRevision: 4,
      submittedRevision: 4,
      response: { ok: true, data: { revision: 5 } },
    };
    const bPlan = resolveQueuedMutationRevision(4, aAck);
    expect(bPlan.expectedRevision).toBe(5);

    const bAck = {
      snapshotRevision: bPlan.snapshotRevision,
      submittedRevision: bPlan.expectedRevision,
      response: { ok: true, data: { revision: 6 } },
    };
    const cPlan = resolveQueuedMutationRevision(5, bAck);
    expect(cPlan).toEqual({
      expectedRevision: 6,
      snapshotRevision: 5,
    });
  });

  it("does not lend a revision to a stale snapshot from another lineage", () => {
    const unrelatedAck = {
      snapshotRevision: 5,
      submittedRevision: 6,
      response: { ok: true, data: { revision: 7 } },
    };
    expect(resolveQueuedMutationRevision(4, unrelatedAck)).toEqual({
      expectedRevision: 4,
      snapshotRevision: 4,
    });
  });

  it("does not advance after a failed or malformed predecessor response", () => {
    expect(resolveQueuedMutationRevision(4, {
      snapshotRevision: 4,
      submittedRevision: 4,
      response: { ok: false, status: 409, data: { revision: 5 } },
    }).expectedRevision).toBe(4);
    expect(resolveQueuedMutationRevision(4, {
      snapshotRevision: 4,
      submittedRevision: 4,
      response: { ok: true, data: { revision: "invalid" } },
    }).expectedRevision).toBe(4);
  });
});

describe("seller-conflict decisions are bound to the reviewed revision", () => {
  it("sends and validates reviewedAccountRevision through the API/RPC contract", () => {
    expect(STORE_SOURCE).toContain("reviewedAccountRevision,");
    expect(STORE_SOURCE).toContain("conflict.accountCart?.serverRevision");
    expect(API_SOURCE).toContain("reviewedAccountRevision = null");
    expect(API_SOURCE).toContain("p_reviewed_account_revision: reviewedRevision");
    expect(MIGRATION_SOURCE).toContain("p_reviewed_account_revision BIGINT");
  });

  it("compares the reviewed revision under the wallet lock before mutation", () => {
    const lockIndex = MIGRATION_SOURCE.indexOf("pg_advisory_xact_lock");
    const revisionIndex = MIGRATION_SOURCE.indexOf("v_cart.revision <> p_reviewed_account_revision");
    const cartUpdateIndex = MIGRATION_SOURCE.indexOf("UPDATE canonical_carts", revisionIndex);
    expect(lockIndex).toBeGreaterThan(-1);
    expect(revisionIndex).toBeGreaterThan(lockIndex);
    expect(cartUpdateIndex).toBeGreaterThan(revisionIndex);
    expect(MIGRATION_SOURCE).toContain("'reason', 'account_revision_changed'");
  });

  it("refreshes the account snapshot without clearing the guest operation", () => {
    const resolver = STORE_SOURCE.slice(
      STORE_SOURCE.indexOf("export async function resolveCartMerge"),
      STORE_SOURCE.indexOf("export async function saveCart"),
    );
    expect(resolver).toContain('result.data?.code === "seller_conflict"');
    expect(resolver).toContain("accountCart = normalizeServerCart(result.data.accountCart)");
    expect(resolver).toContain("conflict: {");
    expect(resolver.indexOf("completeMerge(account, result)")).toBeGreaterThan(
      resolver.indexOf("if (!result.ok)"),
    );
    expect(CONTEXT_SOURCE).toContain("} else if (result.conflict) {");
    expect(CONTEXT_SOURCE).toContain("setConflict(result.conflict);");
  });
});

describe("ambiguous merge responses remain idempotent", () => {
  it("replays a completed committed choice even when the retry choice differs", () => {
    const completedBlock = MIGRATION_SOURCE.slice(
      MIGRATION_SOURCE.indexOf("IF v_operation.status = 'completed' THEN"),
      MIGRATION_SOURCE.indexOf("IF p_resolution IS NOT NULL AND v_operation.status <> 'awaiting_resolution'"),
    );
    expect(completedBlock).toContain("'success', TRUE");
    expect(completedBlock).toContain("'idempotentReplay', TRUE");
    expect(completedBlock).toContain("'committedResolution', v_operation.resolution");
    expect(completedBlock).toContain("'decisionMismatch'");
    expect(completedBlock).not.toContain("'code', 'operation_mismatch'");
  });

  it("clears the preserved guest copy only after the completed replay succeeds", () => {
    const resolver = STORE_SOURCE.slice(
      STORE_SOURCE.indexOf("export async function resolveCartMerge"),
      STORE_SOURCE.indexOf("export async function saveCart"),
    );
    expect(resolver.indexOf("if (!result.ok)")).toBeLessThan(resolver.indexOf("completeMerge(account, result)"));
    expect(STORE_SOURCE).toMatch(/async function completeMerge[\s\S]*writeScopedDexieCart\(emptyCart\(\), null\)/);
  });
});