export const rewardStatuses = [
  "created",
  "claimable",
  "claim_in_progress",
  "claimed",
  "expired",
  "cancelled",
  "failed",
  "reconciliation_required",
] as const;
export type RewardStatus = (typeof rewardStatuses)[number];

const transitions: Readonly<Record<RewardStatus, ReadonlySet<RewardStatus>>> = {
  created: new Set(["claimable", "cancelled", "reconciliation_required"]),
  claimable: new Set(["claim_in_progress", "expired", "cancelled", "reconciliation_required"]),
  claim_in_progress: new Set(["claimable", "claimed", "failed", "reconciliation_required"]),
  reconciliation_required: new Set(["claim_in_progress", "claimed", "failed", "cancelled"]),
  claimed: new Set(),
  expired: new Set(),
  cancelled: new Set(),
  failed: new Set(),
};

export const terminalStatuses = new Set<RewardStatus>([
  "claimed",
  "expired",
  "cancelled",
  "failed",
]);

export function assertTransition(from: RewardStatus, to: RewardStatus): void {
  if (!transitions[from].has(to)) throw new Error(`invalid reward transition ${from} -> ${to}`);
}
