"use client";

import { useRef, useEffect, useCallback } from "react";
import { Map, GeolocateControl, Marker } from "@vis.gl/react-maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { AppMode } from "./mode-toggle";
import type { Bin } from "@/lib/store";

const GOLD_COAST_CENTER = { longitude: 153.41, latitude: -27.97 };
const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

interface MapViewProps {
  mode: AppMode;
  bins: Bin[];
  selectedBinId: string | null;
  onBinSelect: (binId: string) => void;
}

function getBinColor(bin: Bin, mode: AppMode): string {
  if (mode === "run") return "#ef4444"; // red for full bins in run mode
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
        className={`bin-marker ${isFull && mode === "run" ? "full" : ""}`}
        style={{
          backgroundColor: color,
          transform: isSelected ? "scale(1.25)" : "scale(1)",
          borderColor: isSelected ? "#facc15" : "white",
          borderWidth: isSelected ? "4px" : "3px",
        }}
      >
        {bin.fillPercent}%
      </div>
    </Marker>
  );
}

export function MapView({ mode, bins, selectedBinId, onBinSelect }: MapViewProps) {
  const geolocateRef = useRef<maplibregl.GeolocateControl | null>(null);

  const visibleBins = mode === "run"
    ? bins.filter((b) => b.fillPercent >= 80 && b.status !== "claimed" && b.status !== "collected")
    : bins.filter((b) => b.status !== "collected");

  const handleMapLoad = useCallback(() => {
    // Trigger geolocation on map load
    setTimeout(() => {
      if (geolocateRef.current) {
        geolocateRef.current.trigger();
      }
    }, 500);
  }, []);

  return (
    <Map
      initialViewState={{
        ...GOLD_COAST_CENTER,
        zoom: 13,
      }}
      style={{ width: "100%", height: "100%" }}
      mapStyle={MAP_STYLE}
      onLoad={handleMapLoad}
      attributionControl={false}
    >
      <GeolocateControl
        ref={geolocateRef as React.Ref<maplibregl.GeolocateControl>}
        position="top-right"
        trackUserLocation
        showAccuracyCircle={false}
        style={{ marginTop: "70px", marginRight: "12px" }}
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
