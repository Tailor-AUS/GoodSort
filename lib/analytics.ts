import { apiUrl } from "./config";

const ALLOWED = new Set([
  "waitlist_cta",
  "otp_sent",
  "otp_verified",
  "household_joined",
  "invite_whatsapp",
  "invite_sms",
  "invite_share",
  "invite_landed",
  "suburb_picked",
  "bin_day_looked_up",
]);

/** First-party waitlist funnel. No third-party tracker. No email or address. */
export function track(name: string, props?: { suburb?: string | null }) {
  if (typeof window === "undefined") return;
  if (!ALLOWED.has(name)) return;
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
