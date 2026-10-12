#!/usr/bin/env node
// MIT. Selected-dossier CLI; uses the original store and operator request IDs.
import fs from 'node:fs/promises';
import {resolve} from 'node:path';
import {openDossierStore} from '../dossier.mjs';
import {hashBytes} from './workbook.mjs';
export async function runTemplateExchangeCli(argv,{openStore=openDossierStore,stdout=process.stdout}={}){
 const [directory,dossierId,action,inputPath]=argv;
 if(!directory||!dossierId||!action)throw Error('Usage: cli.mjs WORKSPACE DOSSIER ACTION [input.json]. Actions: page, publication, record, operation, stage-template, stage-mapping, stage-release, stage-return, stage-return-review, review, prepare-extraction-draft, accept-extraction-draft, download.');
 const input=inputPath?JSON.parse(await fs.readFile(inputPath,'utf8')):{},store=await openStore(resolve(directory)),api=store.templateExchange;
 if(!api)throw Error('This original Research store does not yet include the templateExchange integration.');
 let result;
 if(action==='download'){
  if(typeof input.output!=='string')throw Error('download requires an explicit output path.');
  const value=await api.readBlob(dossierId,input),path=resolve(input.output);
  let old=null;try{old=await fs.readFile(path);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(old&&!old.equals(value.body))throw Error('An existing output differs; it has been preserved.');
  if(!old)await fs.writeFile(path,value.body,{flag:'wx'});
  result={dossierId,revision:value.revision,path,bytes:value.bytes,sha256:hashBytes(value.body)};
 }else if(['stage-template','stage-return'].includes(action)){
  if(typeof input.bodyPath!=='string')throw Error(action+' requires a bodyPath.');
  const {bodyPath,...options}=input,body=await fs.readFile(resolve(bodyPath));
  result=action==='stage-template'?await api.stageWorkbook({...options,body}):await api.stageReturn(dossierId,{...options,body});
 }else{
  const methods={page:'page',publication:'publication',record:'inspectRecord',operation:'operation',
   'stage-mapping':'stageMapping','stage-release':'stageRelease','stage-return-review':'stageReturnReview',review:'review',
   'prepare-extraction-draft':'prepareExtractionDraft','accept-extraction-draft':'acceptExtractionDraft'};
  const method=methods[action];if(!method)throw Error('Unknown template action: '+action);result=await api[method](dossierId,input);
 }
 stdout.write(JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&new URL(import.meta.url).pathname===resolve(process.argv[1]))runTemplateExchangeCli(process.argv.slice(2)).catch(error=>{
 process.stderr.write(JSON.stringify({error:{code:error.code??'TEMPLATE_CLI_FAILED',message:error.message}})+'\n');process.exitCode=1;
});
