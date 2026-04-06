// Container eligibility and 4-bag sorting
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

// Sample container database
const CONTAINER_DB: Container[] = [
  // ── Aluminium Cans (Blue Bag) ──
  { barcode: "9300675024457", name: "Coca-Cola 375ml", brand: "Coca-Cola", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 10 },
  { barcode: "9300675024464", name: "Coke Zero 375ml", brand: "Coca-Cola", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 10 },
  { barcode: "9300675024471", name: "Sprite 375ml", brand: "Coca-Cola", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 10 },
  { barcode: "9300675024488", name: "Fanta 375ml", brand: "Coca-Cola", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 10 },
  { barcode: "9310058000015", name: "XXXX Gold 375ml", brand: "Lion", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 10 },
  { barcode: "9310058000022", name: "Tooheys New 375ml", brand: "Lion", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 10 },
  { barcode: "9300652000115", name: "Great Northern 375ml", brand: "CUB", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 10 },
  { barcode: "9300652000122", name: "VB 375ml", brand: "CUB", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 10 },
  { barcode: "90162602", name: "Red Bull 250ml", brand: "Red Bull", size_ml: 250, material: "aluminium", weight_g: 11, refund_cents: 10 },
  { barcode: "9300650000117", name: "V Energy 250ml", brand: "Frucor", size_ml: 250, material: "aluminium", weight_g: 11, refund_cents: 10 },
  { barcode: "9300650000124", name: "V Energy 500ml", brand: "Frucor", size_ml: 500, material: "aluminium", weight_g: 16, refund_cents: 10 },
  { barcode: "9300650000131", name: "Monster Energy 500ml", brand: "Monster", size_ml: 500, material: "aluminium", weight_g: 16, refund_cents: 10 },

  // ── PET Plastic Bottles (Teal Bag) ──
  { barcode: "9300675025157", name: "Coca-Cola 600ml PET", brand: "Coca-Cola", size_ml: 600, material: "pet", weight_g: 24, refund_cents: 10 },
  { barcode: "9300675025164", name: "Coca-Cola 1.25L PET", brand: "Coca-Cola", size_ml: 1250, material: "pet", weight_g: 42, refund_cents: 10 },
  { barcode: "9300675025171", name: "Mount Franklin 600ml", brand: "Coca-Cola", size_ml: 600, material: "pet", weight_g: 12, refund_cents: 10 },
  { barcode: "9300675025188", name: "Pump Water 750ml", brand: "Coca-Cola", size_ml: 750, material: "pet", weight_g: 20, refund_cents: 10 },
  { barcode: "93711400001", name: "Cool Ridge Water 600ml", brand: "CCA", size_ml: 600, material: "pet", weight_g: 12, refund_cents: 10 },

  // ── Glass Bottles (Amber Bag) ──
  { barcode: "9310058100012", name: "XXXX Gold Stubby 330ml", brand: "Lion", size_ml: 330, material: "glass", weight_g: 190, refund_cents: 10 },
  { barcode: "9310058100029", name: "James Squire 345ml", brand: "Lion", size_ml: 345, material: "glass", weight_g: 210, refund_cents: 10 },
  { barcode: "9300652100112", name: "Great Northern Stubby 330ml", brand: "CUB", size_ml: 330, material: "glass", weight_g: 190, refund_cents: 10 },

  // ── Other: Liquid Paperboard / Poppers (Green Bag) ──
  { barcode: "9310055000115", name: "Just Juice Apple 250ml", brand: "Juice Brothers", size_ml: 250, material: "liquid_paperboard", weight_g: 9, refund_cents: 10 },
  { barcode: "9310055000122", name: "Golden Circle Tropical 250ml", brand: "Kraft Heinz", size_ml: 250, material: "liquid_paperboard", weight_g: 9, refund_cents: 10 },
];

export function lookupContainer(barcode: string): Container | null {
  return CONTAINER_DB.find((c) => c.barcode === barcode) || null;
}

export function createUnknownContainer(barcode: string): Container {
  return {
    barcode,
    name: "Unknown Container",
    brand: "Unknown",
    size_ml: 375,
    material: "aluminium", // default assumption
    weight_g: 14,
    refund_cents: 10,
  };
}
