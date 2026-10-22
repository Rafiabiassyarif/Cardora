// rateLimit.ts — token bucket per kunci (socket / IP). Tanpa dependensi.

export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();

  constructor(private capacity: number, private refillPerSecond: number) {}

  /** true = diizinkan. */
  take(key: string, cost = 1): boolean {
    const now = Date.now();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, at: now };
    b.tokens = Math.min(this.capacity, b.tokens + ((now - b.at) / 1000) * this.refillPerSecond);
    b.at = now;
    const ok = b.tokens >= cost;
    if (ok) b.tokens -= cost;
    this.buckets.set(key, b);
    if (this.buckets.size > 50000) this.sweep(now);
    return ok;
  }

  private sweep(now: number) {
    for (const [k, b] of this.buckets) if (now - b.at > 600_000) this.buckets.delete(k);
  }
}
