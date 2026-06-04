'use strict';

const { getRedis } = require('./redis');

const CACHE_TTL = 3600; // 1 hour
const CACHE_PREFIX = 'smartmedia:license:';

/**
 * Validate a Lemon Squeezy license key.
 * Result is cached in Redis for 1 hour to avoid hammering the LS API.
 *
 * @param {string} licenseKey
 * @param {string} hostname  — WordPress site hostname, used as instance name
 * @returns {Promise<boolean>}
 */
async function isValidLicense(licenseKey, hostname) {
  if (!licenseKey) return false;

  const redis = getRedis();
  const cacheKey = CACHE_PREFIX + licenseKey;

  // Check cache first.
  const cached = await redis.get(cacheKey);
  if (cached !== null) {
    return cached === '1';
  }

  try {
    const body = new URLSearchParams({
      license_key: licenseKey,
      instance_name: hostname,
    });

    const res = await fetch('https://api.lemonsqueezy.com/v1/licenses/validate', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${process.env.LEMON_SQUEEZY_API_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const data = await res.json();
    const valid = res.ok && data.valid === true && data.license_key?.status === 'active';

    await redis.set(cacheKey, valid ? '1' : '0', 'EX', CACHE_TTL);
    return valid;
  } catch (err) {
    console.error('[license] validation error:', err.message);
    // On network error: fail open (allow the request) to avoid blocking paying users.
    return true;
  }
}

module.exports = { isValidLicense };
