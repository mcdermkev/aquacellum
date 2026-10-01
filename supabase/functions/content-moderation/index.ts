/**
 * content-moderation Edge Function
 *
 * Content moderation pipeline (Task 52).
 * Meant to be called by a database webhook on new content, with the
 * service-role key. Service-role callers only (_shared/callerRole.ts): it can
 * hide content, so an open endpoint let anyone hide any post.
 *
 * Text: a spam pattern check, then Gemini on Vertex (_shared/vertex.ts).
 * Images: fetched (https only, images only, up to 5 MB) and sent to the same
 * model. The old version sent an empty image and a URL, so it never looked.
 *
 * Expects body:
 * {
 *   type: "current" | "comment" | "insight",
 *   id: UUID,
 *   text?: string,
 *   image_urls?: string[],
 *   author_wallet: string
 * }
 *
 * `?dry=1` classifies and returns the verdict without hiding or flagging.
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { aiConfigured, generateText, parseJson } from "../_shared/vertex.ts";
import { isDryRun, requireServiceRole } from "../_shared/callerRole.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Basic filter before the AI check.
const SPAM_PATTERNS = [
  /https?:\/\/[^\s]+\.(xyz|click|win|free)/i,
  /buy now|click here|free money|earn \$\d+/i,
  /(.)\1{10,}/, // 10+ repeated chars
];

// No free number fields in the schema: the 3.x models can run away writing a
// float. Confidence is a word, mapped here.
const CONFIDENCE = { low: 0.35, medium: 0.65, high: 0.9 } as const;
const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    flagged: { type: "boolean" },
    reason: { type: "string", enum: ["spam", "inappropriate", "harassment", "none"] },
    confidence: { type: "string", enum: Object.keys(CONFIDENCE) },
  },
  required: ["flagged", "reason", "confidence"],
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type Verdict = { flagged: boolean; reason: string; confidence: number; source: string };
const CLEAN: Verdict = { flagged: false, reason: "none", confidence: 0, source: "none" };

serve(async (req) => {
  const denied = requireServiceRole(req);
  if (denied) return denied;

  try {
    const { type, id, text, image_urls } = await req.json();

    if (!type || !id) {
      return new Response(JSON.stringify({ error: "type and id required" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const dry = isDryRun(req);
    const ai = aiConfigured();
    let verdict: Verdict = CLEAN;

    // Step 1: spam patterns on the text.
    if (typeof text === "string" && SPAM_PATTERNS.some((p) => p.test(text))) {
      verdict = { flagged: true, reason: "spam", confidence: 0.9, source: "pattern" };
    }

    // Step 2: AI text check.
    if (!verdict.flagged && ai && typeof text === "string" && text.length > 10) {
      verdict = await moderateText(text);
    }

    // Step 3: AI image check.
    if (!verdict.flagged && ai && Array.isArray(image_urls)) {
      for (const url of image_urls.slice(0, 4)) {
        const v = await moderateImage(String(url));
        if (v.flagged) {
          verdict = v;
          break;
        }
      }
    }

    // Step 4: hide the content and record a flag for a curator.
    if (verdict.flagged && !dry) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      if (type === "current") {
        await supabase.from("currents").update({ is_hidden: true }).eq("id", id);
      } else if (type === "comment") {
        await supabase.from("comments").update({ is_hidden: true }).eq("id", id);
      }

      await supabase.from("moderation_flags").insert({
        target_type: type,
        target_id: id,
        reason: verdict.reason,
        auto_flagged: true,
        ai_confidence: verdict.confidence,
        details: `Auto-flagged by content moderation (${verdict.source}). Reason: ${verdict.reason}`,
      });
    }

    return new Response(
      JSON.stringify({ moderated: true, dry, ai, flagged: verdict.flagged, reason: verdict.reason, confidence: verdict.confidence, source: verdict.source }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});

function toVerdict(raw: unknown, source: string): Verdict {
  // deno-lint-ignore no-explicit-any
  const r = raw as any;
  if (!r || typeof r.flagged !== "boolean") return { ...CLEAN, source };
  const reason = ["spam", "inappropriate", "harassment"].includes(r.reason) ? r.reason : "none";
  const confidence = CONFIDENCE[r.confidence as keyof typeof CONFIDENCE] ?? CONFIDENCE.low;
  // Only act on a flag the model is at least moderately sure of. A wrongly
  // hidden post is worse here than one a curator catches later.
  const flagged = r.flagged === true && reason !== "none" && confidence >= CONFIDENCE.medium;
  return { flagged, reason: flagged ? reason : "none", confidence: flagged ? confidence : 0, source };
}

async function moderateText(text: string): Promise<Verdict> {
  const prompt = `You are a content moderator for an aquarium and fishkeeping community. Classify the text below.

Rules:
- Flag spam, sexual content, hate speech or harassment.
- Do NOT flag normal fishkeeping talk, even about breeding, fish dying, culling, disease, medication or water chemistry.
- Do NOT flag slang, casual language or enthusiastic posts.
- Only flag something that clearly breaks community standards.

Text: """${text.slice(0, 1500)}"""`;

  const res = await generateText(prompt, { schema: VERDICT_SCHEMA, maxOutputTokens: 80, temperature: 0 });
  return toVerdict(parseJson(res.text), sourceOf(res));
}

/** Which model decided, or why none did (shown in the response for ops). */
function sourceOf(res: { text: string | null; model: string | null; reason?: string }): string {
  return res.text && res.model ? `ai:${res.model}` : `ai-unavailable:${res.reason || "empty"}`;
}

/** An image as base64, or null when it is not a fetchable https image under the cap. */
async function fetchImage(rawUrl: string): Promise<{ mimeType: string; data: string } | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  // https only, and no IP-literal or local hosts: the URL comes from user content.
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || /^[\d.]+$/.test(host) || host.includes(":") || host.endsWith(".internal") || host.endsWith(".local")) return null;

  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const mimeType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!/^image\/(jpeg|png|webp|gif)$/.test(mimeType)) return null;
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > MAX_IMAGE_BYTES) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;
    let bin = "";
    for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    return { mimeType, data: btoa(bin) };
  } catch {
    return null;
  }
}

async function moderateImage(imageUrl: string): Promise<Verdict> {
  const image = await fetchImage(imageUrl);
  if (!image) return CLEAN;

  const prompt = `You are a content moderator for an aquarium and fishkeeping community. A user uploaded this image. Classify it.

Rules:
- Flag nudity, graphic violence, hate symbols, or spam (ads, QR codes or text promoting unrelated products).
- Do NOT flag fish, aquariums, equipment, plants, water test results, eggs or fry, sick or dead fish, or people with their tanks.
- Only flag something that clearly breaks community standards.`;

  const res = await generateText(prompt, { schema: VERDICT_SCHEMA, maxOutputTokens: 80, temperature: 0, images: [image] });
  return toVerdict(parseJson(res.text), sourceOf(res));
}
