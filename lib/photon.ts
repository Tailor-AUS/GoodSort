import { BRISBANE_SUBURBS } from "./brisbane-suburbs.ts";

// Photon (komoot) is OSM-based and free with no API key. We bias results
// toward Brisbane and filter to AU only.
export const PHOTON_URL = "https://photon.komoot.io/api/";
export const BRISBANE = { lat: -27.4698, lon: 153.0251 };
export const PHOTON_TIMEOUT_MS = 6_000;

export interface PhotonProps {
  name?: string;
  housenumber?: string;
  street?: string;
  city?: string;
  district?: string;
  state?: string;
  postcode?: string;
  country?: string;
  countrycode?: string;
}

export interface PhotonFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: PhotonProps;
}

export interface AddressSelection {
  address: string;
  lat: number;
  lng: number;
  suburb?: string;
  street?: string;
}

const LEADING_STREET_NUMBER_RE =
  /^\s*(?:(?:unit|apt|apartment|flat|lot|shop|villa|townhouse|level|lvl|suite|u)\s*([a-z0-9]+)\s*[\/,\s-]+\s*)?(\d+[a-z]?(?:\s*[\/-]\s*\d+[a-z]?)?)\s+([a-z][a-z0-9\s'.-]{1,})/i;

const BUS_STOP_NAME_RE = /^(?:stop\s+\d+|platform\s+\d+|station\b|busway\b)/i;

const ROAD_TYPE_AFTER_NAME_RE =
  /^\s+(?:road|rd|street|st|avenue|ave|av|crescent|cres|cr|drive|dr|terrace|tce|parade|pde|court|ct|close|cl|place|pl|lane|ln|way|boulevard|blvd|outlook|circuit|cct|esplanade|esp|highway|hwy|grove|gr)\b/i;

const SUBURBS_LONGEST_FIRST = [...BRISBANE_SUBURBS].sort((a, b) => b.name.length - a.name.length);

/** Photon sets city=Brisbane and district=the suburb. City-wide "Brisbane" must never be the cluster. */
export function suburbFromPhoton(p: PhotonProps): string | undefined {
  const district = (p.district ?? "").trim();
  const city = (p.city ?? "").trim();
  if (district && (!city || /^brisbane$/i.test(city))) return district;
  if (/^brisbane city$/i.test(city)) return city;
  if (city && !/^brisbane$/i.test(city) && !/^queensland$/i.test(city)) return city;
  return district || undefined;
}

/**
 * Extracts a leading house/unit number (e.g. "12", "18A", "2/14", "Unit 3, 14" -> "3/14")
 * from a user's typed address query so Photon road-midpoint or neighbouring-house matches
 * never strip or overwrite the resident's actual house number.
 */
export function extractLeadingStreetNumber(input: string | undefined | null): string | undefined {
  if (!input) return undefined;
  const m = LEADING_STREET_NUMBER_RE.exec(input);
  if (!m) return undefined;
  const unit = m[1]?.trim();
  const num = m[2].replace(/\s+/g, "");
  return unit ? `${unit}/${num}` : num;
}

/** Extracts just the street-level house number without unit prefix (e.g. "Unit 2, 18 Cracknell Rd" -> "18"). */
export function extractBareHouseNumber(input: string | undefined | null): string | undefined {
  if (!input) return undefined;
  const m = LEADING_STREET_NUMBER_RE.exec(input);
  if (!m) return undefined;
  const num = m[2].replace(/\s+/g, "");
  return num.includes("/") ? num.split("/").pop() : num;
}

/** Strips any leading unit + house number so street-only fallback queries resolve unmapped house numbers. */
export function stripLeadingStreetNumber(input: string | undefined | null): string | undefined {
  if (!input) return undefined;
  const m = LEADING_STREET_NUMBER_RE.exec(input);
  if (!m) return undefined;
  const rest = input.slice(m[0].length - m[3].length).trim();
  return rest.length >= 3 ? rest : undefined;
}

/** Expands common Australian road abbreviations ("Rd" -> "Road", "Ave" -> "Avenue") for OSM fallback matching. */
export function expandRoadAbbreviations(streetQuery: string): string {
  return streetQuery
    .replace(/\bRd\b/gi, "Road")
    .replace(/\bSt\b/gi, "Street")
    .replace(/\bAve?\b/gi, "Avenue")
    .replace(/\bCres\b/gi, "Crescent")
    .replace(/\bDr\b/gi, "Drive")
    .replace(/\bTce\b/gi, "Terrace")
    .replace(/\bPde\b/gi, "Parade")
    .replace(/\bCt\b/gi, "Court")
    .replace(/\bCl\b/gi, "Close")
    .replace(/\bPl\b/gi, "Place");
}

/**
 * Finds the Brisbane locality typed at the tail of a query (ignoring suburb names that
 * appear immediately before a road suffix like "12 Hamilton Rd Moorooka" -> "Moorooka").
 */
export function extractTypedBrisbaneSuburb(input: string | undefined | null): string | undefined {
  if (!input) return undefined;
  const hay = input.trim();
  let bestMatch: { name: string; index: number } | undefined;
  for (const sub of SUBURBS_LONGEST_FIRST) {
    const escaped = sub.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(hay)) !== null) {
      const after = hay.slice(m.index + m[0].length);
      if (ROAD_TYPE_AFTER_NAME_RE.test(after)) continue;
      if (!bestMatch || m.index > bestMatch.index || (m.index === bestMatch.index && sub.name.length > bestMatch.name.length)) {
        bestMatch = { name: sub.name, index: m.index };
      }
    }
  }
  return bestMatch?.name;
}

export function hasStreetNumber(address: string | undefined | null): boolean {
  return Boolean(extractLeadingStreetNumber(address));
}

export function formatPhotonAddress(p: PhotonProps, userQuery?: string): string {
  const typedNum = extractLeadingStreetNumber(userQuery);
  const effectiveNum = typedNum ?? p.housenumber;
  const fallbackStreet =
    !p.street && p.name && !BUS_STOP_NAME_RE.test(p.name.trim()) ? p.name : undefined;
  const streetName = p.street || fallbackStreet;
  const street = [effectiveNum, streetName].filter(Boolean).join(" ");
  const locality = suburbFromPhoton(p) ?? "";
  const state = /^queensland$/i.test(p.state ?? "") ? "QLD" : (p.state ?? "");
  const tail = [locality, state, p.postcode].filter(Boolean).join(" ");
  return [street || p.name, tail].filter(Boolean).join(", ");
}

async function fetchPhotonRaw(
  q: string,
  limit: number,
  typedNum: string | undefined,
  timeoutMs: number
): Promise<{ features: PhotonFeature[]; timedOut: boolean }> {
  if (timeoutMs <= 50) return { features: [], timedOut: true };
  const url = `${PHOTON_URL}?q=${encodeURIComponent(q)}&limit=${limit}&lang=en&lat=${BRISBANE.lat}&lon=${BRISBANE.lon}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return { features: [], timedOut: false };
    const data = (await res.json()) as { features?: PhotonFeature[] };
    const features = (data.features ?? []).filter((f) => {
      if (f.properties.countrycode !== "AU") return false;
      if (typedNum && !f.properties.street && BUS_STOP_NAME_RE.test((f.properties.name ?? "").trim())) {
        return false;
      }
      return true;
    });
    return { features, timedOut: false };
  } catch {
    return { features: [], timedOut: ctrl.signal.aborted };
  } finally {
    clearTimeout(timer);
  }
}

function featureHasStreet(f: PhotonFeature): boolean {
  return Boolean(f.properties.street || (f.properties.name && !BUS_STOP_NAME_RE.test(f.properties.name.trim())));
}

function matchesSuburb(f: PhotonFeature, targetSuburb?: string): boolean {
  if (!targetSuburb) return true;
  const sub = suburbFromPhoton(f.properties);
  return Boolean(sub && sub.toLowerCase() === targetSuburb.toLowerCase());
}

/**
 * Extracts the core street name stem (e.g. "Ekibin Rd East Annerley" -> "ekibin")
 * so fallback queries never accept a POI/amenity located on an unrelated road (like
 * "45 Ekibin Rd East Annerley" falsely snapping onto "Ipswich Road").
 */
export function extractTypedStreetStem(streetQuery: string | undefined | null, typedSuburb?: string): string | undefined {
  if (!streetQuery) return undefined;
  let cleaned = streetQuery.trim();
  if (typedSuburb) {
    const escaped = typedSuburb.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cleaned = cleaned.replace(new RegExp(`\\b${escaped}\\b`, "gi"), " ");
  }
  cleaned = cleaned
    .replace(/\b(?:qld|queensland|australia|\d{4})\b/gi, " ")
    .replace(/\b(?:road|rd|street|st|avenue|ave|av|crescent|cres|cr|drive|dr|terrace|tce|parade|pde|court|ct|close|cl|place|pl|lane|ln|way|boulevard|blvd|outlook|circuit|cct|esplanade|esp|highway|hwy|grove|gr|east|west|north|south)\b/gi, " ")
    .replace(/[,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return cleaned.length >= 3 ? cleaned : undefined;
}

function matchesStreetStem(f: PhotonFeature, stem?: string): boolean {
  if (!stem) return true;
  const candidate = (f.properties.street || f.properties.name || "").toLowerCase();
  return candidate.includes(stem);
}

export async function searchPhoton(query: string, limit = 6): Promise<PhotonFeature[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];

  const typedNum = extractLeadingStreetNumber(trimmed);
  const bareHouseNum = extractBareHouseNumber(trimmed);
  const streetOnly = stripLeadingStreetNumber(trimmed);
  const typedSuburb = extractTypedBrisbaneSuburb(trimmed);
  const streetStem = extractTypedStreetStem(streetOnly ?? trimmed, typedSuburb);

  // Normalize "Unit 2, 18 Cracknell Rd" -> "18 Cracknell Rd" for Photon's query parser
  // while formatPhotonAddress still preserves the full "2/18" prefix.
  const primaryQuery =
    bareHouseNum && streetOnly ? `${bareHouseNum} ${streetOnly}` : trimmed;

  const fetchLimit = Math.max(limit, 8);
  const merged: PhotonFeature[] = [];
  const seen = new Set<string>();
  const addUnique = (items: PhotonFeature[]) => {
    for (const f of items) {
      const key = `${f.geometry.coordinates[0].toFixed(5)},${f.geometry.coordinates[1].toFixed(5)},${f.properties.housenumber ?? ""},${f.properties.street ?? f.properties.name ?? ""}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(f);
      }
    }
  };

  const deadline = Date.now() + PHOTON_TIMEOUT_MS;
  const remainingMs = () => Math.max(0, deadline - Date.now());

  const first = await fetchPhotonRaw(primaryQuery, fetchLimit, typedNum, remainingMs());
  addUnique(first.features);

  const hasExactStreetAndSuburbHit = () =>
    merged.some((f) => featureHasStreet(f) && matchesSuburb(f, typedSuburb) && matchesStreetStem(f, streetStem));

  // Fallback 1: query the expanded street + suburb without house number ("Ekibin Road East Annerley" / "Cracknell Road Tarragindi")
  // Never retry if Photon hung/timed out so total wait stays bounded by PHOTON_TIMEOUT_MS.
  let aborted = first.timedOut;
  if (!aborted && streetOnly && !hasExactStreetAndSuburbHit() && remainingMs() > 250) {
    const expandedStreet = expandRoadAbbreviations(streetOnly);
    const fb1 = await fetchPhotonRaw(expandedStreet, fetchLimit, typedNum, remainingMs());
    addUnique(fb1.features);
    aborted = fb1.timedOut;
  }

  // Fallback 2: drop directional suffix ("Ekibin Road East Annerley" -> "Ekibin Road Annerley") if OSM indexes base road
  if (!aborted && streetOnly && !hasExactStreetAndSuburbHit() && remainingMs() > 250) {
    const expanded = expandRoadAbbreviations(streetOnly);
    const baseRoad = expanded.replace(/\b(East|West|North|South)\b\s*/gi, "").replace(/\s+/g, " ").trim();
    if (baseRoad.length >= 3 && baseRoad.toLowerCase() !== expanded.toLowerCase()) {
      const fb2 = await fetchPhotonRaw(baseRoad, fetchLimit, typedNum, remainingMs());
      addUnique(fb2.features);
    }
  }

  return merged
    .sort((a, b) => {
      if (streetStem) {
        const aSt = matchesStreetStem(a, streetStem) ? 0 : 1;
        const bSt = matchesStreetStem(b, streetStem) ? 0 : 1;
        if (aSt !== bSt) return aSt - bSt;
      }
      if (typedSuburb) {
        const aSub = matchesSuburb(a, typedSuburb) ? 0 : 1;
        const bSub = matchesSuburb(b, typedSuburb) ? 0 : 1;
        if (aSub !== bSub) return aSub - bSub;
      }
      const aHasStreet = a.properties.street ? 0 : 1;
      const bHasStreet = b.properties.street ? 0 : 1;
      if (aHasStreet !== bHasStreet) return aHasStreet - bHasStreet;
      const aExact =
        bareHouseNum && a.properties.housenumber?.toLowerCase() === bareHouseNum.toLowerCase() ? 0 : 1;
      const bExact =
        bareHouseNum && b.properties.housenumber?.toLowerCase() === bareHouseNum.toLowerCase() ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      const ah = a.properties.housenumber ? 0 : 1;
      const bh = b.properties.housenumber ? 0 : 1;
      return ah - bh;
    })
    .slice(0, limit);
}

/** One-shot geocode: returns the best matching AU street/place, or null. */
export async function geocodeAddress(query: string): Promise<AddressSelection | null> {
  const features = await searchPhoton(query, 6);
  const f = features[0];
  if (!f) return null;
  const fallbackStreet =
    !f.properties.street && f.properties.name && !BUS_STOP_NAME_RE.test(f.properties.name.trim())
      ? f.properties.name
      : undefined;
  return {
    address: formatPhotonAddress(f.properties, query),
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    suburb: suburbFromPhoton(f.properties),
    street: f.properties.street ?? fallbackStreet,
  };
}
