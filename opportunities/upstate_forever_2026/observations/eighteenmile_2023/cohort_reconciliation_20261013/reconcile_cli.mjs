#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { reconcile } from "./reconcile.mjs";

const root = resolve(process.argv[2] || fileURLToPath(new URL("../../../", import.meta.url)));
const output = resolve(root, "observations/eighteenmile_2023/cohort_reconciliation_20261013");
const manifest = JSON.parse(await readFile(resolve(output, "source-inputs.json"), "utf8"));
const inputs = {};
for (const input of manifest.files) {
  const bytes = await readFile(resolve(root, input.path));
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== input.bytes || hash !== input.sha256) throw Error("Original source differs: " + input.path);
  inputs[input.key] = bytes.toString("utf8");
}
const product = reconcile(inputs);
for (const [name,content] of Object.entries(product.files)) await writeFile(resolve(output,name),content,"utf8");
process.stdout.write(JSON.stringify({selected_original_activities:product.selected.length,summary:product.summary},null,2)+"\n");
