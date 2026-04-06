"use client";

export type AppMode = "sort" | "run";

interface ModeToggleProps {
  mode: AppMode;
  onChange: (mode: AppMode) => void;
}

export function ModeToggle({ mode, onChange }: ModeToggleProps) {
  return (
    <div className="flex bg-black/30 backdrop-blur-md rounded-full p-1 gap-1">
      <button
        onClick={() => onChange("sort")}
        className={`px-5 py-2 rounded-full text-sm font-semibold transition-all ${
          mode === "sort"
            ? "bg-green-600 text-white shadow-lg"
            : "text-white/70 hover:text-white"
        }`}
      >
        Sort
      </button>
      <button
        onClick={() => onChange("run")}
        className={`px-5 py-2 rounded-full text-sm font-semibold transition-all ${
          mode === "run"
            ? "bg-amber-500 text-white shadow-lg"
            : "text-white/70 hover:text-white"
        }`}
      >
        Run
      </button>
    </div>
  );
}
