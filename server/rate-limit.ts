type RateLimitPolicy = {
  limit: number;
  windowMs: number;
};

type RateLimitPolicyInput = Partial<RateLimitPolicy> | null | undefined;

type Bucket = {
  count: number;
  resetAt: number;
};

export type RateLimitKeys = {
  requester?: string | null;
  sourceRace?: string | null;
};

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; scope: 'requester' | 'source race'; retryAfterMs: number };

export type RateLimiter = {
  consume(keys: RateLimitKeys): RateLimitResult;
};

export type CreateLimiterOptions = {
  requester?: RateLimitPolicyInput;
  sourceRace?: RateLimitPolicyInput;
  now?: () => number;
};

const DEFAULT_REQUESTER_POLICY: RateLimitPolicy = { limit: 20, windowMs: 60_000 };
const DEFAULT_SOURCE_RACE_POLICY: RateLimitPolicy = { limit: 5, windowMs: 5 * 60_000 };

function policy(value: RateLimitPolicyInput, fallback: RateLimitPolicy): RateLimitPolicy {
  const limit = Number(value?.limit ?? fallback.limit);
  const windowMs = Number(value?.windowMs ?? fallback.windowMs);
  if (!Number.isFinite(limit) || limit < 1 || !Number.isFinite(windowMs) || windowMs < 1) {
    throw new TypeError('Rate-limit policies require positive limit and windowMs values.');
  }
  return { limit: Math.floor(limit), windowMs };
}

function currentBucket(
  buckets: Map<string, Bucket>,
  key: string,
  bucketPolicy: RateLimitPolicy,
  now: number
): Bucket {
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    return { count: 0, resetAt: now + bucketPolicy.windowMs };
  }
  return existing;
}

export function createLimiter({
  requester,
  sourceRace,
  now = Date.now
}: CreateLimiterOptions = {}): RateLimiter {
  const requesterPolicy = policy(requester, DEFAULT_REQUESTER_POLICY);
  const sourceRacePolicy = policy(sourceRace, DEFAULT_SOURCE_RACE_POLICY);
  const requesterBuckets = new Map<string, Bucket>();
  const sourceRaceBuckets = new Map<string, Bucket>();
  let checks = 0;

  function sweepExpired(at: number): void {
    for (const buckets of [requesterBuckets, sourceRaceBuckets]) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= at) buckets.delete(key);
      }
    }
  }

  return {
    consume({ requester: requesterKey, sourceRace: sourceRaceKey }: RateLimitKeys): RateLimitResult {
      const at = Number(now());
      if (!Number.isFinite(at)) throw new TypeError('Rate limiter clock must return milliseconds.');
      if (++checks % 100 === 0) sweepExpired(at);

      const requesterBucket = requesterKey
        ? currentBucket(requesterBuckets, requesterKey, requesterPolicy, at)
        : null;
      const sourceRaceBucket = sourceRaceKey
        ? currentBucket(sourceRaceBuckets, sourceRaceKey, sourceRacePolicy, at)
        : null;

      if (requesterBucket && requesterBucket.count >= requesterPolicy.limit) {
        return {
          allowed: false,
          scope: 'requester',
          retryAfterMs: requesterBucket.resetAt - at
        };
      }
      if (sourceRaceBucket && sourceRaceBucket.count >= sourceRacePolicy.limit) {
        return {
          allowed: false,
          scope: 'source race',
          retryAfterMs: sourceRaceBucket.resetAt - at
        };
      }

      if (requesterBucket && requesterKey) {
        requesterBucket.count += 1;
        requesterBuckets.set(requesterKey, requesterBucket);
      }
      if (sourceRaceBucket && sourceRaceKey) {
        sourceRaceBucket.count += 1;
        sourceRaceBuckets.set(sourceRaceKey, sourceRaceBucket);
      }
      return { allowed: true };
    }
  };
}
