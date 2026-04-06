// Container eligibility — MVP: aluminium cans only
// Based on QLD Container Refund Scheme (CDS) - eligible containers 150ml to 3L

export interface Container {
  barcode: string;
  name: string;
  brand: string;
  size_ml: number;
  material: "aluminium";
  weight_g: number;
  refund_cents: number;
}

// Aluminium can weight: ~14g (375ml standard)
export const CAN_WEIGHT_G = 14;

// Sample container database — aluminium cans only for MVP
const CONTAINER_DB: Container[] = [
  // Soft drinks
  { barcode: "9300675024457", name: "Coca-Cola 375ml", brand: "Coca-Cola", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 10 },
  { barcode: "9300675024464", name: "Coke Zero 375ml", brand: "Coca-Cola", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 10 },
  { barcode: "9300675024471", name: "Sprite 375ml", brand: "Coca-Cola", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 10 },
  { barcode: "9300675024488", name: "Fanta 375ml", brand: "Coca-Cola", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 10 },
  { barcode: "9300675024495", name: "Pepsi 375ml", brand: "PepsiCo", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 10 },
  { barcode: "9300675024501", name: "Solo 375ml", brand: "Asahi", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 10 },

  // Beer
  { barcode: "9310058000015", name: "XXXX Gold 375ml", brand: "Lion", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 10 },
  { barcode: "9310058000022", name: "Tooheys New 375ml", brand: "Lion", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 10 },
  { barcode: "9310058000039", name: "James Boag 375ml", brand: "Lion", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 10 },
  { barcode: "9300652000115", name: "Great Northern 375ml", brand: "CUB", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 10 },
  { barcode: "9300652000122", name: "VB 375ml", brand: "CUB", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 10 },
  { barcode: "9300652000139", name: "Carlton Dry 375ml", brand: "CUB", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 10 },
  { barcode: "9300652000146", name: "Iron Jack 375ml", brand: "CUB", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 10 },

  // Energy drinks
  { barcode: "90162602", name: "Red Bull 250ml", brand: "Red Bull", size_ml: 250, material: "aluminium", weight_g: 11, refund_cents: 10 },
  { barcode: "9300650000117", name: "V Energy 250ml", brand: "Frucor", size_ml: 250, material: "aluminium", weight_g: 11, refund_cents: 10 },
  { barcode: "9300650000124", name: "V Energy 500ml", brand: "Frucor", size_ml: 500, material: "aluminium", weight_g: 16, refund_cents: 10 },
  { barcode: "9300650000131", name: "Monster Energy 500ml", brand: "Monster", size_ml: 500, material: "aluminium", weight_g: 16, refund_cents: 10 },

  // Premix / RTD
  { barcode: "9300652100013", name: "Bundaberg Rum & Cola 375ml", brand: "Diageo", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 10 },
  { barcode: "9300652100020", name: "Jack Daniel's & Cola 375ml", brand: "Brown-Forman", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 10 },

  // Seltzers
  { barcode: "9300652100037", name: "Fellr Brewed Seltzer 330ml", brand: "Fellr", size_ml: 330, material: "aluminium", weight_g: 13, refund_cents: 10 },
  { barcode: "9300652100044", name: "Better Beer 355ml", brand: "Better Beer", size_ml: 355, material: "aluminium", weight_g: 14, refund_cents: 10 },
];

export function lookupContainer(barcode: string): Container | null {
  return CONTAINER_DB.find((c) => c.barcode === barcode) || null;
}

export function createUnknownContainer(barcode: string): Container {
  return {
    barcode,
    name: "Aluminium Can",
    brand: "Unknown",
    size_ml: 375,
    material: "aluminium",
    weight_g: 14,
    refund_cents: 10,
  };
}
