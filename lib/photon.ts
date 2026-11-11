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

export function formatPhotonAddress(p: PhotonProps): string {
  const street = [p.housenumber, p.street].filter(Boolean).join(" ");
  const locality = suburbFromPhoton(p) ?? "";
  const state = /^queensland$/i.test(p.state ?? "") ? "QLD" : (p.state ?? "");
  const tail = [locality, state, p.postcode].filter(Boolean).join(" ");
  return [street || p.name, tail].filter(Boolean).join(", ");
}

export async function searchPhoton(query: string, limit = 6): Promise<PhotonFeature[]> {
  if (query.trim().length < 3) return [];
  const url = `${PHOTON_URL}?q=${encodeURIComponent(query)}&limit=${limit}&lang=en&lat=${BRISBANE.lat}&lon=${BRISBANE.lon}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PHOTON_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return [];
    const data = await res.json() as { features?: PhotonFeature[] };
    const au = (data.features ?? []).filter((f) => f.properties.countrycode === "AU");
    // Street-only Photon hits miss BCC house-level days. Numbered houses first.
    return au.sort((a, b) => {
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
  const features = await searchPhoton(query, 1);
  const f = features[0];
  if (!f) return null;
  return {
    address: formatPhotonAddress(f.properties),
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    suburb: suburbFromPhoton(f.properties),
    street: f.properties.street,
  };
}
