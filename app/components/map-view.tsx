"use client";

import {
  createContext,
  useContext,
  useRef,
  useEffect,
  useState,
  useCallback,
  Component,
  type ReactNode,
} from "react";
import { setOptions as setMapsOptions, importLibrary } from "@googlemaps/js-api-loader";
import { AlertTriangle } from "lucide-react";
import type { Bin } from "@/lib/store";

// ── Types ──

export type AppMode = "sort" | "run";

interface LatLng {
  lat: number;
  lng: number;
}

// ── Constants ──

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const BRISBANE_CENTER: LatLng = { lat: -27.482, lng: 153.021 };

// Clean light map style
const MAP_STYLES: google.maps.MapTypeStyle[] = [
  { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "transit", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry.fill", stylers: [{ color: "#d4e8f7" }] },
  { featureType: "landscape", elementType: "geometry.fill", stylers: [{ color: "#f5f5f5" }] },
  { featureType: "road", elementType: "geometry.fill", stylers: [{ color: "#ffffff" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#e0e0e0" }] },
  { featureType: "road.highway", elementType: "geometry.fill", stylers: [{ color: "#f0f0f0" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#999999" }] },
  { featureType: "administrative", elementType: "labels.text.fill", stylers: [{ color: "#999999" }] },
];

// ── Maps API Loader ──

let _loaderP: Promise<void> | null = null;
function loadMapsApi() {
  if (!_loaderP && MAPS_KEY) {
    setMapsOptions({ key: MAPS_KEY, v: "weekly" });
    _loaderP = Promise.all([
      importLibrary("maps"),
      importLibrary("marker"),
    ]).then(() => {});
  }
  return _loaderP ?? Promise.resolve();
}

// ── Map Context ──

const MapContext = createContext<google.maps.Map | null>(null);
function useMap() {
  return useContext(MapContext);
}

function GoogleMapsProvider({ children }: { children: ReactNode }) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);

  useEffect(() => {
    loadMapsApi().then(() => {
      if (!divRef.current || mapRef.current) return;
      const m = new google.maps.Map(divRef.current, {
        center: BRISBANE_CENTER,
        zoom: 14,
        gestureHandling: "greedy",
        disableDefaultUI: true,
        zoomControl: true,
        zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_TOP },
        styles: MAP_STYLES,
        backgroundColor: "#f5f5f5",
      });
      mapRef.current = m;
      setMap(m);
    });
  }, []);

  return (
    <MapContext.Provider value={map}>
      <div ref={divRef} className="absolute inset-0 z-0" />
      {map && children}
    </MapContext.Provider>
  );
}

// ── Auto Locate ──

function AutoLocate({ onLocated }: { onLocated: (loc: LatLng) => void }) {
  const map = useMap();
  const attempted = useRef(false);

  useEffect(() => {
    if (!map || attempted.current) return;
    attempted.current = true;
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        map.panTo(loc);
        map.setZoom(14);
        onLocated(loc);
      },
      () => {
        // Permission denied or unavailable — stay on Brisbane center
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
    );
  }, [map, onLocated]);

  return null;
}

// ── User Location Marker ──

function UserLocationMarker({ loc }: { loc: LatLng }) {
  const map = useMap();
  const markerRef = useRef<google.maps.Marker | null>(null);

  useEffect(() => {
    if (!map) return;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="#3b82f6" opacity="0.2"/><circle cx="12" cy="12" r="6" fill="#3b82f6" stroke="#fff" stroke-width="2.5"/></svg>`;
    if (!markerRef.current) {
      markerRef.current = new google.maps.Marker({
        map,
        position: loc,
        zIndex: 9999,
        icon: {
          url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
          scaledSize: new google.maps.Size(24, 24),
          anchor: new google.maps.Point(12, 12),
        },
      });
    } else {
      markerRef.current.setPosition(loc);
    }
    return () => {
      if (markerRef.current) {
        markerRef.current.setMap(null);
        markerRef.current = null;
      }
    };
  }, [map, loc]);

  return null;
}

// ── Bin Markers ──

function getBinColor(bin: Bin, mode: AppMode): string {
  if (mode === "run") return "#22c55e";
  if (bin.fillPercent >= 80) return "#ef4444";
  if (bin.fillPercent >= 50) return "#f59e0b";
  return "#22c55e";
}

function binMarkerSvg(bin: Bin, mode: AppMode, isSelected: boolean): string {
  const color = getBinColor(bin, mode);
  const size = isSelected ? 48 : 42;
  const borderColor = isSelected ? "#16a34a" : "#ffffff";
  const borderWidth = isSelected ? 3 : 2.5;
  const r = size / 2;
  const inner = r - borderWidth;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <circle cx="${r}" cy="${r}" r="${inner}" fill="${color}" stroke="${borderColor}" stroke-width="${borderWidth}"/>
    <text x="${r}" y="${r + 4}" text-anchor="middle" fill="#fff" font-size="11" font-weight="800" font-family="Inter,system-ui,sans-serif">${bin.fillPercent}%</text>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function BinMarkers({
  bins,
  mode,
  selectedBinId,
  onSelect,
}: {
  bins: Bin[];
  mode: AppMode;
  selectedBinId: string | null;
  onSelect: (binId: string) => void;
}) {
  const map = useMap();
  const markersRef = useRef<Map<string, { marker: google.maps.Marker; url: string }>>(new Map());

  const visibleBins = mode === "run"
    ? bins.filter((b) => b.fillPercent >= 80 && b.status !== "claimed" && b.status !== "collected")
    : bins.filter((b) => b.status !== "collected");

  useEffect(() => {
    if (!map) return;

    const prev = markersRef.current;
    const nextIds = new Set(visibleBins.map((b) => b.id));

    // Remove markers no longer visible
    for (const [id, entry] of prev) {
      if (!nextIds.has(id)) {
        entry.marker.setMap(null);
        prev.delete(id);
      }
    }

    // Add or update markers
    for (const bin of visibleBins) {
      const isSelected = bin.id === selectedBinId;
      const url = binMarkerSvg(bin, mode, isSelected);
      const existing = prev.get(bin.id);

      if (existing && existing.url === url) continue;
      if (existing) existing.marker.setMap(null);

      const size = isSelected ? 48 : 42;
      const marker = new google.maps.Marker({
        map,
        position: { lat: bin.lat, lng: bin.lng },
        zIndex: isSelected ? 1000 : bin.fillPercent,
        icon: {
          url,
          scaledSize: new google.maps.Size(size, size),
          anchor: new google.maps.Point(size / 2, size / 2),
        },
      });
      marker.addListener("click", () => onSelect(bin.id));
      prev.set(bin.id, { marker, url });
    }

    return () => {
      prev.forEach((e) => e.marker.setMap(null));
      prev.clear();
    };
  }, [map, visibleBins, mode, selectedBinId, onSelect]);

  return null;
}

// ── Error Boundary ──

class MapErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="absolute inset-0 bg-white flex items-center justify-center">
          <div className="text-center px-6 max-w-md">
            <AlertTriangle size={48} className="text-amber-500 mx-auto mb-4" />
            <p className="text-slate-900 font-display font-bold text-lg mb-2">Map failed to load</p>
            <p className="text-slate-500 text-sm mb-4">{this.state.error.message}</p>
            <button
              onClick={() => this.setState({ error: null })}
              className="px-5 py-2.5 rounded-xl bg-green-500 text-black font-bold text-sm hover:bg-green-400 transition-colors shadow-lg shadow-green-500/25"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── No API Key Fallback ──

function NoApiKeyFallback() {
  return (
    <div className="absolute inset-0 bg-white flex items-center justify-center">
      <div className="text-center px-6 max-w-sm">
        <div className="w-16 h-16 bg-neutral-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg width="32" height="32" fill="none" stroke="#525252" strokeWidth="1.5">
            <circle cx="16" cy="14" r="6" />
            <path d="M16 20v2M8 28c0-4.4 3.6-8 8-8s8 3.6 8 8" />
          </svg>
        </div>
        <p className="text-slate-900 font-display font-bold text-lg mb-2">Map requires API key</p>
        <p className="text-slate-500 text-sm">
          Set <code className="text-neutral-400 bg-neutral-800 px-1.5 py-0.5 rounded text-xs">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> in your environment
        </p>
      </div>
    </div>
  );
}

// ── Main Export ──

interface MapViewProps {
  mode: AppMode;
  bins: Bin[];
  selectedBinId: string | null;
  onBinSelect: (binId: string) => void;
  onMapTap: () => void;
}

export function MapView({ mode, bins, selectedBinId, onBinSelect, onMapTap }: MapViewProps) {
  const [userLoc, setUserLoc] = useState<LatLng | null>(null);

  const handleLocated = useCallback((loc: LatLng) => {
    setUserLoc(loc);
  }, []);

  if (!MAPS_KEY) {
    return <NoApiKeyFallback />;
  }

  return (
    <MapErrorBoundary>
      <GoogleMapsProvider>
        <MapClickHandler onMapTap={onMapTap} />
        <AutoLocate onLocated={handleLocated} />
        {userLoc && <UserLocationMarker loc={userLoc} />}
        <BinMarkers
          bins={bins}
          mode={mode}
          selectedBinId={selectedBinId}
          onSelect={onBinSelect}
        />
      </GoogleMapsProvider>
    </MapErrorBoundary>
  );
}

// ── Map Click Handler ──

function MapClickHandler({ onMapTap }: { onMapTap: () => void }) {
  const map = useMap();
  const cbRef = useRef(onMapTap);
  cbRef.current = onMapTap;

  useEffect(() => {
    if (!map) return;
    const listener = map.addListener("click", () => cbRef.current());
    return () => google.maps.event.removeListener(listener);
  }, [map]);

  return null;
}
