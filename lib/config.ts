import { parseDayParam, residentialNeedsStreet } from "./brisbane.ts";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  (process.env.NODE_ENV !== "production" ? "http://localhost:5113" : "");
export const REFERRER_STORAGE_KEY = "goodsort_referrer";
export const REFERRER_EXPIRES_KEY = "goodsort_referrer_exp";
export const NEXT_PATH_KEY = "goodsort_next_path";
export const DAY_HINT_KEY = "goodsort_day_hint";
export const PLACE_HINT_KEY = "goodsort_place_hint";
const REFERRER_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type PlaceHint = {
  address: string;
  lat: number;
  lng: number;
  suburb?: string | null;
  councilArea?: string | null;
};

export function writePlaceHint(place: PlaceHint): void {
  if (typeof window === "undefined") return;
  if (!place.address.trim()) return;
  if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return;
  sessionStorage.setItem(PLACE_HINT_KEY, JSON.stringify({
    address: place.address.trim(),
    lat: place.lat,
    lng: place.lng,
    suburb: place.suburb ?? null,
    councilArea: place.councilArea ?? null,
  }));
}

export function readPlaceHint(): PlaceHint | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PLACE_HINT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<PlaceHint>;
    if (typeof d.address !== "string" || typeof d.lat !== "number" || typeof d.lng !== "number") return null;
    return {
      address: d.address,
      lat: d.lat,
      lng: d.lng,
      suburb: typeof d.suburb === "string" ? d.suburb : null,
      councilArea: typeof d.councilArea === "string" ? d.councilArea : null,
    };
  } catch {
    return null;
  }
}

const PROFILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asProfileId(raw: string | null | undefined): string | undefined {
  const value = raw?.trim();
  return value && PROFILE_ID.test(value) ? value : undefined;
}

/** Safe client-only reader for localStorage goodsort_profile. Never throws on corrupt JSON. */
export function readStoredProfile(): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem("goodsort_profile") || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function jwtSubject(token: string): string | undefined {
  try {
    const payload = token.split(".")[1];
    if (!payload) return undefined;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const sub = JSON.parse(json).sub;
    return typeof sub === "string" ? asProfileId(sub) : undefined;
  } catch {
    return undefined;
  }
}

/** Client-only check for whether the signed-in user has admin privileges (stored profile or JWT role claim). */
export function isStoredAdmin(): boolean {
  if (typeof window === "undefined" || !hasValidToken()) return false;
  if (readStoredProfile().isAdmin === true) return true;
  try {
    const token = localStorage.getItem("goodsort_token");
    if (!token) return false;
    const payload = token.split(".")[1];
    if (!payload) return false;
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { role?: string | string[] };
    if (decoded.role === "admin") return true;
    if (Array.isArray(decoded.role)) return decoded.role.includes("admin");
    return false;
  } catch {
    return false;
  }
}

/** Client-only profile id. Empty on the first render so static HTML matches. */
export function readStoredProfileId(): string | undefined {
  const id = readStoredProfile().id;
  if (typeof id === "string") {
    const parsed = asProfileId(id);
    if (parsed) return parsed;
  }
  if (typeof window !== "undefined" && hasValidToken()) {
    const token = localStorage.getItem("goodsort_token");
    if (token) return jwtSubject(token);
  }
  return undefined;
}

function resolveApiBase(): string {
  if (API_URL) return API_URL;
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") return "http://localhost:5113";
  }
  return "";
}

export function apiUrl(path: string): string {
  const base = resolveApiBase();
  return base ? `${base}${path}` : path;
}

/** Persist ?r= / ?ref= in both sessionStorage and localStorage (30d TTL) so a neighbour invite survives tabs & restarts. */
export function persistReferrerFromUrl(): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  const r = asProfileId(params.get("r") || params.get("ref"));
  if (!r) return;
  try {
    sessionStorage.setItem(REFERRER_STORAGE_KEY, r);
  } catch { /* ignore */ }
  try {
    localStorage.setItem(REFERRER_STORAGE_KEY, r);
    localStorage.setItem(REFERRER_EXPIRES_KEY, String(Date.now() + REFERRER_TTL_MS));
  } catch { /* ignore */ }
}

export function sanitizeNextPath(raw: string | null | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\")) {
    return undefined;
  }
  return trimmed;
}

export function persistNextPathFromUrl(): void {
  if (typeof window === "undefined") return;
  const next = sanitizeNextPath(new URLSearchParams(window.location.search).get("next"));
  if (next) {
    try { sessionStorage.setItem(NEXT_PATH_KEY, next); } catch { /* ignore */ }
  }
}

export function consumeNextPath(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const fromUrl = sanitizeNextPath(new URLSearchParams(window.location.search).get("next"));
  try {
    const stored = sanitizeNextPath(sessionStorage.getItem(NEXT_PATH_KEY));
    sessionStorage.removeItem(NEXT_PATH_KEY);
    return fromUrl ?? stored;
  } catch {
    return fromUrl;
  }
}

/** Persist ?day=friday so the same recycling night survives OTP → onboard. */
export function persistDayFromUrl(): void {
  if (typeof window === "undefined") return;
  const day = parseDayParam(new URLSearchParams(window.location.search).get("day"));
  if (day != null) sessionStorage.setItem(DAY_HINT_KEY, String(day));
}

export function persistWaitlistFromUrl(): void {
  persistReferrerFromUrl();
  persistDayFromUrl();
  persistNextPathFromUrl();
}

export function writeDayHint(day: number): void {
  if (typeof window === "undefined") return;
  if (day < 0 || day > 6) return;
  sessionStorage.setItem(DAY_HINT_KEY, String(day));
}

export function readDayHint(): number | null {
  if (typeof window === "undefined") return null;
  const fromUrl = parseDayParam(new URLSearchParams(window.location.search).get("day"));
  if (fromUrl != null) return fromUrl;
  try {
    return parseDayParam(sessionStorage.getItem(DAY_HINT_KEY));
  } catch {
    return null;
  }
}

export function readReferrerId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const params = new URLSearchParams(window.location.search);
  const fromUrlOrSession = asProfileId(
    params.get("r") || params.get("ref") || sessionStorage.getItem(REFERRER_STORAGE_KEY)
  );
  if (fromUrlOrSession) return fromUrlOrSession;
  try {
    const exp = Number(localStorage.getItem(REFERRER_EXPIRES_KEY) || "0");
    if (exp > Date.now()) {
      return asProfileId(localStorage.getItem(REFERRER_STORAGE_KEY));
    }
    localStorage.removeItem(REFERRER_STORAGE_KEY);
    localStorage.removeItem(REFERRER_EXPIRES_KEY);
  } catch {
    /* ignore */
  }
  return undefined;
}

/** After OTP: honor ?next= if safe, send standalone admins to /admin, finish street, or go sort at home. */
export async function waitlistContinuePath(): Promise<string> {
  const explicitNext = consumeNextPath();
  if (explicitNext) return explicitNext;
  if (!hasValidToken()) return "/onboard";
  const stored = readStoredProfile();
  let householdId = typeof stored.householdId === "string" && stored.householdId ? stored.householdId : undefined;
  if (!householdId && stored.isAdmin === true) return "/admin";
  if (!householdId) {
    try {
      const me = await fetch(apiUrl("/api/profiles/me/payout"), { headers: authHeaders() })
        .then((r) => (r.ok ? r.json() : null));
      if (me && typeof me.householdId === "string" && me.householdId) {
        householdId = me.householdId;
        stored.householdId = me.householdId;
        if (typeof me.profileName === "string" && me.profileName) stored.name = me.profileName;
        localStorage.setItem("goodsort_profile", JSON.stringify(stored));
      }
    } catch {
      /* ignore */
    }
  }
  if (!householdId) return "/onboard";
  try {
    const hh = await fetch(apiUrl(`/api/households/${householdId}`), { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null));
    return residentialNeedsStreet(hh) ? "/onboard" : "/sort";
  } catch {
    return "/onboard";
  }
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
