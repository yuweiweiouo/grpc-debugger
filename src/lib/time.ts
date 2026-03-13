export function normalizeTimestampMs(timestamp) {
  if (timestamp == null) return null;

  const numericTimestamp = Number(timestamp);
  if (!Number.isFinite(numericTimestamp)) return null;

  return numericTimestamp < 1e12 ? numericTimestamp * 1000 : numericTimestamp;
}

export function resolveTimestampMs(timestamp, fallbackTimestamp = Date.now()) {
  return normalizeTimestampMs(timestamp) ?? normalizeTimestampMs(fallbackTimestamp);
}
