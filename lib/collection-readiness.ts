/**
 * Honest suburb collection readiness for the household journey.
 *
 * Mirrors GoodSort.Api CollectionReadiness. The aluminium threshold comes only
 * from operator configuration; with none set the status is
 * "pending_operator_configuration" and no number, household count, bin service
 * or collection date is shown. Reaching a configured volume is NOT a
 * collection — only ops commitment (bins allocated/delivered/collecting) is.
 */

export type ReadinessStatus =
  | "pending_operator_configuration"
  | "accumulating"
  | "aluminium_volume_reached_awaiting_ops"
  | "ops_committed";

export type SuburbReadiness = {
  status: ReadinessStatus;
  aluminiumContainers: number;
  aluminiumThreshold: number | null;
  aluminiumNeeded: number | null;
};

export type CollectionReadinessConfig = {
  configured: boolean;
  aluminiumThreshold: number | null;
  source: "none" | "operator_config" | "local_fixture";
  fixtureLabel: string | null;
};

export const PENDING_READINESS_CONFIG: CollectionReadinessConfig = {
  configured: false,
  aluminiumThreshold: null,
  source: "none",
  fixtureLabel: null,
};

const KNOWN: ReadinessStatus[] = [
  "pending_operator_configuration",
  "accumulating",
  "aluminium_volume_reached_awaiting_ops",
  "ops_committed",
];

/**
 * Normalise whatever the API sent. Anything missing or unrecognised falls back
 * to pending — an older API, or a malformed payload, must never read as a
 * configured or reached threshold.
 */
export function normaliseReadiness(raw: unknown, aluminiumFallback = 0): SuburbReadiness {
  const r = (raw ?? {}) as Partial<SuburbReadiness>;
  const status = KNOWN.includes(r.status as ReadinessStatus) ? (r.status as ReadinessStatus) : "pending_operator_configuration";
  const alu = Number.isFinite(r.aluminiumContainers) ? Math.max(0, Number(r.aluminiumContainers)) : Math.max(0, aluminiumFallback);
  const threshold = status === "pending_operator_configuration" ? null : positiveOrNull(r.aluminiumThreshold);
  const needed = status === "pending_operator_configuration" ? null : nonNegativeOrNull(r.aluminiumNeeded);
  // A non-pending status without a threshold (other than ops commitment) is incoherent: treat as pending.
  if ((status === "accumulating" || status === "aluminium_volume_reached_awaiting_ops") && threshold === null) {
    return { status: "pending_operator_configuration", aluminiumContainers: alu, aluminiumThreshold: null, aluminiumNeeded: null };
  }
  return { status, aluminiumContainers: alu, aluminiumThreshold: threshold, aluminiumNeeded: needed };
}

export function normaliseReadinessConfig(raw: unknown): CollectionReadinessConfig {
  const c = (raw ?? {}) as Partial<CollectionReadinessConfig>;
  const threshold = positiveOrNull(c.aluminiumThreshold);
  if (!c.configured || threshold === null) return PENDING_READINESS_CONFIG;
  const fixture = c.source === "local_fixture";
  return {
    configured: true,
    aluminiumThreshold: threshold,
    source: fixture ? "local_fixture" : "operator_config",
    fixtureLabel: fixture && typeof c.fixtureLabel === "string" && c.fixtureLabel.trim() ? c.fixtureLabel.trim() : fixture ? "local fixture" : null,
  };
}

function positiveOrNull(v: unknown): number | null {
  const n = Number(v);
  return v != null && Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}
function nonNegativeOrNull(v: unknown): number | null {
  const n = Number(v);
  return v != null && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

export type ReadinessCopy = {
  title: string;
  body: string;
  /** 0–100 only when an operator threshold exists; null means draw no bar. */
  progressPct: number | null;
  /** Shown verbatim when the threshold is a local test fixture. */
  fixtureNote: string | null;
};

const cans = (n: number) => `${n.toLocaleString("en-AU")} aluminium can${n === 1 ? "" : "s"}`;

/** Copy for a residential household whose suburb is known and not yet ops-committed. */
export function readinessCopy(
  readiness: SuburbReadiness,
  config: CollectionReadinessConfig,
  place: string,
): ReadinessCopy {
  const fixtureNote = config.source === "local_fixture" ? `Local test fixture threshold (${config.fixtureLabel ?? "local fixture"}) — not an operator setting.` : null;
  const alu = readiness.aluminiumContainers;
  switch (readiness.status) {
    case "ops_committed":
      return {
        title: `${place} — ops have committed a run`,
        body: "We'll tell you when to bag out.",
        progressPct: null,
        fixtureNote,
      };
    case "aluminium_volume_reached_awaiting_ops":
      return {
        title: `${place} reached the aluminium volume`,
        body: `${cans(alu)} scanned. Ops now decide on a driver trip — nothing is scheduled until they confirm.`,
        progressPct: 100,
        fixtureNote,
      };
    case "accumulating": {
      const t = readiness.aluminiumThreshold ?? 0;
      const needed = readiness.aluminiumNeeded ?? Math.max(0, t - alu);
      return {
        title: `Keep scanning in ${place}`,
        body: `${alu.toLocaleString("en-AU")}/${t.toLocaleString("en-AU")} aluminium cans. ${needed.toLocaleString("en-AU")} more before ops consider a driver trip. No collection is scheduled yet.`,
        progressPct: t > 0 ? Math.min(100, Math.round((alu / t) * 100)) : null,
        fixtureNote,
      };
    }
    default:
      return {
        title: `Keep scanning in ${place}`,
        body: `${cans(alu)} scanned in ${place} so far. The collection trigger is pending operator configuration — no collection is scheduled yet.`,
        progressPct: null,
        fixtureNote: null,
      };
  }
}
