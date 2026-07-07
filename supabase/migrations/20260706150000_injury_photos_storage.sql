-- ───────────────── injury photos: private Storage bucket (§6A Phase 4) ─────────────────
-- Photos are uploaded to a PRIVATE bucket, one folder per user (path: <uid>/<injury>/<photo>.jpg).
-- RLS on storage.objects scopes every operation to the owning user's folder. Medical
-- imaging is intentionally unsupported (photos only, compressed client-side).

insert into storage.buckets (id, name, public)
values ('injury-photos', 'injury-photos', false)
on conflict (id) do nothing;

create policy "injury photos - own read" on storage.objects
  for select to authenticated
  using (bucket_id = 'injury-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "injury photos - own insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'injury-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "injury photos - own update" on storage.objects
  for update to authenticated
  using (bucket_id = 'injury-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "injury photos - own delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'injury-photos' and (storage.foldername(name))[1] = auth.uid()::text);
