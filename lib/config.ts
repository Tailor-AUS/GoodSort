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
