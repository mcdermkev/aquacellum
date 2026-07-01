/**
 * photoUpload.js — Upload specimen photos to Supabase Storage.
 *
 * Replaces localStorage-only photo storage with cloud-synced CDN-backed images.
 * Photos are uploaded to the 'specimen-photos' bucket in Supabase Storage,
 * making them visible cross-device and to other users.
 *
 * Flow:
 *   1. Seller takes/uploads a photo
 *   2. Photo is compressed (existing compressImage utility)
 *   3. Uploaded to Supabase Storage: specimen-photos/{walletAddress}/{tokenId}_{timestamp}.jpg
 *   4. Public URL is returned and stored in the listing data
 *   5. localStorage copy is kept as offline cache
 */

import { supabase, isSupabaseConfigured } from "./supabaseClient";

const BUCKET = "specimen-photos";

/**
 * Upload a base64-encoded image to Supabase Storage.
 * Returns the public URL of the uploaded image.
 *
 * @param {string} base64Data - base64 data URL (e.g., "data:image/jpeg;base64,...")
 * @param {string} walletAddress - seller's wallet/account address
 * @param {number|string} tokenId - specimen token ID or listing ID
 * @returns {Promise<{success: boolean, url?: string, error?: string}>}
 */
export async function uploadSpecimenPhoto(base64Data, walletAddress, tokenId) {
  if (!isSupabaseConfigured()) {
    return { success: false, error: "Storage not configured" };
  }

  if (!base64Data || !base64Data.startsWith("data:")) {
    return { success: false, error: "Invalid image data" };
  }

  try {
    // Convert base64 to Blob
    const [header, data] = base64Data.split(",");
    const mimeMatch = header.match(/data:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
    const ext = mime.includes("png") ? "png" : "jpg";

    const binaryStr = atob(data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mime });

    // Generate unique filename
    const wallet = (walletAddress || "anonymous").toLowerCase().slice(0, 10);
    const timestamp = Date.now();
    const filePath = `${wallet}/${tokenId}_${timestamp}.${ext}`;

    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, blob, {
        contentType: mime,
        upsert: false,
        cacheControl: "31536000", // 1 year cache
      });

    if (uploadError) {
      // Bucket might not exist yet
      if (uploadError.message?.includes("not found") || uploadError.statusCode === 404) {
        console.warn("[PhotoUpload] Bucket not found — falling back to local-only storage");
        return { success: false, error: "Photo storage not available yet" };
      }
      throw uploadError;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(filePath);

    const publicUrl = urlData?.publicUrl;

    if (!publicUrl) {
      return { success: false, error: "Failed to get public URL" };
    }

    return { success: true, url: publicUrl };
  } catch (err) {
    console.error("[PhotoUpload] Upload failed:", err);
    return { success: false, error: err.message || "Upload failed" };
  }
}

/**
 * Upload multiple photos and return their URLs.
 * Falls back gracefully — if cloud upload fails, returns null URLs
 * so the caller can keep using localStorage as fallback.
 *
 * @param {string[]} base64Photos - array of base64 data URLs
 * @param {string} walletAddress
 * @param {number|string} tokenId
 * @returns {Promise<string[]>} array of public URLs (null for failed uploads)
 */
export async function uploadMultiplePhotos(base64Photos, walletAddress, tokenId) {
  const urls = [];
  for (const photo of base64Photos) {
    const result = await uploadSpecimenPhoto(photo, walletAddress, tokenId);
    urls.push(result.success ? result.url : null);
  }
  return urls;
}
