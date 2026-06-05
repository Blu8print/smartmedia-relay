'use strict';

const { getRedis } = require('./redis');

const FREE_LIMIT = parseInt(process.env.MONTHLY_FREE_LIMIT || '50', 10);
const PREFIX = 'smartmedia:rl:';

/**
 * Returns the current month key: YYYY-MM
 */
function monthKey() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Number of seconds until the end of the current UTC month (+ 1 day buffer).
 */
function secondsUntilNextMonth() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return Math.ceil((next - now) / 1000) + 86400;
}

/**
 * Check and increment the rate limit counter for a domain.
 *
 * @param {string} hostname
 * @returns {Promise<{ allowed: boolean, used: number, limit: number }>}
 */
async function checkRateLimit(hostname) {
  const redis = getRedis();
  const key = PREFIX + hostname + ':' + monthKey();

  const count = await redis.incr(key);

  // Set TTL only on first increment so the key auto-expires after the month.
  if (count === 1) {
    await redis.expire(key, secondsUntilNextMonth());
  }

  return {
    allowed: count <= FREE_LIMIT,
    used: count,
    limit: FREE_LIMIT,
  };
}

/**
 * Get current usage without incrementing (for diagnostics).
 *
 * @param {string} hostname
 * @returns {Promise<number>}
 */
async function getUsage(hostname) {
  const redis = getRedis();
  const key = PREFIX + hostname + ':' + monthKey();
  const val = await redis.get(key);
  const used = val ? parseInt(val, 10) : 0;
  return { used, limit: FREE_LIMIT };
}

module.exports = { checkRateLimit, getUsage };
