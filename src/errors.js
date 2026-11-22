export class LibDBError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = "LibDBError";
    this.code = code; // "OPEN_FAILED" | "QUOTA_EXCEEDED" | "TX_FAILED"
  }
}

export function normalizeError(err, fallbackCode = "TX_FAILED") {
  if (err?.name === "QuotaExceededError") {
    return new LibDBError("QUOTA_EXCEEDED", "ブラウザの保存容量上限に達しました", err);
  }
  return new LibDBError(fallbackCode, err?.message || "Database operation failed", err);
}
