import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const route = readFileSync(fileURLToPath(new URL("../../api/showcase-owner.js", import.meta.url)), "utf8");

describe("showcase-owner route security posture", () => {
  it("is a default handler(req, res) function", () => {
    expect(route).toMatch(/export default async function handler\(req, res\)/);
  });

  it("sets every frozen no-store / security response header", () => {
    for (const [h, v] of [
      ["Cache-Control", "private, no-store, max-age=0"],
      ["Pragma", "no-cache"],
      ["Expires", "0"],
      ["X-Content-Type-Options", "nosniff"],
      ["Referrer-Policy", "no-referrer"],
      ["Vary", "Origin, Authorization"],
    ]) {
      expect(route).toContain(`res.setHeader("${h}", "${v}")`);
    }
  });

  it("permits only POST and OPTIONS", () => {
    expect(route).toContain('res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")');
    expect(route).toContain('res.status(204).end()'); // OPTIONS
    expect(route).toContain('res.setHeader("Allow", "POST, OPTIONS")');
    expect(route).toContain('"method_not_allowed"');
    expect(route).toMatch(/req\.method !== "POST"/);
  });

  it("sets WWW-Authenticate on 401 and enforces content-type + 1 MiB bound", () => {
    expect(route).toContain('res.setHeader("WWW-Authenticate", "Bearer")');
    expect(route).toContain("application/json");
    expect(route).toContain("payload_too_large");
    expect(route).toContain("1048576");
  });

  it("never touches a base table — RPC-only access", () => {
    expect(route).not.toContain("supabase.from(");
    expect(route).toContain("supabase.rpc(");
  });

  it("only ever calls allowlisted showcase_ RPCs", () => {
    const rpcNames = [...route.matchAll(/supabase\.rpc\("([^"]+)"/g)].map((m) => m[1]);
    // The route calls exactly one rpc() site (callRpc); RPC names are passed via callRpc/rpcData.
    const called = [...route.matchAll(/(?:callRpc|rpcData)\(\s*"([^"]+)"/g)].map((m) => m[1]);
    const allow = new Set([
      "showcase_resolve_owner_principal", "showcase_link_owner_wallet",
      "showcase_issue_wallet_link_nonce", "showcase_consume_wallet_link_nonce",
      "showcase_owner_identity_state", "showcase_owner_identity_conflict_candidates",
      "showcase_enroll_dataset", "showcase_start_dataset_import", "showcase_stage_dataset_import_chunk",
      "showcase_finalize_dataset_import", "showcase_stage_identity_candidates", "showcase_resolve_identity_conflict",
      "showcase_owner_room", "showcase_create_owner_room", "showcase_update_owner_room", "showcase_reset_owner_room",
      "showcase_put_room_tank", "showcase_remove_room_tank", "showcase_put_specimen_settings",
      "showcase_set_room_tank_commerce",
      "showcase_owner_publication_preview", "showcase_owner_publication_preview_v2",
      "showcase_set_owner_room_visibility", "showcase_set_owner_room_visibility_v2",
      "showcase_stage_room_hero", "showcase_cancel_room_hero_stage",
      "showcase_owner_media_upload_binding", "showcase_finalize_room_hero_upload",
      "showcase_owner_media_status", "showcase_authorize_owner_media_preview",
      "showcase_publish_room_hero", "showcase_revoke_media_asset",
      "showcase_stage_room_video", "showcase_cancel_room_video_stage",
      "showcase_owner_video_upload_binding", "showcase_finalize_room_video_upload",
      "showcase_owner_room_videos", "showcase_put_room_video", "showcase_revoke_room_video",
      "showcase_authorize_owner_video_playback",
      "showcase_resolve_owner_legacy_qr", "showcase_bind_owner_legacy_qr",
    ]);
    for (const name of [...rpcNames, ...called]) {
      expect(name.startsWith("showcase_"), `unexpected rpc ${name}`).toBe(true);
      expect(allow.has(name), `rpc ${name} is not on the reviewed allowlist`).toBe(true);
    }
  });

  it("returns the bounded {ok, action, ...} envelope and never leaks raw errors", () => {
    expect(route).toMatch(/ok: true, action, data/);
    expect(route).toMatch(/ok: false, action, code/);
    // Response text comes from the closed ERROR_MESSAGES dictionary, never a raw upstream message.
    expect(route).toContain("ERROR_MESSAGES[code]");
    expect(route).not.toMatch(/\.json\([^)]*\.message/);
  });

  it("resolves owner authority only from the verified session, never the body", () => {
    expect(route).toContain("verifyShowcaseSession(req)");
    expect(route).toContain("resolveOwnerId(supabase, session.subject)");
    expect(route).not.toMatch(/ownerId:\s*(?:body|req\.body)/);
  });
});
