"use client";

import { useState, useEffect, useRef } from "react";
import {
  formatPhotonAddress,
  geocodeAddress,
  PHOTON_TIMEOUT_MS,
  searchPhoton,
  suburbFromPhoton,
  type AddressSelection,
  type PhotonFeature,
} from "@/lib/photon";

export { geocodeAddress, PHOTON_TIMEOUT_MS, suburbFromPhoton, type AddressSelection };

interface AddressAutocompleteProps {
  id?: string;
  ariaLabel?: string;
  value: string;
  onChange: (text: string) => void;
  onSelect: (sel: AddressSelection) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

export function AddressAutocomplete({ id, ariaLabel, value, onChange, onSelect, placeholder, autoFocus, className }: AddressAutocompleteProps) {
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
      address: formatPhotonAddress(f.properties),
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      suburb: suburbFromPhoton(f.properties),
      street: f.properties.street,
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
        id={id}
        aria-label={ariaLabel}
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
            const text = formatPhotonAddress(f.properties);
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
