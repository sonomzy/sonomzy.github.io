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

The OAuth app is used only to prove which GitHub account signed in. The Worker requests only `read:user` and uses PKCE + state verification.

## 3. Create a restricted GitHub write token

Create a **fine-grained personal access token** under your GitHub account.

Restrict it to:

- Repository access: **Only select repositories** → `sonomzy.github.io`
- Repository permissions → **Contents: Read and write**

No other repository permission is needed for normal post/image publishing.

## 4. Add Worker secrets

In the Cloudflare Worker settings, add these as encrypted secrets:

- `GITHUB_CLIENT_ID` — OAuth App Client ID
- `GITHUB_CLIENT_SECRET` — OAuth App Client secret
- `GITHUB_WRITE_TOKEN` — the fine-grained token restricted to `sonomzy.github.io`
- `SESSION_SECRET` — a long random secret; 64+ random characters is recommended

Do not put any of these values into the repository or `admin/config.js`.

The non-secret configuration in `wrangler.toml` restricts access to GitHub account ID `22891072` and repository `sonomzy/sonomzy.github.io`.

## 5. Point the writer at the Worker

Update `admin/config.js`:

```js
export const API_BASE = 'https://sonomzy-publisher.<your-workers-subdomain>.workers.dev';
```

After the site redeploys, `/admin/` shows GitHub sign-in. Only the GitHub account with numeric ID `22891072` can obtain a valid writer session.

## What Publish does

`POST /api/publish` creates:

`_posts/YYYY-MM-DD-your-slug.html`

on `main`. That commit triggers the existing GitHub Pages deployment workflow automatically.

Images inserted through the editor are uploaded to:

`assets/images/posts/YYYY-MM/...`

through `POST /api/upload`.

## Security notes

- GitHub client secrets and the write token never enter the public site.
- The OAuth token used to identify you is discarded after GitHub identity verification.
- The browser receives only an AES-GCM encrypted, short-lived writer session containing your GitHub ID/login, not a GitHub access token.
- Sessions expire after 12 hours and are held in browser `sessionStorage`.
- The Worker verifies the GitHub numeric user ID on login and on every authenticated API request.
- Publishing uses a separate fine-grained token limited to this one repository.
- API requests are restricted to `https://sonomzy.github.io` by CORS and origin validation.
