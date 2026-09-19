import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateReadiness } from "../submission/readiness-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readiness = JSON.parse(await fs.readFile(path.join(root, "submission", "READINESS.json"), "utf8"));
const demo = JSON.parse(await fs.readFile(path.join(root, "submission", "DEMO_PLAN.json"), "utf8"));
const result = validateReadiness(readiness, demo);

for (const relative of ["submission/DEMO_SCRIPT.md","submission/SUBMISSION_COPY.md","submission/CAPABILITY_MATRIX.md"]) {
  const body = await fs.readFile(path.join(root, relative), "utf8");
  if (body.length < 300) throw new Error(`${relative} unexpectedly short`);
  if (/\b(PAID|WINNER|SUBMITTED|LIVE)\b/.test(body) && !/\bOPEN\b/.test(body)) {
    throw new Error(`${relative} may overclaim provider state`);
  }
}

console.log(`submission-readiness PASS (${result.receiptCount} receipt lanes; ${result.verifiedRequired}/${result.requiredCount} required verified; demo ${demo.targetSeconds}s; ready=${result.readyForSubmission}; generation=${result.sourceGeneration})`);
