#!/usr/bin/env node
// MIT. Complete appraisal operations through the original Research listener.
import {parseArgs} from 'node:util';
import {resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {ResearchWorkspaceClient} from '../workspace-client.mjs';
import {readResearchHostFile} from '../workspace-files.mjs';
import {writePortableFile} from '../portable.mjs';
import {need,object,parseJson,safeCode} from '../../node/store.mjs';
import {RISK_OF_BIAS_ACTIONS,RISK_OF_BIAS_SECTIONS,riskOfBiasInput,riskOfBiasDigest} from './contracts.mjs';
import {createRiskOfBiasClient} from './client.mjs';

export const RISK_OF_BIAS_REQUEST_FILE='sf88.research-risk-of-bias.request.v1';
const REQUEST_LIMIT=16*1024*1024;
const mutations=Object.freeze({
  'risk-create':'create-review','risk-protocol':'revise-protocol',
  'risk-assessment':'create-assessment','risk-revise-assessment':'revise-assessment',
  'risk-draft':'save-draft','risk-submit':'submit-review',
  'risk-adjudicate':'adjudicate','risk-impact':'review-impact',
});
export const RISK_OF_BIAS_COMMANDS=Object.freeze([
  'risk-help','risk-view','risk-prepare','risk-review','risk-export',...Object.keys(mutations),
]);
const usage=[
  'Research risk-of-bias appraisal',
  '',
  'Use the existing private Research connection and original dossier store:',
  '  research-client risk-view --connection-file FILE --directory STORE --id DOSSIER',
  '    [--review REVIEW --assessment ASSESSMENT --assessment-edition EDITION --actor REVIEWER]',
  '    [--revision N --section SECTION --offset N --limit N]',
  '',
  'Sections:',
  '  overview reviews protocols studies results assessments drafts submissions',
  '  comparisons adjudications impact operations sources',
  '',
  'Retain one complete original request before a mutation:',
  '  research-client risk-prepare --connection-file FILE --directory STORE --id DOSSIER',
  '    --action ACTION --data DATA.json --actor REVIEWER --actor-name NAME --out NEW_REQUEST.json',
  '    [--review REVIEW --revision N --request-id ORIGINAL_UUID --sha256 DATA_SHA256]',
  '',
  'This writes a create-only file with the actual workspace/dossier identity,',
  'one request ID, the reviewed revision, complete action data and exact digest.',
  'If --revision is omitted, the original current metadata is read once.',
  'Preparation leaves that file ready for an explicit operation:',
  '  research-client risk-review --connection-file FILE --directory STORE --id DOSSIER',
  '    --input ORIGINAL_REQUEST.json [--sha256 REQUEST_FILE_SHA256]',
  '',
  'Named commands check the action already retained inside the same input file:',
  '  risk-create             create-review',
  '  risk-protocol           revise-protocol',
  '  risk-assessment         create-assessment',
  '  risk-revise-assessment  revise-assessment',
  '  risk-draft              save-draft',
  '  risk-submit             submit-review',
  '  risk-adjudicate         adjudicate',
  '  risk-impact             review-impact',
  '',
  'A complete raw original request is also accepted. It has requestId,',
  'expectedRevision, actor:{id,name}, action, optional reviewId and data.',
  'Retain the entire file unchanged when a reply is interrupted; the original',
  'dossier replays the saved result before checking a later current revision.',
  'A changed request body needs an explicitly reviewed new request ID.',
  '',
  'Export the complete selected appraisal and its source/review history:',
  '  research-client risk-export --connection-file FILE --directory STORE --id DOSSIER',
  '    --format json|csv|md|html --out NEW_FILE',
  '    [--review REVIEW --assessment ASSESSMENT --assessment-edition EDITION]',
  '    [--actor REVIEWER --revision N --section SECTION --sha256 EXPORT_SHA256]',
  '',
  'CSV includes the complete selected table. JSON, Markdown and HTML retain',
  'the selected report; pages after offset zero require their original revision.',
  'The existing full dossier export/reopen retains editable appraisals, every',
  'source occurrence and original operations in the same portable workspace.',
  'Actor labels record attribution inside the existing authenticated listener.',
  '',
].join('\n');
const compact=value=>Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined));

export function unwrapRiskOfBiasRequest(value,{workspaceId,dossierId,action}={}){
  need(object(value),'JSON_OBJECT_REQUIRED');
  let request=value;
  if(value.schema===RISK_OF_BIAS_REQUEST_FILE){
    need(value.workspaceId===workspaceId&&value.dossierId===dossierId,
      'RISK_OF_BIAS_REQUEST_TARGET_CHANGED');
    request=riskOfBiasInput(value.request);
    need(value.requestSha256===riskOfBiasDigest(request),'RISK_OF_BIAS_REQUEST_CHANGED');
  }else{
    need(value.schema===undefined,'RISK_OF_BIAS_REQUEST_SCHEMA_INVALID');
    request=riskOfBiasInput(value);
  }
  need(action===undefined||request.action===action,'RISK_OF_BIAS_COMMAND_ACTION_MISMATCH');
  return request;
}

/** Save the exact original operation before a later submit/recovery call. */
export async function prepareRiskOfBiasRequestFile(client,dossierId,{
  file,action,data,actor,reviewId,expectedRevision,requestId,
}={}){
  need(typeof file==='string'&&object(data)&&RISK_OF_BIAS_ACTIONS.includes(action),
    'RISK_OF_BIAS_REQUEST_INVALID');
  const status=await client.status();
  need(status.api?.riskOfBiasReview===true,'RISK_OF_BIAS_WORKSPACE_REQUIRED');
  const selected=await client.metadata(dossierId,compact({revision:expectedRevision}));
  need(selected.id===dossierId&&Number.isSafeInteger(selected.revision)&&selected.revision>=1&&
    (expectedRevision===undefined||selected.revision===expectedRevision),'RISK_OF_BIAS_DOSSIER_CHANGED');
  const request=riskOfBiasInput(compact({
    requestId:requestId??randomUUID(),expectedRevision:selected.revision,actor,action,reviewId,data,
  }));
  const requestSha256=riskOfBiasDigest(request);
  const envelope={schema:RISK_OF_BIAS_REQUEST_FILE,workspaceId:status.workspaceId,dossierId,
    requestSha256,request};
  const bytes=Buffer.from(JSON.stringify(envelope,null,2)+'\n');
  need(bytes.length<=REQUEST_LIMIT,'RISK_OF_BIAS_REQUEST_TOO_LARGE');
  const saved=await writePortableFile(resolve(file),{
    body:Readable.from([bytes]),filename:basename(file),contentType:'application/json',
  });
  return {workspaceId:status.workspaceId,dossierId,requestId:request.requestId,
    expectedRevision:request.expectedRevision,action:request.action,requestSha256,file:saved};
}
export async function main(argv=process.argv.slice(2),{output=process.stdout}={}){
  const [command,...args]=argv;
  if(!command||['risk-help','help','--help','-h'].includes(command)){output.write(usage);return;}
  need(RISK_OF_BIAS_COMMANDS.includes(command),'COMMAND_UNKNOWN');
  const write=command==='risk-review'||Object.hasOwn(mutations,command);
  const preparing=command==='risk-prepare',exporting=command==='risk-export';
  const fields=['connection-file','directory','timeout-ms','id',
    ...(preparing?['action','data','actor','actor-name','out','review','revision','request-id','sha256']:
      write?['input','sha256']:
      ['review','assessment','assessment-edition','actor','revision','section',
        ...(exporting?['format','out','sha256']:['offset','limit'])])];
  const {values,tokens}=parseArgs({
    args,options:Object.fromEntries(fields.map(key=>[key,{type:'string'}])),strict:true,tokens:true,
  });
  const seen=new Set();
  for(const token of tokens)if(token.kind==='option'){
    need(!seen.has(token.name),'ARGUMENT_REPEATED');seen.add(token.name);
  }
  const required=key=>{
    need(typeof values[key]==='string'&&values[key].length>0,'ARGUMENT_REQUIRED');return values[key];
  };
  const number=(key,{minimum=0,maximum=99999999}={})=>{
    if(values[key]===undefined)return undefined;
    need(/^(0|[1-9][0-9]{0,8})$/.test(values[key]),'INTEGER_ARGUMENT_REQUIRED');
    const value=Number(values[key]);
    need(Number.isSafeInteger(value)&&value>=minimum&&value<=maximum,'INTEGER_ARGUMENT_REQUIRED');
    return value;
  };
  const sha256=values.sha256;
  need(sha256===undefined||/^[a-f0-9]{64}$/.test(sha256),'RESEARCH_SHA256_REQUIRED');
  const revision=number('revision',{minimum:1});
  const timeoutMs=number('timeout-ms',{minimum:1000,maximum:900000});
  const id=required('id');
  const client=new ResearchWorkspaceClient({
    connectionFile:resolve(required('connection-file')),directory:resolve(required('directory')),
  },compact({timeoutMs}));
  try{
    const risk=createRiskOfBiasClient(client);
    let result;
    if(preparing){
      const data=parseJson(await readResearchHostFile(resolve(required('data')),REQUEST_LIMIT,{sha256}));
      result=await prepareRiskOfBiasRequestFile(client,id,compact({
        file:required('out'),action:required('action'),data,
        actor:{id:required('actor'),name:required('actor-name')},reviewId:values.review,
        expectedRevision:revision,requestId:values['request-id'],
      }));
    }else{
      const status=await client.status();
      need(status.api?.riskOfBiasReview===true,'RISK_OF_BIAS_WORKSPACE_REQUIRED');
      if(write){
        const original=parseJson(await readResearchHostFile(resolve(required('input')),REQUEST_LIMIT,{sha256}));
        const request=unwrapRiskOfBiasRequest(original,{
          workspaceId:status.workspaceId,dossierId:id,action:mutations[command],
        });
        result=await risk.review(id,request);
      }else{
        const section=values.section??'overview';
        need(RISK_OF_BIAS_SECTIONS.includes(section),'RISK_OF_BIAS_SECTION_INVALID');
        const options=compact({reviewId:values.review,assessmentId:values.assessment,
          assessmentEditionId:values['assessment-edition'],actorId:values.actor,revision,section});
        if(exporting){
          const format=values.format??'json';
          need(['json','csv','md','html'].includes(format),'RISK_OF_BIAS_EXPORT_FORMAT_INVALID');
          result=await risk.export(id,{...options,format,file:resolve(required('out')),
            ...compact({expectedSha256:sha256})});
        }else{
          const offset=number('offset'),limit=number('limit',{minimum:1,maximum:100});
          need(!offset||revision!==undefined,'RESEARCH_PAGE_REVISION_REQUIRED');
          result=await risk.view(id,{...options,...compact({offset,limit})});
        }
      }
    }
    output.write(JSON.stringify(result,null,2)+'\n');return result;
  }finally{await client.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{
    process.stderr.write(JSON.stringify({
      error:safeCode(error.code,'RISK_OF_BIAS_COMMAND_FAILED'),
      ...(Number.isInteger(error.status)?{status:error.status}:{}),
      ...(error.destinationPublished?{destinationPublished:true,file:error.file}:{}),
      ...(error.outcomeUnknown?{outcomeUnknown:true,recovery:error.recovery}:{}),
    })+'\n');process.exitCode=1;
  });
}
