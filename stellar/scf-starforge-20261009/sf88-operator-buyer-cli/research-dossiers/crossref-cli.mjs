#!/usr/bin/env node
// MIT. Enrich an existing original dossier and retain complete Crossref editions.
import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDossierStore} from './dossier.mjs';
import {receiveCrossrefEdition,receiveCrossrefBuyerResult,enrichCrossrefDossier,compareCrossrefMetadata,validateCrossrefEdition} from './crossref.mjs';
import {readBytes,parseJson,writeBytes,jsonBytes,need} from '../node/store.mjs';
import {createCrossrefSource} from '../../sf30-seller-sdk/crossref/source.mjs';
import {readCrossrefConfig} from '../../sf30-seller-sdk/crossref/config.mjs';
import {crossrefSourceOptions} from '../../sf30-seller-sdk/crossref/merchant.mjs';

const usage='Crossref in the original research dossier\n\n'+
  '  import --store DIR --id ID --question ID --revision N --file CAPTURE_PACK_JSON [--label TEXT]\n'+
  '  import-buyer --store DIR --id ID --question ID --revision N --buyer-state DIR --runtime DIR --intent ID [--label TEXT]\n'+
  '  enrich --store DIR --id ID --question ID --revision N --config CROSSREF_CONFIG --state SOURCE_DIR [--all-sources] [--metadata-only] [--label TEXT]\n'+
  '  compare --store DIR --id ID --before N --after N [--out JSON]\n';
export async function main(args=process.argv.slice(2)){
  const command=args[0];if(!command||['help','--help','-h'].includes(command)){process.stdout.write(usage);return;}
  const keys=['store','id','question','revision','file','label','buyer-state','runtime','intent','config','state','before','after','out','max-update-pages'];
  const {values}=parseArgs({args:args.slice(1),strict:true,options:{
    ...Object.fromEntries(keys.map(key=>[key,{type:'string'}])),'all-sources':{type:'boolean'},'metadata-only':{type:'boolean'}}});
  need(values.store&&values.id,'DOSSIER_STORE_AND_ID_REQUIRED');
  const store=await openDossierStore(resolve(values.store));
  const revision=Number(values.revision),common={questionId:values.question,expectedRevision:revision,...(values.label?{label:values.label}:{})};
  let result;
  if(command==='compare'){
    const before=await store.get(values.id,{revision:Number(values.before)}),after=await store.get(values.id,{revision:Number(values.after)});
    result=compareCrossrefMetadata(before,after);
  }else{
    need(values.revision!==undefined&&Number.isSafeInteger(revision)&&revision>=0&&values.question,'DOSSIER_QUESTION_AND_REVISION_REQUIRED');
    if(command==='import'){
      need(values.file,'CROSSREF_CAPTURE_PACK_REQUIRED');
      const input=parseJson(await readBytes(resolve(values.file),64*1024*1024));
      if(input.schema==='sf88-research-results-v1'){
        validateCrossrefEdition(input);
        result=await store.receive(values.id,{...common,provider:'crossref',label:values.label??input.label,
          rawBytes:await readBytes(resolve(values.file),64*1024*1024)});
      }else{
        need(input.schema==='stellar-forge.crossref-capture-pack.v1'&&Array.isArray(input.captures),'CROSSREF_CAPTURE_PACK_REQUIRED');
        result=await receiveCrossrefEdition(store,values.id,{...common,captures:input.captures,dois:input.dois,
          sourceReference:input.sourceReference??''});
      }
    }else if(command==='import-buyer'){
      need(values['buyer-state']&&values.runtime&&values.intent,'ORIGINAL_BUYER_INPUT_REQUIRED');
      const {Buyer}=await import('../node/client.mjs');
      const buyer=new Buyer({stateDirectory:resolve(values['buyer-state']),runtimeDirectory:resolve(values.runtime)});
      const saved=await buyer.operation(values.intent).recover();need(saved,'ORIGINAL_RESULT_NOT_RECORDED');
      result=await receiveCrossrefBuyerResult(store,values.id,{...common,result:saved,intentId:values.intent});
    }else{
      need(command==='enrich'&&values.config&&values.state,'CROSSREF_ENRICH_INPUT_REQUIRED');
      const compiled=await readCrossrefConfig(values.config);
      const source=await createCrossrefSource(crossrefSourceOptions(compiled,{sourceDirectory:resolve(values.state)}));
      const controller=new AbortController(),cancel=()=>controller.abort();
      process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
      try{
        result=await enrichCrossrefDossier(store,values.id,{...common,source,selectedOnly:!values['all-sources'],
          includeUpdates:!values['metadata-only'],signal:controller.signal,
          maxUpdatePages:values['max-update-pages']===undefined?1000:Number(values['max-update-pages'])});
      }finally{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);await source.close();}
    }
  }
  if(values.out)await writeBytes(resolve(values.out),jsonBytes(result),{exclusive:true});
  const {dossier,...summary}=result;
  process.stdout.write(JSON.stringify(dossier?summary:{dossierId:result.id??values.id,revision:result.revision,...(command==='compare'?result:{})},null,2)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'CROSSREF_DOSSIER_COMMAND_FAILED'})+'\n');process.exitCode=1;});
}
