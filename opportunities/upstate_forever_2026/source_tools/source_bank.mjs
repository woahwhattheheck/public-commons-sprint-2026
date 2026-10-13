// Copyright TokenJunkieLabs. Data-only archive recovery; decoded source is never executed.
import { createArchiveCodec } from "./archive_codec.mjs";
import { createXzSourceDecoder } from "./xz_source.mjs";

export const DEFAULT_LIMITS = Object.freeze({
  maxInputBytes: 64 * 1024 * 1024,
  maxOutputBytes: 128 * 1024 * 1024,
  maxMemberBytes: 32 * 1024 * 1024,
  maxMembers: 10000,
  maxGzipMembers: 1024
});

export function createSourceBankToolkit(options = {}) {
  const codec = createArchiveCodec();
  const limits = { ...DEFAULT_LIMITS };
  const fail = message => { throw new Error("source_bank: " + message); };
  for (const [key, value] of Object.entries(options)) {
    if (!Object.prototype.hasOwnProperty.call(limits, key)) fail("unknown limit " + key);
    if (!Number.isSafeInteger(value) || value < 1 || value > 0x7fffffff)
      fail("limits must be positive safe integers below 2 GiB: " + key);
    limits[key] = value;
  }
  const shaPattern = /^[0-9a-f]{64}$/i;
  function count(value, expected, label) {
    if (expected !== undefined && (!Number.isSafeInteger(expected) || expected < 0 || value !== expected))
      fail(label + " byte/count mismatch");
  }
  function hash(value, expected, label) {
    const actual = codec.sha256(value);
    if (expected !== undefined && (typeof expected !== "string" || !shaPattern.test(expected) || actual !== expected.toLowerCase()))
      fail(label + " SHA-256 mismatch");
    return actual;
  }
  function utf8Length(text) {
    if (typeof text !== "string") fail("expected UTF-8 source text");
    let n = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const low = text.charCodeAt(++i);
        if (!(low >= 0xdc00 && low <= 0xdfff)) fail("unpaired UTF-16 surrogate");
        n += 4;
      } else if (c >= 0xdc00 && c <= 0xdfff) fail("unpaired UTF-16 surrogate");
      else n += c < 128 ? 1 : c < 2048 ? 2 : 3;
    }
    return n;
  }
  function inputBytes(value) {
    if (typeof value === "string") {
      if (utf8Length(value) > limits.maxInputBytes) fail("input exceeds maxInputBytes");
      return codec.utf8Encode(value);
    }
    if (!(value instanceof Uint8Array)) fail("input must be Uint8Array or UTF-8 text");
    if (value.length > limits.maxInputBytes) fail("input exceeds maxInputBytes");
    return value;
  }
  function decodeBase64(text, maximum, label) {
    if (typeof text !== "string") fail(label + " must be base64 text");
    const s = text.replace(/[ \t\r\n]/g, "");
    if (s.length > Math.ceil(maximum / 3) * 4 + 4) fail(label + " exceeds its byte limit");
    const data = codec.base64Decode(s);
    if (data.length > maximum) fail(label + " exceeds its byte limit");
    return data;
  }
  function portablePath(value, directory = false) {
    if (typeof value !== "string" || !value || value.length > 4096 ||
        /[\x00-\x1f\x7f\\:]/.test(value) || value.startsWith("/"))
      fail("invalid portable member path");
    let path = value;
    if (directory && path.endsWith("/")) path = path.slice(0, -1);
    const segments = path.split("/");
    if (!path || segments.some(s => !s || s === "." || s === ".." || /[. ]$/.test(s) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s)))
      fail("unsafe member path: " + value);
    return path;
  }
  function checkPaths(rows) {
    const seen = new Map();
    for (const row of rows) {
      const key = row.path.normalize("NFC").toLowerCase();
      if (seen.has(key)) fail("duplicate or case-colliding member path: " + row.path);
      seen.set(key, row);
    }
    for (const row of rows) {
      const segments = row.path.split("/");
      for (let i = 1; i < segments.length; i++) {
        const parent = seen.get(segments.slice(0, i).join("/").normalize("NFC").toLowerCase());
        if (parent && !parent.directory) fail("file is used as a parent directory: " + row.path);
      }
    }
  }
  function fileRow(path, data, expected = {}) {
    if (data.length > limits.maxMemberBytes) fail("member exceeds maxMemberBytes: " + path);
    count(data.length, expected.bytes, path);
    return { path, bytes: data.length, sha256: hash(data, expected.sha256, path), data };
  }
  function summarize(kind, files, metadata = {}) {
    checkPaths(files);
    const total = files.reduce((n, f) => n + f.bytes, 0);
    if (files.length > limits.maxMembers || total > limits.maxOutputBytes)
      fail("expanded archive exceeds member or output limits");
    return { kind, files, memberCount: files.length, totalBytes: total, ...metadata };
  }
  function sourceBank(bank) {
    if (!bank || typeof bank !== "object" || Array.isArray(bank)) fail("expected a source-bank object");
    const schema = bank.schema ?? bank.format;
    if (![1, "commons.source-bank/v1", "commons.source-map/1",
          "upstate.source-files/v1", "eco-source-text-v1"].includes(schema))
      fail("unsupported source-bank schema");
    let entries;
    if (schema === "commons.source-map/1" && Array.isArray(bank.files)) {
      if (bank.file_metadata !== undefined)
        fail("source-map array descriptors must contain their own metadata");
      if (bank.files.length > limits.maxMembers) fail("source bank member limit exceeded");
      entries = bank.files.map(entry => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
            !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 ||
            typeof entry.sha256 !== "string" || !shaPattern.test(entry.sha256) ||
            (entry.mode !== undefined && !["100644", "100755"].includes(entry.mode)))
          fail("source-map array descriptors need original bytes, SHA-256 and an optional regular-file mode");
        const { content, content_base64, ...metadata } = entry;
        return { ...entry, declaredMetadata: metadata };
      });
    } else if (schema === "commons.source-map/1") {
      if (!bank.files || typeof bank.files !== "object" || Array.isArray(bank.files) ||
          !bank.file_metadata || typeof bank.file_metadata !== "object" || Array.isArray(bank.file_metadata))
        fail("source map needs files and file_metadata mappings");
      const paths = Object.keys(bank.files), metadataPaths = Object.keys(bank.file_metadata);
      if (paths.length > limits.maxMembers) fail("source bank member limit exceeded");
      if (paths.length !== metadataPaths.length ||
          metadataPaths.some(path => !Object.prototype.hasOwnProperty.call(bank.files, path)))
        fail("source-map metadata paths must match every source file exactly");
      entries = paths.map(path => {
        const metadata = bank.file_metadata[path];
        if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) ||
            !Number.isSafeInteger(metadata.bytes) || metadata.bytes < 0 ||
            typeof metadata.sha256 !== "string" || !shaPattern.test(metadata.sha256) ||
            (metadata.mode !== undefined && !["100644", "100755"].includes(metadata.mode)))
          fail("source-map metadata needs original bytes, SHA-256 and an optional regular-file mode: " + path);
        return { path, content: bank.files[path], bytes: metadata.bytes,
                 sha256: metadata.sha256, mode: metadata.mode, encoding: metadata.encoding,
                 declaredMetadata: metadata };
      });
    } else if (Array.isArray(bank.files)) entries = bank.files;
    else if (bank.files && typeof bank.files === "object")
      entries = Object.entries(bank.files).map(([path, content]) => ({ path, content }));
    else fail("source bank needs files");
    if (entries.length > limits.maxMembers) fail("source bank member limit exceeded");
    const files = []; let total = 0;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") fail("invalid source file descriptor");
      const path = portablePath(entry.path);
      let data;
      if (entry.content_base64 !== undefined) {
        if (entry.content !== undefined) fail("ambiguous source content fields: " + path);
        data = decodeBase64(entry.content_base64, Math.min(limits.maxMemberBytes, limits.maxOutputBytes - total), path);
      } else if (entry.encoding === "base64") {
        data = decodeBase64(entry.content, Math.min(limits.maxMemberBytes, limits.maxOutputBytes - total), path);
      } else {
        if (entry.encoding && !["utf-8", "utf8", "text"].includes(entry.encoding))
          fail("unsupported source encoding: " + path);
        const n = utf8Length(entry.content);
        if (n > limits.maxMemberBytes || n > limits.maxOutputBytes - total)
          fail("source member exceeds expanded byte limit: " + path);
        data = codec.utf8Encode(entry.content);
      }
      if (entry.mode !== undefined && ![0o644, 0o755, "644", "755", "0644", "0755", "100644", "100755"].includes(entry.mode))
        fail("source bank contains unsupported file mode: " + path);
      const row = fileRow(path, data, entry);
      row.executable = [0o755, "755", "0755", "100755"].includes(entry.mode);
      row.declaredSha256 = entry.sha256 !== undefined;
      if (entry.declaredMetadata !== undefined) row.declaredMetadata = { ...entry.declaredMetadata };
      total += data.length; files.push(row);
    }
    return summarize("source-bank", files, {
      schema, sourceRoot: bank.source_root ?? bank.base_path ?? (schema === "commons.source-map/1" ? bank.prefix ?? null : null),
      ...(schema === "commons.source-map/1" ? {
        edition: bank.edition ?? null, repository: bank.repository ?? null, sourceRef: bank.source_ref ?? null
      } : {})
    });
  }
  const u16 = (a, p) => a[p] | (a[p + 1] << 8);
  const u32 = (a, p) => (a[p] | (a[p + 1] << 8) | (a[p + 2] << 16) | (a[p + 3] << 24)) >>> 0;
  function extraFields(a, p, length) {
    const end = p + length;
    while (p < end) {
      if (p + 4 > end) fail("truncated ZIP extra field");
      const type = u16(a, p), size = u16(a, p + 2); p += 4;
      if (p + size > end) fail("truncated ZIP extra field data");
      if (type === 1) fail("ZIP64 is not supported");
      p += size;
    }
  }
  function zip(input) {
    const a = inputBytes(input);
    let end = -1;
    for (let p = a.length - 22; p >= Math.max(0, a.length - 22 - 65535); p--) {
      if (u32(a, p) === 0x06054b50 && p + 22 + u16(a, p + 20) === a.length) { end = p; break; }
    }
    if (end < 0) fail("ZIP end-of-central-directory record not found");
    const disk = u16(a, end + 4), cdDisk = u16(a, end + 6), diskCount = u16(a, end + 8);
    const members = u16(a, end + 10), cdSize = u32(a, end + 12), cdOffset = u32(a, end + 16);
    if (disk || cdDisk || diskCount !== members) fail("multi-disk ZIP is not supported");
    if (members === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff)
      fail("ZIP64 is not supported");
    if (members > limits.maxMembers || cdOffset + cdSize !== end) fail("invalid ZIP central-directory bounds");
    const rows = []; let p = cdOffset, expanded = 0;
    for (let i = 0; i < members; i++) {
      if (p + 46 > end || u32(a, p) !== 0x02014b50) fail("invalid ZIP central-directory entry");
      const flags = u16(a, p + 8), method = u16(a, p + 10), crc = u32(a, p + 16);
      const compressed = u32(a, p + 20), size = u32(a, p + 24);
      const nameLength = u16(a, p + 28), extraLength = u16(a, p + 30), commentLength = u16(a, p + 32);
      const startDisk = u16(a, p + 34), attrs = u32(a, p + 38), local = u32(a, p + 42);
      const finish = p + 46 + nameLength + extraLength + commentLength;
      if (finish > end || compressed === 0xffffffff || size === 0xffffffff || local === 0xffffffff)
        fail("invalid or ZIP64 member bounds");
      if (startDisk || (flags & ~0x080e)) fail("encrypted or unsupported ZIP flags");
      if (![0, 8].includes(method) || (method === 0 && (flags & 6)))
        fail("only stored and deflated ZIP members are supported");
      const rawName = a.subarray(p + 46, p + 46 + nameLength);
      if (!(flags & 0x0800) && rawName.some(v => v > 127)) fail("ZIP filename needs UTF-8 flag or ASCII bytes");
      const name = codec.utf8Decode(rawName), directory = name.endsWith("/");
      const path = portablePath(name, directory), unixType = (attrs >>> 16) & 0xf000;
      if (![0, 0x8000, 0x4000].includes(unixType) || (unixType === 0x4000 && !directory) ||
          (unixType === 0x8000 && directory)) fail("ZIP special file or mismatched directory type: " + path);
      if ((attrs & 0x10) && !directory) fail("ZIP directory attribute mismatch");
      if (directory && size !== 0) fail("ZIP directory contains data");
      if (size > limits.maxMemberBytes || size > limits.maxOutputBytes - expanded)
        fail("ZIP expanded member/output limit exceeded");
      expanded += size;
      extraFields(a, p + 46 + nameLength, extraLength);
      if (local + 30 > cdOffset || u32(a, local) !== 0x04034b50) fail("invalid ZIP local header");
      const localFlags = u16(a, local + 6), localMethod = u16(a, local + 8);
      const localNameLength = u16(a, local + 26), localExtraLength = u16(a, local + 28);
      const dataStart = local + 30 + localNameLength + localExtraLength, dataEnd = dataStart + compressed;
      if (dataEnd > cdOffset || localFlags !== flags || localMethod !== method ||
          localNameLength !== nameLength) fail("ZIP local/central member mismatch");
      for (let j = 0; j < nameLength; j++) if (a[local + 30 + j] !== rawName[j])
        fail("ZIP local/central filename mismatch");
      extraFields(a, local + 30 + localNameLength, localExtraLength);
      if (!(flags & 8) && (u32(a, local + 14) !== crc || u32(a, local + 18) !== compressed || u32(a, local + 22) !== size))
        fail("ZIP local/central size or CRC mismatch");
      let memberEnd = dataEnd;
      if (flags & 8) {
        const offsets = u32(a, dataEnd) === 0x08074b50 ? [dataEnd + 4, dataEnd] : [dataEnd];
        const descriptor = offsets.find(q => q + 12 <= cdOffset && u32(a, q) === crc &&
          u32(a, q + 4) === compressed && u32(a, q + 8) === size);
        if (descriptor === undefined) fail("ZIP data descriptor mismatch");
        memberEnd = descriptor + 12;
      }
      rows.push({ path, directory, size, compressed, crc, method, dataStart, dataEnd,
                  start: local, end: memberEnd, executable: Boolean((attrs >>> 16) & 0o111) });
      p = finish;
    }
    if (p !== end) fail("ZIP central-directory length/count mismatch");
    checkPaths(rows);
    const spans = rows.slice().sort((x, y) => x.start - y.start);
    let edge = 0;
    for (const row of spans) {
      if (row.start !== edge) fail("ZIP has overlapping members, a preamble or unaccounted local data");
      edge = row.end;
    }
    if (edge !== cdOffset) fail("ZIP has unaccounted data before central directory");
    const files = [];
    for (const row of rows) {
      const packed = a.subarray(row.dataStart, row.dataEnd);
      let data;
      if (row.method === 0) {
        if (packed.length !== row.size) fail("stored ZIP member size mismatch");
        data = packed.slice();
      } else {
        const value = codec.inflateRaw(packed, 0, row.size);
        if (value.nextOffset !== packed.length) fail("ZIP member has trailing deflate bytes");
        data = value.bytes;
      }
      if (data.length !== row.size || codec.crc32(data) !== row.crc) fail("ZIP member size or CRC32 mismatch: " + row.path);
      if (!row.directory) files.push({ ...fileRow(row.path, data), executable: row.executable, crc32: row.crc.toString(16).padStart(8, "0") });
    }
    return summarize("zip", files, { archiveSha256: codec.sha256(a), archiveBytes: a.length, directoryCount: rows.filter(r => r.directory).length });
  }
  function carrierJson(text) {
    // Slack may replace indentation spaces with NBSP. Preserve every quoted
    // source character and keep hashing the original carrier before this parse.
    if (!text.includes("\u00a0")) return JSON.parse(text);
    let quoted = false, escaped = false, start = 0;
    const spans = [];
    for (let index = 0; index < text.length; index++) {
      const character = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
      } else {
        if (character === '"') quoted = true;
        if (character === "\u00a0") {
          spans.push(text.slice(start, index), " ");
          start = index + 1;
        }
      }
    }
    return JSON.parse(spans.length ? spans.join("") + text.slice(start) : text);
  }
  function gzipEnvelope(value, depth) {
    if (!["base64+gzip", "gzip+base64", "base64+gzip+utf8-json"].includes(value.encoding) || !Array.isArray(value.chunks) ||
        !value.chunks.length || value.chunks.length > limits.maxMembers)
      fail("gzip source envelope needs ordered base64 chunks");
    let chunks;
    if (value.chunks.every(part => typeof part === "string")) chunks = value.chunks;
    else if (value.chunks.every((part, index) => part && typeof part === "object" &&
        !Array.isArray(part) && part.index === index && typeof part.content_base64 === "string"))
      chunks = value.chunks.map(part => part.content_base64);
    else fail("gzip source chunks must be strings or a complete zero-based indexed sequence");
    const pairs = [["compressed_bytes", "compressed_sha256"], ["gzip_bytes", "gzip_sha256"]];
    const identities = pairs.filter(([bytes, sha]) => value[bytes] !== undefined || value[sha] !== undefined)
      .map(([bytes, sha]) => {
        if (!Number.isSafeInteger(value[bytes]) || value[bytes] < 0 ||
            typeof value[sha] !== "string" || !shaPattern.test(value[sha]))
          fail("gzip source envelope needs both " + bytes + " and " + sha);
        return { bytes: value[bytes], sha256: value[sha].toLowerCase() };
      });
    if (!identities.length || identities.some(row =>
        row.bytes !== identities[0].bytes || row.sha256 !== identities[0].sha256))
      fail("gzip source envelope has absent or conflicting compressed identities");
    const compressed = identities[0];
    if (!Number.isSafeInteger(value.decoded_bytes) || value.decoded_bytes < 0 ||
        typeof value.decoded_sha256 !== "string" || !shaPattern.test(value.decoded_sha256))
      fail("gzip source envelope needs decoded bytes and SHA-256");
    const encodedLength = chunks.reduce((n, part) => n + part.length, 0);
    if (encodedLength > Math.ceil(limits.maxInputBytes / 3) * 4 + 4 ||
        compressed.bytes > limits.maxInputBytes || value.decoded_bytes > limits.maxOutputBytes)
      fail("gzip source envelope exceeds byte limits");
    const packed = decodeBase64(chunks.join(""), limits.maxInputBytes, "gzip source envelope");
    count(packed.length, compressed.bytes, "compressed source envelope");
    const compressedSha256 = hash(packed, compressed.sha256, "compressed source envelope");
    const raw = codec.gunzip(packed, { maxOutputBytes: value.decoded_bytes, maxMembers: limits.maxGzipMembers });
    count(raw.length, value.decoded_bytes, "decoded source envelope");
    const payloadSha256 = hash(raw, value.decoded_sha256, "decoded source envelope");
    const result = unwrapJson(carrierJson(codec.utf8Decode(raw)), depth + 1);
    count(result.memberCount, value.file_count, "source envelope file count");
    return { ...result, compressedBytes: packed.length, compressedSha256, payloadSha256,
      envelope: { schema: value.schema, encoding: value.encoding,
                  compressedBytes: packed.length, decodedBytes: raw.length,
                  compressedSha256, decodedSha256: payloadSha256,
                  ...(value.file_count === undefined ? {} : { fileCount: value.file_count }) } };
  }
  function unwrapJson(value, depth = 0) {
    if (depth > 4) fail("archive envelope nesting exceeds limit");
    if (value?.schema === "upstate.application-source-part/v1") return packets([value]);
    if (Array.isArray(value) && value.length && value.every(part =>
        part?.schema === "upstate.application-source-part/v1")) return packets(value);
    if (value?.schema === "commons.gzip-source-bank/v1") return gzipEnvelope(value, depth);
    if (value?.schema === "commons.artifact-base64/v1") {
      const data = decodeBase64(value.content_base64, limits.maxInputBytes, "artifact envelope");
      count(data.length, value.bytes, "artifact envelope");
      const identity = hash(data, value.sha256, "artifact envelope");
      const result = decode(data, { depth: depth + 1 });
      result.envelope = { schema: value.schema, filename: portablePath(value.filename), bytes: data.length, sha256: identity };
      return result;
    }
    if (value?.schema === "commons.source-bank-envelope/v1") {
      if (value.encoding !== "base64+gzip"
          || !Number.isSafeInteger(value.bytes) || value.bytes < 0
          || !Number.isSafeInteger(value.gzip_bytes) || value.gzip_bytes < 0
          || typeof value.sha256 !== "string" || !shaPattern.test(value.sha256)
          || typeof value.gzip_sha256 !== "string" || !shaPattern.test(value.gzip_sha256))
        fail("source-bank envelope requires decoded and gzip byte counts and SHA-256");
      if (value.bytes > limits.maxOutputBytes || value.gzip_bytes > limits.maxInputBytes)
        fail("source-bank envelope exceeds resource limits");
      const packed = decodeBase64(value.data, limits.maxInputBytes, "source-bank envelope");
      count(packed.length, value.gzip_bytes, "source-bank gzip");
      const compressedSha256 = hash(packed, value.gzip_sha256, "source-bank gzip");
      const raw = codec.gunzip(packed, {
        maxOutputBytes: value.bytes, maxMembers: limits.maxGzipMembers
      });
      count(raw.length, value.bytes, "source-bank payload");
      const payloadSha256 = hash(raw, value.sha256, "source-bank payload");
      const result = sourceBank(carrierJson(codec.utf8Decode(raw)));
      return { ...result, envelope: {
        schema: value.schema, encoding: value.encoding,
        bytes: raw.length, sha256: payloadSha256,
        gzipBytes: packed.length, gzipSha256: compressedSha256
      }, payloadSha256, compressedSha256, compressedBytes: packed.length };
    }
    if (value && typeof value === "object" && !("schema" in value) && !("format" in value)
        && "markdown_content" in value) {
      if (typeof value.canvas_id !== "string" || !/^F[A-Z0-9]+$/.test(value.canvas_id)
          || typeof value.markdown_content !== "string")
        fail("Slack Canvas response needs its original canvas ID and Markdown");
      const result = markdown(value.markdown_content, depth + 1, true);
      return { ...result, carrier: {
        type: "slack-canvas", canvasId: value.canvas_id,
        markdownBytes: utf8Length(value.markdown_content),
        markdownSha256: codec.sha256(codec.utf8Encode(value.markdown_content))
      } };
    }
    if (value && typeof value === "object" && !("schema" in value) && !("format" in value)
        && Array.isArray(value.content)) {
      if (value.isError === true) fail("provider returned an error instead of source content");
      if (value.content.length !== 1 || value.content[0]?.type !== "text"
          || typeof value.content[0].text !== "string")
        fail("provider source response must contain exactly one text result");
      const result = decode(value.content[0].text, { depth: depth + 1 });
      return { ...result, providerResponse: { type: "mcp-text-result" } };
    }
    return sourceBank(value);
  }
  function packets(parts) {
    if (!parts.length || parts.length > limits.maxMembers) fail("invalid source packet count");
    const ordered = parts.slice().sort((a, b) => a.part - b.part), first = ordered[0];
    const keys = ["schema", "edition", "encoding", "parts", "payload_bytes", "payload_sha256",
                  "compressed_bytes", "compressed_sha256", "files", "source_bytes"];
    if (first.schema !== "upstate.application-source-part/v1" || first.encoding !== "gzip+base64")
      fail("unsupported source packet schema or encoding");
    if (typeof first.edition !== "string" || !first.edition ||
        !Number.isSafeInteger(first.parts) || first.parts < 1 ||
        !Number.isSafeInteger(first.payload_bytes) || first.payload_bytes < 0 ||
        !Number.isSafeInteger(first.compressed_bytes) || first.compressed_bytes < 0 ||
        typeof first.payload_sha256 !== "string" || !shaPattern.test(first.payload_sha256) ||
        typeof first.compressed_sha256 !== "string" || !shaPattern.test(first.compressed_sha256))
      fail("source packets require an edition, part count and decoded/gzip byte and SHA-256 identities");
    if (first.payload_bytes > limits.maxOutputBytes || first.compressed_bytes > limits.maxInputBytes)
      fail("source packet declared size exceeds resource limits");
    count(parts.length, first.parts, "source packet total");
    ordered.forEach((part, i) => {
      if (part.part !== i + 1) fail("missing or duplicate source packet");
      for (const key of keys) if (part[key] !== first[key]) fail("source packets mix editions or identities");
      if (typeof part.data !== "string") fail("source packet data must be base64");
    });
    const encodedLength = ordered.reduce((n, part) => n + part.data.length, 0);
    if (encodedLength > Math.ceil(limits.maxInputBytes / 3) * 4 + 4)
      fail("source packet input exceeds maxInputBytes");
    const joined = ordered.map(part => part.data).join("");
    const packed = decodeBase64(joined, limits.maxInputBytes, "source packets");
    count(packed.length, first.compressed_bytes, "compressed source packets");
    hash(packed, first.compressed_sha256, "compressed source packets");
    const raw = codec.gunzip(packed, { maxOutputBytes: first.payload_bytes, maxMembers: limits.maxGzipMembers });
    count(raw.length, first.payload_bytes, "source packet payload");
    hash(raw, first.payload_sha256, "source packet payload");
    const result = sourceBank(carrierJson(codec.utf8Decode(raw)));
    count(result.memberCount, first.files, "source packet files");
    count(result.totalBytes, first.source_bytes, "source packet source");
    return { ...result, carrierEdition: first.edition, payloadSha256: codec.sha256(raw),
             compressedSha256: codec.sha256(packed), compressedBytes: packed.length };
  }
  function markdown(text, depth = 0, canvasEscapes = false) {
    if (depth > 4) fail("archive envelope nesting exceeds limit");
    if (utf8Length(text) > limits.maxInputBytes) fail("carrier exceeds maxInputBytes");
    const blocks = [...text.matchAll(/(?:^|\n)[ \t]*\x60{3}json[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\x60{3}[ \t]*(?=\r?\n|$)/g)].map(match => {
      try { return carrierJson(match[1]); }
      catch (error) {
        if (!canvasEscapes) throw error;
        // Native Slack Canvas reads escape Markdown punctuation inside code blocks.
        // Remove one documented transport layer only in an identified Canvas result.
        return carrierJson(match[1].replace(/\\([\\/"\x60*_{}\[\]()#+\-.!>])/g, "$1"));
      }
    });
    if (!blocks.length) {
      // Original native component carriers use numbered base64 fences plus
      // explicit compressed and decoded identities in the introductory header.
      const parts = [...text.matchAll(/(?:^|\n)## Part ([0-9]+) of ([0-9]+)[ \t]*\r?\n\s*\x60{3}base64[ \t]*\r?\n([A-Za-z0-9+/=\s]+?)\r?\n[ \t]*\x60{3}[ \t]*(?=\r?\n|$)/g)];
      const fences = [...text.matchAll(/(?:^|\n)[ \t]*\x60{3}base64[ \t]*\r?\n/g)];
      if (!parts.length || parts.length !== fences.length || parts.length > limits.maxMembers)
        fail("carrier needs one complete numbered base64 cohort");
      const count = Number(parts[0][2]);
      if (count !== parts.length || parts.some((part, index) =>
          Number(part[1]) !== index + 1 || Number(part[2]) !== count))
        fail("numbered source parts must form the complete original sequence");
      const header = text.slice(0, parts[0].index);
      const jsonIdentity = [...header.matchAll(/Complete JSON:[ \t]*([0-9]+) bytes[ \t]*\/[ \t]*SHA256[ \t]+([a-f0-9]{64})\b/g)];
      const gzipIdentity = [...header.matchAll(/Gzip:[ \t]*([0-9]+) bytes[ \t]*\/[ \t]*SHA256[ \t]+([a-f0-9]{64})\b/g)];
      const declaredParts = [...header.matchAll(/Parts:[ \t]*([0-9]+)\b/g)];
      if (jsonIdentity.length !== 1 || gzipIdentity.length !== 1 ||
          declaredParts.length !== 1 || Number(declaredParts[0][1]) !== count)
        fail("numbered source carrier needs exact JSON, gzip and part-count identities");
      return gzipEnvelope({
        schema: "commons.gzip-source-bank/v1", encoding: "gzip+base64",
        decoded_bytes: Number(jsonIdentity[0][1]), decoded_sha256: jsonIdentity[0][2],
        gzip_bytes: Number(gzipIdentity[0][1]), gzip_sha256: gzipIdentity[0][2],
        chunks: parts.map(part => part[3].replace(/\s/g, ""))
      }, depth);
    }
    if (blocks.every(b => b?.schema === "upstate.application-source-part/v1")) return packets(blocks);
    if (blocks.length !== 1) fail("carrier must contain one bank/envelope or one ordered packet cohort");
    return unwrapJson(blocks[0], depth + 1);
  }
  function decode(input, { expectedSha256, base64 = false, depth = 0 } = {}) {
    if (depth > 4) fail("archive envelope nesting exceeds limit");
    let a = inputBytes(input);
    if (base64) a = decodeBase64(codec.utf8Decode(a), limits.maxInputBytes, "base64 input");
    const inputSha256 = hash(a, expectedSha256, "input");
    let result;
    if (a.length >= 4 && [0x04034b50, 0x06054b50].includes(u32(a, 0))) result = zip(a);
    else if (a.length >= 6 && [253,55,122,88,90,0].every((v,i)=>a[i]===v)) {
      const recovered = createXzSourceDecoder(codec, {
        maxInputBytes: limits.maxInputBytes, maxOutputBytes: limits.maxOutputBytes,
        maxDictionaryBytes: 64 * 1024 * 1024, maxBlocks: limits.maxMembers
      })(a);
      result = unwrapJson(carrierJson(codec.utf8Decode(recovered.data)), depth + 1);
      result.payloadSha256 = recovered.sha256;
      result.xzBytes = a.length;
      result.xz = { checkType: recovered.checkType, blocks: recovered.blocks };
    }
    else if (a.length >= 2 && a[0] === 31 && a[1] === 139) {
      const raw = codec.gunzip(a, { maxOutputBytes: limits.maxOutputBytes, maxMembers: limits.maxGzipMembers });
      result = unwrapJson(carrierJson(codec.utf8Decode(raw)), depth + 1);
      result.payloadSha256 = codec.sha256(raw);
      result.gzipBytes = a.length;
    } else {
      const text = codec.utf8Decode(a);
      if (text.trimStart().startsWith("{") || text.trimStart().startsWith("[")) {
        const value = carrierJson(text);
        result = Array.isArray(value) ? packets(value) : unwrapJson(value, depth);
      } else result = markdown(text, depth);
    }
    return { ...result, inputSha256, inputBytes: a.length };
  }
  function inventory(result) {
    const { files, ...metadata } = result;
    return { ...metadata, limits: { ...limits }, files: files.map(({ data, ...f }) => f) };
  }
  return { decode, zip, sourceBank, packets, markdown, inventory, portablePath, limits: { ...limits } };
}
