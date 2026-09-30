-- ============================================================================
-- Storage: writes only into your own folder, identity from the signed session
-- ============================================================================
-- Before this migration (checked on the live project 2026-10-04):
--   reef-media         INSERT, UPDATE and DELETE for {public} with only
--                      bucket_id = 'reef-media'. Anyone with the anon key could
--                      overwrite or delete any Reef photo.
--   specimen-photos    INSERT for {public} with only the bucket check; DELETE
--                      matched the folder against the x-wallet-address request
--                      header, which any caller can set.
--   specimen-metadata  INSERT/UPDATE matched the folder against the JWT claim
--                      OR the x-wallet-address header, so the header alone was
--                      enough to overwrite another breeder's specimen document
--                      (the URL of which is written on-chain).
--
-- After: every browser write goes to the `authenticated` role (the minted
-- session from /api/mint-session) and the folder must match
-- public.current_wallet(), the wallet claim of that signed JWT. No header is
-- trusted. Reads stay public (these buckets serve public images and the
-- on-chain metadata URIs). The server (service_role) is unaffected: the purge
-- job and admin tools bypass RLS.
--
-- Paths the app writes (must keep working):
--   reef-media         reef/<first 10 chars of wallet>/<ts>-<name>   services/mediaUpload.js
--   specimen-photos    <first 10 chars of wallet, lower>/<id>_<ts>.<ext>  services/photoUpload.js
--   specimen-metadata  <wallet, lower>/<id>.json (upsert)          services/specimenMetadata.js
-- No browser code updates or deletes reef-media or specimen-photos objects.
--
-- Also: reef-media gets the same size and type limits the client enforces
-- (5 MB; jpeg, png, webp, gif), and a private feedback-screenshots bucket is
-- created for the Feedback button. That bucket has NO browser policies: the
-- server hands out a one-time signed upload URL and signed read links.
--
-- REVERSIBILITY: the previous policy definitions are recorded above; recreate
-- them with create policy ... if this has to be rolled back.
-- ============================================================================

begin;

-- ── reef-media ──────────────────────────────────────────────────────────────
drop policy if exists "Allow public uploads to reef-media" on storage.objects;
drop policy if exists "Allow public updates to reef-media" on storage.objects;
drop policy if exists "Allow public deletes from reef-media" on storage.objects;

create policy "Reef media: upload into your own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'reef-media'
    and public.current_wallet() is not null
    and (storage.foldername(name))[1] = 'reef'
    and lower((storage.foldername(name))[2]) = left(public.current_wallet(), 10)
  );

update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
 where id = 'reef-media';

-- ── specimen-photos ─────────────────────────────────────────────────────────
drop policy if exists "Authenticated users can upload specimen photos" on storage.objects;
drop policy if exists "Users can delete their own photos" on storage.objects;

create policy "Specimen photos: upload into your own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'specimen-photos'
    and public.current_wallet() is not null
    and (storage.foldername(name))[1] = left(public.current_wallet(), 10)
  );

create policy "Specimen photos: delete your own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'specimen-photos'
    and public.current_wallet() is not null
    and (storage.foldername(name))[1] = left(public.current_wallet(), 10)
  );

-- ── specimen-metadata ───────────────────────────────────────────────────────
drop policy if exists "Breeders write their own specimen metadata" on storage.objects;
drop policy if exists "Breeders update their own specimen metadata" on storage.objects;

create policy "Specimen metadata: write your own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'specimen-metadata'
    and public.current_wallet() is not null
    and (storage.foldername(name))[1] = public.current_wallet()
  );

create policy "Specimen metadata: update your own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'specimen-metadata'
    and public.current_wallet() is not null
    and (storage.foldername(name))[1] = public.current_wallet()
  )
  with check (
    bucket_id = 'specimen-metadata'
    and public.current_wallet() is not null
    and (storage.foldername(name))[1] = public.current_wallet()
  );

-- ── feedback-screenshots (private, server-only) ─────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback-screenshots', 'feedback-screenshots', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── Self-check ──────────────────────────────────────────────────────────────
do $$
declare
  bad record;
begin
  -- No write policy on these buckets may be open to anon/public or lack an
  -- owner check.
  for bad in
    select policyname, cmd, roles::text as roles, coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
      from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
       and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(reef-media|specimen-photos|specimen-metadata|feedback-screenshots)'
  loop
    if bad.roles <> '{authenticated}' then
      raise exception 'storage write policy % (%) is open to %', bad.policyname, bad.cmd, bad.roles;
    end if;
    if bad.expr !~ 'current_wallet' then
      raise exception 'storage write policy % (%) has no owner check', bad.policyname, bad.cmd;
    end if;
    if bad.expr ~ 'x-wallet-address' then
      raise exception 'storage write policy % still trusts the x-wallet-address header', bad.policyname;
    end if;
    if bad.expr ~ 'feedback-screenshots' then
      raise exception 'feedback-screenshots must have no browser policies (%)', bad.policyname;
    end if;
  end loop;

  if not exists (select 1 from storage.buckets where id = 'feedback-screenshots' and public = false) then
    raise exception 'feedback-screenshots bucket missing or public';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                  and policyname = 'Allow public reads from reef-media') then
    raise exception 'reef-media public read policy is gone';
  end if;
end;
$$;

commit;
