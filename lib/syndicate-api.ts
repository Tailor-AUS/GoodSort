import { apiUrl, authHeaders } from "./config.ts";

export type SyndicateStatus = "detected" | "official" | "paused";
export type SyndicatePickupStatus = "none" | "requested" | "scheduled";
export type SyndicateMemberStatus = "none" | "pending" | "approved" | "rejected";
export type SyndicateRole = "none" | "member" | "captain";
export type SyndicateDropSpot = "bin_room" | "loading_dock" | "lobby" | "kerbside";
export type SyndicatePickupWindow = "weekday_am" | "weekday_pm" | "saturday_am";

export const DROP_SPOT_OPTIONS: { id: SyndicateDropSpot; label: string }[] = [
  { id: "bin_room", label: "Bin room" },
  { id: "loading_dock", label: "Loading dock" },
  { id: "lobby", label: "Lobby / mailroom" },
  { id: "kerbside", label: "Street kerb" },
];

export const PICKUP_WINDOW_OPTIONS: { id: SyndicatePickupWindow; label: string }[] = [
  { id: "weekday_am", label: "Weekday AM" },
  { id: "weekday_pm", label: "Weekday PM" },
  { id: "saturday_am", label: "Saturday AM" },
];

export function formatDropSpot(code?: string | null): string {
  return DROP_SPOT_OPTIONS.find((o) => o.id === code)?.label ?? "Not set";
}

export function formatPickupWindow(code?: string | null): string {
  return PICKUP_WINDOW_OPTIONS.find((o) => o.id === code)?.label ?? "Flexible";
}

export interface SyndicateSummary {
  id: string;
  displayName: string;
  channelName: string;
  suburb: string;
  buildingKind: string;
  status: SyndicateStatus;
  pickupStatus: SyndicatePickupStatus;
  dropSpot: string | null;
  pickupWindow: string | null;
  pickupRequestedAt: string | null;
  pickupRequestedByHandle: string | null;
  officialApprovedAt: string | null;
  targetContainers: number;
  totalSortersInBuilding: number;
  otherSortersCount: number;
  approvedMembersCount: number;
  pendingRequestsCount: number;
  readyCount: number;
  totalContainers: number;
  potCents: number;
  dropSpotVotes: Record<string, number>;
  pickupWindowVotes: Record<string, number>;
}

export interface SyndicateMembership {
  memberId: string | null;
  anonHandle: string | null;
  role: SyndicateRole;
  status: SyndicateMemberStatus;
  readyToPool: boolean;
  votedDropSpot: string | null;
  votedPickupWindow: string | null;
  myContainers: number;
  mySharePct: number;
  canApprovePending: boolean;
}

export interface AnonymousSyndicateMember {
  id: string;
  anonHandle: string;
  role: string;
  readyToPool: boolean;
  isMe: boolean;
}

export interface PendingSyndicateRequest {
  id: string;
  anonHandle: string;
  joinedAt: string;
}

export interface SyndicateMessage {
  id: string;
  anonHandle: string;
  kind: "chat" | "system";
  body: string;
  createdAt: string;
  isMine: boolean;
}

export interface MySyndicateResponse {
  eligible: boolean;
  reason?: string;
  syndicate?: SyndicateSummary;
  myMembership?: SyndicateMembership;
  members?: AnonymousSyndicateMember[];
  pendingRequests?: PendingSyndicateRequest[];
  messages?: SyndicateMessage[];
}

export interface AdminSyndicateMember {
  id: string;
  anonHandle: string;
  role: string;
  status: string;
  readyToPool: boolean;
  votedDropSpot: string | null;
  votedPickupWindow: string | null;
  joinedAt: string;
}

export interface AdminFlaggedMessage {
  id: string;
  anonHandle: string;
  body: string;
  flagCount: number;
  hidden: boolean;
  createdAt: string;
}

export interface AdminSyndicateItem {
  id: string;
  buildingKey: string;
  displayName: string;
  suburb: string;
  buildingKind: string;
  status: SyndicateStatus;
  pickupStatus: SyndicatePickupStatus;
  dropSpot: string | null;
  pickupWindow: string | null;
  pickupRequestedAt: string | null;
  pickupRequestedByHandle: string | null;
  officialApprovedAt: string | null;
  createdAt: string;
  updatedAt: string;
  totalSortersInBuilding: number;
  totalContainers: number;
  potCents: number;
  approvedCount: number;
  pendingCount: number;
  readyCount: number;
  flaggedCount: number;
  members: AdminSyndicateMember[];
  flaggedMessages: AdminFlaggedMessage[];
}

export interface AdminSyndicatesResponse {
  total: number;
  official: number;
  detected: number;
  pickupRequested: number;
  syndicates: AdminSyndicateItem[];
}

/** Client-side detector mirroring BuildingAddress.cs for instant onboarding feedback. */
export function looksLikeMultiUnitOrCommercialAddress(address: string): {
  detected: boolean;
  kind: "commercial" | "residential";
} {
  const raw = (address || "").trim();
  if (!raw) return { detected: false, kind: "residential" };
  const commercial = /\b(?:level|lvl|floor|suite|ste|office|tenancy|shop|tower|plaza|chambers|commercial|centre|center)\b/i.test(raw);
  const multiUnit =
    commercial ||
    /^\s*(?:unit|u|apt|apartment|flat|lot|villa|townhouse|bldg|building)\s*[a-z0-9\-]+/i.test(raw) ||
    /^\s*[a-z]?\d+[a-z]?\s*\/\s*\d+[a-z]?\s+[a-z]/i.test(raw);
  return {
    detected: multiUnit,
    kind: commercial ? "commercial" : "residential",
  };
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({} as { error?: string }));
  return typeof body.error === "string" && body.error ? body.error : fallback;
}

export async function fetchMySyndicate(): Promise<MySyndicateResponse | null> {
  const res = await fetch(apiUrl("/api/syndicates/mine"), {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as MySyndicateResponse;
}

export async function requestJoinMySyndicate(): Promise<MySyndicateResponse> {
  const res = await fetch(apiUrl("/api/syndicates/mine/request-join"), {
    method: "POST",
    headers: authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await readApiError(res, "Could not request to join building syndicate."));
  return (await res.json()) as MySyndicateResponse;
}

export async function decideSyndicateMember(
  memberId: string,
  decision: "approve" | "reject",
): Promise<MySyndicateResponse> {
  const res = await fetch(apiUrl(`/api/syndicates/mine/members/${memberId}/decision`), {
    method: "POST",
    headers: authHeaders(),
    cache: "no-store",
    body: JSON.stringify({ decision }),
  });
  if (!res.ok) throw new Error(await readApiError(res, "Could not update member request."));
  return (await res.json()) as MySyndicateResponse;
}

export async function updateSyndicateCoordination(payload: {
  readyToPool?: boolean;
  dropSpot?: SyndicateDropSpot;
  pickupWindow?: SyndicatePickupWindow;
  requestPickup?: boolean;
}): Promise<MySyndicateResponse> {
  const res = await fetch(apiUrl("/api/syndicates/mine/coordination"), {
    method: "POST",
    headers: authHeaders(),
    cache: "no-store",
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readApiError(res, "Could not save building pickup preference."));
  return (await res.json()) as MySyndicateResponse;
}

export async function postSyndicateMessage(body: string): Promise<SyndicateMessage> {
  const res = await fetch(apiUrl("/api/syndicates/mine/messages"), {
    method: "POST",
    headers: authHeaders(),
    cache: "no-store",
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(await readApiError(res, "Could not send message."));
  return (await res.json()) as SyndicateMessage;
}

export async function reportSyndicateMessage(messageId: string): Promise<{ reported: boolean; hidden: boolean }> {
  const res = await fetch(apiUrl(`/api/syndicates/mine/messages/${messageId}/report`), {
    method: "POST",
    headers: authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await readApiError(res, "Could not report message."));
  return (await res.json()) as { reported: boolean; hidden: boolean };
}
