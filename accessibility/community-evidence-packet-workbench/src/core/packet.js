/**
 * Community evidence packet model.
 * Unknown fields are preserved on import and re-emitted on JSON export.
 */

import { sha256Hex, utf8Bytes, BYTE_IDENTITY_NOTICE } from "./hash.js";
import { isSafeArchivePath, normalizePath, uniqueArchivePath, collisionKey } from "./paths.js";
import { recognizeAttachment, WACZ_POLICY } from "./wacz.js";

export const SCHEMA = "community-evidence-packet/v1";

export const ADVISORY_MAX_BYTES = 50 * 1024 * 1024;
export const ADVISORY_MAX_FILES = 200;

export const ITEM_ROLES = [
  "photo",
  "testimony",
  "minutes",
  "map",
  "recording",
  "wacz",
  "document",
  "other",
];

const PACKET_KEYS = new Set([
  "schema",
  "id",
  "created",
  "updated",
  "title",
  "community",
  "collector",
  "statement",
  "location",
  "period",
  "tags",
  "people",
  "places",
  "events",
  "items",
  "unknown",
  "limits",
]);

const ITEM_KEYS = new Set([
  "id",
  "name",
  "path",
  "role",
  "mediaType",
  "bytes",
  "sha256",
  "caption",
  "collectedAt",
  "provenance",
  "waczOpaque",
  "recognizedAs",
  "note",
  "unknown",
  "textContent",
]);

export function nowIso() {
  return new Date().toISOString();
}

export function mintId(prefix) {
  const rand =
    globalThis.crypto?.randomUUID?.() ||
    "x" + Math.random().toString(16).slice(2) + Date.now().toString(16);
  return `${prefix}-${rand}`;
}

export function emptyPacket() {
  return {
    schema: SCHEMA,
    id: mintId("cep"),
    created: nowIso(),
    updated: nowIso(),
    title: "",
    community: "",
    collector: "",
    statement: "",
    location: "",
    period: { start: "", end: "" },
    tags: [],
    people: [],
    places: [],
    events: [],
    items: [],
    unknown: {},
    limits: {
      advisoryMaxBytes: ADVISORY_MAX_BYTES,
      advisoryMaxFiles: ADVISORY_MAX_FILES,
    },
  };
}

function asArray(value) {
  if (Array.isArray(value)) return value.slice();
  if (value == null || value === "") return [];
  return [value];
}

function importItem(src) {
  if (!src || typeof src !== "object" || Array.isArray(src)) {
    return {
      id: mintId("item"),
      name: "",
      path: "",
      role: "other",
      mediaType: "application/octet-stream",
      bytes: 0,
      sha256: "",
      caption: "",
      collectedAt: "",
      provenance: "",
      waczOpaque: false,
      recognizedAs: "file",
      note: "",
      unknown: { _invalidItem: src },
      textContent: "",
    };
  }
  const rec = recognizeAttachment(src.name || src.path || "", src.mediaType || "");
  const item = {
    id: String(src.id || mintId("item")),
    name: String(src.name ?? ""),
    path: String(src.path ?? src.name ?? ""),
    role: ITEM_ROLES.includes(src.role) ? src.role : rec.kind === "wacz-attachment" ? "wacz" : "other",
    mediaType: String(src.mediaType ?? "application/octet-stream"),
    bytes: Number(src.bytes) || 0,
    sha256: String(src.sha256 ?? ""),
    caption: String(src.caption ?? ""),
    collectedAt: String(src.collectedAt ?? ""),
    provenance: String(src.provenance ?? ""),
    waczOpaque: rec.kind === "wacz-attachment" || src.waczOpaque === true,
    recognizedAs: rec.recognizedAs,
    note: rec.note || String(src.note ?? ""),
    unknown: {},
    textContent: String(src.textContent ?? ""),
  };
  for (const key of Object.keys(src)) {
    if (!ITEM_KEYS.has(key) && key !== "_bytes") item.unknown[key] = src[key];
  }
  if (src.unknown && typeof src.unknown === "object" && !Array.isArray(src.unknown)) {
    item.unknown = { ...src.unknown, ...item.unknown };
  }
  return item;
}

export function importPacket(input) {
  const src = typeof input === "string" ? JSON.parse(input) : input;
  if (!src || typeof src !== "object" || Array.isArray(src)) {
    throw new Error("packet-must-be-object");
  }
  const packet = emptyPacket();
  if (typeof src.id === "string" && src.id) packet.id = src.id;
  if (typeof src.created === "string" && src.created) packet.created = src.created;
  packet.updated = nowIso();
  packet.title = String(src.title ?? "");
  packet.community = String(src.community ?? "");
  packet.collector = String(src.collector ?? "");
  packet.statement = String(src.statement ?? "");
  packet.location = String(src.location ?? "");
  if (src.period && typeof src.period === "object") {
    packet.period = {
      start: String(src.period.start ?? ""),
      end: String(src.period.end ?? ""),
    };
  }
  packet.tags = asArray(src.tags).map((t) => String(t));
  packet.people = asArray(src.people);
  packet.places = asArray(src.places);
  packet.events = asArray(src.events);
  packet.items = asArray(src.items).map(importItem);
  packet.unknown = {};
  for (const key of Object.keys(src)) {
    if (!PACKET_KEYS.has(key)) packet.unknown[key] = src[key];
  }
  if (src.unknown && typeof src.unknown === "object" && !Array.isArray(src.unknown)) {
    packet.unknown = { ...src.unknown, ...packet.unknown };
  }
  if (src.schema) packet.schema = String(src.schema);
  return packet;
}

export function itemToJson(item) {
  const { unknown, _bytes, ...rest } = item;
  const out = { ...(unknown || {}), ...rest };
  if (!out.textContent) delete out.textContent;
  return out;
}

export function packetToJsonObject(packet) {
  const { unknown, items, ...rest } = packet;
  return {
    ...(unknown || {}),
    ...rest,
    items: (items || []).map(itemToJson),
  };
}

export function packetToJson(packet) {
  return JSON.stringify(packetToJsonObject(packet), null, 2);
}

export function missingFields(packet) {
  const missing = [];
  if (!packet.title) missing.push("title");
  if (!packet.community) missing.push("community");
  if (!packet.collector) missing.push("collector");
  if (!packet.statement) missing.push("statement");
  if (!packet.items.length) missing.push("items");
  for (const item of packet.items) {
    if (!item.sha256) missing.push("item.sha256:" + (item.name || item.id));
  }
  return missing;
}

export function isEmptyPacket(packet) {
  return (
    !packet.title &&
    !packet.community &&
    !packet.collector &&
    !packet.statement &&
    !packet.location &&
    packet.items.length === 0
  );
}

export function totalBytes(packet) {
  return packet.items.reduce((n, it) => n + (Number(it.bytes) || 0), 0);
}

export function advisoryNotices(packet) {
  const notices = [];
  const bytes = totalBytes(packet);
  if (bytes > packet.limits.advisoryMaxBytes) {
    notices.push({
      level: "advisory",
      code: "SIZE",
      text: `Packet payload is ${bytes} bytes, above the advisory ${packet.limits.advisoryMaxBytes}-byte notice. Export is still available.`,
    });
  }
  if (packet.items.length > packet.limits.advisoryMaxFiles) {
    notices.push({
      level: "advisory",
      code: "COUNT",
      text: `Packet has ${packet.items.length} items, above the advisory ${packet.limits.advisoryMaxFiles}-file notice. Export is still available.`,
    });
  }
  const missing = missingFields(packet);
  if (missing.length) {
    notices.push({
      level: "incomplete",
      code: "INCOMPLETE",
      text: "Incomplete packet. Missing: " + missing.join(", ") + ". Export is still available.",
    });
  }
  if (isEmptyPacket(packet)) {
    notices.push({
      level: "empty",
      code: "EMPTY",
      text: "Empty packet. Every export still runs and labels the empty state.",
    });
  }
  return notices;
}

export function archivePathForItem(item, used) {
  const raw = item.path || item.name || item.id || "item.bin";
  const fallback = isSafeArchivePath(raw) ? normalizePath(raw) : "evidence/" + String(item.id || "item") + ".bin";
  const path = uniqueArchivePath("data/" + fallback.replace(/^data\//, ""), used);
  used.add(collisionKey(path));
  return path;
}

export async function makeTextItem(name, text, role) {
  const bytes = utf8Bytes(text);
  const rec = recognizeAttachment(name, "text/plain");
  return {
    id: mintId("item"),
    name,
    path: name,
    role: role || "testimony",
    mediaType: "text/plain;charset=utf-8",
    bytes: bytes.length,
    sha256: await sha256Hex(bytes),
    caption: "",
    collectedAt: nowIso(),
    provenance: "pasted-as-text-in-workbench",
    waczOpaque: rec.kind === "wacz-attachment",
    recognizedAs: rec.recognizedAs,
    note: rec.note,
    unknown: {},
    textContent: String(text),
    _bytes: bytes,
  };
}

export async function makeFileItem(file, arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const rec = recognizeAttachment(file.name, file.type);
  return {
    id: mintId("item"),
    name: file.name,
    path: file.name,
    role: rec.kind === "wacz-attachment" ? "wacz" : "other",
    mediaType: file.type || "application/octet-stream",
    bytes: bytes.length,
    sha256: await sha256Hex(bytes),
    caption: "",
    collectedAt: nowIso(),
    provenance: "loaded-from-local-file-in-workbench",
    waczOpaque: rec.kind === "wacz-attachment",
    recognizedAs: rec.recognizedAs,
    note: rec.note,
    unknown: {},
    textContent: "",
    _bytes: bytes,
  };
}

export { BYTE_IDENTITY_NOTICE, WACZ_POLICY };
