// sessionStorage.js — cookie + URL helpers for BMS session id
// Cookie key and URL parameter name match BMS-SESSION-SPECIFICATION.md.

const COOKIE_NAME = 'bms-session-id';
const URL_PARAM = 'bms-session-id';
const COOKIE_DAYS = 7;

export function setSessionCookie(sessionId) {
  if (!sessionId) return;
  const expires = new Date();
  expires.setDate(expires.getDate() + COOKIE_DAYS);
  const secure = typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie =
    `${COOKIE_NAME}=${encodeURIComponent(sessionId)}` +
    `; expires=${expires.toUTCString()}` +
    `; path=/` +
    `; SameSite=Lax${secure}`;
}

export function getSessionCookie() {
  if (typeof document === 'undefined') return null;
  const prefix = `${COOKIE_NAME}=`;
  const parts = document.cookie ? document.cookie.split(';') : [];
  for (const raw of parts) {
    const c = raw.trim();
    if (c.startsWith(prefix)) {
      try {
        return decodeURIComponent(c.slice(prefix.length));
      } catch {
        return c.slice(prefix.length);
      }
    }
  }
  return null;
}

export function removeSessionCookie() {
  document.cookie = `${COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
}

export function getSessionFromUrl() {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get(URL_PARAM);
  } catch {
    return null;
  }
}

export function removeSessionFromUrl() {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete(URL_PARAM);
    const next = url.pathname + (url.search ? url.search : '') + (url.hash || '');
    window.history.replaceState({}, document.title, next);
  } catch {
    // ignore
  }
}

// Combined flow: extract session id from URL, persist to cookie, clean URL.
// Returns the id (or null) so caller can immediately call connectSession().
export function handleUrlSession() {
  const fromUrl = getSessionFromUrl();
  if (fromUrl) {
    setSessionCookie(fromUrl);
    removeSessionFromUrl();
    return fromUrl;
  }
  return getSessionCookie();
}
