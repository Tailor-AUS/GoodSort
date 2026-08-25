import { BRISBANE_SUBURBS, type BrisbaneSuburb } from "./brisbane-suburbs";

export { BRISBANE_SUBURBS, type BrisbaneSuburb };

export const LIVE_HOUSEHOLD_THRESHOLD = 12;

/** BCC residential collection-day dataset used for waitlist clustering. */
export const BCC_BIN_DAY_DATASET =
  "https://data.brisbane.qld.gov.au/explore/dataset/waste-collection-days-collection-days/";
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type GrowthDay = {
  day: number;
  dayName: string;
  households: number;
  live: boolean;
  needed: number;
};

export type GrowthSuburb = {
  suburb: string;
  households: number;
  live: boolean;
  needed: number;
  bestDay: number | null;
  bestDayName: string | null;
  byDay: GrowthDay[];
};

export function clusterForDay(suburb?: GrowthSuburb | null, day?: number | null): GrowthDay | undefined {
  if (!suburb?.byDay?.length) return undefined;
  if (day != null) return suburb.byDay.find((d) => d.day === day);
  if (suburb.bestDay != null) return suburb.byDay.find((d) => d.day === suburb.bestDay);
  return suburb.byDay[0];
}

export type DayClusterStats = {
  households: number;
  needed: number;
  live: boolean;
  dayName: string | null;
};

/** Same suburb + same recycling day only. Never suburb-wide or city-wide totals. */
export function dayClusterStats(
  suburb?: GrowthSuburb | null,
  day?: number | null,
): DayClusterStats | null {
  const cluster = clusterForDay(suburb, day);
  if (!cluster) return null;
  return {
    households: cluster.households,
    needed: cluster.needed,
    live: cluster.live,
    dayName: cluster.dayName,
  };
}

/** Safe invite/progress fallback: you, on an unknown day. Never a city total. */
export function justYouStats(dayName?: string | null): DayClusterStats {
  return {
    households: 1,
    needed: LIVE_HOUSEHOLD_THRESHOLD - 1,
    live: false,
    dayName: dayName ?? null,
  };
}

/** Houses on a recycling day. A unit/building viewer must not appear as 1/12. */
export function streetStatsForViewer(
  suburb: GrowthSuburb | null | undefined,
  day: number | null | undefined,
  viewerCountsTowardUnlock: boolean,
): DayClusterStats {
  const cluster = dayClusterStats(suburb, day);
  if (cluster) return cluster;
  if (viewerCountsTowardUnlock) return justYouStats();
  return { households: 0, needed: LIVE_HOUSEHOLD_THRESHOLD, live: false, dayName: null };
}

/** Residential waitlist is incomplete until suburb + recycling day are set. Units skip this — they do not unlock. */
export function residentialNeedsStreet(hh: {
  type?: string | null;
  suburb?: string | null;
  councilCollectionDay?: number | null;
} | null | undefined): boolean {
  if (!hh) return true;
  if (hh.type === "unit_complex") return false;
  const suburb = typeof hh.suburb === "string" ? hh.suburb.trim() : "";
  return !suburb || hh.councilCollectionDay == null;
}

/** Closest to a run = fewest more houses needed on the best recycling day. Suburb-wide totals never rank a street. */
export function rankByUnlockProximity(suburbs: GrowthSuburb[]): GrowthSuburb[] {
  return [...suburbs].sort((a, b) => {
    const ac = clusterForDay(a);
    const bc = clusterForDay(b);
    const aNeeded = ac?.needed ?? LIVE_HOUSEHOLD_THRESHOLD;
    const bNeeded = bc?.needed ?? LIVE_HOUSEHOLD_THRESHOLD;
    if (aNeeded !== bNeeded) return aNeeded - bNeeded;
    const aHave = ac?.households ?? 0;
    const bHave = bc?.households ?? 0;
    if (bHave !== aHave) return bHave - aHave;
    return a.suburb.localeCompare(b.suburb);
  });
}

export function isCollecting(status?: string | null) {
  return status === "delivered" || status === "collecting";
}

/** Date-only `yyyy-MM-dd` from the API — never parse as UTC midnight. */
export function formatCollectionNight(iso?: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

export function inviteShareText(
  suburb?: string | null,
  opts?: { dayName?: string | null; households?: number; needed?: number; live?: boolean },
) {
  const place = suburb ? titleSuburb(suburb) : "our street";
  const day = opts?.dayName ? ` ${opts.dayName}` : "";
  if (opts?.live) {
    return `${place}${day} recycling has enough neighbours for a The Good Sort collection night. Start sorting today — they tell you when they collect:`;
  }
  if (opts?.households && opts.households > 0 && opts.needed != null) {
    return `${place}${day} is ${opts.households}/${LIVE_HOUSEHOLD_THRESHOLD} for a The Good Sort collection night. Start sorting today. ${opts.needed} more neighbours on that day and they collect:`;
  }
  return `Start sorting with The Good Sort in ${place}. ${LIVE_HOUSEHOLD_THRESHOLD} neighbours on the same recycling day start the collection night:`;
}

export function inviteMessage(url: string, suburb?: string | null, opts?: { dayName?: string | null; households?: number; needed?: number; live?: boolean }) {
  return `${inviteShareText(suburb, opts)} ${url}`;
}

export function parseDayParam(raw?: string | null): number | null {
  if (raw == null || raw.trim() === "") return null;
  const s = raw.trim().toLowerCase();
  const asNum = Number(s);
  if (Number.isInteger(asNum) && asNum >= 0 && asNum <= 6) return asNum;
  const names: Record<string, number> = {
    sun: 0, sunday: 0,
    mon: 1, monday: 1,
    tue: 2, tues: 2, tuesday: 2,
    wed: 3, wednesday: 3,
    thu: 4, thur: 4, thurs: 4, thursday: 4,
    fri: 5, friday: 5,
    sat: 6, saturday: 6,
  };
  return names[s] ?? null;
}

export function daySlug(day: number): string | null {
  return day >= 0 && day <= 6 ? DAY_NAMES[day].toLowerCase() : null;
}

/** Path only (`/brisbane/moorooka?day=friday&r=`). Missing suburb → `/`, never a fake Moorooka. */
export function streetInvitePath(opts: {
  suburb?: string | null;
  day?: number | null;
  dayName?: string | null;
  profileId?: string | null;
}): string {
  const known = opts.suburb ? findSuburb(opts.suburb) : undefined;
  const path = known ? `/brisbane/${known.slug}` : "/";
  const params = new URLSearchParams();
  const day = opts.day ?? parseDayParam(opts.dayName);
  const slug = day != null ? daySlug(day) : null;
  if (slug) params.set("day", slug);
  if (opts.profileId) params.set("r", opts.profileId);
  const q = params.toString();
  return q ? `${path}?${q}` : path;
}

export function streetInviteUrl(opts: {
  suburb?: string | null;
  day?: number | null;
  dayName?: string | null;
  profileId?: string | null;
  origin?: string;
}): string {
  const origin = (opts.origin ?? "https://thegoodsort.org").replace(/\/+$/, "");
  return `${origin}${streetInvitePath(opts)}`;
}

/** Printable letterbox card. Missing suburb → `/`, never a fake Moorooka. */
export function streetCardPath(opts: {
  suburb?: string | null;
  day?: number | null;
  dayName?: string | null;
}): string {
  const known = opts.suburb ? findSuburb(opts.suburb) : undefined;
  if (!known) return "/";
  const day = opts.day ?? parseDayParam(opts.dayName);
  const slug = day != null ? daySlug(day) : null;
  return slug ? `/brisbane/${known.slug}/card?day=${slug}` : `/brisbane/${known.slug}/card`;
}

export function whatsappShareUrl(message: string) {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

export function smsShareUrl(message: string) {
  return `sms:?&body=${encodeURIComponent(message)}`;
}

/** Depot-adjacent inner south — chip/index order, not alphabetical. */
export const WEDGE_SLUGS = [
  "moorooka",
  "annerley",
  "yeronga",
  "fairfield",
  "yeerongpilly",
  "dutton-park",
  "west-end",
  "highgate-hill",
  "south-brisbane",
  "woolloongabba",
  "greenslopes",
  "tarragindi",
  "salisbury",
  "rocklea",
  "tennyson",
  "coorparoo",
] as const;

export function wedgeSuburbs(): BrisbaneSuburb[] {
  return WEDGE_SLUGS.map((slug) => BRISBANE_SUBURBS.find((s) => s.slug === slug)).filter(
    (s): s is BrisbaneSuburb => !!s,
  );
}

/** City-wide labels Photon uses. Never a density cluster. */
const NOT_A_CLUSTER = new Set(["brisbane", "qld", "queensland", "australia"]);

export function canonicalSuburb(raw?: string | null): string | null {
  if (!raw?.trim()) return null;
  const known = findSuburb(raw);
  if (known) return known.name.toUpperCase();
  const upper = raw.trim().toUpperCase();
  if (NOT_A_CLUSTER.has(upper.toLowerCase())) return null;
  return upper;
}

export function suburbSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function findSuburb(slugOrName: string): BrisbaneSuburb | undefined {
  const key = suburbSlug(slugOrName);
  return BRISBANE_SUBURBS.find(
    (s) => s.slug === key || suburbSlug(s.name) === key,
  );
}

export function sameSuburb(a?: string | null, b?: string | null) {
  const left = canonicalSuburb(a);
  const right = canonicalSuburb(b);
  return !!left && left === right;
}

export function titleSuburb(stored: string): string {
  const known = findSuburb(stored);
  if (known) return known.name;
  return stored
    .toLowerCase()
    .split(/[\s-]+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
