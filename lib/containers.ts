// Container eligibility data and lookup
// Based on QLD Container Refund Scheme (CDS) - eligible containers 150ml to 3L

export interface Container {
  barcode: string;
  name: string;
  brand: string;
  size_ml: number;
  material: "aluminium" | "pet" | "glass" | "hdpe" | "liquid_paperboard";
  weight_g: number;
  refund_cents: number;
}

// Average weight per material type (grams per container) for estimation
export const MATERIAL_WEIGHTS: Record<string, number> = {
  aluminium: 14,
  pet: 25,
  glass: 200,
  hdpe: 30,
  liquid_paperboard: 10,
};

// VFM ranking - profit density score (lower weight = more containers per bin load)
export const VFM_RANK: Record<string, "elite" | "excellent" | "good" | "poor"> = {
  aluminium: "elite",
  pet: "good",
  hdpe: "good",
  liquid_paperboard: "excellent",
  glass: "poor",
};

// Sample container database - in production this would be an API call to COEX's eligible container list
const CONTAINER_DB: Container[] = [
  // Aluminium cans - Elite VFM
  { barcode: "9300675024457", name: "Coca-Cola 375ml", brand: "Coca-Cola", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 10 },
  { barcode: "9300675024464", name: "Coca-Cola Zero 375ml", brand: "Coca-Cola", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 10 },
  { barcode: "9300675024471", name: "Sprite 375ml", brand: "Coca-Cola", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 10 },
  { barcode: "9300675024488", name: "Fanta Orange 375ml", brand: "Coca-Cola", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 10 },
  { barcode: "9310058000015", name: "XXXX Gold 375ml", brand: "Lion", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 10 },
  { barcode: "9310058000022", name: "Tooheys New 375ml", brand: "Lion", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 10 },
  { barcode: "9310058000039", name: "James Boag Premium 375ml", brand: "Lion", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 10 },
  { barcode: "9300652000115", name: "Great Northern Original 375ml", brand: "CUB", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 10 },
  { barcode: "9300652000122", name: "VB 375ml", brand: "CUB", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 10 },
  { barcode: "90162602", name: "Red Bull 250ml", brand: "Red Bull", size_ml: 250, material: "aluminium", weight_g: 11, refund_cents: 10 },
  { barcode: "9300650000117", name: "V Energy 250ml", brand: "Frucor", size_ml: 250, material: "aluminium", weight_g: 11, refund_cents: 10 },
  { barcode: "9300650000124", name: "V Energy 500ml", brand: "Frucor", size_ml: 500, material: "aluminium", weight_g: 16, refund_cents: 10 },

  // PET Bottles - Good VFM
  { barcode: "9300675025157", name: "Coca-Cola 600ml PET", brand: "Coca-Cola", size_ml: 600, material: "pet", weight_g: 24, refund_cents: 10 },
  { barcode: "9300675025164", name: "Coca-Cola 1.25L PET", brand: "Coca-Cola", size_ml: 1250, material: "pet", weight_g: 42, refund_cents: 10 },
  { barcode: "9300675025171", name: "Mount Franklin 600ml", brand: "Coca-Cola", size_ml: 600, material: "pet", weight_g: 12, refund_cents: 10 },
  { barcode: "9300675025188", name: "Pump Water 750ml", brand: "Coca-Cola", size_ml: 750, material: "pet", weight_g: 20, refund_cents: 10 },
  { barcode: "93711400001", name: "Cool Ridge Water 600ml", brand: "CCA", size_ml: 600, material: "pet", weight_g: 12, refund_cents: 10 },

  // Glass - Poor VFM (heavy)
  { barcode: "9310058100012", name: "XXXX Gold 330ml Stubby", brand: "Lion", size_ml: 330, material: "glass", weight_g: 190, refund_cents: 10 },
  { barcode: "9310058100029", name: "James Squire 345ml", brand: "Lion", size_ml: 345, material: "glass", weight_g: 210, refund_cents: 10 },
  { barcode: "9300652100112", name: "Great Northern 330ml Stubby", brand: "CUB", size_ml: 330, material: "glass", weight_g: 190, refund_cents: 10 },

  // Liquid Paperboard (Poppers) - Excellent VFM
  { barcode: "9310055000115", name: "Just Juice Apple 250ml", brand: "The Juice Brothers", size_ml: 250, material: "liquid_paperboard", weight_g: 9, refund_cents: 10 },
  { barcode: "9310055000122", name: "Golden Circle Tropical 250ml", brand: "Kraft Heinz", size_ml: 250, material: "liquid_paperboard", weight_g: 9, refund_cents: 10 },
];

export function lookupContainer(barcode: string): Container | null {
  return CONTAINER_DB.find((c) => c.barcode === barcode) || null;
}

// For unknown barcodes, check if it could be an eligible container
// In production, this would hit COEX's API
export function createUnknownContainer(barcode: string): Container {
  return {
    barcode,
    name: "Unknown Container",
    brand: "Unknown",
    size_ml: 375,
    material: "aluminium",
    weight_g: 14,
    refund_cents: 10,
  };
}

// Estimate container count from weight
export function estimateCountFromWeight(weight_kg: number, material: string): number {
  const avgWeight = MATERIAL_WEIGHTS[material] || 20;
  return Math.round((weight_kg * 1000) / avgWeight);
}
