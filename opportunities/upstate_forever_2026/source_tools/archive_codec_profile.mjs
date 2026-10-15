#!/usr/bin/env node
// Profile the complete retained source-map text carrier, using the selected maintained codec.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createArchiveCodec } from "./archive_codec.mjs";
import { gunzipSync } from "node:zlib";

export function profileSourceMapCarrier(codec, envelope, { checkGzip = false, onStage = () => {} } = {}) {
  if (envelope?.schema !== "commons.artifact-base64/v1" || envelope.encoding !== "gzip+base64")
    throw new Error("Choose the complete gzip/base64 source-map text companion.");
  const stages = [];
  const stage = (name, action) => {
    const start = performance.now(), value = action();
    const record = { name, milliseconds: performance.now() - start };
    stages.push(record); onStage(record); return value;
  };
  const packed = stage("base64Decode", () => codec.base64Decode(envelope.content_base64));
  const gzipSha = stage("sha256_gzip", () => codec.sha256(packed));
  if (packed.length !== envelope.gzip_bytes || gzipSha !== envelope.gzip_sha256)
    throw new Error("Original gzip identity mismatch.");
  const raw = stage("gunzip_including_crc", () => codec.gunzip(packed));
  const rawSha = stage("sha256_raw", () => codec.sha256(raw));
  if (raw.length !== envelope.decoded_bytes || rawSha !== envelope.decoded_sha256)
    throw new Error("Original source-map identity mismatch.");
  const text = stage("utf8Decode", () => codec.utf8Decode(raw));
  const bank = stage("JSON_parse", () => JSON.parse(text));
  if (bank?.schema !== "commons.source-map/1" || !bank.files || !bank.file_metadata)
    throw new Error("Choose the complete original source-map carrier.");
  const encoded = stage("utf8Encode", () => codec.utf8Encode(text));
  if (encoded.length !== raw.length) throw new Error("UTF-8 byte length changed.");
  for (let i = 0; i < raw.length; i++) if (encoded[i] !== raw[i]) throw new Error("UTF-8 bytes changed.");
  const files = stage("member_encode_and_sha", () => {
    let count = 0;
    for (const [path, content] of Object.entries(bank.files)) {
      const bytes = codec.utf8Encode(content), identity = bank.file_metadata[path];
      if (!identity || bytes.length !== identity.bytes || codec.sha256(bytes) !== identity.sha256)
        throw new Error("Original source member mismatch: " + path);
      count++;
    }
    return count;
  });
  if (files !== envelope.files) throw new Error("Original source-member count changed.");
  const base64 = stage("base64Encode", () => codec.base64Encode(packed));
  if (base64 !== envelope.content_base64) throw new Error("Original base64 bytes changed.");
  const result = { schema: "commons.archive-codec-profile/v1", files,
    sourceBytes: raw.length, sourceSha256: rawSha, gzipBytes: packed.length,
    gzipSha256: gzipSha, stages, measuredStageMilliseconds: stages.reduce((n, s) => n + s.milliseconds, 0) };
  if (checkGzip) {
    const start = performance.now(), produced = codec.gzip(raw);
    const milliseconds = performance.now() - start;
    if (produced.length !== packed.length) throw new Error("Recompressed gzip size changed.");
    for (let i = 0; i < packed.length; i++) if (produced[i] !== packed[i])
      throw new Error("Recompressed gzip byte changed at " + i);
    result.recompression = { milliseconds, exactOriginalBytes: true };
  }
  return result;
}

export function createAuthoredCompressionInput(codec, kind, sizeBytes) {
  if (!["compressible", "mixed"].includes(kind)) throw new Error("Choose compressible or mixed.");
  const size = sizeBytes ?? (kind === "compressible" ? 20 : 44) * 1024 * 1024;
  if (!Number.isSafeInteger(size) || size < 1 || size > 134217728)
    throw new Error("Choose an integer fixture size from 1 through 134217728 bytes.");
  const pattern = codec.utf8Encode('{"path":"module/example.mjs","content":"export const value = 1; // α 😀\\n","source":"authored public fixture"}\\n');
  const input = new Uint8Array(size); let state = 0x13a5b7d9;
  for (let i = 0; i < size; i++) {
    if (kind === "mixed" && (i & 65535) < 16384) {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      input[i] = state & 255;
    } else input[i] = pattern[i % pattern.length];
  }
  return input;
}

export function profileAuthoredCompression(codec, referenceCodec, {
  kind = "compressible", sizeBytes, onStage = () => {}, restore = bytes => codec.gunzip(bytes)
} = {}) {
  if (!referenceCodec) throw new Error("Choose the exact retained predecessor codec.");
  const input = createAuthoredCompressionInput(codec, kind, sizeBytes);
  const stages = [];
  function stage(name, action) {
    const start = performance.now(), value = action();
    const row = { name, milliseconds: performance.now() - start };
    stages.push(row); onStage(row); return value;
  }
  function exact(a, b, label) {
    if (a.length !== b.length) throw new Error(label + " length changed.");
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i])
      throw new Error(label + " byte changed at " + i);
  }
  const previous = stage("reference_gzip", () => referenceCodec.gzip(input));
  const current = stage("current_gzip", () => codec.gzip(input));
  exact(previous, current, "Recompressed gzip");
  const recovered = stage("restore", () => restore(current));
  exact(input, recovered, "Recovered input");
  const deflateBytes = current.length - 18;
  return {
    schema: "commons.archive-codec-authored-compression/v1", kind, sourceBytes: input.length,
    sourceSha256: codec.sha256(input), gzipBytes: current.length, gzipSha256: codec.sha256(current),
    exactReferenceBytes: true, exactRecoveredBytes: true, stages,
    allocationModel: {
      inputSizedMatchTableBytes: 262144 + 4 * input.length,
      fixedWindowMatchTableBytes: 393216,
      chunkedTypedOutputPayloadBoundBytes: 2 * deflateBytes + 65536,
      basis: "Source-derived formulas for predecessor blob e36e5ad678f0cc83edda8fa48e7e62de344a7404 and the fixed-window implementation, not runtime inspection of the selected modules. Output bound covers chunks and the deflate return buffer, not input, gzip framing copies, object overhead, runtime retention or process peak."
    }
  };
}

async function main(args) {
  let input, selectedCodec, checkGzip = false, authoredKind, referencePath, sizeBytes;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--gzip-check") checkGzip = true;
    else if (args[i] === "--codec" && args[i + 1]) selectedCodec = args[++i];
    else if (args[i] === "--authored-compression" && args[i + 1]) authoredKind = args[++i];
    else if (args[i] === "--reference-codec" && args[i + 1]) referencePath = args[++i];
    else if (args[i] === "--bytes" && args[i + 1]) sizeBytes = Number(args[++i]);
    else if (!args[i].startsWith("-") && !input) input = args[i];
    else throw new Error("Usage: node archive_codec_profile.mjs SOURCE.text.json [--codec CODEC.mjs] [--gzip-check], or --authored-compression compressible|mixed --reference-codec PREVIOUS.mjs [--bytes N] [--codec CURRENT.mjs]");
  }
  const factory = selectedCodec ? (await import(pathToFileURL(resolve(selectedCodec)).href)).createArchiveCodec : createArchiveCodec;
  const onStage = row => process.stderr.write(row.name + ": " + row.milliseconds.toFixed(3) + " ms\n");
  let result;
  if (authoredKind) {
    if (input || checkGzip || !referencePath)
      throw new Error("Authored compression requires --reference-codec, without a source carrier or --gzip-check.");
    const referenceFactory = (await import(pathToFileURL(resolve(referencePath)).href)).createArchiveCodec;
    result = profileAuthoredCompression(factory(), referenceFactory(), {
      kind: authoredKind, sizeBytes, onStage,
      // Node receiving also crosses the independent built-in gzip implementation.
      restore: bytes => gunzipSync(bytes)
    });
    result.restoreImplementation = "node:zlib gunzipSync";
  } else {
    if (!input || referencePath || sizeBytes !== undefined)
      throw new Error("Choose the retained source-map text companion, or an authored compression mode.");
    const source = JSON.parse(await readFile(input, "utf8"));
    result = profileSourceMapCarrier(factory(), source, { checkGzip, onStage });
  }
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
}
