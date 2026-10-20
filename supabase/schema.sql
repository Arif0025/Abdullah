-- Apply in the Supabase SQL editor after creating the project.
-- Then invite only the profile owner's email in Authentication > Users and insert their auth.users.id into editor_access.
create table if not exists public.editor_access (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table if not exists public.site_drafts (
  id integer primary key check (id = 1),
  content jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.site_published (
  id integer primary key check (id = 1),
  content jsonb not null,
  published_at timestamptz not null default now()
);

alter table public.editor_access enable row level security;
alter table public.site_drafts enable row level security;
alter table public.site_published enable row level security;

create or replace function public.is_profile_editor()
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$ select exists (select 1 from public.editor_access where user_id = (select auth.uid())) $$;
revoke all on function public.is_profile_editor() from public;
grant execute on function public.is_profile_editor() to authenticated;

drop policy if exists "editor can see own access row" on public.editor_access;
create policy "editor can see own access row" on public.editor_access
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "MFA editor reads draft" on public.site_drafts;
create policy "MFA editor reads draft" on public.site_drafts
  for select to authenticated using (public.is_profile_editor() and (select auth.jwt()->>'aal') = 'aal2');
drop policy if exists "MFA editor inserts draft" on public.site_drafts;
create policy "MFA editor inserts draft" on public.site_drafts
  for insert to authenticated with check (public.is_profile_editor() and (select auth.jwt()->>'aal') = 'aal2');
drop policy if exists "MFA editor updates draft" on public.site_drafts;
create policy "MFA editor updates draft" on public.site_drafts
  for update to authenticated using (public.is_profile_editor() and (select auth.jwt()->>'aal') = 'aal2')
  with check (public.is_profile_editor() and (select auth.jwt()->>'aal') = 'aal2');

drop policy if exists "published profile is public" on public.site_published;
create policy "published profile is public" on public.site_published for select to anon, authenticated using (true);
drop policy if exists "MFA editor publishes" on public.site_published;
create policy "MFA editor publishes" on public.site_published
  for all to authenticated using (public.is_profile_editor() and (select auth.jwt()->>'aal') = 'aal2')
  with check (public.is_profile_editor() and (select auth.jwt()->>'aal') = 'aal2');

grant select on public.site_published to anon, authenticated;
grant select, insert, update on public.site_drafts to authenticated;
grant select on public.editor_access to authenticated;
grant insert, update on public.site_published to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-media', 'site-media', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "public can view profile media" on storage.objects;
create policy "public can view profile media" on storage.objects for select to anon, authenticated using (bucket_id = 'site-media' and (storage.foldername(name))[1] = 'profile');
drop policy if exists "MFA editor uploads profile media" on storage.objects;
create policy "MFA editor uploads profile media" on storage.objects for insert to authenticated
  with check (bucket_id = 'site-media' and (storage.foldername(name))[1] = 'profile'
    and public.is_profile_editor() and (select auth.jwt()->>'aal') = 'aal2');

-- Do not enable public sign-up. Enable TOTP MFA and enforce AAL2 in the Supabase Auth settings.

-- Storage library: public profile uploads are readable by visitors, but only
-- the MFA-verified profile editor can manage them. The separate trash bucket
-- stays private and supports restore before permanent deletion.
update storage.buckets set public = true, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp']
where id = 'site-media';
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-media-trash', 'site-media-trash', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "public can view profile media" on storage.objects;
create policy "public can view profile media" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'site-media' and (storage.foldername(name))[1] = 'profile');
drop policy if exists "MFA editor archives unused profile media" on storage.objects;
create policy "MFA editor archives unused profile media" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'site-media-trash' and public.is_profile_editor()
    and (select auth.jwt()->>'aal') = 'aal2');
drop policy if exists "MFA editor views archived media" on storage.objects;
create policy "MFA editor views archived media" on storage.objects
  for select to authenticated
  using (bucket_id = 'site-media-trash' and public.is_profile_editor()
    and (select auth.jwt()->>'aal') = 'aal2');
drop policy if exists "MFA editor removes profile media" on storage.objects;
create policy "MFA editor removes profile media" on storage.objects
  for delete to authenticated
  using (bucket_id = 'site-media' and (storage.foldername(name))[1] = 'profile'
    and public.is_profile_editor() and (select auth.jwt()->>'aal') = 'aal2');
drop policy if exists "MFA editor removes archived media" on storage.objects;
create policy "MFA editor removes archived media" on storage.objects
  for delete to authenticated
  using (bucket_id = 'site-media-trash' and public.is_profile_editor()
    and (select auth.jwt()->>'aal') = 'aal2');
