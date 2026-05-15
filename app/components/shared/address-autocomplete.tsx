"use client";

import { useState, useEffect, useRef } from "react";

// Photon (komoot) is OSM-based and free with no API key. We bias results
// toward Brisbane and filter to AU only.
const PHOTON_URL = "https://photon.komoot.io/api/";
const BRISBANE = { lat: -27.4698, lon: 153.0251 };

interface PhotonProps {
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

interface PhotonFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: PhotonProps;
}

export interface AddressSelection {
  address: string;
  lat: number;
  lng: number;
}

function formatAddress(p: PhotonProps): string {
  const street = [p.housenumber, p.street].filter(Boolean).join(" ");
  const locality = p.city ?? p.district ?? "";
  const tail = [locality, p.state, p.postcode].filter(Boolean).join(" ");
  return [street || p.name, tail].filter(Boolean).join(", ");
}

async function searchPhoton(query: string, limit = 6): Promise<PhotonFeature[]> {
  if (query.trim().length < 3) return [];
  const url = `${PHOTON_URL}?q=${encodeURIComponent(query)}&limit=${limit}&lang=en&lat=${BRISBANE.lat}&lon=${BRISBANE.lon}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json() as { features?: PhotonFeature[] };
  return (data.features ?? []).filter((f) => f.properties.countrycode === "AU");
}

/** One-shot geocode: returns the first matching AU place, or null. */
export async function geocodeAddress(query: string): Promise<AddressSelection | null> {
  const features = await searchPhoton(query, 1);
  const f = features[0];
  if (!f) return null;
  return {
    address: formatAddress(f.properties),
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  };
}

interface AddressAutocompleteProps {
  value: string;
  onChange: (text: string) => void;
  onSelect: (sel: AddressSelection) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

export function AddressAutocomplete({ value, onChange, onSelect, placeholder, autoFocus, className }: AddressAutocompleteProps) {
  const [results, setResults] = useState<PhotonFeature[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastQueryRef = useRef("");

  useEffect(() => {
    const q = value.trim();
    if (q === lastQueryRef.current) return;
    lastQueryRef.current = q;
    if (q.length < 3) { setResults([]); setOpen(false); return; }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const features = await searchPhoton(q);
      if (cancelled) return;
      setResults(features);
      setOpen(features.length > 0);
      setHighlight(0);
      setLoading(false);
    }, 250);
    return () => { cancelled = true; clearTimeout(t); setLoading(false); };
  }, [value]);

  // Close on outside click
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function pick(f: PhotonFeature) {
    const sel: AddressSelection = {
      address: formatAddress(f.properties),
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
    };
    onChange(sel.address);
    onSelect(sel);
    setOpen(false);
    setResults([]);
    inputRef.current?.blur();
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => { if (results.length > 0) setOpen(true); }}
        onKeyDown={(e) => {
          if (!open || results.length === 0) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, results.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); pick(results[highlight]); }
          else if (e.key === "Escape") { setOpen(false); }
        }}
        placeholder={placeholder ?? "Start typing your address…"}
        autoFocus={autoFocus}
        autoComplete="off"
        className={className ?? "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-base text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500"}
      />
      {open && results.length > 0 && (
        <ul className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 max-h-72 overflow-y-auto">
          {results.map((f, i) => {
            const text = formatAddress(f.properties);
            return (
              <li
                key={`${f.geometry.coordinates[0]},${f.geometry.coordinates[1]},${i}`}
                onMouseDown={(e) => { e.preventDefault(); pick(f); }}
                onMouseEnter={() => setHighlight(i)}
                className={`px-4 py-2.5 text-[13px] cursor-pointer ${i === highlight ? "bg-green-50 text-green-700" : "text-slate-700"}`}
              >
                {text}
              </li>
            );
          })}
        </ul>
      )}
      {loading && value.trim().length >= 3 && results.length === 0 && (
        <p className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">Searching…</p>
      )}
    </div>
  );
}
