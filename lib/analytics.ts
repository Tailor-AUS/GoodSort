import { apiUrl } from "./config.ts";

/**
 * The funnel we can actually measure. Must stay in step with the server
 * allowlist in `Program.cs` — an event missing from either side is dropped
 * silently, with no error on the client and a bare 400 on the server that the
 * client discards.
 *
 * Scanning is the product's core action and the thing the launch bonus pays
 * for, so it is instrumented from camera to credit. `first_scan_credited` is
 * the activation metric.
 */
export const TRACKED_EVENTS = [
  "waitlist_cta",
  "scan_camera_opened",
  "scan_captured",
  "scan_credited",
  "first_scan_credited",
  "otp_sent",
  "otp_verified",
  "household_joined",
  "invite_whatsapp",
  "invite_sms",
  "invite_share",
  "invite_landed",
  "suburb_picked",
  "bin_day_looked_up",
] as const;

export type TrackedEvent = (typeof TRACKED_EVENTS)[number];

const ALLOWED = new Set<string>(TRACKED_EVENTS);

/** First-party waitlist funnel. No third-party tracker. No email or address. */
export function track(name: string, props?: { suburb?: string | null }) {
  if (typeof window === "undefined") return;
  if (!ALLOWED.has(name)) {
    // Silently dropping an unknown name is how instrumentation quietly rots:
    // the call looks fine, nothing throws, and the event simply never exists.
    // Keep the production behaviour, but make it obvious while developing.
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[analytics] "${name}" is not in TRACKED_EVENTS — event dropped. Add it here AND to the server allowlist in Program.cs.`);
    }
    return;
  }
  let suburb = props?.suburb ?? null;
  try {
    suburb = suburb ?? sessionStorage.getItem("goodsort_suburb_hint");
  } catch { /* ignore */ }
  const body = JSON.stringify({
    name,
    suburb,
    path: window.location.pathname,
  });
  fetch(apiUrl("/api/growth/events"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}
