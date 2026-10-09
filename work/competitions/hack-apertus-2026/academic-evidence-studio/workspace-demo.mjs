#!/usr/bin/env node
/** Real offline execution with explicitly fictional input. Does not call a model. */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createWorkspace, applyReview } from './workspace.mjs';
const directory = resolve(process.argv[2] || 'offline-demo');
await mkdir(directory, {recursive:true});
const cli = fileURLToPath(new URL('./workspace-tools.mjs', import.meta.url));
const run = (args, expected = 0) => {
  console.log(`\n$ node workspace-tools.mjs ${args.map(a => a.startsWith(directory) ? a.slice(directory.length + 1) : a).join(' ')}`);
  const result = spawnSync(process.execPath, [cli, ...args], {encoding:'utf8'});
  process.stdout.write(result.stdout); if (result.stderr) process.stderr.write(result.stderr);
  console.log(`exit=${result.status}`);
  if (result.status !== expected) throw Error(`Expected exit ${expected}, received ${result.status}`);
  return JSON.parse(result.stdout);
};
console.log('ACADEMIC EVIDENCE STUDIO — OFFLINE WORKSPACE TOOL DEMONSTRATION');
console.log('All source text and reviewer labels in this demonstration are synthetic. No inference or organizer submission occurs.');
let workspace = createWorkspace({title:'Synthetic observational study review', sources:[
  {id:'results',title:'Fictional results note',body:'🧪 Fictional data for a software demonstration.\r\nAcross three sites, the reported average response time fell by 12 percent.'},
  {id:'methods',title:'Fictional limitations note',body:'Response time was observed for eight weeks. No control group was used, so the reported change does not establish a causal effect.'}
],claims:[
  {id:'observed-change',text:'The reported average response time fell by 12 percent.'},
  {id:'causal-change',text:'The reported change establishes a causal effect on response time.'}
]});
const observed = workspace.claims[0].evidence.find(e => e.source_id === 'results');
workspace = applyReview(workspace,'observed-change',{decision:'supported',reviewer:'Synthetic reviewer',note:'The supplied fictional result explicitly reports the observed change; this decision has no real-world scientific claim.',evidence_ids:[observed.id]});
const causal = workspace.claims[1].evidence.find(e => e.source_id === 'methods' && workspace.sources[1].body.slice(e.start,e.end).includes('No control group'));
if (!causal) throw Error('Demonstration must include the exact limitations excerpt');
workspace = applyReview(workspace,'causal-change',{decision:'insufficient',reviewer:'Synthetic reviewer',note:'The fictional methods excerpt states that the observed change does not establish causality. No causal conclusion is approved.',evidence_ids:[causal.id]});
const input = join(directory,'synthetic-workspace.json');
await writeFile(input,JSON.stringify(workspace,null,2)+'\n',{flag:'wx',mode:0o600});
console.log('\n1. Created two claims; recorded two explicitly synthetic reviewer decisions.');
const inspection = run(['inspect',input]);
console.log('\n2. Export the native Markdown report and only the selected citation rows.');
const exports = run(['export',input,'--report',join(directory,'synthetic-report.md'),'--citations',join(directory,'selected-citations.jsonl')]);
console.log('\nSelected citation ledger:');
const citations = (await readFile(join(directory,'selected-citations.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
for (const row of citations) console.log(`${row.claim_id}: ${row.decision}; ${row.source_id} [${row.start}, ${row.end}) UTF-16; ${JSON.stringify(row.quote)}`);
console.log('\n3. Change a stored citation offset, without touching the source corpus.');
const damaged = structuredClone(workspace); damaged.claims[0].evidence[0].start++;
const damagedFile = join(directory,'damaged-workspace.json');
await writeFile(damagedFile,JSON.stringify(damaged,null,2)+'\n',{flag:'wx',mode:0o600});
const rejected = run(['inspect',damagedFile],2);
const receipt = {schema:'academic-workspace-tools-demo/v1',input:'SYNTHETIC',node:process.version,inspection,artifacts:exports.artifacts,damaged_archive_rejected:rejected.code,model_calls:0,network_calls:0,browser_validation:'NOT_EXECUTED_IN_THIS_OFFLINE_DEMO',organizer_submission:false};
await writeFile(join(directory,'demo-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
console.log('\nPASS: real offline native-format inspect, export and rejection demonstration completed.');
