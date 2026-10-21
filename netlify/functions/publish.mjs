import { randomUUID } from 'node:crypto';
import { json, readSession, sameOrigin } from '../lib/editor-auth.mjs';

async function github(path, options, env) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
      ...options?.headers,
    },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || `GitHub rejected the publish request (${response.status}).`);
  return result;
}

export default async (request, context) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!sameOrigin(request)) return json({ error: 'Request origin is not allowed.' }, 403);
  try {
    const env = process.env;
    if (!readSession(request, env)) return json({ error: 'Your editor session has expired. Sign in again.' }, 401);
    const { content: submitted } = await request.json();
    const content = structuredClone(submitted);
    if (!content || typeof content !== 'object' || Array.isArray(content)) return json({ error: 'Invalid profile content.' }, 400);
    if (Buffer.byteLength(JSON.stringify(content), 'utf8') > 4_500_000) return json({ error: 'The draft is too large to publish. Reduce uploaded image sizes.' }, 413);

    const { GITHUB_OWNER: owner, GITHUB_REPO: repo, GITHUB_BRANCH: branch = 'main', GITHUB_CONTENT_PATH: filePath = 'public/content.js', GITHUB_TOKEN: token } = env;
    if (!owner || !repo || !token) return json({ error: 'GitHub publishing is not configured in Netlify yet.' }, 503);
    const refPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}`;
    const ref = await github(refPath, { method: 'GET' }, env);
    const parentSha = ref.object.sha;
    const parentCommit = await github(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${parentSha}`, { method: 'GET' }, env);
    const entries = [];
    for (const [key, image] of Object.entries(content.images || {})) {
      const match = typeof image?.src === 'string' && image.src.match(/^data:image\/(png|jpeg|webp);base64,([a-z\d+/=]+)$/i);
      if (!match) continue;
      const extension = match[1].toLowerCase().replace('jpeg', 'jpg');
      const baseName = String(image.label || key).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || key;
      const filename = `editor-${baseName}-${randomUUID()}.${extension}`;
      const imageBlob = await github(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs`, {
        method: 'POST', body: JSON.stringify({ content: match[2], encoding: 'base64' }),
      }, env);
      entries.push({ path: `public/assets/${filename}`, mode: '100644', type: 'blob', sha: imageBlob.sha });
      image.src = `assets/${filename}`;
    }
    const blob = await github(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs`, {
      method: 'POST', body: JSON.stringify({ content: `window.INITIAL_CONTENT = ${JSON.stringify(content, null, 2)};\n`, encoding: 'utf-8' }),
    }, env);
    entries.push({ path: filePath, mode: '100644', type: 'blob', sha: blob.sha });
    const tree = await github(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees`, {
      method: 'POST', body: JSON.stringify({ base_tree: parentCommit.tree.sha, tree: entries }),
    }, env);
    const commit = await github(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits`, {
      method: 'POST', body: JSON.stringify({ message: 'Update profile content from editor', tree: tree.sha, parents: [parentSha] }),
    }, env);
    await github(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads/${encodeURIComponent(branch)}`, {
      method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }),
    }, env);
    return json({ ok: true, commit: commit.sha, content, message: 'Changes committed. Netlify will deploy them shortly.' });
  } catch (error) {
    const message = error instanceof SyntaxError ? 'The publish request was not valid JSON.' : error?.message || 'Publish failed.';
    const status = /sign in|session|account|origin/i.test(message) ? 401 : 500;
    return json({ error: message }, status);
  }
};

export const config = {
  path: '/api/editor/publish',
  rateLimit: { windowLimit: 5, windowSize: 300, aggregateBy: ['ip', 'domain'] },
};
