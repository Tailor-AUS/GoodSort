"use client";

import { useState, useRef, useCallback } from "react";
import { Camera, X, Check } from "lucide-react";

interface PhotoCaptureProps {
  onCapture: (photoUrl: string) => void;
  onCancel: () => void;
}

const MAX_CAPTURE_EDGE = 1600;
const TARGET_DATA_URL_CHARS = 1_400_000;
const QUALITY_LADDER = [0.82, 0.68, 0.52];

function downscaleImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.onloadend = () => {
      const rawDataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!rawDataUrl) {
        reject(new Error("Empty image data"));
        return;
      }
      const img = new Image();
      img.onerror = () => resolve(rawDataUrl);
      img.onload = () => {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (!w || !h) {
          resolve(rawDataUrl);
          return;
        }
        const scale = Math.min(1, MAX_CAPTURE_EDGE / Math.max(w, h));
        const targetW = Math.max(1, Math.round(w * scale));
        const targetH = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(rawDataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, targetW, targetH);
        let encoded = rawDataUrl;
        for (const q of QUALITY_LADDER) {
          encoded = canvas.toDataURL("image/jpeg", q);
          if (encoded.length <= TARGET_DATA_URL_CHARS) break;
        }
        resolve(encoded);
      };
      img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export function PhotoCapture({ onCapture, onCancel: _onCancel }: PhotoCaptureProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleCapture = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void downscaleImageFile(file)
      .then((dataUrl) => setPreview(dataUrl))
      .catch(() => setPreview(null));
  }, []);

  const handleConfirm = useCallback(() => {
    if (preview) onCapture(preview);
  }, [preview, onCapture]);

  if (preview) {
    return (
      <div className="glass rounded-2xl p-3 border border-white/40 shadow-sm">
        <div className="relative rounded-xl overflow-hidden mb-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Pickup verification" className="w-full h-40 object-cover" />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPreview(null)}
            className="flex-1 py-2.5 glass border border-white/40 text-slate-500 font-bold rounded-xl text-[13px] flex items-center justify-center gap-1.5 min-h-[40px]"
          >
            <X className="w-4 h-4" /> Retake
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="flex-1 py-2.5 bg-green-500 text-white font-bold rounded-xl text-[13px] flex items-center justify-center gap-1.5 min-h-[40px]"
          >
            <Check className="w-4 h-4" /> Use Photo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="glass rounded-2xl p-4 border border-white/40 shadow-sm text-center">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="Capture pickup verification photo"
        onChange={handleCapture}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex items-center justify-center gap-2 w-full py-3 bg-slate-100 text-slate-600 font-bold rounded-xl text-[13px] min-h-[44px] active:bg-slate-200 transition-colors"
      >
        <Camera className="w-4 h-4" /> Take Verification Photo
      </button>
      <p className="text-[11px] text-slate-400 mt-2">Optional: helps verify pickup for rating</p>
    </div>
  );
}
