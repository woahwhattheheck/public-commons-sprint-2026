/**
 * Static checks that the built page does not perform runtime network I/O.
 * Recording an IRI string (RO-Crate context) is not a fetch.
 */

const FORBIDDEN = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bnavigator\.sendBeacon\s*\(/,
  /\bWebSocket\s*\(/,
  /\bEventSource\s*\(/,
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
  /<a\b[^>]*\bping\s*=\s*["'][^"']*(?:https?:)?\/\//i,
  /<meta\b(?=[^>]*\bhttp-equiv\s*=\s*["']?refresh["']?)(?=[^>]*\bcontent\s*=\s*["'][^"']*\burl\s*=\s*["']?\s*(?:https?:)?\/\/)[^>]*>/i,
  /@import\s+(?:url\(\s*)?["']?\s*(?:https?:)?\/\//i,
  /url\(\s*["']?\s*(?:https?:)?\/\//i,
  /fonts\.googleapis/i,
  /cdn\.jsdelivr/i,
  /unpkg\.com/i,
];

export function networkRisks(source) {
  const text = String(source ?? "");
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
