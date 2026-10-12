#!/usr/bin/env node
// MIT. Original Fiscal comparison → complete offline customer briefing.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPrivate } from '../postgres/publisher/files.mjs';
import { openFiscalWorkspace } from './workspace-model.mjs';
import { createFiscalBriefing, verifyFiscalBriefing } from './briefing.mjs';

const usage = [
  'Fiscal comparison briefing',
  '',
  'starforge fiscaldata-briefing list --dir SOURCE_WORKSPACE',
  'starforge fiscaldata-briefing create --dir SOURCE_WORKSPACE --comparison ID',
  '  --expected-comparison-sha256 SHA256 --source-export ID --out PRIVATE_OUTPUT',
  '  --operation STABLE_ID --title TITLE [--audience TEXT] [--notes-file PRIVATE_UTF8_FILE]',
  '  [--rows-per-page 200]',
  'starforge fiscaldata-briefing verify --report EXTRACTED_REPORT',
  '  [--manifest-sha256 SHA256]',
  '',
  'Source launch: node stellar/scf-starforge-20261009/sf30-seller-sdk/fiscaldata/briefing-cli.mjs COMMAND ...',
  '',
  'Select the existing READY comparison and complete comparison export. Stop its managed Application',
  'before standalone list/create; the original workspace lease protects the same source records.',
  'Reusing the same operation preserves its selection, commentary, complete files and archive.',
  'Open the returned index.html in a browser. It works offline and links every original row page.',
  ''
].join('\n');
const specs = {
  list: {required:['--dir'],optional:[]},
  create: {required:['--dir','--comparison','--expected-comparison-sha256','--source-export',
    '--out','--operation','--title'],optional:['--audience','--notes-file','--rows-per-page']},
  verify: {required:['--report'],optional:['--manifest-sha256']}
};
const emit = value => process.stdout.write(JSON.stringify(value,null,2)+'\n');
export async function main(argv=process.argv.slice(2)) {
  const [command,...rest]=argv;
  if(!command||['help','--help','-h'].includes(command)||rest.includes('--help')||rest.includes('-h')) {
    process.stdout.write(usage);return;
  }
  const spec=specs[command];if(!spec)throw new Error('Choose list, create or verify.');
  const allowed=new Set([...spec.required,...spec.optional]),values={};
  for(let index=0;index<rest.length;index++) {
    const name=rest[index];
    if(!allowed.has(name)||Object.hasOwn(values,name))throw new Error('Unknown or repeated option: '+name);
    const value=rest[++index];
    if(value===undefined||value.startsWith('--'))throw new Error('Missing value for '+name);
    values[name]=value;
  }
  for(const name of spec.required)if(!values[name])throw new Error('Required option: '+name);
  process.umask(0o077);
  if(command==='verify') {
    emit(await verifyFiscalBriefing({directory:resolve(values['--report']),
      expectedManifestSha256:values['--manifest-sha256']}));return;
  }
  if(command==='create') {
    let notes='';
    if(values['--notes-file'])notes=new TextDecoder('utf-8',{fatal:true}).decode(
      await readPrivate(resolve(values['--notes-file']),64000));
    emit(await createFiscalBriefing({
      directory:resolve(values['--dir']),comparisonId:values['--comparison'],
      expectedComparisonSha256:values['--expected-comparison-sha256'],exportId:values['--source-export'],
      outputDirectory:resolve(values['--out']),operationId:values['--operation'],title:values['--title'],
      audience:values['--audience']??'',notes,
      rowsPerPage:values['--rows-per-page']===undefined?undefined:Number(values['--rows-per-page'])
    }));return;
  }
  const model=await openFiscalWorkspace({directory:resolve(values['--dir'])});
  try {
    const state=await model.snapshot();
    emit({schema:'stellar-forge.fiscaldata-briefing-selection.v1',revision:state.revision,
      comparisons:state.comparisons.map(item=>({
        id:item.id,name:item.name,status:item.status,sha256:item.sha256,
        leftEditionId:item.leftEditionId,rightEditionId:item.rightEditionId,summary:item.summary,
        exports:state.exports.filter(saved=>saved.kind==='comparison'&&saved.sourceId===item.id)
          .map(saved=>({id:saved.id,createdAt:saved.createdAt,sha256:saved.sha256,files:saved.files}))
      }))});
  } finally { await model.close(); }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(error=>{
    process.stderr.write((error.code?error.code+': ':'')+error.message+'\n\n'+usage);
    process.exitCode=1;
  });
}
