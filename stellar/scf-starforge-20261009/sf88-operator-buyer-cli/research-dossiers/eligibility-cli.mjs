#!/usr/bin/env node
// MIT. Full eligibility workflow through the original Research client and connection.
import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ResearchWorkspaceClient} from './workspace-client.mjs';
import {readResearchHostFile} from './workspace-files.mjs';
import {need,object,parseJson,safeCode} from '../node/store.mjs';

const mutations=Object.freeze({
  'eligibility-create':'create-review','eligibility-protocol':'revise-protocol',
  'eligibility-workset':'create-workset','eligibility-decide':'decide',
  'eligibility-resolve':'resolve','eligibility-study':'study-link',
  'eligibility-apply':'apply-outcomes','eligibility-impact':'review-impact',
});
export const ELIGIBILITY_COMMANDS=Object.freeze(['eligibility-help','eligibility-view','eligibility-queue',
  'eligibility-review','eligibility-export',...Object.keys(mutations)]);
const usage=String.raw`Research eligibility review

Use the original local workspace and its private connection file:
  research-client eligibility-view --connection-file FILE --directory STORE --id DOSSIER
    [--review REVIEW --workset WORKSET --section overview|reviews|occurrences|occurrences|queue|decisions|resolutions|studies|impact|operations]
    [--revision N --offset N --limit N]
  research-client eligibility-queue --connection-file FILE --directory STORE --id DOSSIER
    --review REVIEW --workset WORKSET [--revision N --offset N --limit N]

Apply a complete, retained original request:
  research-client eligibility-review --connection-file FILE --directory STORE --id DOSSIER --input REQUEST.json
  research-client eligibility-create|eligibility-protocol|eligibility-workset|eligibility-decide
    --connection-file FILE --directory STORE --id DOSSIER --input REQUEST.json
  research-client eligibility-resolve|eligibility-study|eligibility-apply|eligibility-impact
    --connection-file FILE --directory STORE --id DOSSIER --input REQUEST.json

Each request retains requestId, expectedRevision, actor:{id,name}, action,
reviewId when selected, and the complete data object. The named command checks
the action already present in the file. After an unknown response, submit the
same file unchanged; the original dossier operation recovers its saved result.
A concurrent-edit conflict requires an explicit reviewed new request.

Read complete original exports:
  research-client eligibility-export --connection-file FILE --directory STORE --id DOSSIER
    --review REVIEW [--workset WORKSET --revision N] --format json|csv --out NEW_FILE
    [--section occurrences|queue|decisions|resolutions|studies|impact|operations --sha256 SHA256]

JSON preserves the complete review report. CSV selects one full table, without
page truncation. HTML/Markdown and full editable JSON/gzip receiving use the
existing export/reopen commands and retain the original dossier sources/history.
Pages after offset zero must include the exact revision returned by page zero.
Reviewer labels describe the current local operating workflow; the connection
uses the existing authenticated Research listener.
`;
const compact=value=>Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined));
export async function main(argv=process.argv.slice(2),{output=process.stdout}={}){
  const [command,...args]=argv;
  if(!command||['eligibility-help','help','--help','-h'].includes(command)){output.write(usage);return;}
  need(ELIGIBILITY_COMMANDS.includes(command),'COMMAND_UNKNOWN');
  const write=command==='eligibility-review'||Object.hasOwn(mutations,command);
  const fields=['connection-file','directory','timeout-ms','id',...(write?['input']:
    ['review','workset','revision',...(command==='eligibility-export'?['format','section','out','sha256']:
      ['section','offset','limit'])])];
  const {values,tokens}=parseArgs({args,options:Object.fromEntries(fields.map(k=>[k,{type:'string'}])),strict:true,tokens:true});
  const seen=new Set();
  for(const token of tokens)if(token.kind==='option'){need(!seen.has(token.name),'ARGUMENT_REPEATED');seen.add(token.name);}
  const required=k=>{need(typeof values[k]==='string'&&values[k].length>0,'ARGUMENT_REQUIRED');return values[k];};
  const number=k=>{
    if(values[k]===undefined)return undefined;
    need(/^(0|[1-9][0-9]{0,8})$/.test(values[k]),'INTEGER_ARGUMENT_REQUIRED');
    return Number(values[k]);
  };
  const client=new ResearchWorkspaceClient({
    connectionFile:resolve(required('connection-file')),directory:resolve(required('directory')),
  },values['timeout-ms']===undefined?{}:{timeoutMs:number('timeout-ms')});
  try{
    const status=await client.status();need(status.api?.eligibilityReview===true,'ELIGIBILITY_WORKSPACE_REQUIRED');
    const id=required('id');let result;
    if(write){
      const input=parseJson(await readResearchHostFile(resolve(required('input')),16*1024*1024));
      need(object(input),'JSON_OBJECT_REQUIRED');
      if(Object.hasOwn(mutations,command))need(input.action===mutations[command],'ELIGIBILITY_COMMAND_ACTION_MISMATCH');
      result=await client.reviewEligibility(id,input);
    }else if(command==='eligibility-export'){
      if(values.sha256!==undefined)need(/^[a-f0-9]{64}$/.test(values.sha256),'RESEARCH_SHA256_REQUIRED');
      result=await client.exportEligibility(id,{reviewId:required('review'),file:resolve(required('out')),
        ...compact({workSetId:values.workset,revision:number('revision'),format:values.format??'json',
          section:values.section??'queue',expectedSha256:values.sha256})});
    }else{
      result=await client.eligibility(id,compact({reviewId:values.review,workSetId:values.workset,
        revision:number('revision'),section:command==='eligibility-queue'?'queue':values.section??'overview',
        offset:number('offset'),limit:number('limit')}));
    }
    output.write(JSON.stringify(result,null,2)+'\n');return result;
  }finally{await client.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{
    process.stderr.write(JSON.stringify({error:safeCode(error.code,'ELIGIBILITY_COMMAND_FAILED'),
      ...(Number.isInteger(error.status)?{status:error.status}:{}),
      ...(error.destinationPublished?{destinationPublished:true,file:error.file}:{}),
      ...(error.outcomeUnknown?{outcomeUnknown:true,recovery:error.recovery}:{}),
    })+'\n');process.exitCode=1;
  });
}
