/**
 * Static checks that the built page does not perform runtime network I/O.
 * Recording an IRI string (RO-Crate context) is not a fetch.
 */

const SECURITY_HTML_ENTITIES = new Map([
  ["bsol", "\\"],
  ["colon", ":"],
  ["newline", "\n"],
  ["sol", "/"],
  ["tab", "\t"],
]);

function isSecurityUrlCodePoint(codePoint) {
  return (
    (codePoint >= 0x30 && codePoint <= 0x39) ||
    (codePoint >= 0x41 && codePoint <= 0x5a) ||
    (codePoint >= 0x61 && codePoint <= 0x7a) ||
    codePoint === 0x09 ||
    codePoint === 0x0a ||
    codePoint === 0x0d ||
    codePoint === 0x2f ||
    codePoint === 0x3a ||
    codePoint === 0x5c
  );
}

function decodeSecurityHtmlEntities(text) {
  return text.replace(
    /&(?:#x([0-9a-f]+)|#([0-9]+)|([a-z][a-z0-9]+));?/gi,
    (match, hex, decimal, named) => {
      if (hex || decimal) {
        const codePoint = Number.parseInt(hex || decimal, hex ? 16 : 10);
        if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
          return match;
        }
        // The URL parser trims leading/trailing C0 controls and space. Preserve
        // TAB/LF/CR for the dedicated URL-whitespace pass; represent the other
        // leading C0 controls as space so a remote prefix cannot hide behind a
        // numeric character reference such as &#11;.
        if (codePoint > 0 && codePoint <= 0x20 && ![0x09, 0x0a, 0x0d].includes(codePoint)) {
          return " ";
        }
        if (!isSecurityUrlCodePoint(codePoint)) return match;
        return String.fromCodePoint(codePoint);
      }
      return SECURITY_HTML_ENTITIES.get(named.toLowerCase()) ?? match;
    },
  );
}

function decodeCssUrlEscapes(text) {
  const withoutLineContinuations = text.replace(/\\(?:\r\n|[\n\r\f])/g, "");
  return withoutLineContinuations.replace(
    /\\([0-9a-f]{1,6})(?:\r\n|[\t\n\f\r ])?|\\([^0-9a-f\r\n\f])/gi,
    (match, hex, escaped) => {
      const codePoint = hex ? Number.parseInt(hex, 16) : escaped.codePointAt(0);
      if (!Number.isInteger(codePoint) || !isSecurityUrlCodePoint(codePoint)) {
        return match;
      }
      return String.fromCodePoint(codePoint);
    },
  );
}

function normalizeUrlSchemeControls(text) {
  const withoutSchemeControls = text.replace(
    /h[\t\n\r]*t[\t\n\r]*t[\t\n\r]*p(?:[\t\n\r]*s)?[\t\n\r]*:/gi,
    (match) => match.replace(/[\t\n\r]/g, ""),
  );
  // The basic URL parser removes ASCII TAB/LF/CR before parsing, including in
  // a protocol-relative prefix. Mirror just that prefix-relevant transform.
  return withoutSchemeControls.replace(/\/[\t\n\r]*\//g, (match) =>
    match.replace(/[\t\n\r]/g, ""),
  );
}

function securityScanText(source) {
  const text = String(source ?? "");
  // Browser URL-bearing values resolve character references before URL parsing,
  // while CSS resolves identifier/string escapes before url()/@import. Decode
  // only URL-significant characters in a scan-only copy: structural entities
  // such as &lt; and &quot; must NOT become markup delimiters here because HTML
  // does not re-tokenize decoded character references as source syntax.
  return normalizeUrlSchemeControls(
    decodeCssUrlEscapes(decodeSecurityHtmlEntities(text)),
  );
}

const FORBIDDEN = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bnavigator\.sendBeacon\s*\(/,
  /\bWebSocket\s*\(/,
  /\bEventSource\s*\(/,
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
  /<a\b(?=[^>]*\bping\s*=\s*(?:"[^"]*(?:https?:|\/\/)|'[^']*(?:https?:|\/\/)|[^\s>]*(?:https?:|\/\/)))[^>]*>/i,
  /<meta\b(?=[^>]*\bhttp-equiv\s*=\s*(?:["']?\s*refresh\s*["']?))(?=[^>]*\bcontent\s*=\s*(?:"[^"]*\burl\s*=\s*[^"]*(?:https?:|\/\/)|'[^']*\burl\s*=\s*[^']*(?:https?:|\/\/)|[^\s>]*\burl\s*=\s*[^\s>]*(?:https?:|\/\/)))[^>]*>/i,
  /!\[[^\]\r\n]*\]\(\s*(?:<\s*)?(?:https?:|\/\/)/i,
  /@import\s+(?:url\(\s*)?["']?\s*(?:https?:|\/\/)/i,
  /url\(\s*["']?\s*(?:https?:|\/\/)/i,
  /fonts\.googleapis/i,
  /cdn\.jsdelivr/i,
  /unpkg\.com/i,
];

export function networkRisks(source) {
  const text = securityScanText(source);
  const hits = [];
  for (const re of FORBIDDEN) {
    if (re.test(text)) hits.push(re.toString());
  }
  return hits;
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
