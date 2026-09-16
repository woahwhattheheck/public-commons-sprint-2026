import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await fs.readFile(path.join(root, "SOURCE_MANIFEST.json"), "utf8"));
for (const [relative, expected] of Object.entries(manifest.files)) {
  const bytes = await fs.readFile(path.join(root, relative));
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) throw new Error(`manifest mismatch: ${relative}`);
}
console.log(`manifest PASS (${Object.keys(manifest.files).length} files)`);
