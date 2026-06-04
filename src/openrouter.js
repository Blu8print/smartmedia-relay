'use strict';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Free tier uses a cost-free vision model; Pro gets a higher quality one.
const MODEL_FREE = 'google/gemini-2.0-flash-exp:free';
const MODEL_PRO  = 'google/gemini-2.0-flash-001';

/**
 * Call OpenRouter with a vision prompt and return the raw text response.
 *
 * @param {Array} messages  — OpenRouter messages array
 * @param {boolean} isPro
 * @returns {Promise<string>}
 */
async function callOpenRouter(messages, isPro = false) {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://relay.smartmedia.blu8print.com',
    },
    body: JSON.stringify({
      model: isPro ? MODEL_PRO : MODEL_FREE,
      messages,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

/**
 * Parse a JSON object out of a raw string (handles markdown code-block wrapping).
 *
 * @param {string} text
 * @returns {object|null}
 */
function parseJSON(text) {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const objMatch = text.match(/\{[\s\S]*?\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch { /* fall through */ }
  }
  return null;
}

/**
 * Parse a JSON array out of a raw string.
 *
 * @param {string} text
 * @returns {Array|null}
 */
function parseJSONArray(text) {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const arrMatch = text.match(/\[[\s\S]*?\]/);
  if (arrMatch) {
    try { return JSON.parse(arrMatch[0]); } catch { /* fall through */ }
  }
  return null;
}

/**
 * Fallback metadata derived from the original filename.
 *
 * @param {string} originalName
 */
function fallbackMeta(originalName) {
  const base = originalName.replace(/\.[^.]+$/, '');
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'image';
  return { filename: slug, title: base, alt: base, keywords: [] };
}

/**
 * Generate SEO metadata (filename, title, alt, keywords) for an image.
 *
 * @param {object} params
 * @param {string} params.imageBase64
 * @param {string} params.mime
 * @param {string} params.originalName
 * @param {string} params.article
 * @param {string} params.keywords
 * @param {string} params.siteLanguage
 * @param {boolean} params.isPro
 * @returns {Promise<{ filename: string, title: string, alt: string, keywords: string[] }>}
 */
async function analyzeImage({ imageBase64, mime, originalName, article, keywords, siteLanguage, isPro }) {
  const contextParts = [];
  if (article)  contextParts.push(`Website / article context: ${article}`);
  if (keywords) contextParts.push(`Target SEO keywords: ${keywords}`);
  const contextBlock = contextParts.length
    ? `Context for this image:\n${contextParts.join('\n')}\n\n`
    : '';

  const keywordsRule = keywords
    ? 'keywords is an array of 3-6 SEO terms: include the target keywords where relevant, supplement with image-derived terms to reach 3-6 total'
    : 'keywords is an array of 3-6 descriptive SEO terms extracted from the image';

  const contextNote = contextBlock
    ? ' Use the context above to make filename, title, alt, and keywords more relevant and SEO-targeted.'
    : '';

  const prompt = `${contextBlock}Analyze this image and return ONLY a raw JSON object (no markdown, no code blocks) with exactly these four fields:
{"filename":"seo-kebab-case-no-extension","title":"Natural Language Title","alt":"Descriptive alt text for accessibility.","keywords":["term one","term two","term three"]}
Rules: filename is lowercase kebab-case max 5 words (ASCII only); title is title-case max 8 words; alt is 1-2 descriptive sentences; ${keywordsRule}. Base all values on actual image content.${contextNote} Write title, alt, and keywords in the site language: ${siteLanguage || 'en-US'}.`;

  const messages = [
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBase64}` } },
        { type: 'text', text: prompt },
      ],
    },
  ];

  const raw = await callOpenRouter(messages, isPro);
  const parsed = parseJSON(raw);

  if (!parsed) return fallbackMeta(originalName);

  const fallback = fallbackMeta(originalName);
  const kws = Array.isArray(parsed.keywords) ? parsed.keywords.filter(k => typeof k === 'string') : [];

  return {
    filename: parsed.filename || fallback.filename,
    title:    parsed.title    || fallback.title,
    alt:      parsed.alt      || fallback.alt,
    keywords: kws,
  };
}

/**
 * Extract SEO keywords from image title + alt text (text-only, no image).
 *
 * @param {object} params
 * @param {string} params.title
 * @param {string} params.alt
 * @param {string} params.siteLanguage
 * @param {boolean} params.isPro
 * @returns {Promise<string[]>}
 */
async function extractKeywords({ title, alt, siteLanguage, isPro }) {
  const text = [title, alt].filter(Boolean).join(' — ');

  const prompt = `Extract 3-6 SEO keyword terms from the following image metadata. Return ONLY a raw JSON array of strings (no markdown, no code blocks), e.g. ["term one","term two"]. Write keywords in the site language: ${siteLanguage || 'en-US'}. Text: ${text}`;

  const messages = [{ role: 'user', content: prompt }];
  const raw = await callOpenRouter(messages, isPro);
  const parsed = parseJSONArray(raw);

  if (!Array.isArray(parsed)) return [];
  return parsed.filter(k => typeof k === 'string');
}

module.exports = { analyzeImage, extractKeywords, fallbackMeta };
