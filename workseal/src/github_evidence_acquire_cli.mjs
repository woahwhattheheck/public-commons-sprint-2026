#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { canonicalJson } from './canonical.mjs';
import { compileGitHubActionsAcquisition, parseStrictJsonBytes } from './github_evidence_acquire.mjs';

function usage(message) {
  if (message) console.error(message);
  console.error('usage: node src/github_evidence_acquire_cli.mjs --run run.json --jobs jobs-page-1.json [--jobs jobs-page-N.json ...] --workflow .github/workflows/ci.yml --expect expected.json [--out bundle.json]');
  process.exitCode = 2;
}

function parseArgs(argv) {
  const args = { jobs: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!['--run','--jobs','--workflow','--expect','--out'].includes(flag)) return usage(`unknown argument: ${flag}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) return usage(`missing value for ${flag}`);
    if (flag === '--jobs') args.jobs.push(value);
    else args[flag.slice(2)] = value;
  }
  if (!args.run || !args.workflow || !args.expect || args.jobs.length === 0) return usage('run, at least one jobs page, workflow and expect are required');
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args) {
  try {
    const [runBytes, workflowBytes, expectBytes, ...jobsBytes] = await Promise.all([
      readFile(args.run), readFile(args.workflow), readFile(args.expect), ...args.jobs.map(path => readFile(path)),
    ]);
    const expected = parseStrictJsonBytes(expectBytes, 'expectation file');
    const bundle = compileGitHubActionsAcquisition({
      runBytes, workflowBytes, expected,
      jobsPages: jobsBytes.map((rawBytes, index) => ({ page:index + 1, rawBytes })),
    });
    const output = `${canonicalJson(bundle)}\n`;
    if (args.out) await writeFile(args.out, output, { encoding:'utf8', flag:'wx', mode:0o600 });
    else process.stdout.write(output);
  } catch (error) {
    console.error(`${error.name ?? 'Error'}${error.code ? ` [${error.code}]` : ''}: ${error.message}`);
    process.exitCode = 1;
  }
}
