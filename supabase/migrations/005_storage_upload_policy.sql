-- ============================================================================
-- Storage: Allow uploads to reef-media bucket
-- Supabase Storage uses RLS on storage.objects table
-- ============================================================================

-- Allow anyone to upload to reef-media bucket (dev mode)
CREATE POLICY "Allow public uploads to reef-media"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'reef-media');

-- Allow anyone to update their uploads
CREATE POLICY "Allow public updates to reef-media"
ON storage.objects
FOR UPDATE
USING (bucket_id = 'reef-media');

-- Allow anyone to read from reef-media (already public bucket, but explicit)
CREATE POLICY "Allow public reads from reef-media"
ON storage.objects
FOR SELECT
USING (bucket_id = 'reef-media');

-- Allow deletion (for cleanup)
CREATE POLICY "Allow public deletes from reef-media"
ON storage.objects
FOR DELETE
USING (bucket_id = 'reef-media');
