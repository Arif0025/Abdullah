const EXPECTED_USER = 'profile-owner';

function safeEqualText(left, right) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}

function credentials(request) {
  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('Basic ')) return null;
  try {
    const binary = atob(header.slice(6));
    const decoded = new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
    const separator = decoded.indexOf(':');
    if (separator < 0) return null;
    return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

export default async request => {
  const password = Netlify.env.get('EDITOR_PAGE_PASSWORD');
  if (!password) {
    return new Response('Not found', {
      status: 404,
      headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    });
  }

  const supplied = credentials(request);
  if (supplied?.username === EXPECTED_USER && safeEqualText(supplied.password, password)) return;

  return new Response('Editor access required.', {
    status: 401,
    headers: {
      'www-authenticate': 'Basic realm="Private profile editor", charset="UTF-8"',
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
      'x-content-type-options': 'nosniff',
    },
  });
};

export const config = { path: ['/editor', '/editor/*'] };
