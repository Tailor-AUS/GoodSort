"use client";

import { useRef, useCallback } from "react";
import { Map, GeolocateControl, Marker } from "@vis.gl/react-maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Bin } from "@/lib/store";

export type AppMode = "sort" | "run";

const BRISBANE_CENTER = { longitude: 153.021, latitude: -27.482 };
const MAP_STYLE = "https://tiles.openfreemap.org/styles/dark";

interface MapViewProps {
  mode: AppMode;
  bins: Bin[];
  selectedBinId: string | null;
  onBinSelect: (binId: string) => void;
  onMapTap: () => void;
}

function getBinColor(bin: Bin, mode: AppMode): string {
  if (mode === "run") return "#22c55e";
  if (bin.fillPercent >= 80) return "#ef4444";
  if (bin.fillPercent >= 50) return "#f59e0b";
  return "#22c55e";
}

function BinMarker({
  bin,
  mode,
  isSelected,
  onClick,
}: {
  bin: Bin;
  mode: AppMode;
  isSelected: boolean;
  onClick: () => void;
}) {
  const color = getBinColor(bin, mode);
  const isFull = bin.fillPercent >= 80;

  return (
    <Marker
      longitude={bin.lng}
      latitude={bin.lat}
      anchor="center"
      onClick={(e) => {
        e.originalEvent.stopPropagation();
        onClick();
      }}
    >
      <div
        className={`bin-marker ${isFull && mode === "run" ? "full" : ""} ${isSelected ? "selected" : ""}`}
        style={{
          backgroundColor: color,
          borderColor: isSelected ? "#22c55e" : "rgba(255,255,255,0.9)",
          borderWidth: isSelected ? "3px" : "2.5px",
        }}
      >
        {bin.fillPercent}%
      </div>
    </Marker>
  );
}

export function MapView({ mode, bins, selectedBinId, onBinSelect, onMapTap }: MapViewProps) {
  const geolocateRef = useRef<maplibregl.GeolocateControl | null>(null);

  const visibleBins = mode === "run"
    ? bins.filter((b) => b.fillPercent >= 80 && b.status !== "claimed" && b.status !== "collected")
    : bins.filter((b) => b.status !== "collected");

  const handleMapLoad = useCallback(() => {
    setTimeout(() => {
      if (geolocateRef.current) {
        geolocateRef.current.trigger();
      }
    }, 500);
  }, []);

  return (
    <Map
      initialViewState={{
        ...BRISBANE_CENTER,
        zoom: 14,
      }}
      style={{ width: "100%", height: "100%" }}
      mapStyle={MAP_STYLE}
      onLoad={handleMapLoad}
      onClick={onMapTap}
      attributionControl={false}
    >
      <GeolocateControl
        ref={geolocateRef as React.Ref<maplibregl.GeolocateControl>}
        position="top-right"
        trackUserLocation
        showAccuracyCircle={false}
        style={{ marginTop: "16px", marginRight: "16px" }}
      />

      {visibleBins.map((bin) => (
        <BinMarker
          key={bin.id}
          bin={bin}
          mode={mode}
          isSelected={selectedBinId === bin.id}
          onClick={() => onBinSelect(bin.id)}
        />
      ))}
    </Map>
  );
}
