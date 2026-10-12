#!/usr/bin/env node
// MIT. Complete original extraction operation from retained request files.
import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ResearchWorkspaceClient} from './workspace-client.mjs';
import {readResearchHostFile} from './workspace-files.mjs';
import {need,parseJson,safeCode} from '../node/store.mjs';
const commands={
  'extraction-view':['id','revision','section','form','result-set','offset','limit'],
  'extraction-source-values':['id','revision','input'],
  'extraction-review':['id','input'],
  'extraction-export':['id','revision','form','result-set','format','out','sha256'],
  'extraction-publications':['id','revision','section','table','publication','offset','limit','current-only','from-publication','to-publication','against-publication','change-type'],
  'extraction-publication-review':['id','input'],
  'extraction-publication-export':['id','revision','table','publication','against-publication','from-publication','to-publication','change-type','current-only','format','out','sha256'],
};
const aliases={
  'extraction-create-form':'create-form','extraction-revise-form':'revise-form','extraction-create-set':'create-result-set',
  'extraction-save':'save-extraction','extraction-submit':'submit-extraction','extraction-resolve':'resolve-result',
  'extraction-impact':'review-impact','extraction-create-table':'create-table','extraction-revise-table':'revise-table',
  'extraction-publish':'publish-table','extraction-publication-impact':'review-impact','extraction-withdraw':'withdraw-publication',
};
export const STUDY_EXTRACTION_COMMANDS=Object.freeze(['extraction-help',...Object.keys(commands),...Object.keys(aliases)]);
const publicationAliases=new Set(['extraction-create-table','extraction-revise-table','extraction-publish',
  'extraction-publication-impact','extraction-withdraw']);
const usage="Study extraction in the original Research workspace\n\n  research-client extraction-COMMAND --connection-file /private/research.json --directory /original/dossier-store [OPTIONS]\n\nRead full revision-pinned sections:\n  extraction-view --id DOSSIER [--revision N --section overview|forms|formEditions|resultSets|extractions|submissions|results|resolutions|impact|operations|occurrences|studies --form ID --result-set ID --offset N --limit N]\n  extraction-source-values --id DOSSIER --input SOURCE_SELECTION.json [--revision N]\n  extraction-publications --id DOSSIER [--revision N --section overview|tables|table-editions|results|publications|rows|impact|reviews|withdrawals|operations|comparison --table ID --publication ID --offset N --limit N --current-only true|false --from-publication ID --to-publication ID --against-publication ID --change-type all|added|removed|changed|unchanged]\n\nSOURCE_SELECTION.json keeps {occurrenceId,pointers:[...],fileName?}. The original source reader returns\ntyped values and present-versus-absent information bound to the retained occurrence and exact file.\nAn offset after page zero requires the original returned revision.\n\nCommit a complete saved operator request:\n  extraction-review --id DOSSIER --input ORIGINAL_REQUEST.json\n  extraction-publication-review --id DOSSIER --input ORIGINAL_REQUEST.json\n\nRequests contain exactly {requestId,expectedRevision,actor:{id,name},action,data}.\nUse the same unchanged file and requestId after a lost response. Read the original operations section\nto inspect the committed result. A stale request which was not committed must be reviewed against\nthe current source before authoring a new request; never rewrite an already submitted file.\n\nAction-specific aliases use that same complete request and check its action:\n  extraction-create-form, extraction-revise-form, extraction-create-set\n  extraction-save, extraction-submit, extraction-resolve, extraction-impact\n  extraction-create-table, extraction-revise-table, extraction-publish\n  extraction-publication-impact, extraction-withdraw\n\nDownload a complete report or selected frozen publication:\n  extraction-export --id DOSSIER --out NEW_FILE [--revision N --form ID --result-set ID --format json|md|html --sha256 SHA256]\n  extraction-publication-export --id DOSSIER --out NEW_FILE [--revision N --table ID --publication ID --against-publication ID --format json|csv|md|html --sha256 SHA256]\n\nExports preserve complete rows and source/review history; page size does not shorten the export.\nThe original file writer preserves existing destinations and returns actual bytes/hash.\nUse the existing export and reopen commands for the whole editable dossier JSON/gzip history.\nClosing this attachment leaves the original application, store and acquisitions running.\n";
export async function main(argv=process.argv.slice(2),{output=process.stdout}={}){
  const [command,...args]=argv;
  if(!command||command==='extraction-help'||['help','--help','-h'].includes(command)){output.write(usage);return;}
  need(STUDY_EXTRACTION_COMMANDS.includes(command),'COMMAND_UNKNOWN');
  const fields=['connection-file','directory','timeout-ms',...(commands[command]??['id','input'])];
  const {values,tokens}=parseArgs({args,options:Object.fromEntries(fields.map(name=>[name,{type:'string'}])),strict:true,tokens:true});
  const seen=new Set();
  for(const token of tokens)if(token.kind==='option'){need(!seen.has(token.name),'ARGUMENT_REPEATED');seen.add(token.name);}
  const required=name=>{need(typeof values[name]==='string'&&values[name].length>0,'ARGUMENT_REQUIRED');return values[name];};
  const number=name=>{
    if(values[name]===undefined)return undefined;
    need(/^(0|[1-9][0-9]{0,8})$/.test(values[name]),'INTEGER_ARGUMENT_REQUIRED');return Number(values[name]);
  };
  const options={
    revision:number('revision'),offset:number('offset'),limit:number('limit'),section:values.section,
    formId:values.form,resultSetId:values['result-set'],tableId:values.table,publicationId:values.publication,
    againstPublicationId:values['against-publication'],fromPublicationId:values['from-publication'],
    toPublicationId:values['to-publication'],changeType:values['change-type'],
    currentOnly:values['current-only']===undefined?undefined:(need(['true','false'].includes(values['current-only']),'BOOLEAN_ARGUMENT_REQUIRED'),values['current-only']==='true'),
    format:values.format,expectedSha256:values.sha256,
  };
  const identifier=required('id');
  const client=new ResearchWorkspaceClient({
    connectionFile:resolve(required('connection-file')),directory:resolve(required('directory')),
  },values['timeout-ms']===undefined?{}:{timeoutMs:number('timeout-ms')});
  const input=async()=>parseJson(await readResearchHostFile(resolve(required('input')),16*1024*1024));
  let result;
  try{
    await client.status();
    if(command==='extraction-view')result=await client.extraction(identifier,options);
    else if(command==='extraction-source-values')result=await client.extractionSourceValues(identifier,{...await input(),revision:options.revision});
    else if(command==='extraction-publications')result=await client.extractionPublications(identifier,options);
    else if(command==='extraction-export')result=await client.exportExtraction(identifier,{...options,file:resolve(required('out'))});
    else if(command==='extraction-publication-export')result=await client.exportExtractionPublication(identifier,{...options,file:resolve(required('out'))});
    else{
      const request=await input();
      if(aliases[command])need(request.action===aliases[command],'EXTRACTION_REQUEST_ACTION_CHANGED');
      result=await (command==='extraction-publication-review'||publicationAliases.has(command)?
        client.reviewExtractionPublication(identifier,request):client.reviewExtraction(identifier,request));
    }
    output.write(JSON.stringify(result)+'\n');return result;
  }finally{await client.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{process.stderr.write(JSON.stringify({error:safeCode(error.code,'EXTRACTION_COMMAND_FAILED'),
    outcomeUnknown:error.outcomeUnknown??false,recovery:error.recovery??null})+'\n');process.exitCode=1;});
