const MAX_INT64 = 9_223_372_036_854_775_807n;
const DECIMAL_FILE_ID = /^\d+$/;

/**
 * Normalize a positive int64 file ID without passing it through Number.
 *
 * MiniMax documents file_id as int64, while its JSON examples encode IDs as
 * strings. Sending the decimal string preserves all int64 values and remains
 * compatible with callers that previously supplied safe integer numbers.
 */
export function normalizeFileId(fileId: string | number | bigint): string | undefined {
  if (typeof fileId === 'number') {
    if (!Number.isSafeInteger(fileId) || fileId <= 0) return undefined;
    return String(fileId);
  }

  const decimal = typeof fileId === 'bigint' ? fileId.toString() : fileId;
  if (!DECIMAL_FILE_ID.test(decimal)) return undefined;

  const value = BigInt(decimal);
  if (value <= 0n || value > MAX_INT64) return undefined;

  return decimal;
}
