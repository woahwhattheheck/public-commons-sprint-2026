import { canonicalJson } from "./json-codec.mjs";
import { createHash, randomUUID } from "node:crypto";

export class HaystackError extends Error {
  constructor(code, message, status = 400, details) {
    super(message); this.name = "HaystackError"; this.code = code; this.status = status; this.details = details;
  }
}
export function need(condition, message, code = "HAYSTACK_INPUT", status = 400, details) {
  if (!condition) throw new HaystackError(code, message, status, details);
}
export const clone = value => structuredClone(value);
export const sha256 = value => createHash("sha256").update(value).digest("hex");
export const now = () => new Date().toISOString();
export const newId = () => randomUUID();
export const own = (value, key) => Object.hasOwn(value, key);
export function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
export const canonical = canonicalJson;
export const digest = value => sha256(Buffer.from(canonical(value)));
export function hash(value, name = "SHA-256") {
  need(typeof value === "string" && /^[0-9a-f]{64}$/.test(value), "Supply the complete " + name + ".");
  return value;
}
export function id(value, name = "operation ID") {
  need(typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value), "Supply a complete " + name + ".");
  return value;
}
export function text(value, name, max = 4000, nonempty = false) {
  need(typeof value === "string" && value.length <= max && !value.includes("\0") && (!nonempty || value.trim().length),
    "Supply " + name + (nonempty ? " with content" : "") + " within " + max + " characters.");
  return value;
}
export function integer(value, name, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  need(Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    "Supply " + name + " from " + minimum + " to " + maximum + ".");
  return value;
}
export function fields(value, allowed, required = []) {
  need(plain(value), "Supply a complete arguments object.");
  need(Object.keys(value).every(key => allowed.includes(key)), "Use the declared action fields.");
  for (const key of required) need(own(value, key), "Supply " + key + ".");
  return value;
}
export function json(bytes, maximum = 128 * 1024 * 1024) {
  const raw = Buffer.from(bytes); need(raw.length <= maximum, "The complete JSON source exceeds its byte limit.", "HAYSTACK_SIZE", 413);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
  catch { throw new HaystackError("HAYSTACK_JSON", "Supply complete UTF-8 JSON."); }
}
export function base64(value, maximum) {
  need(typeof value === "string" && value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value), "Supply complete canonical base64.");
  const raw = Buffer.from(value, "base64");
  need(raw.toString("base64") === value && raw.length <= maximum, "The original bytes exceed their limit or use another base64 encoding.", "HAYSTACK_SIZE", 413);
  return raw;
}
export function page(items, { offset = 0, limit = 50 } = {}) {
  integer(offset, "page offset"); integer(limit, "page size", 1, 250);
  const selected = items.slice(offset, offset + limit), nextOffset = offset + selected.length;
  return { items: selected, offset, limit, total: items.length, nextOffset, hasMore: nextOffset < items.length };
}
export function recordKey(sourceId, rowIndex) { return hash(sourceId, "source identity") + ":" + integer(rowIndex, "row index"); }
export function splitRecordKey(key) {
  need(typeof key === "string" && /^[0-9a-f]{64}:(0|[1-9][0-9]*)$/.test(key), "Choose a complete source row identity.");
  const [sourceId, number] = key.split(":"); return { sourceId, rowIndex: integer(Number(number), "row index") };
}
export function csvCell(value) {
  const raw = value === null || value === undefined ? "" : typeof value === "object" ? canonical(value) : String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? "'" + raw : raw;
  return '"' + safe.replaceAll('"', '""') + '"';
}
export function csv(columns, rows) {
  return "\uFEFF" + [columns.map(csvCell).join(","), ...rows.map(row => columns.map(column => csvCell(row[column])).join(","))].join("\r\n") + "\r\n";
}
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
