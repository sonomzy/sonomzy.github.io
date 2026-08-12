# Sonomzy Publisher Worker

This Worker authenticates the Sonomzy writer with GitHub and publishes posts/images to `sonomzy/sonomzy.github.io` without exposing GitHub credentials in browser JavaScript.

## 1. Deploy the Worker from this repository

In Cloudflare:

1. Go to **Workers & Pages**.
2. Select **Create application** and choose **Import a repository**.
3. Connect GitHub and select `sonomzy/sonomzy.github.io`.
4. Use `worker` as the root directory.
5. Worker name: `sonomzy-publisher`.
6. Production branch: `main` after this change is merged.
7. Deploy command: `npx wrangler deploy`.
8. Deploy. No build command is required.

Cloudflare will provide a URL similar to:

`https://sonomzy-publisher.<your-workers-subdomain>.workers.dev`

The `/health` endpoint works before secrets are configured.

## 2. Create the GitHub OAuth App

GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**.

Use:

- Application name: `Sonomzy Writer`
- Homepage URL: `https://sonomzy.github.io/admin/`
- Authorization callback URL: `https://sonomzy-publisher.<your-workers-subdomain>.workers.dev/auth/callback`

After registering it, copy the **Client ID** and generate a **Client secret**.

## 3. Add Worker secrets

In the Cloudflare Worker settings, add these as encrypted secrets:

- `GITHUB_CLIENT_ID` — OAuth App Client ID
- `GITHUB_CLIENT_SECRET` — OAuth App Client secret
- `SESSION_SECRET` — a long random secret (at least 32 random bytes/characters; 64+ characters is recommended)

Do not put any of these values into the repository.

The non-secret configuration is already in `wrangler.toml` and restricts access to GitHub account ID `22891072` and repository `sonomzy/sonomzy.github.io`.

## 4. Point the writer at the Worker

Update `admin/config.js`:

```js
export const API_BASE = 'https://sonomzy-publisher.<your-workers-subdomain>.workers.dev';
```

After the site redeploys, `/admin/` will show GitHub sign-in. Only the GitHub account with numeric ID `22891072` can obtain a valid writer session.

## What Publish does

`POST /api/publish` creates:

`_posts/YYYY-MM-DD-your-slug.html`

on `main`. That commit triggers the existing GitHub Pages deployment workflow automatically.

Images inserted through the editor are uploaded to:

`assets/images/posts/YYYY-MM/...`

through `POST /api/upload`.

## Security notes

- GitHub client secrets never enter the public site.
- GitHub OAuth access tokens stay inside an AES-GCM encrypted, short-lived writer session.
- Sessions expire after 12 hours and are held in browser `sessionStorage`, so closing the browser session removes them locally.
- The Worker verifies the GitHub numeric user ID on login and again when decoding the session.
- API requests are restricted to `https://sonomzy.github.io` by CORS and origin validation.
