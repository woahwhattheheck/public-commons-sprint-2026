// Upper Savannah source-root ZIP publication for JavaScript-only coordinators.
// Uses the same full source map and payload identity as encodeApplicationCarrier.
import {fromBase64, utf8Encode, sha256Bytes, gzipBytes, toBase64} from "./carrier_codec.mjs";

function concatBytes(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (total >= 0xffffffff) throw Error("Source archive requires ZIP64");
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

function zipSourceEntries(entries) {
  if (!entries.length || entries.length > 65535) throw Error("Invalid source archive member count");
  const locals = [], central = [], seen = new Set();
  let offset = 0;
  const date = ((2026 - 1980) << 9) | (10 << 5) | 12;
  const set16 = (bytes, at, value) => {
    bytes[at] = value & 255; bytes[at + 1] = (value >>> 8) & 255;
  };
  const set32 = (bytes, at, value) => {
    for (let i = 0; i < 4; i++) bytes[at + i] = (value >>> (i * 8)) & 255;
  };
  for (const entry of entries) {
    const name = entry.name;
    if (typeof name !== "string" || !name || name.startsWith("/") ||
        name.includes("\\") || /[\x00-\x1f]/.test(name) ||
        name.split("/").some(part => !part || part === "." || part === ".." || part.includes(":")) ||
        seen.has(name) || !["100644", "100755"].includes(entry.mode)) {
      throw Error("Invalid source archive member");
    }
    seen.add(name);
    const filename = utf8Encode(name), body = entry.bytes;
    if (!(body instanceof Uint8Array) || body.length >= 0xffffffff || filename.length > 65535) {
      throw Error("Source archive member exceeds classic ZIP limits");
    }
    const gzip = gzipBytes(body), compressed = gzip.subarray(10, gzip.length - 8);
    if (gzip[3] !== 0) throw Error("Source compressor requires a fixed gzip header");
    const crc = (gzip[gzip.length - 8] | (gzip[gzip.length - 7] << 8) |
                 (gzip[gzip.length - 6] << 16) | (gzip[gzip.length - 5] << 24)) >>> 0;
    const local = new Uint8Array(30 + filename.length);
    set32(local, 0, 0x04034b50); set16(local, 4, 20); set16(local, 6, 0x0800);
    set16(local, 8, 8); set16(local, 12, date); set32(local, 14, crc);
    set32(local, 18, compressed.length); set32(local, 22, body.length);
    set16(local, 26, filename.length); local.set(filename, 30);
    const directory = new Uint8Array(46 + filename.length);
    set32(directory, 0, 0x02014b50); set16(directory, 4, (3 << 8) | 20);
    set16(directory, 6, 20); set16(directory, 8, 0x0800); set16(directory, 10, 8);
    set16(directory, 14, date); set32(directory, 16, crc);
    set32(directory, 20, compressed.length); set32(directory, 24, body.length);
    set16(directory, 28, filename.length);
    set32(directory, 38, ((entry.mode === "100755" ? 0o100755 : 0o100644) << 16) >>> 0);
    set32(directory, 42, offset); directory.set(filename, 46);
    locals.push(local, compressed); central.push(directory);
    offset += local.length + compressed.length;
    if (offset >= 0xffffffff) throw Error("Source archive requires ZIP64");
  }
  const directory = concatBytes(central), end = new Uint8Array(22);
  set32(end, 0, 0x06054b50); set16(end, 8, entries.length); set16(end, 10, entries.length);
  set32(end, 12, directory.length); set32(end, 16, offset);
  return concatBytes([...locals, directory, end]);
}

function encodeApplicationArchive(document) {
  if (!document || document.schema !== "commons.source-map/1" ||
      document.kind !== "upstate.complete-application-source/v1" ||
      typeof document.source_ref !== "string" || typeof document.repository !== "string") {
    throw Error("Choose the complete application source map");
  }
  const files = document.files || {}, metadata = document.file_metadata || {};
  const names = Object.keys(files).sort(), entries = [];
  if (!names.length || names.length !== Object.keys(metadata).length) throw Error("Source inventory differs");
  let sourceBytes = 0;
  for (const name of names) {
    if (name === "APPLICATION_SOURCE_RECEIPT.json" || typeof files[name] !== "string") {
      throw Error("Invalid source body or reserved receiving marker");
    }
    const item = metadata[name], encoding = item?.encoding || "utf-8";
    if (!["utf-8", "utf8", "base64"].includes(encoding)) {
      throw Error("Unsupported member encoding: " + name);
    }
    const bytes = encoding === "base64" ? fromBase64(files[name]) : utf8Encode(files[name]);
    if (!item || item.bytes !== bytes.length || item.sha256 !== sha256Bytes(bytes) ||
        !["100644", "100755"].includes(item.mode)) throw Error("Source identity differs: " + name);
    sourceBytes += bytes.length;
    entries.push({name: "upper-savannah-application/" + name, bytes, mode: item.mode});
  }
  const payload = utf8Encode(JSON.stringify(document, null, 2) + "\n");
  const receipt = {
    schema: "upstate.application-source-receipt/v1",
    source_ref: document.source_ref, repository: document.repository,
    payload_sha256: sha256Bytes(payload), payload_bytes: payload.length,
    files: names.length, source_bytes: sourceBytes,
    state: "application_source_received", scientific_execution: "not_performed"
  };
  entries.push({name: "upper-savannah-application/APPLICATION_SOURCE_RECEIPT.json",
                bytes: utf8Encode(JSON.stringify(receipt, null, 2) + "\n"), mode: "100644"});
  entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const bytes = zipSourceEntries(entries);
  return {
    bytes, base64: toBase64(bytes), receipt,
    metadata: {schema: "upstate.application-source-archive/v1",
               bytes: bytes.length, sha256: sha256Bytes(bytes),
               files: names.length, source_bytes: sourceBytes,
               payload_sha256: receipt.payload_sha256,
               root: "upper-savannah-application", source_ref: document.source_ref}
  };
}

export {zipSourceEntries, encodeApplicationArchive};
