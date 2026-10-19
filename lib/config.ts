import { parseDayParam, residentialNeedsStreet } from "./brisbane.ts";

/** Sole permitted external AI gateway base. Never used for GoodSort's own /api/* application routes. */
export const ALLOWED_EXTERNAL_API_BASE = "https://api.aukus.si/v1";

export type DocumentedAukusPath =
  | "/chat/completions"
  | "/responses"
  | "/embeddings"
  | "/models";

const DOCUMENTED_AUKUS_PATHS = new Set<string>([
  "/chat/completions",
  "/responses",
  "/embeddings",
  "/models",
]);

/**
 * Validates the exact https://api.aukus.si/v1 base URI (parsed scheme, host,
 * default port 443, exact /v1 pathname, no userinfo/query/fragment) and
 * resolves only a documented Aukus AI endpoint path. Rejects /v1extra,
 * arbitrary descendants, and undocumented GoodSort application paths.
 */
export function resolveAukusEndpoint(
  rawBase: string | null | undefined,
  documentedPath: DocumentedAukusPath,
): string | null {
  const trimmed = (rawBase ?? "").trim();
  if (!trimmed || !DOCUMENTED_AUKUS_PATHS.has(documentedPath)) {
    return null;
  }
  try {
    const u = new URL(trimmed);
    if (
      u.protocol !== "https:" ||
      u.hostname.toLowerCase() !== "api.aukus.si" ||
      u.port !== "" ||
      u.username !== "" ||
      u.password !== "" ||
      u.search !== "" ||
      u.hash !== ""
    ) {
      return null;
    }
    const cleanPath = u.pathname.replace(/\/+$/, "");
    if (cleanPath !== "/v1") {
      return null;
    }
    return `${ALLOWED_EXTERNAL_API_BASE}${documentedPath}`;
  } catch {
    return null;
  }
}

/**
 * Enforces the GoodSort application API origin boundary: permits same-origin
 * ("") or local loopback (http://localhost[:port] or http://127.0.0.1[:port])
 * only. Never routes GoodSort /api/* endpoints to https://api.aukus.si/v1 or
 * any external origin.
 */
export function sanitiseApiBase(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }
  try {
    const u = new URL(trimmed);
    if (
      (u.protocol === "http:" || u.protocol === "https:") &&
      (u.hostname === "localhost" || u.hostname === "127.0.0.1") &&
      u.username === "" &&
      u.password === "" &&
      u.search === "" &&
      u.hash === "" &&
      (u.pathname === "" || u.pathname === "/")
    ) {
      return `${u.protocol}//${u.host}`;
    }
  } catch {
    // Reject malformed or non-URL strings.
  }
  return "";
}

export const API_URL =
  sanitiseApiBase(process.env.NEXT_PUBLIC_API_URL) ||
  (process.env.NODE_ENV === "production" ? "" : "http://localhost:5113");

/** Self-contained inline MapLibre style so map views render locally with zero external tile/font requests. */
export const LOCAL_MAP_STYLE = {
  version: 8 as const,
  name: "GoodSort Local Canvas",
  sources: {},
  layers: [
    {
      id: "local-background",
      type: "background" as const,
      paint: { "background-color": "#f1f5f9" },
    },
  ],
};

export const REFERRER_STORAGE_KEY = "goodsort_referrer";
export const DAY_HINT_KEY = "goodsort_day_hint";
export const PLACE_HINT_KEY = "goodsort_place_hint";

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

/** Client-only profile id. Empty on the first render so static HTML matches. */
export function readStoredProfileId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return asProfileId(JSON.parse(localStorage.getItem("goodsort_profile") || "{}").id);
  } catch {
    return undefined;
  }
}

function resolveApiBase(): string {
  const configured = sanitiseApiBase(process.env.NEXT_PUBLIC_API_URL);
  if (configured) return configured;
  if (typeof window !== "undefined" && window.location?.hostname) {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") return "http://localhost:5113";
    return "";
  }
  return API_URL;
}

export function apiUrl(path: string): string {
  const base = resolveApiBase();
  return base ? `${base}${path}` : path;
}

/** Persist ?r= / ?ref= so a neighbour invite survives the OTP hop. */
export function persistReferrerFromUrl(): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  const r = asProfileId(params.get("r") || params.get("ref"));
  if (r) sessionStorage.setItem(REFERRER_STORAGE_KEY, r);
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
  return asProfileId(params.get("r") || params.get("ref") || sessionStorage.getItem(REFERRER_STORAGE_KEY));
}

/** After OTP: finish the street, or go sort at home. Never invent a suburb. */
export async function waitlistContinuePath(): Promise<"/onboard" | "/sort"> {
  if (!hasValidToken()) return "/onboard";
  let householdId: string | undefined;
  try {
    const id = JSON.parse(localStorage.getItem("goodsort_profile") || "{}").householdId;
    householdId = typeof id === "string" && id ? id : undefined;
  } catch {
    return "/onboard";
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
