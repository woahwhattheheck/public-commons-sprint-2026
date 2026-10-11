// MIT. OGC source intake composed with original SF30 dataset and seller commands.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { capture, discover, selectCollection, recordedSource, fault } from './source.mjs';
import { inspectCapture, exportDataset, reopenExport } from './project.mjs';
import { writeReview } from './review.mjs';
import { createFile, bytes } from '../postgres/publisher/files.mjs';
const USAGE = `Starforge OGC API Features → existing dataset merchant (Node 22.16+, Linux flock)
  ogc discover --url https://provider.example/ --out discovery.json
  ogc select --discovery discovery.json --collection ID --out source.json
       [--bbox WEST,SOUTH,EAST,NORTH --datetime START/END --limit 1000]
  ogc capture --state /private/capture --config source.json [--recordings responses.json]
  ogc capture --state /private/capture
  ogc inspect --state /private/capture
  ogc review --state /private/capture --out /private/review.html
  ogc export --state /private/capture --plan reviewed-plan.json --out /private/edition
       [--payment public-terms.json --origin https://merchant.example --path /data]
  ogc reopen --out /private/edition

Use the source entry with: node ogc/cli.mjs COMMAND ...
Repeat capture to continue the last committed next link. Ctrl+C preserves accepted
pages. Open review.html locally, save a plan, then export all selected rows.
Open the output with ORIGINAL dataset-workspace.mjs --dataset EDITION/dataset.json.
Complete original source pages travel with the portable edition. See ogc/README.md.`;
async function json(path) {
  const data = await readFile(path); if (data.length > 1024*1024) throw fault('OGC_INPUT_TOO_LARGE');
  return JSON.parse(new TextDecoder('utf-8', { fatal:true }).decode(data));
}
export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes('--help')) { console.log(USAGE); return; }
  const command = args.shift(), allowed = {
    discover:['url','out','authorization-env'], select:['discovery','collection','name','bbox','datetime','limit','authorization-env','out'], capture:['state','config','recordings'], inspect:['state'], review:['state','out'],
    export:['state','plan','out','payment','origin','path'], reopen:['out'] }[command];
  if (!allowed) throw fault('OGC_COMMAND_INVALID', USAGE);
  const options = {};
  for (let i=0;i<args.length;i+=2) {
    const name = args[i].slice(2);
    if (!args[i].startsWith('--') || !allowed.includes(name) || Object.hasOwn(options,name) || !args[i+1] || args[i+1].startsWith('--')) throw fault('OGC_OPTION_INVALID', args[i]);
    options[name] = args[i+1];
  }
  const required = {discover:['url','out'],select:['discovery','collection','out'],capture:['state'],inspect:['state'],review:['state','out'],export:['state','plan','out'],reopen:['out']}[command];
  for (const key of required) if (!options[key]) throw fault('OGC_OPTION_REQUIRED', '--'+key);
  if (options.state) options.state = resolve(options.state); if (options.out) options.out = resolve(options.out);
  let result;
  if (command === 'discover') {
    result = await discover(options.url, options['authorization-env'] ? {authorizationEnv:options['authorization-env']} : {});
    await createFile(options.out, bytes(result)); result = {created:options.out,collections:result.collections};
  } else if (command === 'select') {
    result = selectCollection(await json(options.discovery), {collection:options.collection,name:options.name,bbox:options.bbox,datetime:options.datetime,limit:options.limit,authorizationEnv:options['authorization-env']});
    await createFile(options.out,bytes(result)); result={created:options.out,source:result};
  } else if (command === 'capture') {
    const controller = new AbortController(), cancel = () => controller.abort();
    process.once('SIGINT',cancel); process.once('SIGTERM',cancel);
    try { result = await capture(options.state, options.config ? await json(options.config) : undefined, {
      signal:controller.signal, recordSource:options.recordings ? await recordedSource(resolve(options.recordings)) : undefined,
      onPage:p => process.stderr.write(JSON.stringify({pages:p.pages,rows:p.rows,complete:p.next===null})+'\n') });
      result = {sourceId:result.sourceId,rows:result.rows,pages:result.pages.length,complete:result.complete,state:options.state};
    } finally {process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}
  } else if (command === 'inspect') result = await inspectCapture(options.state);
  else if (command === 'review') result = await writeReview(options.state,options.out);
  else if (command === 'reopen') result = await reopenExport(options.out);
  else result = await exportDataset(options.state,options.out,await json(options.plan),{
    payment:options.payment ? await json(options.payment):undefined, origin:options.origin,path:options.path});
  console.log(JSON.stringify(result,null,2)); return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => {console.error('OGC: '+(error.code ?? error.name)+' — '+error.message);if(error.retryAfter)console.error('Retry-After: '+error.retryAfter);process.exitCode=1;});
