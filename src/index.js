'use strict';

require('dotenv').config();

const express = require('express');
const { isValidLicense } = require('./license');
const { checkRateLimit } = require('./rateLimit');
const { analyzeImage, extractKeywords, fallbackMeta } = require('./openrouter');

const app  = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Accept large JSON bodies — base64 images can be several MB.
app.use(express.json({ limit: '25mb' }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the hostname from a site_url string.
 * Returns null when the URL is missing or invalid.
 *
 * @param {string} siteUrl
 * @returns {string|null}
 */
function extractHostname(siteUrl) {
  if (!siteUrl || typeof siteUrl !== 'string') return null;
  try {
    return new URL(siteUrl).hostname;
  } catch {
    return null;
  }
}

/**
 * Resolve tier and enforce rate limit / license gate.
 * Returns { isPro } on success, or sends a 429/403 response and returns null.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {string} hostname
 * @param {string} licenseKey
 * @returns {Promise<{ isPro: boolean }|null>}
 */
async function resolveTier(req, res, hostname, licenseKey) {
  if (licenseKey) {
    const valid = await isValidLicense(licenseKey, hostname);
    if (!valid) {
      res.status(403).json({ error: 'invalid_license', message: 'Invalid license key.' });
      return null;
    }
    return { isPro: true };
  }

  // Free tier — apply rate limit.
  const rl = await checkRateLimit(hostname);
  if (!rl.allowed) {
    res.status(429).json({
      error: 'rate_limit',
      message: `Monthly limit of ${rl.limit} AI analyses reached. Upgrade to Pro for unlimited use.`,
      used:  rl.used,
      limit: rl.limit,
    });
    return null;
  }

  return { isPro: false };
}

// ---------------------------------------------------------------------------
// POST /analyze
// ---------------------------------------------------------------------------

app.post('/analyze', async (req, res) => {
  const {
    image,
    mime         = 'image/webp',
    original_name = 'image.jpg',
    article       = '',
    keywords      = '',
    site_url      = '',
    site_language = 'en-US',
    license_key   = '',
  } = req.body;

  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'bad_request', message: 'Missing or invalid "image" field.' });
  }

  const hostname = extractHostname(site_url);
  if (!hostname) {
    return res.status(400).json({ error: 'bad_request', message: 'Missing or invalid "site_url".' });
  }

  const tier = await resolveTier(req, res, hostname, license_key);
  if (!tier) return; // response already sent

  try {
    const meta = await analyzeImage({
      imageBase64: image,
      mime,
      originalName: original_name,
      article,
      keywords,
      siteLanguage: site_language,
      isPro: tier.isPro,
    });

    return res.json(meta);
  } catch (err) {
    console.error('[/analyze] OpenRouter error:', err.message);
    // Return fallback metadata rather than a hard 500 — the plugin gracefully
    // handles missing AI data, so this prevents silent upload failures.
    return res.json({ ...fallbackMeta(original_name), keywords: [], _error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /extract-keywords
// ---------------------------------------------------------------------------

app.post('/extract-keywords', async (req, res) => {
  const {
    title         = '',
    alt           = '',
    site_url      = '',
    site_language = 'en-US',
    license_key   = '',
  } = req.body;

  const hostname = extractHostname(site_url);
  if (!hostname) {
    return res.status(400).json({ error: 'bad_request', message: 'Missing or invalid "site_url".' });
  }

  const tier = await resolveTier(req, res, hostname, license_key);
  if (!tier) return;

  try {
    const kws = await extractKeywords({ title, alt, siteLanguage: site_language, isPro: tier.isPro });
    return res.json({ keywords: kws });
  } catch (err) {
    console.error('[/extract-keywords] OpenRouter error:', err.message);
    return res.json({ keywords: [] });
  }
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`[smartmedia-relay] listening on port ${PORT}`);
});
