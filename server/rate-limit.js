const DEFAULT_REQUESTER_POLICY = { limit: 20, windowMs: 60_000 };
const DEFAULT_SOURCE_RACE_POLICY = { limit: 5, windowMs: 5 * 60_000 };

function policy(value, fallback) {
  const limit = Number(value?.limit ?? fallback.limit);
  const windowMs = Number(value?.windowMs ?? fallback.windowMs);
  if (!Number.isFinite(limit) || limit < 1 || !Number.isFinite(windowMs) || windowMs < 1) {
    throw new TypeError('Rate-limit policies require positive limit and windowMs values.');
  }
  return { limit: Math.floor(limit), windowMs };
}

function currentBucket(buckets, key, bucketPolicy, now) {
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
} = {}) {
  const requesterPolicy = policy(requester, DEFAULT_REQUESTER_POLICY);
  const sourceRacePolicy = policy(sourceRace, DEFAULT_SOURCE_RACE_POLICY);
  const requesterBuckets = new Map();
  const sourceRaceBuckets = new Map();
  let checks = 0;

  function sweepExpired(at) {
    for (const buckets of [requesterBuckets, sourceRaceBuckets]) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= at) buckets.delete(key);
      }
    }
  }

  return {
    consume({ requester: requesterKey, sourceRace: sourceRaceKey }) {
      const at = Number(now());
      if (!Number.isFinite(at)) throw new TypeError('Rate limiter clock must return milliseconds.');
      if (++checks % 100 === 0) sweepExpired(at);

      const requesterBucket = requesterKey
        ? currentBucket(requesterBuckets, requesterKey, requesterPolicy, at)
        : null;
      const sourceRaceBucket = sourceRaceKey
        ? currentBucket(sourceRaceBuckets, sourceRaceKey, sourceRacePolicy, at)
        : null;

      if (requesterBucket?.count >= requesterPolicy.limit) {
        return {
          allowed: false,
          scope: 'requester',
          retryAfterMs: requesterBucket.resetAt - at
        };
      }
      if (sourceRaceBucket?.count >= sourceRacePolicy.limit) {
        return {
          allowed: false,
          scope: 'source race',
          retryAfterMs: sourceRaceBucket.resetAt - at
        };
      }

      if (requesterBucket) {
        requesterBucket.count += 1;
        requesterBuckets.set(requesterKey, requesterBucket);
      }
      if (sourceRaceBucket) {
        sourceRaceBucket.count += 1;
        sourceRaceBuckets.set(sourceRaceKey, sourceRaceBucket);
      }
      return { allowed: true };
    }
  };
}
