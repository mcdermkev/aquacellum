/**
 * useVideoUpload.js
 * 
 * TanStack Query mutation hook for video upload.
 * Manages upload state, progress tracking, and error handling.
 */

import { useMutation } from "@tanstack/react-query";
import { useState, useCallback } from "react";
import { uploadVideo } from "../services/videoUpload";

/**
 * Hook for uploading a video with progress tracking.
 * 
 * Usage:
 * ```jsx
 * const { upload, progress, isUploading, error, result } = useVideoUpload();
 * 
 * // Start upload
 * await upload(videoFile);
 * 
 * // result = { uploadId, thumbnailUrl, duration }
 * ```
 */
export function useVideoUpload() {
  const [progress, setProgress] = useState(0);

  const mutation = useMutation({
    mutationFn: (file) =>
      uploadVideo(file, {
        onProgress: (pct) => setProgress(pct),
      }),
    onMutate: () => {
      setProgress(0);
    },
    onError: () => {
      setProgress(0);
    },
  });

  const upload = useCallback(
    async (file) => {
      const result = await mutation.mutateAsync(file);
      if (result.error) {
        throw new Error(result.error);
      }
      return result;
    },
    [mutation]
  );

  const reset = useCallback(() => {
    mutation.reset();
    setProgress(0);
  }, [mutation]);

  return {
    upload,
    reset,
    progress,
    isUploading: mutation.isPending,
    error: mutation.data?.error || (mutation.error?.message ?? null),
    result: mutation.data?.uploadId ? mutation.data : null,
  };
}
