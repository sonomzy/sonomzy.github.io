const encoder = new TextEncoder();
const decoder = new TextDecoder();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env, origin) });
    }

    try {
      if (url.pathname === '/auth/github') return startGithubAuth(request, env);
      if (url.pathname === '/auth/callback') return finishGithubAuth(request, env);
      if (url.pathname === '/api/me') return requireSession(request, env, (session) => json({ authenticated: true, login: session.login, id: session.id }, 200, env, origin));
      if (url.pathname === '/api/publish' && request.method === 'POST') return requireSession(request, env, (session) => publishPost(request, env, origin, session));
      if (url.pathname === '/api/upload' && request.method === 'POST') return requireSession(request, env, (session) => uploadImage(request, env, origin, session));
      if (url.pathname === '/health') return json({ ok: true }, 200, env, origin);
      return json({ error: 'Not found' }, 404, env, origin);
    } catch (error) {
      console.error(error);
      return json({ error: error?.message || 'Unexpected error' }, 500, env, origin);
    }
  },
};

function corsHeaders(env, origin) {
  const allowed = origin === env.ALLOWED_ORIGIN ? origin : env.ALLOWED_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(data, status, env, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(env, origin) },
  });
}

async function startGithubAuth(request, env) {
  assertSecrets(env);
  const url = new URL(request.url);
  const state = crypto.randomUUID();
  const stateToken = await seal({ state, exp: Date.now() + 10 * 60 * 1000 }, env.SESSION_SECRET);
  const callback = `${url.origin}/auth/callback`;
  const github = new URL('https://github.com/login/oauth/authorize');
  github.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  github.searchParams.set('redirect_uri', callback);
  github.searchParams.set('scope', 'public_repo read:user');
  github.searchParams.set('state', state);
  github.searchParams.set('allow_signup', 'false');
  const response = Response.redirect(github.toString(), 302);
  response.headers.append('Set-Cookie', `sonomzy_oauth_state=${stateToken}; Path=/auth/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  return response;
}

async function finishGithubAuth(request, env) {
  assertSecrets(env);
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return redirectWithError(env, 'GitHub did not return an authorization code.');

  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const stateToken = cookies.sonomzy_oauth_state;
  if (!stateToken) return redirectWithError(env, 'The sign-in request expired. Try again.');

  let statePayload;
  try {
    statePayload = await unseal(stateToken, env.SESSION_SECRET);
  } catch {
    return redirectWithError(env, 'The sign-in request could not be verified.');
  }
  if (statePayload.state !== state || statePayload.exp < Date.now()) return redirectWithError(env, 'The sign-in request could not be verified.');

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/auth/callback`,
    }),
  });
  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenData.access_token) return redirectWithError(env, 'GitHub sign-in failed.');

  const userResponse = await githubFetch('https://api.github.com/user', tokenData.access_token);
  const user = await userResponse.json();
  if (!userResponse.ok) return redirectWithError(env, 'Could not verify your GitHub account.');
  if (String(user.id) !== String(env.ALLOWED_GITHUB_ID)) return redirectWithError(env, 'This GitHub account is not allowed to use the Sonomzy writer.');

  const session = await seal({
    token: tokenData.access_token,
    login: user.login,
    id: user.id,
    exp: Date.now() + 12 * 60 * 60 * 1000,
  }, env.SESSION_SECRET);

  const admin = new URL(env.ADMIN_URL);
  admin.hash = `session=${encodeURIComponent(session)}`;
  const response = Response.redirect(admin.toString(), 302);
  response.headers.append('Set-Cookie', 'sonomzy_oauth_state=; Path=/auth/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  return response;
}

function redirectWithError(env, message) {
  const admin = new URL(env.ADMIN_URL);
  admin.hash = `error=${encodeURIComponent(message)}`;
  return Response.redirect(admin.toString(), 302);
}

async function requireSession(request, env, handler) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== env.ALLOWED_ORIGIN) return json({ error: 'Origin not allowed' }, 403, env, origin);
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return json({ authenticated: false, error: 'Sign in required' }, 401, env, origin);
  try {
    const session = await unseal(auth.slice(7), env.SESSION_SECRET);
    if (session.exp < Date.now() || String(session.id) !== String(env.ALLOWED_GITHUB_ID)) throw new Error('Expired session');
    return handler(session);
  } catch {
    return json({ authenticated: false, error: 'Your session expired. Sign in again.' }, 401, env, origin);
  }
}

async function publishPost(request, env, origin, session) {
  const body = await request.json();
  const title = cleanText(body.title, 180);
  const description = cleanText(body.description || '', 300);
  const date = cleanDate(body.date);
  const slug = cleanSlug(body.slug || title);
  const html = typeof body.html === 'string' ? body.html.trim() : '';
  if (!title) return json({ error: 'Title is required.' }, 400, env, origin);
  if (!slug) return json({ error: 'A valid slug is required.' }, 400, env, origin);
  if (!html || html === '<p></p>') return json({ error: 'Write something before publishing.' }, 400, env, origin);
  if (html.length > 900000) return json({ error: 'This post is too large. Upload large images instead of embedding them.' }, 413, env, origin);

  const path = `_posts/${date}-${slug}.html`;
  const frontMatter = [
    '---',
    'layout: post',
    `title: ${yamlString(title)}`,
    `date: ${date}`,
    `description: ${yamlString(description)}`,
    '---',
    '',
  ].join('\n');
  const content = `${frontMatter}${html}\n`;

  const existing = await githubFetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${encodePath(path)}?ref=main`, session.token);
  if (existing.status === 200) return json({ error: 'A post with this date and slug already exists. Change the slug or date.' }, 409, env, origin);
  if (existing.status !== 404) {
    const detail = await safeGithubError(existing);
    return json({ error: detail || 'Could not check the destination post.' }, 502, env, origin);
  }

  const create = await githubFetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${encodePath(path)}`, session.token, {
    method: 'PUT',
    body: JSON.stringify({
      message: `Publish: ${title}`,
      content: utf8ToBase64(content),
      branch: 'main',
    }),
  });
  const result = await create.json();
  if (!create.ok) return json({ error: result.message || 'GitHub rejected the publish request.' }, create.status, env, origin);

  return json({
    ok: true,
    path,
    commit: result.commit?.sha || null,
    url: `https://${env.GITHUB_OWNER}.github.io/${slug}/`,
  }, 200, env, origin);
}

async function uploadImage(request, env, origin, session) {
  const body = await request.json();
  const name = safeFileName(body.name || 'image');
  const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : '';
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/);
  if (!match) return json({ error: 'Unsupported image. Use PNG, JPG, WEBP or GIF.' }, 400, env, origin);
  if (match[2].length > 12_000_000) return json({ error: 'Image is too large.' }, 413, env, origin);

  const month = new Date().toISOString().slice(0, 7);
  const unique = `${Date.now()}-${name}`;
  const path = `assets/images/posts/${month}/${unique}`;
  const create = await githubFetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${encodePath(path)}`, session.token, {
    method: 'PUT',
    body: JSON.stringify({
      message: `Upload post image: ${unique}`,
      content: match[2],
      branch: 'main',
    }),
  });
  const result = await create.json();
  if (!create.ok) return json({ error: result.message || 'Could not upload the image.' }, create.status, env, origin);
  return json({ ok: true, path, url: `/${path}` }, 200, env, origin);
}

async function githubFetch(url, token, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'sonomzy-writer',
      ...(options.headers || {}),
    },
  });
}

async function safeGithubError(response) {
  try { const data = await response.json(); return data.message || ''; } catch { return ''; }
}

function assertSecrets(env) {
  for (const name of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'SESSION_SECRET']) {
    if (!env[name]) throw new Error(`Missing Worker secret: ${name}`);
  }
}

function cleanText(value, max) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function cleanDate(value) {
  const v = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : new Date().toISOString().slice(0, 10);
}
function cleanSlug(value) {
  return String(value || '').toLowerCase().trim().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
}
function safeFileName(value) {
  const cleaned = String(value).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.slice(-120) || 'image.png';
}
function yamlString(value) { return JSON.stringify(String(value || '')); }
function encodePath(path) { return path.split('/').map(encodeURIComponent).join('/'); }
function utf8ToBase64(value) {
  const bytes = encoder.encode(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function parseCookies(header) {
  return Object.fromEntries(header.split(';').map(v => v.trim()).filter(Boolean).map(v => {
    const i = v.indexOf('=');
    return [v.slice(0, i), v.slice(i + 1)];
  }));
}

async function seal(payload, secret) {
  const key = await sessionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = encoder.encode(JSON.stringify(payload));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  return `${base64url(iv)}.${base64url(encrypted)}`;
}

async function unseal(token, secret) {
  const [ivPart, dataPart] = String(token).split('.');
  if (!ivPart || !dataPart) throw new Error('Invalid session');
  const key = await sessionKey(secret);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64url(ivPart) }, key, fromBase64url(dataPart));
  return JSON.parse(decoder.decode(decrypted));
}

async function sessionKey(secret) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function fromBase64url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
