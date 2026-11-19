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

/** Photon sets city=Brisbane and district=the suburb. City-wide "Brisbane" must never be the cluster. */
export function suburbFromPhoton(p: PhotonProps): string | undefined {
  const district = (p.district ?? "").trim();
  const city = (p.city ?? "").trim();
  if (district && (!city || /^brisbane$/i.test(city))) return district;
  if (/^brisbane city$/i.test(city)) return city;
  if (city && !/^brisbane$/i.test(city) && !/^queensland$/i.test(city)) return city;
  return district || undefined;
}

const LEADING_STREET_NUMBER_RE =
  /^\s*(?:(?:unit|apt|apartment|flat|lot|shop|villa|townhouse|level|lvl|suite|u)\s*([a-z0-9]+)\s*[\/,\s-]+\s*)?(\d+[a-z]?(?:\s*[\/-]\s*\d+[a-z]?)?)\s+([a-z][a-z0-9\s'.-]{1,})/i;

const BUS_STOP_NAME_RE = /^(?:stop\s+\d+|platform\s+\d+|station\b)/i;

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

export async function searchPhoton(query: string, limit = 6): Promise<PhotonFeature[]> {
  if (query.trim().length < 3) return [];
  const typedNum = extractLeadingStreetNumber(query);
  const url = `${PHOTON_URL}?q=${encodeURIComponent(query)}&limit=${limit}&lang=en&lat=${BRISBANE.lat}&lon=${BRISBANE.lon}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PHOTON_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return [];
    const data = await res.json() as { features?: PhotonFeature[] };
    const au = (data.features ?? []).filter((f) => {
      if (f.properties.countrycode !== "AU") return false;
      if (typedNum && !f.properties.street && BUS_STOP_NAME_RE.test((f.properties.name ?? "").trim())) {
        return false;
      }
      return true;
    });
    // Exact house-number match first, then any street hit, then POI fallback.
    return au.sort((a, b) => {
      const aExact = typedNum && a.properties.housenumber?.toLowerCase() === typedNum.toLowerCase() ? 0 : 1;
      const bExact = typedNum && b.properties.housenumber?.toLowerCase() === typedNum.toLowerCase() ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      const aHasStreet = a.properties.street ? 0 : 1;
      const bHasStreet = b.properties.street ? 0 : 1;
      if (aHasStreet !== bHasStreet) return aHasStreet - bHasStreet;
      const ah = a.properties.housenumber ? 0 : 1;
      const bh = b.properties.housenumber ? 0 : 1;
      return ah - bh;
    });
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** One-shot geocode: returns the first matching AU place, or null. */
export async function geocodeAddress(query: string): Promise<AddressSelection | null> {
  const features = await searchPhoton(query, 4);
  const f = features[0];
  if (!f) return null;
  return {
    address: formatPhotonAddress(f.properties, query),
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    suburb: suburbFromPhoton(f.properties),
    street: f.properties.street,
  };
}
