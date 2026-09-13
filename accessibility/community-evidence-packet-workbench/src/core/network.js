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
  /<script\b[^>]*\bsrc\s*=\s*["']?\s*(?:https?:|\/\/)/i,
  /<link\b[^>]*\bhref\s*=\s*["']?\s*(?:https?:|\/\/)/i,
  /<(?:img|iframe|audio|video|source|track|embed|input)\b[^>]*\bsrc\s*=\s*["']?\s*(?:https?:|\/\/)/i,
  /<(?:img|source)\b[^>]*\bsrcset\s*=\s*(?:["'][^"']*|[^\s>]*)?(?:https?:|\/\/)/i,
  /<video\b[^>]*\bposter\s*=\s*["']?\s*(?:https?:|\/\/)/i,
  /<object\b[^>]*\bdata\s*=\s*["']?\s*(?:https?:|\/\/)/i,
  /<form\b[^>]*\baction\s*=\s*["']?\s*(?:https?:|\/\/)/i,
  /<(?:input|button)\b[^>]*\bformaction\s*=\s*["']?\s*(?:https?:|\/\/)/i,
  /<base\b[^>]*\bhref\s*=\s*["']?\s*(?:https?:|\/\/)/i,
  /<(?:image|use)\b[^>]*\b(?:href|xlink:href)\s*=\s*["']?\s*(?:https?:|\/\/)/i,
  /<(?:body|table|td|th)\b[^>]*\bbackground\s*=\s*["']?\s*(?:https?:|\/\/)/i,
  /<a\b[^>]*\bping\s*=\s*(?:["'][^"']*|[^\s>]*)?(?:https?:|\/\/)/i,
  /<meta\b(?=[^>]*\bhttp-equiv\s*=\s*["']?refresh["']?)(?=[^>]*\bcontent\s*=\s*(?:["'][^>]*\burl\s*=\s*["']?\s*|[^\s>]*url\s*=\s*)(?:https?:|\/\/))[^>]*>/i,
];

const CSS_REMOTE = [
  /@import\s+(?:url\(\s*)?["']?\s*(?:https?:|\/\/)/i,
  /url\(\s*["']?\s*(?:https?:|\/\/)/i,
];

const DISALLOWED_HOSTS = [
  /fonts\.googleapis/i,
  /cdn\.jsdelivr/i,
  /unpkg\.com/i,
];

function networkCharacter(character) {
  return /^[A-Za-z0-9:/. \t\r\n\f\v]$/.test(character);
}

function collapseUrlParserWhitespace(text) {
  const collapse = (match) => match.replace(/[\t\r\n]/g, "");
  return text
    .replace(/h[\t\r\n]*t[\t\r\n]*t[\t\r\n]*p[\t\r\n]*s?[\t\r\n]*:/gi, collapse)
    .replace(/\/[\t\r\n]*\//g, collapse);
}

function decodeHtmlNetworkReferences(text) {
  const numeric = text.replace(/&#(?:x([0-9a-f]+)|([0-9]+));?/gi, (match, hex, decimal) => {
    const codePoint = Number.parseInt(hex ?? decimal, hex ? 16 : 10);
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
      return match;
    }
    if (codePoint > 0 && codePoint <= 0x20 && ![0x09, 0x0a, 0x0d].includes(codePoint)) {
      return " ";
    }
    const character = String.fromCodePoint(codePoint);
    return networkCharacter(character) ? character : match;
  });
  const named = new Map([
    ["colon", ":"],
    ["sol", "/"],
    ["Tab", "\t"],
    ["NewLine", "\n"],
  ]);
  const namedNormalized = numeric.replace(
    /&(colon|sol|Tab|NewLine);/g,
    (match, name) => named.get(name) ?? match,
  );
  return collapseUrlParserWhitespace(namedNormalized);
}

function decodeCssNetworkEscapes(text) {
  const decoded = text
    .replace(/\\(?:\r\n|[\n\r\f])/g, "")
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
  return collapseUrlParserWhitespace(decoded);
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
