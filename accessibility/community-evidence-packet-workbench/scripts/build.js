#!/usr/bin/env node
/**
 * Reproducible static build: one self-contained dist/index.html.
 * No bundler package. No runtime network.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const order = [
  "src/core/hash.js",
  "src/core/escape.js",
  "src/core/paths.js",
  "src/core/zip.js",
  "src/core/wacz.js",
  "src/core/packet.js",
  "src/core/export.js",
  "src/ui/app.js",
];

function stripModule(src, file) {
  let s = src.replace(/^\s*import\s+[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "");
  s = s.replace(/export\s+async\s+function/g, "async function");
  s = s.replace(/export\s+function/g, "function");
  s = s.replace(/export\s+const/g, "const");
  s = s.replace(/export\s+\{[^}]+\}\s*;?/g, "");
  return `\n/* ---- ${file} ---- */\n` + s + "\n";
}

const css = readFileSync(join(root, "src/ui/app.css"), "utf8");
let html = readFileSync(join(root, "src/ui/index.html"), "utf8");
let js = '"use strict";\n';
for (const file of order) {
  js += stripModule(readFileSync(join(root, file), "utf8"), file);
}
js = js.replace(/<\/script/gi, "<\\/script");

html = html.replace(
  /<link rel="stylesheet" href="app.css">/,
  "<style>\n" + css + "\n</style>",
);
html = html.replace(/<script type="module" src="app.js"><\/script>/, () => {
  return "<script>\n" + js + "\n</script>";
});

mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist/index.html"), html);
writeFileSync(
  join(root, "dist/BUILD.txt"),
  "Reproducible static build of Community Evidence Packet Workbench.\nCommand: node scripts/build.js\nOutput: dist/index.html (self-contained, no runtime network).\nThis file is a build note, not a certification.\nBytes: " +
    Buffer.byteLength(html) +
    "\n",
);
process.stdout.write("wrote dist/index.html (" + Buffer.byteLength(html) + " bytes)\n");
