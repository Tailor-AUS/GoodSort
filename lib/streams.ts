// ══════════════════════════════════════════════════════════════
// The Good Sort — 8-Stream Material Sorting System
// ══════════════════════════════════════════════════════════════
// Matches depot-grade 8-stream sort. AI identifies the container,
// this module tells the user exactly which bin section to use.
//
// The GoodSort bin has 8 colour-coded sections. Each section maps
// to a recycler endpoint — no depot, no MRF, straight to processor.

export interface Stream {
  id: number;
  key: string;
  label: string;
  shortLabel: string;
  color: string;         // tailwind bg class
  textColor: string;     // tailwind text class
  hex: string;           // for canvas/overlay
  emoji: string;
  examples: string;
  recycler: string;      // who buys this material
  row: "top" | "bottom"; // position in the bin
}

export const STREAMS: Stream[] = [
  // ── Top row (high volume) ──
  {
    id: 1, key: "aluminium",
    label: "Aluminium Cans", shortLabel: "ALU",
    color: "bg-blue-500", textColor: "text-blue-600", hex: "#3b82f6",
    emoji: "🔵",
    examples: "Beer cans, soft drink cans, energy drink cans, premix cans",
    recycler: "Aluminium smelter",
    row: "top",
  },
  {
    id: 2, key: "pet_clear",
    label: "PET Clear", shortLabel: "PET CLR",
    color: "bg-sky-400", textColor: "text-sky-500", hex: "#38bdf8",
    emoji: "💧",
    examples: "Clear water bottles, clear soft drink bottles (Mount Franklin, Pump)",
    recycler: "PET processor",
    row: "top",
  },
  {
    id: 3, key: "pet_coloured",
    label: "PET Coloured", shortLabel: "PET COL",
    color: "bg-rose-500", textColor: "text-rose-500", hex: "#f43f5e",
    emoji: "🔴",
    examples: "Green Sprite bottles, brown Bundaberg bottles, coloured juice bottles",
    recycler: "PET processor",
    row: "top",
  },

  // ── Bottom row (glass + small streams) ──
  {
    id: 4, key: "glass_clear",
    label: "Glass Clear", shortLabel: "GLS CLR",
    color: "bg-emerald-400", textColor: "text-emerald-500", hex: "#34d399",
    emoji: "🟢",
    examples: "Clear wine bottles, clear spirit bottles, clear juice bottles",
    recycler: "Glass recycler (Visy, O-I)",
    row: "bottom",
  },
  {
    id: 5, key: "glass_brown",
    label: "Glass Brown", shortLabel: "GLS BRN",
    color: "bg-amber-700", textColor: "text-amber-700", hex: "#b45309",
    emoji: "🟤",
    examples: "Beer stubbies (VB, XXXX, Carlton), brown spirit bottles",
    recycler: "Glass recycler (Visy, O-I)",
    row: "bottom",
  },
  {
    id: 6, key: "glass_green",
    label: "Glass Green", shortLabel: "GLS GRN",
    color: "bg-green-700", textColor: "text-green-700", hex: "#15803d",
    emoji: "🟩",
    examples: "Green wine bottles, Heineken, some spirit bottles",
    recycler: "Glass recycler (Visy, O-I)",
    row: "bottom",
  },
  {
    id: 7, key: "steel",
    label: "Steel Cans", shortLabel: "STEEL",
    color: "bg-slate-500", textColor: "text-slate-600", hex: "#64748b",
    emoji: "⚪",
    examples: "Some food-crossover cans, steel beverage cans (less common)",
    recycler: "Steel recycler",
    row: "bottom",
  },
  {
    id: 8, key: "hdpe_lpb",
    label: "HDPE & Cartons", shortLabel: "HDPE/LPB",
    color: "bg-orange-400", textColor: "text-orange-500", hex: "#fb923c",
    emoji: "🟠",
    examples: "Juice poppers, tetra packs, flavoured milk cartons, HDPE juice bottles",
    recycler: "Paper/board recycler",
    row: "bottom",
  },
];

/**
 * Map a material + container description from the AI to the correct stream.
 * The AI returns material as: "aluminium", "pet", "glass", "steel",
 * "hdpe", "liquid_paperboard". We need to sub-classify:
 *   - PET → clear or coloured (based on AI description)
 *   - Glass → clear, brown, or green (based on AI description)
 */
export function classifyToStream(
  material: string,
  description: string,
): Stream {
  const mat = material.toLowerCase();
  const desc = description.toLowerCase();

  // Aluminium / steel
  if (mat === "aluminium" || mat === "aluminum") return STREAMS[0]; // ALU
  if (mat === "steel") return STREAMS[6]; // STEEL

  // PET — sub-classify by colour
  if (mat === "pet") {
    if (desc.includes("green") || desc.includes("colour") || desc.includes("color") ||
        desc.includes("sprite") || desc.includes("fanta") || desc.includes("bundaberg") ||
        desc.includes("brown") || desc.includes("dark") || desc.includes("tinted")) {
      return STREAMS[2]; // PET COLOURED
    }
    return STREAMS[1]; // PET CLEAR (default for plastic bottles)
  }

  // Glass — sub-classify by colour
  if (mat === "glass") {
    if (desc.includes("brown") || desc.includes("amber") || desc.includes("stubby") ||
        desc.includes("stubbies") || desc.includes("vb") || desc.includes("xxxx") ||
        desc.includes("carlton") || desc.includes("tooheys") || desc.includes("beer")) {
      return STREAMS[4]; // GLASS BROWN
    }
    if (desc.includes("green") || desc.includes("heineken") || desc.includes("perrier") ||
        desc.includes("champagne")) {
      return STREAMS[5]; // GLASS GREEN
    }
    return STREAMS[3]; // GLASS CLEAR (default for wine/spirit bottles)
  }

  // HDPE / Liquid paperboard
  if (mat === "hdpe" || mat === "liquid_paperboard" || mat === "lpb" || mat === "carton") {
    return STREAMS[7]; // HDPE/LPB
  }

  // Fallback — HDPE/LPB (the "other" section)
  return STREAMS[7];
}

/**
 * Get a stream by its ID (1-8).
 */
export function getStreamById(id: number): Stream | undefined {
  return STREAMS.find(s => s.id === id);
}

/**
 * Refund value per container in cents (CDS rate).
 */
export const CDS_REFUND_CENTS = 10;

/**
 * Sorter credit per container in cents (what the household earns).
 */
export const SORTER_CREDIT_CENTS = 5;
