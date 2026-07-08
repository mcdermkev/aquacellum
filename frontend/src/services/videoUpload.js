/**
 * videoUpload.js
 * 
 * Client-side video upload service for The Reef.
 * Mirrors the pattern in mediaUpload.js but targets Mux for transcoding + delivery.
 * 
 * Upload flow:
 * 1. Client validates video (type, size, duration)
 * 2. Client requests a Mux Direct Upload URL from /api/mux?action=upload
 * 3. Client PUTs the file directly to Mux's upload endpoint
 * 4. Mux transcodes the video → webhook updates Supabase with playback ID
 * 5. Returns the upload ID for immediate DB reference (playback becomes available async)
 * 
 * The video is playable once Mux fires the "video.asset.ready" webhook,
 * which typically takes 30–90 seconds for a 60s clip.
 */

import { getCurrentWallet } from "./supabaseClient";

const MAX_VIDEO_DURATION_S = 60;
const MAX_VIDEO_SIZE_MB = 100;
const ALLOWED_VIDEO_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime", // .mov files from iOS
  "video/x-m4v",
];

/**
 * Extract video duration and basic metadata from a File.
 * Uses a hidden <video> element to read metadata.
 * 
 * @param {File} file - Video file
 * @returns {Promise<{ duration: number, width: number, height: number }>}
 */
export function getVideoMetadata(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";

    const url = URL.createObjectURL(file);

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      });
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read video metadata"));
    };

    video.src = url;
  });
}

/**
 * Generate a thumbnail from a video file at a specific time.
 * Returns a Blob of the thumbnail image.
 * 
 * @param {File} file - Video file
 * @param {number} [timeSeconds=1] - Time position to capture
 * @returns {Promise<{ blob: Blob, url: string }>}
 */
export function generateVideoThumbnail(file, timeSeconds = 1) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;

    const fileUrl = URL.createObjectURL(file);

    video.onloadeddata = () => {
      // Seek to the desired time
      video.currentTime = Math.min(timeSeconds, video.duration - 0.1);
    };

    video.onseeked = () => {
      // Draw the current frame to a canvas
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(video.videoWidth, 640);
      canvas.height = Math.round(
        (canvas.width / video.videoWidth) * video.videoHeight
      );

      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(fileUrl);
          if (blob) {
            const thumbUrl = URL.createObjectURL(blob);
            resolve({ blob, url: thumbUrl });
          } else {
            reject(new Error("Failed to generate thumbnail"));
          }
        },
        "image/webp",
        0.8
      );
    };

    video.onerror = () => {
      URL.revokeObjectURL(fileUrl);
      reject(new Error("Failed to load video for thumbnail"));
    };

    video.src = fileUrl;
  });
}

/**
 * Upload a video file via Mux Direct Upload.
 * 
 * @param {File} file - The video file to upload
 * @param {object} [options]
 * @param {function} [options.onProgress] - Progress callback (0-100)
 * @returns {Promise<{uploadId: string, thumbnailUrl: string, duration: number, error?: string}>}
 */
export async function uploadVideo(file, { onProgress } = {}) {
  // ── Validation ──

  if (!file) {
    return { uploadId: null, error: "No file provided" };
  }

  if (!ALLOWED_VIDEO_TYPES.includes(file.type)) {
    return {
      uploadId: null,
      error: `Invalid video type "${file.type}". Allowed: MP4, WebM, MOV`,
    };
  }

  if (file.size > MAX_VIDEO_SIZE_MB * 1024 * 1024) {
    return { uploadId: null, error: `Video too large. Maximum: ${MAX_VIDEO_SIZE_MB}MB` };
  }

  const walletAddress = getCurrentWallet();
  if (!walletAddress) {
    return { uploadId: null, error: "Not connected" };
  }

  try {
    // ── Step 1: Read video metadata (duration check) ──
    if (onProgress) onProgress(5);

    let metadata;
    try {
      metadata = await getVideoMetadata(file);
    } catch {
      // If we can't read metadata, allow upload and let Mux handle it
      metadata = { duration: 0, width: 0, height: 0 };
    }

    if (metadata.duration > MAX_VIDEO_DURATION_S) {
      return {
        uploadId: null,
        error: `Video is ${Math.round(metadata.duration)}s — maximum is ${MAX_VIDEO_DURATION_S}s. Please trim it first.`,
      };
    }

    if (onProgress) onProgress(10);

    // ── Step 2: Request upload URL from our API ──
    const apiResponse = await fetch("/api/mux?action=upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress }),
    });

    const apiData = await apiResponse.json();

    if (apiData.error || !apiData.uploadUrl) {
      return { uploadId: null, error: apiData.error || "Failed to get upload URL" };
    }

    if (onProgress) onProgress(15);

    // ── Step 3: Upload video directly to Mux ──
    const uploadResult = await uploadWithProgress(apiData.uploadUrl, file, (pct) => {
      // Scale progress from 15–90%
      if (onProgress) onProgress(15 + Math.round(pct * 0.75));
    });

    if (!uploadResult.ok) {
      return { uploadId: null, error: "Video upload to Mux failed" };
    }

    if (onProgress) onProgress(92);

    // ── Step 4: Generate a local thumbnail for immediate display ──
    let localThumbnailUrl = null;
    try {
      const thumb = await generateVideoThumbnail(file, 1);
      localThumbnailUrl = thumb.url;
    } catch {
      // Non-critical — Mux will generate one via webhook
    }

    if (onProgress) onProgress(100);

    return {
      uploadId: apiData.uploadId,
      thumbnailUrl: localThumbnailUrl,
      duration: Math.round(metadata.duration),
      error: null,
    };
  } catch (err) {
    console.error("[Video Upload] Error:", err);
    return { uploadId: null, error: err.message };
  }
}

/**
 * PUT a file to a URL with progress tracking via XMLHttpRequest.
 * (fetch() doesn't support upload progress)
 * 
 * @param {string} url - The upload URL
 * @param {File|Blob} file - The file to upload
 * @param {function} onProgress - Progress callback (0-1)
 * @returns {Promise<{ok: boolean}>}
 */
function uploadWithProgress(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(e.loaded / e.total);
      }
    };

    xhr.onload = () => {
      resolve({ ok: xhr.status >= 200 && xhr.status < 300 });
    };

    xhr.onerror = () => {
      reject(new Error("Network error during upload"));
    };

    xhr.ontimeout = () => {
      reject(new Error("Upload timed out"));
    };

    // Mux expects the raw binary, no Content-Type header needed
    xhr.send(file);
  });
}

/**
 * Create a local preview URL for a video file (no upload).
 * Used for immediate playback while upload happens in background.
 */
export function createVideoPreviewUrl(file) {
  return URL.createObjectURL(file);
}

/**
 * Revoke a previously created video preview URL to free memory.
 */
export function revokeVideoPreviewUrl(url) {
  if (url?.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

/**
 * Check if a file is a video type.
 */
export function isVideoFile(file) {
  return ALLOWED_VIDEO_TYPES.includes(file?.type);
}

/**
 * Get the max allowed video duration in seconds.
 */
export function getMaxVideoDuration() {
  return MAX_VIDEO_DURATION_S;
}
