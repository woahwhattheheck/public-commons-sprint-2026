import fs from 'node:fs';
import { evaluateReleaseEvidence } from '../src/release-gate.mjs';
const [file] = process.argv.slice(2);
if (!file) {
  console.error('usage: node bin/release-gate.mjs <manifest.json>');
  process.exit(2);
}
const input = JSON.parse(fs.readFileSync(file, 'utf8'));
const result = evaluateReleaseEvidence(input);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exit(result.state === 'READY_FOR_HUMAN_SUBMISSION_REVIEW' ? 0 : 3);
