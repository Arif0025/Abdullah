# Dr. MD Abdullah profile site

The public website lives in `public/`. Publish only the contents of that directory to a static host. It contains the homepage and its assets; it has no editor sign-in page or editor scripts.

## Local preview

From the project root, run:

```powershell
node server.mjs
```

Open `http://localhost:4173`. The server serves only `public/` and maps `/` to the homepage. The bundled content and images work without a database. If Supabase public content is configured, the homepage reads the published content record.

## Local profile editor

Run `node server.mjs` and open `http://127.0.0.1:4173/editor/` to edit a local draft. The editor groups content by page section, supports editing and reordering cards and lists, and opens a full-site draft preview. Drafts are stored only in that browser's local storage. Publishing is disabled until authentication and the remote content store are configured.

The local server binds only to `127.0.0.1` and serves `private-editor/` only for local development. For deployment, publish only `public/`; do not upload `private-editor/`. Before the editor is hosted or used to update the live site, configure invite-only authentication, require an authenticator factor, and enable server-side authorization for saving and publishing.

## Visual assets

The portrait, certificate, and four surgical case assets are in `public/assets/`. The four case thumbnails are crops from the screenshots supplied for the recreation; original case image files would allow sharper, cleaner cards. The lumbar spine illustration is `public/assets/spine-art.png`; it is an art-only image frame designed to allow a future interactive 3D model to replace it.

## Hosting

For the public site, set the static host's publish/output directory to `public/` (or upload the contents of `public/` as the document root). The root URL then opens `index.html`. Text changes can be fetched from a configured Supabase published-content row without rebuilding the frontend. Image replacements can use the configured storage bucket once the editor is completed and secured.

## Supabase editor setup

Use a separate Supabase project for this profile editor to keep it isolated from your existing application. The Free plan currently allows two active projects per account and includes 1 GB of storage and 5 GB of egress; Free projects may pause after a week of low activity. For a production site that needs reliable always-on editing, review the paid plan before launch.

1. Create a new project and copy its Project URL and publishable/anon key into `public/config.js`. Never use a service-role key in browser code.
2. Run `supabase/schema.sql` in that project's SQL Editor. It creates the draft/published tables, editor authorization policy, public image bucket, and private recoverable trash bucket.
3. In Supabase Auth, disable public sign-up and invite only the profile owner's email. Add that invited user's UUID to `public.editor_access` using the SQL Editor.
4. Sign in to the editor once to enroll an authenticator app. Editing and database/storage operations require the verified MFA assurance level.
5. Keep `private-editor/` out of the public-site deployment. Host it separately or protect its route at the host; database permissions still enforce access even if the editor page URL is known.

Image management archives only uploads unused in both the current draft and the published profile. Archived images move to the private `site-media-trash` bucket and can be restored; permanent deletion is only available from the trash list with a confirmation. Images bundled in `public/assets/` are static deployment files and are not managed as database uploads.
