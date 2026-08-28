/**
 * Path normalization and ZIP-slip / collision defense.
 * These checks are local archive hygiene, not access control.
 */

const WIN_ABS = /^[a-zA-Z]:[\\/]/;

export function normalizePath(input) {
  let s = String(input ?? "").replace(/\\/g, "/");
  s = s.replace(/^\.\/+/, "");
  s = s.replace(/\/{2,}/g, "/");
  if (s.endsWith("/") && s.length > 1) s = s.slice(0, -1);
  return s;
}

export function zipSlipReason(input) {
  const raw = String(input ?? "");
  if (!raw || !raw.trim()) return "empty-path";
  if (raw.includes("\0")) return "nul-byte";
  const s = normalizePath(raw);
  if (!s) return "empty-path";
  if (s.startsWith("/") || s.startsWith("\\")) return "absolute-path";
  if (WIN_ABS.test(raw) || WIN_ABS.test(s)) return "absolute-path";
  const parts = s.split("/");
  for (const part of parts) {
    if (part === ".." || part === ".") return part === ".." ? "parent-segment" : "dot-segment";
  }
  if (s.includes("\\")) return "backslash";
  return null;
}

export function isSafeArchivePath(input) {
  return zipSlipReason(input) === null;
}

export function assertSafeArchivePath(input) {
  const reason = zipSlipReason(input);
  if (reason) {
    const err = new Error("unsafe-archive-path:" + reason);
    err.code = "UNSAFE_ARCHIVE_PATH";
    err.reason = reason;
    err.path = String(input ?? "");
    throw err;
  }
  return normalizePath(input);
}

export function collisionKey(input) {
  return normalizePath(input).toLowerCase();
}

export function findCollisions(paths) {
  const seen = new Map();
  const collisions = [];
  for (const p of paths) {
    const key = collisionKey(p);
    if (seen.has(key)) {
      collisions.push({ path: normalizePath(p), other: seen.get(key), key });
    } else {
      seen.set(key, normalizePath(p));
    }
  }
  return collisions;
}

export function uniqueArchivePath(desired, used) {
  const base = assertSafeArchivePath(desired);
  if (!used.has(collisionKey(base))) return base;
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  let n = 2;
  while (n < 10000) {
    const candidate = `${stem}-${n}${ext}`;
    if (!used.has(collisionKey(candidate))) return candidate;
    n += 1;
  }
  throw new Error("could-not-dedupe-path");
}
