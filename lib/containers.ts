// Container lookup — multi-source: local DB → Open Food Facts → heuristic
// QLD Container Refund Scheme: eligible 150ml to 3L beverage containers

export type ContainerMaterial = "aluminium" | "pet" | "glass" | "hdpe" | "liquid_paperboard";

export interface Container {
  barcode: string;
  name: string;
  brand: string;
  size_ml: number;
  material: ContainerMaterial;
  weight_g: number;
  refund_cents: number;
  source: "local" | "openfoodfacts" | "heuristic" | "user";
  confidence: "high" | "medium" | "low";
}

// ── Material classification from bag system ──

export function toBagMaterial(material: ContainerMaterial): "aluminium" | "pet" | "glass" | "other" {
  if (material === "aluminium") return "aluminium";
  if (material === "pet") return "pet";
  if (material === "glass") return "glass";
  return "other";
}

// ── Local Database (high confidence, instant) ──

const LOCAL_DB: Container[] = [
  // ── Aluminium Cans ──
  // Coca-Cola range
  { barcode: "9300675024457", name: "Coca-Cola 375ml", brand: "Coca-Cola", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300675024464", name: "Coke Zero 375ml", brand: "Coca-Cola", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300675024471", name: "Sprite 375ml", brand: "Coca-Cola", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300675024488", name: "Fanta 375ml", brand: "Coca-Cola", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300675024495", name: "Diet Coke 375ml", brand: "Coca-Cola", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300675024501", name: "Lift 375ml", brand: "Coca-Cola", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300675030014", name: "Kirks Lemonade 375ml", brand: "Coca-Cola", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
  // Pepsi range
  { barcode: "9310015200019", name: "Pepsi 375ml", brand: "PepsiCo", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9310015200026", name: "Pepsi Max 375ml", brand: "PepsiCo", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9310015200033", name: "Solo 375ml", brand: "Asahi", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
  // Beer — Lion
  { barcode: "9310058000015", name: "XXXX Gold 375ml", brand: "Lion", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9310058000022", name: "Tooheys New 375ml", brand: "Lion", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9310058000039", name: "James Boag 375ml", brand: "Lion", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9310058000046", name: "XXXX Bitter 375ml", brand: "Lion", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9310058000053", name: "Tooheys Extra Dry 375ml", brand: "Lion", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
  // Beer — CUB
  { barcode: "9300652000115", name: "Great Northern Original 375ml", brand: "CUB", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300652000122", name: "VB 375ml", brand: "CUB", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300652000139", name: "Carlton Dry 375ml", brand: "CUB", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300652000146", name: "Iron Jack 375ml", brand: "CUB", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300652000153", name: "Great Northern Super Crisp 375ml", brand: "CUB", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300652000160", name: "Carlton Zero 375ml", brand: "CUB", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
  // Craft
  { barcode: "9350987000012", name: "Balter XPA 375ml", brand: "Balter", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9350987000029", name: "Stone & Wood Pacific Ale 375ml", brand: "Stone & Wood", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
  // Energy drinks
  { barcode: "90162602", name: "Red Bull 250ml", brand: "Red Bull", size_ml: 250, material: "aluminium", weight_g: 11, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300650000117", name: "V Energy 250ml", brand: "Frucor", size_ml: 250, material: "aluminium", weight_g: 11, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300650000124", name: "V Energy 500ml", brand: "Frucor", size_ml: 500, material: "aluminium", weight_g: 16, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300650000131", name: "Monster Energy 500ml", brand: "Monster", size_ml: 500, material: "aluminium", weight_g: 16, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300650000148", name: "Mother Energy 500ml", brand: "Coca-Cola", size_ml: 500, material: "aluminium", weight_g: 16, refund_cents: 5, source: "local", confidence: "high" },
  // RTD / Premix
  { barcode: "9300652100013", name: "Bundaberg Rum & Cola 375ml", brand: "Diageo", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300652100020", name: "Jack Daniel's & Cola 375ml", brand: "Brown-Forman", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300652100037", name: "Canadian Club & Dry 375ml", brand: "Beam Suntory", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
  // Seltzers
  { barcode: "9300652100044", name: "Fellr Brewed Seltzer 330ml", brand: "Fellr", size_ml: 330, material: "aluminium", weight_g: 13, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300652100051", name: "Better Beer 355ml", brand: "Better Beer", size_ml: 355, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },

  // ── PET Plastic Bottles ──
  { barcode: "9300675025157", name: "Coca-Cola 600ml PET", brand: "Coca-Cola", size_ml: 600, material: "pet", weight_g: 24, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300675025164", name: "Coca-Cola 1.25L PET", brand: "Coca-Cola", size_ml: 1250, material: "pet", weight_g: 42, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300675025171", name: "Mount Franklin 600ml", brand: "Coca-Cola", size_ml: 600, material: "pet", weight_g: 12, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300675025188", name: "Pump Water 750ml", brand: "Coca-Cola", size_ml: 750, material: "pet", weight_g: 20, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "93711400001", name: "Cool Ridge Water 600ml", brand: "CCA", size_ml: 600, material: "pet", weight_g: 12, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300675025195", name: "Sprite 1.25L PET", brand: "Coca-Cola", size_ml: 1250, material: "pet", weight_g: 42, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300675025201", name: "Fanta 1.25L PET", brand: "Coca-Cola", size_ml: 1250, material: "pet", weight_g: 42, refund_cents: 5, source: "local", confidence: "high" },

  // ── Glass Bottles ──
  { barcode: "9310058100012", name: "XXXX Gold Stubby 330ml", brand: "Lion", size_ml: 330, material: "glass", weight_g: 190, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9310058100029", name: "James Squire 345ml", brand: "Lion", size_ml: 345, material: "glass", weight_g: 210, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300652100112", name: "Great Northern Stubby 330ml", brand: "CUB", size_ml: 330, material: "glass", weight_g: 190, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300652100129", name: "Crown Lager 375ml", brand: "CUB", size_ml: 375, material: "glass", weight_g: 220, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300652100136", name: "Peroni Nastro Azzurro 330ml", brand: "Asahi", size_ml: 330, material: "glass", weight_g: 190, refund_cents: 5, source: "local", confidence: "high" },

  // ── Liquid Paperboard ──
  { barcode: "9310055000115", name: "Just Juice Apple 250ml", brand: "Juice Brothers", size_ml: 250, material: "liquid_paperboard", weight_g: 9, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9310055000122", name: "Golden Circle Tropical 250ml", brand: "Kraft Heinz", size_ml: 250, material: "liquid_paperboard", weight_g: 9, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9310055000139", name: "Nippy's Chocolate Milk 375ml", brand: "Nippy's", size_ml: 375, material: "liquid_paperboard", weight_g: 12, refund_cents: 5, source: "local", confidence: "high" },
];

// ── Weight estimates by material ──

const MATERIAL_WEIGHTS: Record<ContainerMaterial, Record<string, number>> = {
  aluminium: { small: 11, medium: 14, large: 16 },  // 250ml, 375ml, 500ml
  pet: { small: 12, medium: 24, large: 42 },         // 600ml, 600ml, 1.25L
  glass: { small: 190, medium: 210, large: 300 },     // 330ml, 345ml, 750ml
  hdpe: { small: 20, medium: 30, large: 40 },
  liquid_paperboard: { small: 9, medium: 12, large: 15 },
};

function estimateWeight(material: ContainerMaterial, size_ml: number): number {
  const w = MATERIAL_WEIGHTS[material];
  if (size_ml <= 330) return w.small;
  if (size_ml <= 500) return w.medium;
  return w.large;
}

// ── Source 1: Local DB lookup ──

export function lookupLocal(barcode: string): Container | null {
  return LOCAL_DB.find((c) => c.barcode === barcode) || null;
}

// ── Source 2: Open Food Facts API ──

export async function lookupOpenFoodFacts(barcode: string): Promise<Container | null> {
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${barcode}.json`,
      { headers: { "User-Agent": "TheGoodSort/1.0 (noreply@thegoodsort.org)" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 1 || !data.product) return null;

    const p = data.product;
    const name = p.product_name || p.product_name_en || "Unknown Product";
    const brand = p.brands || "Unknown";
    const qty = p.quantity || "";
    const size_ml = parseSize(qty);

    // Try to get material from packaging data
    const material = classifyMaterialFromOFF(p);

    return {
      barcode,
      name: `${name} ${qty}`.trim(),
      brand,
      size_ml,
      material,
      weight_g: estimateWeight(material, size_ml),
      refund_cents: 5,
      source: "openfoodfacts",
      confidence: p.packaging_materials_tags?.length > 0 ? "high" : "medium",
    };
  } catch {
    return null;
  }
}

function classifyMaterialFromOFF(product: Record<string, unknown>): ContainerMaterial {
  const tags = (product.packaging_materials_tags as string[]) || [];
  const packaging = ((product.packaging as string) || "").toLowerCase();
  const categories = ((product.categories as string) || "").toLowerCase();

  // Check packaging_materials_tags first (most reliable)
  for (const tag of tags) {
    const t = tag.toLowerCase();
    if (t.includes("aluminium") || t.includes("aluminum") || t.includes("steel")) return "aluminium";
    if (t.includes("pet") || t.includes("polyethylene-terephthalate") || t.includes("pp-") || t.includes("hdpe")) return "pet";
    if (t.includes("glass")) return "glass";
    if (t.includes("cardboard") || t.includes("tetra") || t.includes("paperboard")) return "liquid_paperboard";
  }

  // Check free-text packaging field
  if (packaging.includes("can") || packaging.includes("aluminium") || packaging.includes("tin")) return "aluminium";
  if (packaging.includes("pet") || packaging.includes("plastic bottle")) return "pet";
  if (packaging.includes("glass")) return "glass";
  if (packaging.includes("tetra") || packaging.includes("carton")) return "liquid_paperboard";

  // Fall back to category-based heuristic
  return classifyByCategory(categories, 375);
}

function parseSize(qty: string): number {
  const match = qty.match(/(\d+\.?\d*)\s*(ml|l|cl)/i);
  if (!match) return 375;
  const val = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "l") return Math.round(val * 1000);
  if (unit === "cl") return Math.round(val * 10);
  return Math.round(val);
}

// ── Source 3: Category + size heuristic ──

function classifyByCategory(category: string, size_ml: number): ContainerMaterial {
  const cat = category.toLowerCase();

  // Beer/cider in can sizes → aluminium
  if ((cat.includes("beer") || cat.includes("cider") || cat.includes("lager") || cat.includes("ale")) && size_ml <= 500) return "aluminium";

  // Beer in larger/stubby sizes → glass
  if ((cat.includes("beer") || cat.includes("cider")) && size_ml > 500) return "glass";

  // Soft drinks in small sizes → aluminium can
  if ((cat.includes("soft drink") || cat.includes("soda") || cat.includes("cola") || cat.includes("energy")) && size_ml <= 500) return "aluminium";

  // Soft drinks in larger sizes → PET
  if ((cat.includes("soft drink") || cat.includes("soda") || cat.includes("cola")) && size_ml > 500) return "pet";

  // Water → PET
  if (cat.includes("water")) return "pet";

  // Wine/spirits → glass
  if (cat.includes("wine") || cat.includes("spirit") || cat.includes("vodka") || cat.includes("whisky") || cat.includes("gin") || cat.includes("rum")) return "glass";

  // Juice in small sizes → liquid paperboard
  if ((cat.includes("juice") || cat.includes("popper") || cat.includes("milk")) && size_ml <= 350) return "liquid_paperboard";

  // Juice in larger → PET
  if (cat.includes("juice")) return "pet";

  // Default: aluminium (most common in AU CDS)
  return "aluminium";
}

// ── Unified Lookup (sync for local, async for API) ──

export function lookupContainer(barcode: string): Container | null {
  return lookupLocal(barcode);
}

export async function lookupContainerAsync(barcode: string): Promise<Container> {
  // 1. Local DB (instant, high confidence)
  const local = lookupLocal(barcode);
  if (local) return local;

  // 2. Open Food Facts API
  const off = await lookupOpenFoodFacts(barcode);
  if (off) return off;

  // 3. Heuristic fallback
  return createUnknownContainer(barcode);
}

export function createUnknownContainer(barcode: string): Container {
  return {
    barcode,
    name: "Unknown Container",
    brand: "Unknown",
    size_ml: 375,
    material: "aluminium", // Most common in AU
    weight_g: 14,
    refund_cents: 5,
    source: "heuristic",
    confidence: "low",
  };
}
