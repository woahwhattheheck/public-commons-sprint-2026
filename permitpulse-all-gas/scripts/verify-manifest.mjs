import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await fs.readFile(path.join(root, "SOURCE_MANIFEST.json"), "utf8"));
if (manifest.format !== "permitpulse-source-manifest-v2") throw new Error("unexpected manifest format");
if (!/^[0-9a-f]{64}$/.test(manifest.sourceGeneration)) throw new Error("invalid sourceGeneration");
for (const [relative, expected] of Object.entries(manifest.files)) {
  const bytes = await fs.readFile(path.join(root, relative));
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) throw new Error(`manifest mismatch: ${relative}`);
}
const orderedFiles = Object.fromEntries(Object.entries(manifest.files).sort(([a],[b]) => (a < b ? -1 : a > b ? 1 : 0)));
const generation = createHash("sha256").update(JSON.stringify(orderedFiles)).digest("hex");
if (generation !== manifest.sourceGeneration) throw new Error("source generation mismatch");
console.log(`manifest PASS (${Object.keys(manifest.files).length} files; generation=${generation})`);
