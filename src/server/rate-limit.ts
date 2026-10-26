// Fixed-window in-memory rate limiter. Per-process only: adequate for a single-instance
// deployment; a shared store (e.g. Redis) is required when running multiple instances.
import { RateLimitedError } from "./errors";

const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) throw new RateLimitedError();
}

export function resetRateLimits() {
  buckets.clear();
}
