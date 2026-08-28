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
  /<script[^>]+src=["']https?:/i,
  /<link[^>]+href=["']https?:/i,
  /url\(\s*["']?https?:/i,
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
