# Dr. MD Abdullah profile site

The public static site is served at `/`. Page content is in `public/content.js` and images are in `public/assets/`. The visual editor is at `/editor/` and saves drafts in the current browser until they are published.

## Develop locally

Run `node server.mjs` and open `http://127.0.0.1:4173/`. The root URL displays the public profile. The editor is at `/editor/`. Local development uses in-memory authenticator enrollment and does not send email. The local server is bound to loopback and skips the production password check. Local publishing returns a setup message; the live GitHub commit and Netlify deploy run through Netlify Functions.

## Temporary client demo through a tunnel

The public profile can be shared through ngrok. The editor page itself is public, while its sign-in and editor APIs require the editor password and authenticator. Set a temporary editor password before starting the server. The public profile remains open. Authenticator enrollment and recovery are in-memory for the demo server, drafts are saved in that browser, and publishing is unavailable locally.

In PowerShell, set a temporary editor password, then start the server:

```powershell
$env:EDITOR_DEMO_PASSWORD = "choose-a-long-temporary-password"
node server.mjs
```

In another terminal, start a tunnel to the same port (4173 by default):

```powershell
ngrok http 4173
```

Share the HTTPS forwarding URL and temporary password with the client through a separate channel. Remove the password from the server environment and stop the tunnel after the demo. Without the password, remote editor sign-in is unavailable. Local requests continue to use the development code catcher.

## Netlify deployment

Netlify builds with `node build.mjs` and publishes `dist/`. The build puts the public site at the root and keeps `/public/` as an alias for compatibility. Publishing commits `public/content.js` and newly uploaded image files to the configured GitHub branch; Netlify then deploys the commit.

Configure these Netlify environment variables for Functions:

- `EDITOR_PASSWORD`: a strong password known only to the profile owner (at least 16 characters). It authorizes initial authenticator enrollment and recovery; it is not included in browser code.
- `EDITOR_SESSION_SECRET`: a random secret of at least 32 characters. Generate one with `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`.
- `GITHUB_OWNER`
- `GITHUB_REPO`
- `GITHUB_BRANCH` (optional; defaults to `main`)
- `GITHUB_CONTENT_PATH` (optional; defaults to `public/content.js`)
- `GITHUB_TOKEN`: fine-grained token with Contents read/write permission for this repository.

On first sign-in, the password starts enrollment of a Google Authenticator-compatible TOTP app. Later sign-ins use the password and six-digit authenticator code. The TOTP secret is encrypted in Netlify Blobs using `EDITOR_SESSION_SECRET`. Eight one-time recovery codes are shown after enrollment; store them safely. A recovery code consumes itself, removes the old authenticator, and immediately allows enrollment of a replacement after the password check. Keep `EDITOR_SESSION_SECRET` stable: rotating it makes enrolled TOTP secrets unreadable, so reset/re-enroll the authenticator before changing that variable. Netlify function rate limits apply per IP. Sessions are signed, eight-hour, `HttpOnly`, `SameSite=Strict` cookies, marked `Secure` over HTTPS. No email provider, Supabase project, or content database is required.

Never put `EDITOR_PASSWORD`, `EDITOR_SESSION_SECRET`, or `GITHUB_TOKEN` in browser code or commit them to the repository. Generate a fresh `EDITOR_SESSION_SECRET` before the first deployment and do not rotate it after authenticator enrollment unless you first clear and re-enroll the authenticator.

## Images

New image uploads are limited to 2 MB each. The editor stages them in the draft; publish commits them under `public/assets/` with the updated content. Older image versions remain available in Git history.
