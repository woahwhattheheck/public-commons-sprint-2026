#!/usr/bin/env node
// Profile the complete retained source-map text carrier, using the selected maintained codec.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createArchiveCodec } from "./archive_codec.mjs";

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

async function main(args) {
  let input, selectedCodec, checkGzip = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--gzip-check") checkGzip = true;
    else if (args[i] === "--codec" && args[i + 1]) selectedCodec = args[++i];
    else if (!args[i].startsWith("-") && !input) input = args[i];
    else throw new Error("Usage: node archive_codec_profile.mjs SOURCE.text.json [--codec CODEC.mjs] [--gzip-check]");
  }
  if (!input) throw new Error("Choose the retained source-map text companion.");
  const factory = selectedCodec ? (await import(pathToFileURL(resolve(selectedCodec)).href)).createArchiveCodec : createArchiveCodec;
  const source = JSON.parse(await readFile(input, "utf8"));
  const result = profileSourceMapCarrier(factory(), source, { checkGzip,
    onStage: row => process.stderr.write(row.name + ": " + row.milliseconds.toFixed(3) + " ms\n") });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
}
