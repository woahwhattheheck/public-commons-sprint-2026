import fs from 'node:fs';
import { evaluateReleaseEvidence } from '../src/release-gate.mjs';
const [file, asOfArg] = process.argv.slice(2);
if (!file) { console.error('usage: node bin/release-gate.mjs <evidence.json> [asOf]'); process.exit(2); }
const input = JSON.parse(fs.readFileSync(file, 'utf8'));
const asOf = asOfArg || new Date().toISOString();
try {
  const result = evaluateReleaseEvidence(input, { asOf });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.state === 'READY_FOR_HUMAN_SUBMISSION_REVIEW' ? 0 : 3);
} catch (error) {
  console.error(error.message);
  process.exit(4);
}
