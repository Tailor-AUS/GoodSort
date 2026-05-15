"use client";

import {
  createContext, useContext, useRef, useEffect, useState, useCallback,
  Component, type ReactNode,
} from "react";
import maplibregl, { Map as MLMap, Marker as MLMarker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { AlertTriangle } from "lucide-react";
import type { SortBin, Route, Depot } from "@/lib/store";
import type { RunStopDetail } from "@/lib/marketplace";

export interface RunCentroid {
  id: string;
  lat: number;
  lng: number;
  label: string;
  containers: number;
  pricingTier: number;
}

export type AppMode = "sort" | "collect";

interface LatLng { lat: number; lng: number; }

const BRISBANE_CENTER: LatLng = { lat: -27.482, lng: 153.021 };

// OpenFreeMap "Liberty" style — OSM-based vector tiles, free, no API key.
// Run by the OpenFreeMap project (founded by the MapTiler founder).
const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

// ── Map error registry (shared across MapView instances) ──

let _mapsError: string | null = null;
const _mapsErrorListeners = new Set<(e: string) => void>();
function emitMapsError(code: string) {
  _mapsError = code;
  _mapsErrorListeners.forEach((l) => l(code));
}
function getMapsError() { return _mapsError; }
function subscribeMapsError(l: (e: string) => void) {
  _mapsErrorListeners.add(l);
  return () => { _mapsErrorListeners.delete(l); };
}

function useMapsError(): string | null {
  const [err, setErr] = useState<string | null>(getMapsError());
  useEffect(() => subscribeMapsError(setErr), []);
  return err;
}

// ── Map Context ──

const MapContext = createContext<MLMap | null>(null);
function useMap() { return useContext(MapContext); }

function MapProvider({ children, onMapTap }: { children: ReactNode; onMapTap?: () => void }) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [map, setMap] = useState<MLMap | null>(null);
  const tapRef = useRef(onMapTap);
  tapRef.current = onMapTap;

  useEffect(() => {
    if (!divRef.current || mapRef.current) return;
    const m = new maplibregl.Map({
      container: divRef.current,
      style: MAP_STYLE_URL,
      center: [BRISBANE_CENTER.lng, BRISBANE_CENTER.lat],
      zoom: 13,
      attributionControl: { compact: true },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("click", () => tapRef.current?.());
    m.on("error", (e) => {
      // OpenFreeMap or network issue. Surface a generic failure code.
      const message = (e?.error?.message ?? "").toLowerCase();
      if (message.includes("failed to fetch") || message.includes("network")) {
        emitMapsError("NetworkError");
      } else if (message.includes("style")) {
        emitMapsError("StyleLoadError");
      }
    });
    m.once("load", () => {
      mapRef.current = m;
      setMap(m);
    });

    return () => {
      m.remove();
      mapRef.current = null;
    };
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
        map.flyTo({ center: [loc.lng, loc.lat], zoom: 15, duration: 800 });
        onLocated(loc);
      },
      () => {},
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
    );
  }, [map, onLocated]);
  return null;
}

// ── Marker helpers ──

function svgMarker(svg: string): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = "line-height:0; pointer-events:auto;";
  el.innerHTML = svg;
  return el;
}

// ── User Location Marker ──

function UserLocationMarker({ loc }: { loc: LatLng }) {
  const map = useMap();
  const markerRef = useRef<MLMarker | null>(null);
  useEffect(() => {
    if (!map) return;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="#3b82f6" opacity="0.2"/><circle cx="12" cy="12" r="6" fill="#3b82f6" stroke="#fff" stroke-width="2.5"/></svg>`;
    if (!markerRef.current) {
      markerRef.current = new maplibregl.Marker({ element: svgMarker(svg), anchor: "center" })
        .setLngLat([loc.lng, loc.lat])
        .addTo(map);
    } else {
      markerRef.current.setLngLat([loc.lng, loc.lat]);
    }
    return () => { markerRef.current?.remove(); markerRef.current = null; };
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

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size + 16}">
    <circle cx="${r}" cy="${r}" r="${inner}" fill="${color}" stroke="${borderColor}" stroke-width="${borderWidth}"/>
    <text x="${r}" y="${r - 2}" text-anchor="middle" fill="#fff" font-size="16">♻</text>
    <text x="${r}" y="${r + 12}" text-anchor="middle" fill="#fff" font-size="8" font-weight="700" font-family="Inter,system-ui,sans-serif">${bin.pendingContainers}</text>
    <rect x="${r - 18}" y="${size + 1}" width="36" height="14" rx="7" fill="${color}" opacity="0.9"/>
    <text x="${r}" y="${size + 11}" text-anchor="middle" fill="#fff" font-size="8" font-weight="700" font-family="Inter,system-ui,sans-serif">${bin.code}</text>
  </svg>`;
}

function BinMarkers({
  bins, selectedId, onSelect,
}: {
  bins: SortBin[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const map = useMap();
  const markersRef = useRef<Map<string, { marker: MLMarker; svg: string }>>(new Map());

  const visible = bins.filter((b) => b.status !== "disabled" && b.status !== "collected");

  useEffect(() => {
    if (!map) return;
    const prev = markersRef.current;
    const nextIds = new Set(visible.map((b) => b.id));

    for (const [id, entry] of prev) {
      if (!nextIds.has(id)) { entry.marker.remove(); prev.delete(id); }
    }

    for (const bin of visible) {
      const isSelected = bin.id === selectedId;
      const svg = binMarkerSvg(bin, isSelected);
      const existing = prev.get(bin.id);
      if (existing && existing.svg === svg) continue;
      if (existing) existing.marker.remove();

      const el = svgMarker(svg);
      el.style.cursor = "pointer";
      el.addEventListener("click", (e) => { e.stopPropagation(); onSelect(bin.id); });
      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([bin.lng, bin.lat])
        .addTo(map);
      prev.set(bin.id, { marker, svg });
    }

    return () => { prev.forEach((e) => e.marker.remove()); prev.clear(); };
  }, [map, visible, selectedId, onSelect]);

  return null;
}

// ── Route Line ──

const ROUTE_SOURCE_ID = "goodsort-route";
const ROUTE_LAYER_ID = "goodsort-route-line";

function RouteLine({ route, depot }: { route: Route | null; depot: Depot | null }) {
  const map = useMap();
  const depotMarkerRef = useRef<MLMarker | null>(null);

  useEffect(() => {
    if (!map) return;
    // Tear down any previous render.
    if (map.getLayer(ROUTE_LAYER_ID)) map.removeLayer(ROUTE_LAYER_ID);
    if (map.getSource(ROUTE_SOURCE_ID)) map.removeSource(ROUTE_SOURCE_ID);
    if (depotMarkerRef.current) { depotMarkerRef.current.remove(); depotMarkerRef.current = null; }
    if (!route || !depot) return;

    const ordered = [...route.stops].sort((a, b) => a.sequence - b.sequence);
    const coords: [number, number][] = ordered.map((s) => [s.lng, s.lat]);
    coords.push([depot.lng, depot.lat]);

    map.addSource(ROUTE_SOURCE_ID, {
      type: "geojson",
      data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } },
    });
    map.addLayer({
      id: ROUTE_LAYER_ID,
      type: "line",
      source: ROUTE_SOURCE_ID,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#16a34a", "line-width": 4, "line-opacity": 0.7 },
    });

    const depotSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect x="4" y="4" width="24" height="24" rx="4" fill="#16a34a" stroke="#fff" stroke-width="2"/><text x="16" y="20" text-anchor="middle" fill="#fff" font-size="12" font-weight="800">D</text></svg>`;
    depotMarkerRef.current = new maplibregl.Marker({ element: svgMarker(depotSvg), anchor: "center" })
      .setLngLat([depot.lng, depot.lat])
      .addTo(map);

    return () => {
      if (map.getLayer(ROUTE_LAYER_ID)) map.removeLayer(ROUTE_LAYER_ID);
      if (map.getSource(ROUTE_SOURCE_ID)) map.removeSource(ROUTE_SOURCE_ID);
      depotMarkerRef.current?.remove();
      depotMarkerRef.current = null;
    };
  }, [map, route, depot]);

  return null;
}

// ── Centroid Bubbles (privacy-safe area markers for marketplace runs) ──

const CENTROID_SOURCE_ID = "goodsort-centroids";
const CENTROID_LAYER_ID = "goodsort-centroids-fill";

// Approximate a 500m radius circle as a 64-vertex polygon in GeoJSON.
function circlePolygon(lng: number, lat: number, radiusMeters: number, steps = 64): [number, number][] {
  const coords: [number, number][] = [];
  const earthRadius = 6378137;
  const latRad = (lat * Math.PI) / 180;
  const dLat = (radiusMeters / earthRadius) * (180 / Math.PI);
  const dLng = ((radiusMeters / earthRadius) * (180 / Math.PI)) / Math.cos(latRad);
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * 2 * Math.PI;
    coords.push([lng + dLng * Math.cos(theta), lat + dLat * Math.sin(theta)]);
  }
  return coords;
}

function tierColor(tier: number): string {
  return tier >= 4 ? "#f59e0b" : tier >= 3 ? "#16a34a" : "#3b82f6";
}

function CentroidBubbles({ centroids }: { centroids: RunCentroid[] }) {
  const map = useMap();
  const labelMarkersRef = useRef<Map<string, MLMarker>>(new Map());

  useEffect(() => {
    if (!map) return;

    // Build a single FeatureCollection for all bubbles (one fill layer per render).
    const features = centroids.map((c) => ({
      type: "Feature" as const,
      properties: { color: tierColor(c.pricingTier) },
      geometry: {
        type: "Polygon" as const,
        coordinates: [circlePolygon(c.lng, c.lat, 500)],
      },
    }));
    const data = { type: "FeatureCollection" as const, features };

    const existing = map.getSource(CENTROID_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (existing) {
      existing.setData(data);
    } else {
      map.addSource(CENTROID_SOURCE_ID, { type: "geojson", data });
      map.addLayer({
        id: CENTROID_LAYER_ID,
        type: "fill",
        source: CENTROID_SOURCE_ID,
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": 0.08,
          "fill-outline-color": ["get", "color"],
        },
      });
    }

    // Label markers (one per centroid).
    const prev = labelMarkersRef.current;
    const nextIds = new Set(centroids.map((c) => c.id));
    for (const [id, marker] of prev) {
      if (!nextIds.has(id)) { marker.remove(); prev.delete(id); }
    }
    for (const c of centroids) {
      const color = tierColor(c.pricingTier);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="44">
        <rect x="0" y="0" width="80" height="30" rx="15" fill="${color}" opacity="0.9"/>
        <text x="40" y="14" text-anchor="middle" fill="#fff" font-size="10" font-weight="800" font-family="Inter,system-ui,sans-serif">${c.containers}</text>
        <text x="40" y="24" text-anchor="middle" fill="rgba(255,255,255,0.8)" font-size="7" font-family="Inter,system-ui,sans-serif">${c.label}</text>
      </svg>`;
      const m = prev.get(c.id);
      if (m) {
        m.setLngLat([c.lng, c.lat]);
        const el = m.getElement();
        el.innerHTML = svg;
      } else {
        const marker = new maplibregl.Marker({ element: svgMarker(svg), anchor: "center" })
          .setLngLat([c.lng, c.lat])
          .addTo(map);
        prev.set(c.id, marker);
      }
    }

    return () => {
      prev.forEach((m) => m.remove()); prev.clear();
      if (map.getLayer(CENTROID_LAYER_ID)) map.removeLayer(CENTROID_LAYER_ID);
      if (map.getSource(CENTROID_SOURCE_ID)) map.removeSource(CENTROID_SOURCE_ID);
    };
  }, [map, centroids]);

  return null;
}

// ── Active Run Stop Markers ──

function ActiveRunStopMarkers({ stops }: { stops: RunStopDetail[] }) {
  const map = useMap();
  const markersRef = useRef<Map<string, MLMarker>>(new Map());

  useEffect(() => {
    if (!map) return;
    const prev = markersRef.current;
    const nextIds = new Set(stops.map((s) => s.id));

    for (const [id, marker] of prev) {
      if (!nextIds.has(id)) { marker.remove(); prev.delete(id); }
    }

    for (const stop of stops) {
      const color = stop.status === "picked_up" ? "#16a34a" : stop.status === "skipped" ? "#94a3b8" : stop.status === "arrived" ? "#3b82f6" : "#f59e0b";
      const icon = stop.status === "picked_up" ? "✓" : stop.status === "skipped" ? "—" : `${stop.sequence + 1}`;

      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
        <circle cx="16" cy="16" r="14" fill="${color}" stroke="#fff" stroke-width="2.5"/>
        <text x="16" y="21" text-anchor="middle" fill="#fff" font-size="12" font-weight="800" font-family="Inter,system-ui,sans-serif">${icon}</text>
      </svg>`;

      const existing = prev.get(stop.id);
      if (existing) {
        existing.setLngLat([stop.lng, stop.lat]);
        existing.getElement().innerHTML = svg;
      } else {
        const marker = new maplibregl.Marker({ element: svgMarker(svg), anchor: "center" })
          .setLngLat([stop.lng, stop.lat])
          .addTo(map);
        prev.set(stop.id, marker);
      }
    }

    return () => { prev.forEach((m) => m.remove()); prev.clear(); };
  }, [map, stops]);

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

const MAPS_ERROR_MESSAGES: Record<string, string> = {
  NetworkError: "Map tiles couldn't be reached. Check your internet connection.",
  StyleLoadError: "Map style failed to load from OpenFreeMap. Try refreshing.",
};

function MapsUnavailableFallback({ reason }: { reason: string }) {
  const message = MAPS_ERROR_MESSAGES[reason] ?? "Map failed to load.";
  return (
    <div className="absolute inset-0 bg-white flex items-center justify-center">
      <div className="text-center px-6 max-w-md">
        <AlertTriangle size={48} className="text-amber-500 mx-auto mb-4" />
        <p className="text-slate-900 font-display font-bold text-lg mb-2">Map unavailable</p>
        <p className="text-slate-500 text-sm mb-3">{message}</p>
        <code className="text-[11px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{reason}</code>
      </div>
    </div>
  );
}

// ── Main Export ──

interface MapViewProps {
  mode: AppMode;
  bins: SortBin[];
  selectedBinId?: string | null;
  activeRoute?: Route | null;
  depot: Depot | null;
  onBinSelect?: (id: string) => void;
  onMapTap: () => void;
  runCentroids?: RunCentroid[];
  activeRunStops?: RunStopDetail[];
}

export function MapView({ mode, bins, selectedBinId, activeRoute, depot, onBinSelect, onMapTap, runCentroids, activeRunStops }: MapViewProps) {
  const [userLoc, setUserLoc] = useState<LatLng | null>(null);
  const handleLocated = useCallback((loc: LatLng) => setUserLoc(loc), []);
  const mapsError = useMapsError();

  if (mapsError) return <MapsUnavailableFallback reason={mapsError} />;

  return (
    <MapErrorBoundary>
      <MapProvider onMapTap={onMapTap}>
        <AutoLocate onLocated={handleLocated} />
        {userLoc && <UserLocationMarker loc={userLoc} />}
        {onBinSelect && <BinMarkers bins={bins} selectedId={selectedBinId ?? null} onSelect={onBinSelect} />}
        {activeRoute && <RouteLine route={activeRoute} depot={depot} />}
        {runCentroids && runCentroids.length > 0 && <CentroidBubbles centroids={runCentroids} />}
        {activeRunStops && activeRunStops.length > 0 && <ActiveRunStopMarkers stops={activeRunStops} />}
      </MapProvider>
    </MapErrorBoundary>
  );
}
