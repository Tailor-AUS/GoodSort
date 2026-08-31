// Container lookup — multi-source: local DB → Open Food Facts → heuristic
// QLD Container Refund Scheme: eligible 150ml to 3L beverage containers

import { apiUrl } from "./config.ts";

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

// Nine entries were removed on 2026-08-31: eight had invalid EAN-13 check
// digits and one ("93711400001") was eleven digits, which is not a retail
// barcode length at all. None of them could ever match a real scan — a reader
// cannot produce a barcode whose check digit does not compute — so they were
// coverage on paper only. Real coverage was 39, not 48.
//
// The products themselves are still uncovered and worth adding back with
// barcodes read off an actual container: Pepsi 375ml, Pepsi Max 375ml, Solo
// 375ml, Balter XPA 375ml, Stone & Wood Pacific Ale 375ml, Just Juice Apple
// 250ml, Golden Circle Tropical 250ml, Nippy's Chocolate Milk 375ml, Cool Ridge
// Water 600ml. containers.test.ts rejects any entry whose check digit is wrong,
// so a guessed barcode will fail the build rather than sit here looking real.
//
// One category is now empty rather than thin: all three liquid-paperboard
// rows (juice poppers and flavoured milk) were among the fabricated ones, so
// the table covers no cartons at all. Every carton scanned today takes the
// unknown path.
//
// This matters more than a stale row usually would: Open Food Facts has no
// record for any Australian beverage barcode in this table (measured 2026-08-31,
// 48/48 returned HTTP 404), so a miss here does not get a second opinion — it
// falls straight to createUnknownContainer, which assumes aluminium.
export const LOCAL_DB: Container[] = [
  // ── Aluminium Cans ──
  // Coca-Cola range
  { barcode: "9300675024457", name: "Coca-Cola 375ml", brand: "Coca-Cola", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300675024464", name: "Coke Zero 375ml", brand: "Coca-Cola", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300675024471", name: "Sprite 375ml", brand: "Coca-Cola", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300675024488", name: "Fanta 375ml", brand: "Coca-Cola", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300675024495", name: "Diet Coke 375ml", brand: "Coca-Cola", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300675024501", name: "Lift 375ml", brand: "Coca-Cola", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300675030014", name: "Kirks Lemonade 375ml", brand: "Coca-Cola", size_ml: 375, material: "aluminium", weight_g: 14, refund_cents: 5, source: "local", confidence: "high" },
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
  { barcode: "9300675025195", name: "Sprite 1.25L PET", brand: "Coca-Cola", size_ml: 1250, material: "pet", weight_g: 42, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300675025201", name: "Fanta 1.25L PET", brand: "Coca-Cola", size_ml: 1250, material: "pet", weight_g: 42, refund_cents: 5, source: "local", confidence: "high" },

  // ── Glass Bottles ──
  { barcode: "9310058100012", name: "XXXX Gold Stubby 330ml", brand: "Lion", size_ml: 330, material: "glass", weight_g: 190, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9310058100029", name: "James Squire 345ml", brand: "Lion", size_ml: 345, material: "glass", weight_g: 210, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300652100112", name: "Great Northern Stubby 330ml", brand: "CUB", size_ml: 330, material: "glass", weight_g: 190, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300652100129", name: "Crown Lager 375ml", brand: "CUB", size_ml: 375, material: "glass", weight_g: 220, refund_cents: 5, source: "local", confidence: "high" },
  { barcode: "9300652100136", name: "Peroni Nastro Azzurro 330ml", brand: "Asahi", size_ml: 330, material: "glass", weight_g: 190, refund_cents: 5, source: "local", confidence: "high" },
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

/**
 * Same product, different digits.
 *
 * Robustness, not a live bug — worth being precise about which. The table is
 * currently 46 Australian 93x EAN-13s plus two short codes, none starting with
 * a zero, and the only caller (scanner.tsx processBarcodeResult) already strips
 * non-digits before it gets here. So no real scan misses today.
 *
 * It matters as the table grows. UPC-A widens to EAN-13 by gaining a leading
 * zero, and EAN-13 widens to GTIN-14 the same way, so an imported product added
 * in its 13-digit form will not match the 12 digits a reader hands back. That
 * miss is not harmless: the lookup falls through to createUnknownContainer,
 * which assumes aluminium — a glass bottle would be named "Unknown Container"
 * and sent to the aluminium bag.
 *
 * Leading zeros only. Stripping zeros anywhere would collide distinct products,
 * and no two current entries collide that way, so the suite would not have
 * noticed — containers.test.ts carries two synthetic colliders for exactly that.
 */
function canonicalBarcode(barcode: string): string {
  const digits = barcode.trim().replace(/\D/g, "");
  const trimmed = digits.replace(/^0+/, "");
  return trimmed.length > 0 ? trimmed : digits;
}

export function lookupLocal(barcode: string): Container | null {
  const wanted = canonicalBarcode(barcode);
  if (wanted.length === 0) return null;
  return LOCAL_DB.find((c) => canonicalBarcode(c.barcode) === wanted) || null;
}

// ── Source 2: Open Food Facts API ──

/**
 * Goes through our own API, not to openfoodfacts.org directly.
 *
 * I first justified this by saying CSP refused the direct call. That was wrong:
 * the CSP was never served, because staticwebapp.config.json sat at the repo
 * root and never reached the deployed artifact. The direct call worked and
 * simply found nothing, since OFF has no record for Australian beverage
 * barcodes. The config is deployed now, so a direct call would be refused —
 * and lib/csp.test.ts keeps client hosts and connect-src in step.
 *
 * The `User-Agent` header the old call set was doing nothing either — it is a
 * forbidden header name in fetch, so browsers drop it silently, and Open Food
 * Facts asks callers to identify themselves. The server sends it for real, and
 * applies a timeout and a per-IP ceiling that a page cannot.
 */
export async function lookupOpenFoodFacts(barcode: string): Promise<Container | null> {
  try {
    const res = await fetch(apiUrl(`/api/barcode/${encodeURIComponent(barcode)}`));
    if (!res.ok) return null;
    const p = await res.json();
    if (!p?.found) return null;

    const name = p.productName || "Unknown Product";
    const qty = p.quantity || "";
    const size_ml = parseSize(qty);
    const material = classifyMaterialFromOFF({
      packaging_materials_tags: p.packagingMaterialsTags,
      packaging: p.packaging,
      categories: p.categories,
    });

    return {
      barcode,
      name: `${name} ${qty}`.trim(),
      brand: p.brands || "Unknown",
      size_ml,
      material,
      weight_g: estimateWeight(material, size_ml),
      refund_cents: 5,
      source: "openfoodfacts",
      confidence: p.packagingMaterialsTags?.length > 0 ? "high" : "medium",
    };
  } catch {
    return null;
  }
}

export function classifyMaterialFromOFF(product: Record<string, unknown>): ContainerMaterial {
  const tags = (product.packaging_materials_tags as string[]) || [];
  const packaging = ((product.packaging as string) || "").toLowerCase();
  const categories = ((product.categories as string) || "").toLowerCase();

  // Check packaging_materials_tags first (most reliable)
  for (const tag of tags) {
    const t = tag.toLowerCase();
    if (t.includes("aluminium") || t.includes("aluminum") || t.includes("steel")) return "aluminium";
    // HDPE and polypropylene are not PET. They used to be mapped here as "pet",
    // which sends a milk or juice bottle to the PET bag — and PET clear is the
    // highest-value plastic stream, so contaminating it downgrades the whole
    // load at the depot. They belong in the "other" section, which is exactly
    // what toBagMaterial("hdpe") returns.
    //
    // This was unreachable until the lookup started working: the tier that
    // feeds it was refused by CSP, so nothing ever came through here. Fixing
    // that made this live, which is why it is corrected in the same change.
    if (t.includes("hdpe") || t.includes("pp-") || t.includes("polypropylene")) return "hdpe";
    if (t.includes("pet") || t.includes("polyethylene-terephthalate")) return "pet";
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
