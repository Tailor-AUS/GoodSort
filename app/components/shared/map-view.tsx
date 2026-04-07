"use client";

import {
  createContext, useContext, useRef, useEffect, useState, useCallback,
  Component, type ReactNode,
} from "react";
import { setOptions as setMapsOptions, importLibrary } from "@googlemaps/js-api-loader";
import { AlertTriangle } from "lucide-react";
import type { SortBin, Route, Depot } from "@/lib/store";

export type AppMode = "sort" | "collect";

interface LatLng { lat: number; lng: number; }

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const BRISBANE_CENTER: LatLng = { lat: -27.482, lng: 153.021 };

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
    _loaderP = Promise.all([importLibrary("maps"), importLibrary("marker"), importLibrary("routes")]).then(() => {});
  }
  return _loaderP ?? Promise.resolve();
}

// ── Map Context ──

const MapContext = createContext<google.maps.Map | null>(null);
function useMap() { return useContext(MapContext); }

function GoogleMapsProvider({ children }: { children: ReactNode }) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);

  useEffect(() => {
    loadMapsApi().then(() => {
      if (!divRef.current || mapRef.current) return;
      const m = new google.maps.Map(divRef.current, {
        center: BRISBANE_CENTER, zoom: 14,
        gestureHandling: "greedy", disableDefaultUI: true, zoomControl: true,
        zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_TOP },
        styles: MAP_STYLES, backgroundColor: "#f5f5f5",
      });
      mapRef.current = m;
      setMap(m);
    }).catch((err) => { console.error("Google Maps failed:", err); });
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
      (pos) => { const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }; map.panTo(loc); map.setZoom(15); onLocated(loc); },
      () => {},
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
        map, position: loc, zIndex: 9999,
        icon: { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`, scaledSize: new google.maps.Size(24, 24), anchor: new google.maps.Point(12, 12) },
      });
    } else { markerRef.current.setPosition(loc); }
    return () => { if (markerRef.current) { markerRef.current.setMap(null); markerRef.current = null; } };
  }, [map, loc]);
  return null;
}

// ── Bin Markers ──

function getBinColor(bin: SortBin): string {
  if (bin.status === "full") return "#ef4444";
  if (bin.pendingContainers >= 200) return "#ef4444";
  if (bin.pendingContainers >= 50) return "#f59e0b";
  return "#16a34a";
}

function binMarkerSvg(bin: SortBin, isSelected: boolean): string {
  const color = getBinColor(bin);
  const size = isSelected ? 52 : 44;
  const borderColor = isSelected ? "#16a34a" : "#ffffff";
  const borderWidth = isSelected ? 3 : 2.5;
  const r = size / 2;
  const inner = r - borderWidth;

  // Recycling icon + bin code
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size + 16}">
    <circle cx="${r}" cy="${r}" r="${inner}" fill="${color}" stroke="${borderColor}" stroke-width="${borderWidth}"/>
    <text x="${r}" y="${r - 2}" text-anchor="middle" fill="#fff" font-size="16">♻</text>
    <text x="${r}" y="${r + 12}" text-anchor="middle" fill="#fff" font-size="8" font-weight="700" font-family="Inter,system-ui,sans-serif">${bin.pendingContainers}</text>
    <rect x="${r - 18}" y="${size + 1}" width="36" height="14" rx="7" fill="${color}" opacity="0.9"/>
    <text x="${r}" y="${size + 11}" text-anchor="middle" fill="#fff" font-size="8" font-weight="700" font-family="Inter,system-ui,sans-serif">${bin.code}</text>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function BinMarkers({
  bins, selectedId, onSelect,
}: {
  bins: SortBin[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const map = useMap();
  const markersRef = useRef<Map<string, { marker: google.maps.Marker; url: string }>>(new Map());

  const visible = bins.filter((b) => b.status !== "disabled" && b.status !== "collected");

  useEffect(() => {
    if (!map) return;
    const prev = markersRef.current;
    const nextIds = new Set(visible.map((b) => b.id));

    for (const [id, entry] of prev) {
      if (!nextIds.has(id)) { entry.marker.setMap(null); prev.delete(id); }
    }

    for (const bin of visible) {
      const isSelected = bin.id === selectedId;
      const url = binMarkerSvg(bin, isSelected);
      const existing = prev.get(bin.id);
      if (existing && existing.url === url) continue;
      if (existing) existing.marker.setMap(null);

      const size = isSelected ? 52 : 44;
      const marker = new google.maps.Marker({
        map,
        position: { lat: bin.lat, lng: bin.lng },
        zIndex: isSelected ? 1000 : bin.pendingContainers,
        icon: { url, scaledSize: new google.maps.Size(size, size + 16), anchor: new google.maps.Point(size / 2, size / 2) },
      });
      marker.addListener("click", () => onSelect(bin.id));
      prev.set(bin.id, { marker, url });
    }

    return () => { prev.forEach((e) => e.marker.setMap(null)); prev.clear(); };
  }, [map, visible, selectedId, onSelect]);

  return null;
}

// ── Route Line ──

function RouteLine({ route, depot }: { route: Route | null; depot: Depot | null }) {
  const map = useMap();
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const depotMarkerRef = useRef<google.maps.Marker | null>(null);

  useEffect(() => {
    if (polylineRef.current) { polylineRef.current.setMap(null); polylineRef.current = null; }
    if (depotMarkerRef.current) { depotMarkerRef.current.setMap(null); depotMarkerRef.current = null; }
    if (!map || !route || !depot) return;

    const path = route.stops.sort((a, b) => a.sequence - b.sequence).map((s) => ({ lat: s.lat, lng: s.lng }));
    path.push({ lat: depot.lat, lng: depot.lng });

    polylineRef.current = new google.maps.Polyline({ map, path, strokeColor: "#16a34a", strokeWeight: 4, strokeOpacity: 0.7 });

    const depotSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect x="4" y="4" width="24" height="24" rx="4" fill="#16a34a" stroke="#fff" stroke-width="2"/><text x="16" y="20" text-anchor="middle" fill="#fff" font-size="12" font-weight="800">D</text></svg>`;
    depotMarkerRef.current = new google.maps.Marker({
      map, position: { lat: depot.lat, lng: depot.lng }, zIndex: 2000,
      icon: { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(depotSvg)}`, scaledSize: new google.maps.Size(32, 32), anchor: new google.maps.Point(16, 16) },
    });

    return () => {
      if (polylineRef.current) { polylineRef.current.setMap(null); polylineRef.current = null; }
      if (depotMarkerRef.current) { depotMarkerRef.current.setMap(null); depotMarkerRef.current = null; }
    };
  }, [map, route, depot]);

  return null;
}

// ── Map Click Handler ──

function MapClickHandler({ onMapTap }: { onMapTap: () => void }) {
  const map = useMap();
  const cbRef = useRef(onMapTap);
  cbRef.current = onMapTap;
  useEffect(() => {
    if (!map) return;
    const l = map.addListener("click", () => cbRef.current());
    return () => google.maps.event.removeListener(l);
  }, [map]);
  return null;
}

// ── Error Boundary + Fallback ──

class MapErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="absolute inset-0 bg-white flex items-center justify-center">
          <div className="text-center px-6 max-w-md">
            <AlertTriangle size={48} className="text-amber-500 mx-auto mb-4" />
            <p className="text-slate-900 font-display font-bold text-lg mb-2">Map failed to load</p>
            <p className="text-slate-500 text-sm mb-4">{this.state.error.message}</p>
            <button onClick={() => this.setState({ error: null })} className="px-5 py-2.5 rounded-xl bg-green-600 text-white font-bold text-sm hover:bg-green-500 transition-colors shadow-lg shadow-green-600/25">Try Again</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function NoApiKeyFallback() {
  return (
    <div className="absolute inset-0 bg-white flex items-center justify-center">
      <div className="text-center px-6 max-w-sm">
        <p className="text-slate-900 font-display font-bold text-lg mb-2">Map requires API key</p>
        <p className="text-slate-500 text-sm">Set <code className="text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded text-xs">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code></p>
      </div>
    </div>
  );
}

// ── Main Export ──

interface MapViewProps {
  mode: AppMode;
  bins: SortBin[];
  selectedBinId: string | null;
  activeRoute: Route | null;
  depot: Depot | null;
  onBinSelect: (id: string) => void;
  onMapTap: () => void;
}

export function MapView({ mode, bins, selectedBinId, activeRoute, depot, onBinSelect, onMapTap }: MapViewProps) {
  const [userLoc, setUserLoc] = useState<LatLng | null>(null);
  const handleLocated = useCallback((loc: LatLng) => setUserLoc(loc), []);

  if (!MAPS_KEY) return <NoApiKeyFallback />;

  return (
    <MapErrorBoundary>
      <GoogleMapsProvider>
        <MapClickHandler onMapTap={onMapTap} />
        <AutoLocate onLocated={handleLocated} />
        {userLoc && <UserLocationMarker loc={userLoc} />}
        <BinMarkers bins={bins} selectedId={selectedBinId} onSelect={onBinSelect} />
        {activeRoute && <RouteLine route={activeRoute} depot={depot} />}
      </GoogleMapsProvider>
    </MapErrorBoundary>
  );
}
