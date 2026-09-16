import { assertHttpsUrl, sha256Hex } from "./core.mjs";

function text(v, name, max = 100_000, empty = false) {
  if (typeof v !== "string") throw new TypeError(`${name} must be a string`);
  const out = v.normalize("NFC").trim();
  if (!empty && !out) throw new TypeError(`${name} must not be empty`);
  if (out.length > max) throw new RangeError(`${name} too long`);
  return out;
}

export async function normalizeInboundNotice(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new TypeError("message must be an object");
  const eventId = text(raw.eventId, "eventId", 300);
  const messageId = text(raw.messageId, "messageId", 300);
  const threadId = text(raw.threadId, "threadId", 300);
  const from = text(raw.from, "from", 500);
  const subject = text(raw.subject ?? "(no subject)", "subject", 1_000, true);
  const body = text(raw.text ?? "", "text", 100_000, true);
  const receivedAt = new Date(raw.receivedAt);
  if (!Number.isFinite(receivedAt.valueOf())) throw new TypeError("receivedAt must be a timestamp");
  const urls = [];
  const seen = new Set();
  for (const match of body.matchAll(/https:\/\/[^\s<>()"']+/g)) {
    try {
      const url = assertHttpsUrl(match[0].replace(/[.,;:!?]+$/, ""), "notice url");
      if (!seen.has(url)) { seen.add(url); urls.push(url); }
    } catch { /* ignore malformed text fragments */ }
  }
  return {
    eventId, messageId, threadId, from, subject, text: body,
    receivedAt: receivedAt.toISOString(), urls,
    dedupeKey: await sha256Hex({ eventId, messageId, threadId }),
    authority: "inbound_evidence_only",
  };
}

export function routeNoticeToSources(notice, sources) {
  if (!Array.isArray(sources)) throw new TypeError("sources must be an array");
  const sourceHosts = sources.map((source) => {
    const normalized = assertHttpsUrl(source.sourceUrl, "sourceUrl");
    return { sourceId: source.sourceId, sourceUrl: normalized, host: new URL(normalized).host };
  });
  const matched = new Map();
  for (const url of notice.urls ?? []) {
    const host = new URL(url).host;
    for (const source of sourceHosts) {
      if (host === source.host || host.endsWith(`.${source.host}`) || source.host.endsWith(`.${host}`)) matched.set(source.sourceId, source);
    }
  }
  return [...matched.values()];
}
