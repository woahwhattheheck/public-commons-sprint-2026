/**
 * STORE-method ZIP writer. Container only. Not a PKWARE-certified product.
 */

import { assertSafeArchivePath, collisionKey, findCollisions } from "./paths.js";

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[i] = c >>> 0;
}

export function crc32(bytes) {
  let c = 0xffffffff;
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n) {
  const b = new Uint8Array(2);
  b[0] = n & 0xff;
  b[1] = (n >>> 8) & 0xff;
  return b;
}

function u32(n) {
  const b = new Uint8Array(4);
  b[0] = n & 0xff;
  b[1] = (n >>> 8) & 0xff;
  b[2] = (n >>> 16) & 0xff;
  b[3] = (n >>> 24) & 0xff;
  return b;
}

function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function encodeName(name) {
  return new TextEncoder().encode(name);
}

/**
 * @param {{path:string, bytes:Uint8Array}[]} entries
 */
export function buildStoreZip(entries) {
  const prepared = [];
  for (const entry of entries) {
    const path = assertSafeArchivePath(entry.path);
    const bytes =
      entry.bytes instanceof Uint8Array ? entry.bytes : new Uint8Array(entry.bytes || []);
    prepared.push({ path, bytes });
  }
  const collisions = findCollisions(prepared.map((e) => e.path));
  if (collisions.length) {
    const err = new Error("zip-collision:" + collisions[0].path);
    err.code = "ZIP_COLLISION";
    err.collisions = collisions;
    throw err;
  }
  const used = new Set(prepared.map((e) => collisionKey(e.path)));
  if (used.size !== prepared.length) {
    throw new Error("zip-collision");
  }

  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { path, bytes } of prepared) {
    const name = encodeName(path);
    const crc = crc32(bytes);
    const size = bytes.length;
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(1 << 11),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(size),
      u32(size),
      u16(name.length),
      u16(0),
      name,
      bytes,
    ]);
    const central = concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(1 << 11),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(size),
      u32(size),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const centralDir = concat(centrals);
  const eocd = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(prepared.length),
    u16(prepared.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);
  return concat([...locals, centralDir, eocd]);
}

export function zipHasMagic(bytes) {
  return bytes && bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}
