/**
 * mediaUpload.js
 * 
 * Client-side image upload service for The Reef.
 * 
 * Upload flow:
 * 1. Client resizes image (max 2048px longest edge)
 * 2. Client requests presigned URL from Supabase Edge Function
 * 3. Client PUTs file directly to Cloudflare R2
 * 4. Returns the public CDN URL for storage in currents.media_urls
 * 
 * Fallback (MVP before R2 is set up):
 * - Uses Supabase Storage bucket as temporary media store
 * - Same API, just different upload target
 */

import { supabase, isSupabaseConfigured, getCurrentWallet } from "./supabaseClient";
import { generateAltText } from "../utils/altTextGenerator";

const MAX_IMAGE_DIMENSION = 2048;
const MAX_FILE_SIZE_MB = 5;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/**
 * Resize an image file to fit within max dimensions.
 * Returns a Blob of the resized image.
 * 
 * @param {File} file - The original image file
 * @param {number} maxDim - Max width or height in pixels
 * @returns {Promise<Blob>}
 */
async function resizeImage(file, maxDim = MAX_IMAGE_DIMENSION) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width, height } = img;

      // Only resize if larger than max
      if (width <= maxDim && height <= maxDim) {
        resolve(file);
        return;
      }

      // Calculate new dimensions maintaining aspect ratio
      if (width > height) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }

      // Draw to canvas
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      // Convert to blob (prefer webp for smaller size, fall back to jpeg)
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            // Fallback to jpeg if webp not supported
            canvas.toBlob(
              (jpegBlob) => resolve(jpegBlob || file),
              "image/jpeg",
              0.85
            );
          }
        },
        "image/webp",
        0.85
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image for resizing"));
    };

    img.src = url;
  });
}

/**
 * Generate a unique file path for uploads.
 */
function generateFilePath(walletAddress, fileName) {
  const timestamp = Date.now();
  const sanitizedName = fileName
    .replace(/[^a-zA-Z0-9.-]/g, "_")
    .toLowerCase();
  return `reef/${walletAddress.slice(0, 10)}/${timestamp}-${sanitizedName}`;
}

/**
 * Upload an image file to storage.
 * 
 * @param {File} file - The image file to upload
 * @param {function} [onProgress] - Progress callback (0-100)
 * @returns {Promise<{url: string, error?: string}>}
 */
export async function uploadImage(file, onProgress) {
  // Validation
  if (!file) {
    return { url: null, error: "No file provided" };
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return { url: null, error: `Invalid file type. Allowed: ${ALLOWED_TYPES.join(", ")}` };
  }

  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    return { url: null, error: `File too large. Maximum: ${MAX_FILE_SIZE_MB}MB` };
  }

  if (!isSupabaseConfigured()) {
    return { url: null, error: "Storage not configured" };
  }

  const walletAddress = getCurrentWallet();
  if (!walletAddress) {
    return { url: null, error: "Not connected" };
  }

  try {
    // Step 1: Resize image
    if (onProgress) onProgress(10);
    const resizedBlob = await resizeImage(file);
    if (onProgress) onProgress(30);

    // Step 2: Upload to Supabase Storage (MVP fallback)
    // In production, this would use R2 presigned URLs instead
    const filePath = generateFilePath(walletAddress, file.name);

    const { data, error } = await supabase.storage
      .from("reef-media")
      .upload(filePath, resizedBlob, {
        contentType: resizedBlob.type || "image/webp",
        upsert: false,
      });

    if (error) {
      console.error("[Reef Media] Upload failed:", error);
      return { url: null, error: error.message };
    }

    if (onProgress) onProgress(90);

    // Step 3: Get public URL
    const { data: urlData } = supabase.storage
      .from("reef-media")
      .getPublicUrl(filePath);

    if (onProgress) onProgress(95);

    const publicUrl = urlData.publicUrl;

    // Step 4: Auto-generate alt text via Poseidon (non-blocking)
    // Fire and forget — don't block the upload completion
    let altText = "Aquarium photo";
    try {
      altText = await generateAltText(publicUrl);
    } catch {
      // Alt text generation is best-effort, don't fail the upload
    }

    if (onProgress) onProgress(100);

    return { url: publicUrl, altText, error: null };
  } catch (err) {
    console.error("[Reef Media] Upload error:", err);
    return { url: null, error: err.message };
  }
}

/**
 * Upload multiple images in parallel.
 * 
 * @param {File[]} files - Array of image files
 * @param {function} [onProgress] - Progress callback with {index, progress}
 * @returns {Promise<{urls: string[], errors: string[]}>}
 */
export async function uploadImages(files, onProgress) {
  const results = await Promise.allSettled(
    files.map((file, index) =>
      uploadImage(file, (progress) => {
        if (onProgress) onProgress({ index, progress });
      })
    )
  );

  const urls = [];
  const altTexts = [];
  const errors = [];

  for (const result of results) {
    if (result.status === "fulfilled" && result.value.url) {
      urls.push(result.value.url);
      altTexts.push(result.value.altText || "Aquarium photo");
    } else {
      const errorMsg = result.status === "fulfilled"
        ? result.value.error
        : result.reason?.message || "Upload failed";
      errors.push(errorMsg);
    }
  }

  return { urls, altTexts, errors };
}

/**
 * Create a local preview URL for an image file (no upload).
 * Used for immediate display while upload happens in background.
 */
export function createPreviewUrl(file) {
  return URL.createObjectURL(file);
}

/**
 * Revoke a previously created preview URL to free memory.
 */
export function revokePreviewUrl(url) {
  URL.revokeObjectURL(url);
}
