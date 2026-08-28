export interface ResolvedQuotaCounts {
  used: number;
  remaining: number;
  total: number;
}

const PERCENT_MATCH_TOLERANCE = 1;

/**
 * Resolve the ambiguous `*_usage_count` fields returned by the quota API.
 *
 * Older responses use the fields as remaining counts, while newer responses
 * may use them as consumed counts. When the server also returns an explicit
 * remaining percentage, use it to select the interpretation that agrees with
 * the authoritative percentage. Without a percentage, preserve the legacy
 * remaining-count interpretation.
 */
export function resolveQuotaCounts(
  reportedCount: number,
  total: number,
  remainingPercent?: number | null,
): ResolvedQuotaCounts | undefined {
  if (!Number.isFinite(reportedCount)
    || !Number.isFinite(total)
    || total <= 0
    || reportedCount < 0
    || reportedCount > total) {
    return undefined;
  }

  let remaining = reportedCount;

  if (remainingPercent !== undefined
    && remainingPercent !== null
    && Number.isFinite(remainingPercent)) {
    const reportedAsRemaining = (reportedCount / total) * 100;
    const reportedAsUsed = ((total - reportedCount) / total) * 100;
    const remainingDistance = Math.abs(reportedAsRemaining - remainingPercent);
    const usedDistance = Math.abs(reportedAsUsed - remainingPercent);
    const closestDistance = Math.min(remainingDistance, usedDistance);

    if (closestDistance > PERCENT_MATCH_TOLERANCE) return undefined;
    if (usedDistance < remainingDistance) remaining = total - reportedCount;
  }

  return {
    used: total - remaining,
    remaining,
    total,
  };
}
