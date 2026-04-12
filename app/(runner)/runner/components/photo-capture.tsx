"use client";

import { useState, useRef, useCallback } from "react";
import { Camera, X, Check } from "lucide-react";

interface PhotoCaptureProps {
  onCapture: (photoUrl: string) => void;
  onCancel: () => void;
}

export function PhotoCapture({ onCapture, onCancel }: PhotoCaptureProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleCapture = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
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
            onClick={() => setPreview(null)}
            className="flex-1 py-2.5 glass border border-white/40 text-slate-500 font-bold rounded-xl text-[13px] flex items-center justify-center gap-1.5 min-h-[40px]"
          >
            <X className="w-4 h-4" /> Retake
          </button>
          <button
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
        onChange={handleCapture}
        className="hidden"
      />
      <button
        onClick={() => inputRef.current?.click()}
        className="flex items-center justify-center gap-2 w-full py-3 bg-slate-100 text-slate-600 font-bold rounded-xl text-[13px] min-h-[44px] active:bg-slate-200 transition-colors"
      >
        <Camera className="w-4 h-4" /> Take Verification Photo
      </button>
      <p className="text-[11px] text-slate-400 mt-2">Optional: helps verify pickup for rating</p>
    </div>
  );
}
