import { createHash } from "node:crypto";

export const SHOWCASE_DERIVATIVE_BUCKET = "showcase-media-derivatives-v1";
export const SHOWCASE_DERIVATIVE_MIME = "image/webp";
export const SHOWCASE_DERIVATIVE_MAX_BYTES = 4 * 1024 * 1024;

const UUID_PART = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const DERIVATIVE_KEY_RE = new RegExp(
  `^owners/(${UUID_PART})/assets/(${UUID_PART})/versions/(${UUID_PART})/(hero|thumb)\\.webp$`
);

function validateAuthorization(authorization, { assetId, ownerId, variant }) {
  const expectedSize = Number(authorization?.byteSize);
  const keyMatch = typeof authorization?.objectKey === "string"
    ? DERIVATIVE_KEY_RE.exec(authorization.objectKey)
    : null;
  if (authorization?.bucket !== SHOWCASE_DERIVATIVE_BUCKET
      || authorization?.mime !== SHOWCASE_DERIVATIVE_MIME
      || !Number.isSafeInteger(expectedSize) || expectedSize < 1
      || expectedSize > SHOWCASE_DERIVATIVE_MAX_BYTES
      || !keyMatch
      || keyMatch[2] !== assetId
      || keyMatch[4] !== variant
      || (ownerId && keyMatch[1] !== ownerId)
      || typeof authorization?.checksumHex !== "string"
      || !/^[0-9a-f]{64}$/.test(authorization.checksumHex)) {
    return null;
  }
  return { expectedSize, objectKey: authorization.objectKey };
}

export async function downloadAuthorizedShowcaseMedia({
  supabase, authorization, assetId, ownerId = null, variant,
}) {
  const validated = validateAuthorization(authorization, { assetId, ownerId, variant });
  if (!validated) return { ok: false, code: "internal_error" };

  const { data: blob, error } = await supabase.storage
    .from(SHOWCASE_DERIVATIVE_BUCKET)
    .download(validated.objectKey);
  if (error || !blob) return { ok: false, code: "not_found" };

  const bytes = Buffer.from(await blob.arrayBuffer());
  if (bytes.length !== validated.expectedSize || bytes.length > SHOWCASE_DERIVATIVE_MAX_BYTES) {
    return { ok: false, code: "not_found" };
  }
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== authorization.checksumHex) return { ok: false, code: "not_found" };

  return { ok: true, bytes, mime: SHOWCASE_DERIVATIVE_MIME };
}
