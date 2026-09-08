const FIXTURE_COOKIES = new Set(['__Host-m0_principal', '__Host-m0_preview', '__Host-m0_challenge']);

// Playwright's URL filter also suffix-matches host-only cookie domains. These
// fixture credentials are all __Host-, so manual replay must use exact hosts.
export function fixtureCookiesForUrl(cookies, value) {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('fixture-cookie-https-required');
  return cookies.filter(cookie => FIXTURE_COOKIES.has(cookie.name) && cookie.domain === url.hostname && cookie.path === '/' && cookie.secure && cookie.httpOnly);
}
