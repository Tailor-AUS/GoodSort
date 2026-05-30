export const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export function apiUrl(path: string): string {
  return API_URL ? `${API_URL}${path}` : path;
}

// Builds headers for a direct fetch() to an authenticated endpoint. Any fetch()
// outside lib/store-api.ts must attach the Bearer token manually — apiFetch()
// does this automatically, direct fetch() calls do not. SSR-safe for the static
// export (guards against `localStorage` being undefined during prerender).
export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("goodsort_token") : null;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

// Decode a JWT's `exp` (unix seconds) without verifying the signature — that's
// the server's job. We only need to know if the token is past expiry so we can
// route the user back to login instead of firing API calls that will 401.
function jwtExpiry(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const exp = JSON.parse(json).exp;
    return typeof exp === "number" ? exp : null;
  } catch {
    return null;
  }
}

// True when there's a stored token that is still within its lifetime. A token
// with no parseable exp is treated as valid (fail-open to the server, which is
// the real authority) — only a definitively-expired token returns false.
export function hasValidToken(): boolean {
  if (typeof window === "undefined") return false;
  const token = localStorage.getItem("goodsort_token");
  if (!token) return false;
  const exp = jwtExpiry(token);
  if (exp === null) return true;
  return exp * 1000 > Date.now();
}

// Clear all auth state. Used when a token is found to be expired (client-side)
// or rejected by the server (401), so the next screen starts clean.
export function clearAuth(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem("goodsort_token");
  localStorage.removeItem("goodsort_profile");
  localStorage.removeItem("goodsort_user");
  document.cookie = "goodsort_token=; path=/; max-age=0; SameSite=Lax; Secure";
}
