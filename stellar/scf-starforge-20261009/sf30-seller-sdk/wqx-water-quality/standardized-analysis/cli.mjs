#!/usr/bin/env node
// MIT. Original WQX scientific review, complete reporting units and two-edition receiving.
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { mkdir, open, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readBytes } from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { openWaterQualityProject } from '../project.mjs';
import { openWatersHash } from '../openwaters.mjs';
import { previewStandardizedReview, saveStandardizedReview, readStandardizedReview, listStandardizedReviews,
  exportStandardizedReview, receiveStandardizedReview, STANDARDIZED_PREVIEW_SCHEMA } from './workflow.mjs';

const HELP=[
  'Stellar Forge / Reporting-unit scientific reviews','',
  'node wqx-water-quality/cli.mjs scientific COMMAND --project DIRECTORY [options]','',
  'preview  Analyze a complete saved decision review: --request request.json --out preview.json.',
  'save     Save the exact original preview: --preview preview.json --out saved.json.',
  'list     List saved scientific reviews and their complete source identities.',
  'read     Reopen --review ID with the original retained source.',
  'export   Download --review ID --format FORMAT --out FILE.',
  'receive  Reproduce both selected source editions from --bundle FILE in a private project.','',
  'Request JSON: reviewId, decisionReviewId, expectedDecisionReviewSha256, title, note, options.',
  'Options: window, baselineWindow, includeEstimated, characteristics, siteIds, allowedQualifiers.',
  'Add previousReviewId and expectedPreviousReviewSha256 to compare a retained scientific edition.',
  'Dates are original source calendar dates. Estimated or qualified results remain separately visible.',
  'FORMAT: json, observations, observations-tsv, groups, changes, report, bundle.',
  'The complete bundle includes current and selected previous source data, receiving choices and exact analyses.',
  'A received previous source is kept in its own private original project alongside the selected report.',
  'Use a new scientific review ID for changed choices. Reopening the same ID preserves its exact operation.',
  'Existing output files are retained; use read/export after an interrupted response.',
  ''
].join('\n');
const options=Object.fromEntries(['project','request','preview','review','format','bundle','out'].map(key=>[key,{type:'string'}]));
const need=(value,name)=>{if(!value[name])throw new Error('Provide --'+name);return value[name];};
async function jsonFile(path,maximum) {
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBytes(resolve(path),maximum)));
}
async function reserve(path) {
  if(!path)return null;
  path=resolve(path);await mkdir(dirname(path),{recursive:true,mode:0o700});
  const file=await open(path,'wx',0o600),identity=await file.stat();
  return {path,file,identity};
}
async function publish(value,reserved) {
  const bytes=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');
  if(!reserved){process.stdout.write(bytes);return;}
  const current=await lstat(reserved.path);
  if(!current.isFile()||current.isSymbolicLink()||current.dev!==reserved.identity.dev||current.ino!==reserved.identity.ino||current.nlink!==1)
    throw new Error('The reserved scientific output changed.');
  await reserved.file.writeFile(bytes);await reserved.file.sync();
  process.stdout.write(JSON.stringify({output:reserved.path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')})+'\n');
}
export async function main(argv=process.argv.slice(2)) {
  const {values,positionals}=parseArgs({args:argv,allowPositionals:true,options:{...options,help:{type:'boolean'}}});
  const command=positionals[0]??'help';
  if(values.help||command==='help'){process.stdout.write(HELP);return;}
  if(positionals.length!==1||!['preview','save','list','read','export','receive'].includes(command))
    throw new Error('Choose one scientific review command. Run scientific help.');
  const directory=resolve(need(values,'project'));
  if(command==='export')need(values,'out');
  const reserved=await reserve(values.out);
  let project;
  try {
    project=await openWaterQualityProject(directory);
    let result;
    if(command==='preview')result=await previewStandardizedReview({...await jsonFile(need(values,'request'),1024*1024),project});
    else if(command==='save') {
      const preview=await jsonFile(need(values,'preview'),128*1024*1024);
      const {previewSha256,...body}=preview;
      if(preview.schema!==STANDARDIZED_PREVIEW_SCHEMA||openWatersHash(body)!==previewSha256)
        throw new Error('Use the complete unchanged scientific preview.');
      result=await saveStandardizedReview({...preview.request,expectedPreviewSha256:previewSha256,project});
    } else if(command==='list')result=await listStandardizedReviews({project});
    else if(command==='read')result=await readStandardizedReview({project,reviewId:need(values,'review')});
    else if(command==='export')result=(await exportStandardizedReview({project,reviewId:need(values,'review'),format:need(values,'format')})).bytes;
    else result=await receiveStandardizedReview({project,bundle:await jsonFile(need(values,'bundle'),128*1024*1024)});
    await publish(result,reserved);
    return result;
  } catch(error) {
    if(reserved) {
      try {if((await reserved.file.stat()).size===0)await publish({error:{code:error.code??'WQX_SCIENTIFIC_FAILED',message:error.message}},reserved);}catch{}
    }
    throw error;
  } finally {try{await project?.close();}finally{await reserved?.file.close();}}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'WQX_SCIENTIFIC_FAILED',message:error.message})+'\n');process.exitCode=1;});
