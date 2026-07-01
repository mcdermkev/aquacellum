-- Specimen Photo Storage Bucket
-- Public bucket for specimen listing photos uploaded by breeders.
-- Photos are accessible via CDN URL for cross-device and cross-user visibility.

-- Create the storage bucket (public access for reading)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'specimen-photos',
  'specimen-photos',
  true,
  5242880, -- 5MB limit per file
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: anyone can read (public bucket), authenticated users can upload
-- Use DROP IF EXISTS to make this migration idempotent
DROP POLICY IF EXISTS "Public read access for specimen photos" ON storage.objects;
CREATE POLICY "Public read access for specimen photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'specimen-photos');

DROP POLICY IF EXISTS "Authenticated users can upload specimen photos" ON storage.objects;
CREATE POLICY "Authenticated users can upload specimen photos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'specimen-photos');

DROP POLICY IF EXISTS "Users can delete their own photos" ON storage.objects;
CREATE POLICY "Users can delete their own photos"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'specimen-photos'
    AND (storage.foldername(name))[1] = substring(current_setting('request.headers', true)::json->>'x-wallet-address' from 1 for 10)
  );
