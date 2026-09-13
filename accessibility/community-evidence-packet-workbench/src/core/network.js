/**
 * Static checks that the built page does not perform runtime network I/O.
 * Recording an IRI string (RO-Crate context) is not a fetch.
 */

const ACTIVE_RUNTIME = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bnavigator\.sendBeacon\s*\(/,
  /\bWebSocket\s*\(/,
  /\bEventSource\s*\(/,
];

const HTML_REMOTE = [
  /<script\b[^>]*\bsrc\s*=\s*["']?\s*(?:https?:)?\/\//i,
  /<link\b[^>]*\bhref\s*=\s*["']?\s*(?:https?:)?\/\//i,
  /<(?:img|iframe|audio|video|source|track|embed|input)\b[^>]*\bsrc\s*=\s*["']?\s*(?:https?:)?\/\//i,
  /<(?:img|source)\b[^>]*\bsrcset\s*=\s*(?:["'][^"']*|[^\s>]*)?(?:https?:)?\/\//i,
  /<video\b[^>]*\bposter\s*=\s*["']?\s*(?:https?:)?\/\//i,
  /<object\b[^>]*\bdata\s*=\s*["']?\s*(?:https?:)?\/\//i,
  /<form\b[^>]*\baction\s*=\s*["']?\s*(?:https?:)?\/\//i,
  /<(?:input|button)\b[^>]*\bformaction\s*=\s*["']?\s*(?:https?:)?\/\//i,
  /<base\b[^>]*\bhref\s*=\s*["']?\s*(?:https?:)?\/\//i,
  /<(?:image|use)\b[^>]*\b(?:href|xlink:href)\s*=\s*["']?\s*(?:https?:)?\/\//i,
  /<(?:body|table|td|th)\b[^>]*\bbackground\s*=\s*["']?\s*(?:https?:)?\/\//i,
  /<a\b[^>]*\bping\s*=\s*(?:["'][^"']*|[^\s>]*)?(?:https?:)?\/\//i,
  /<meta\b(?=[^>]*\bhttp-equiv\s*=\s*["']?refresh["']?)(?=[^>]*\bcontent\s*=\s*(?:["'][^>]*\burl\s*=\s*["']?\s*|[^\s>]*url\s*=\s*)(?:https?:)?\/\/)[^>]*>/i,
];

const CSS_REMOTE = [
  /@import\s+(?:url\(\s*)?["']?\s*(?:https?:)?\/\//i,
  /url\(\s*["']?\s*(?:https?:)?\/\//i,
];

const DISALLOWED_HOSTS = [
  /fonts\.googleapis/i,
  /cdn\.jsdelivr/i,
  /unpkg\.com/i,
];

function networkCharacter(character) {
  return /^[A-Za-z0-9:/. \t\r\n\f]$/.test(character);
}

function decodeHtmlNetworkReferences(text) {
  const numeric = text.replace(
    /&#(?:x([0-9a-f]{1,6})|([0-9]{1,7}));?/gi,
    (match, hex, decimal) => {
      const codePoint = Number.parseInt(hex ?? decimal, hex ? 16 : 10);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        return match;
      }
      const character = String.fromCodePoint(codePoint);
      return networkCharacter(character) ? character : match;
    },
  );
  const named = new Map([
    ["colon", ":"],
    ["sol", "/"],
    ["Tab", "\t"],
    ["NewLine", "\n"],
  ]);
  return numeric.replace(/&(colon|sol|Tab|NewLine);/g, (match, name) => named.get(name) ?? match);
}

function decodeCssNetworkEscapes(text) {
  return text
    .replace(/\\([0-9a-f]{1,6})(?:\r\n|[ \t\r\n\f])?/gi, (match, hex) => {
      const codePoint = Number.parseInt(hex, 16);
      if (!Number.isInteger(codePoint) || codePoint === 0 || codePoint > 0x10ffff) {
        return match;
      }
      const character = String.fromCodePoint(codePoint);
      return networkCharacter(character) ? character : match;
    })
    .replace(/\\([^0-9a-f\r\n\f])/gi, (match, character) =>
      networkCharacter(character) ? character : match,
    );
}

function collectHits(hits, text, patterns) {
  for (const re of patterns) {
    if (re.test(text)) hits.add(re.toString());
  }
}

export function networkRisks(source) {
  const text = String(source ?? "");
  const htmlNormalized = decodeHtmlNetworkReferences(text);
  const cssNormalized = decodeCssNetworkEscapes(htmlNormalized);
  const hits = new Set();
  collectHits(hits, text, ACTIVE_RUNTIME);
  collectHits(hits, htmlNormalized, HTML_REMOTE);
  collectHits(hits, cssNormalized, CSS_REMOTE);
  collectHits(hits, cssNormalized, DISALLOWED_HOSTS);
  return [...hits];
}

export function assertNoRuntimeNetwork(source) {
  const hits = networkRisks(source);
  if (hits.length) {
    const err = new Error("runtime-network-pattern:" + hits.join(","));
    err.hits = hits;
    throw err;
  }
  return true;
}
