#!/usr/bin/env node
// MIT. Direct local receiving and complete result reopening using the same laboratory application.
import { readFile, open, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { labProfiles, labProfile } from './profiles.mjs';
import { inspectDelivery, normalizeDecisions, previewDelivery, compareDeliveries, sha256 } from './model.mjs';
import { laboratoryReview, sourceMembers, readLabDecisions } from './application.mjs';
import { reviewTable } from './decisions.mjs';
import { reconcileDeliveries, normalizeReconciliation, previewReconciliation } from './reconciliation.mjs';
import { reconciliationTable } from './reconciliation-table.mjs';
import { readReconciliationDecisions } from './reconciliation-application.mjs';
import { readLabResult } from './result.mjs';
import { openLocalInputs } from './local.mjs';
import { writeLabMerchantConfiguration } from './merchant-configuration.mjs';
const json=value=>JSON.stringify(value,null,2)+'\n';
export const HELP='Laboratory EDD receiving\n\n'+
'lab-edd profiles\n'+
'lab-edd merchant-config --origin HTTPS_ORIGIN --network NETWORK --asset ASSET --pay-to RECIPIENT --amount ATOMIC_AMOUNT --out NEW_JSON [--service-name NAME] [--memory-limit-mb MB]\n'+
'lab-edd inspect --source FILE --profile ID [--encoding utf-8|windows-1252] [--out JSON]\n'+
'lab-edd table --source FILE --profile ID --out CSV_OR_TSV [--decisions FILE] [--format csv|tsv] [--scope issues|all] [--fields FIELD,FIELD]\n'+
'lab-edd preview --source FILE --profile ID [--decisions FILE] [--baseline FILE] --out JSON\n'+
'lab-edd receive --source FILE --profile ID --review NAME [--decisions FILE] [--baseline FILE] --out COMPLETE_ZIP\n'+
'lab-edd reconcile --source CURRENT --profile ID --baseline ORIGINAL --baseline-profile OTHER_ID [--reconciliation FILE] [--decisions FILE] [--baseline-decisions FILE] --out JSON\n'+
'lab-edd reconciliation-table --source CURRENT --profile ID --baseline ORIGINAL --baseline-profile OTHER_ID [--reconciliation FILE] --format csv|tsv --out TABLE\n'+
'lab-edd result --file COMPLETE_ZIP [--out MANIFEST_JSON]\n\n'+
'Cross-profile receive adds --baseline-profile, --baseline-decisions and --reconciliation to the same full receive command.\n'+
'Select the installed source profile. XLSX and XLS are passed to its native decoder; CSV table families arrive in their original ZIP.\n'+
'Receive produces the complete original inputs, native receiving files, editable decisions, field history and offline operator report.\n';
function args(argv){
  if(!argv.length||argv.includes('--help')||argv.includes('-h'))return {command:'help'};
  const [command,...rest]=argv,options={command};
  const allowed=new Set(['source','baseline','decisions','profile','encoding','review','out','format','scope','fields','file','expected-source-sha256','baseline-profile','baseline-encoding','expected-baseline-sha256','baseline-decisions','baseline-decision-format','reconciliation','reconciliation-format','origin','network','asset','pay-to','amount','service-name','memory-limit-mb']);
  if(!['profiles','inspect','table','preview','receive','result','reconcile','reconciliation-table','merchant-config'].includes(command))throw Error('Unknown lab-edd command.');
  for(let i=0;i<rest.length;i+=2){
    const key=rest[i]?.replace(/^--/,'');
    if(!rest[i]?.startsWith('--')||!allowed.has(key)||options[key]!==undefined||rest[i+1]===undefined||rest[i+1].startsWith('--'))
      throw Error('Use each supported option once with an explicit value.');
    options[key]=rest[i+1];
  }
  return options;
}
async function output(path,bytes){
  if(!path){process.stdout.write(bytes);return null;}
  const target=resolve(path);await mkdir(dirname(target),{recursive:true});
  const file=await open(target,'wx',0o600);
  try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
  return {path:target,bytes:Buffer.byteLength(bytes),sha256:sha256(bytes)};
}
export async function main(argv=process.argv.slice(2)){
  const options=args(argv);
  if(options.command==='help'){process.stdout.write(HELP);return {status:'HELP'};}
  if(options.command==='merchant-config'){
    if(!options.out)throw Error('Select --out for the new private merchant configuration.');
    const memory=options['memory-limit-mb'];
    if(memory!==undefined&&!/^[1-9][0-9]*$/.test(memory))throw Error('Use a whole memory-limit-mb value.');
    const saved=await writeLabMerchantConfiguration({file:options.out,publicOrigin:options.origin,
      payment:{scheme:'exact',network:options.network,asset:options.asset,payTo:options['pay-to'],
        amount:options.amount,maxTimeoutSeconds:60},
      ...(options['service-name']?{serviceName:options['service-name']}:{}),
      ...(memory===undefined?{}:{memoryLimitMb:Number(memory)})});
    process.stdout.write(json(saved));return saved;
  }
  if(options.command==='profiles'){
    const profiles=labProfiles.map(({id,version,label,references})=>({id,version,label,references}));
    process.stdout.write(json(profiles));return profiles;
  }
  if(options.command==='result'){
    if(!options.file)throw Error('Supply --file for the retained complete result.');
    const bytes=await readFile(options.file),{manifest}=readLabResult(bytes);
    const report={status:'COMPLETE',file:resolve(options.file),bytes:bytes.length,sha256:sha256(bytes),manifest};
    const saved=await output(options.out,json(report));if(saved)process.stdout.write(json(saved));return report;
  }
  if(!options.source||!options.profile)throw Error('Supply the original --source and selected --profile.');
  const profile=labProfile(options.profile),controller=new AbortController();
  const cancelled=()=>controller.abort(new Error('Laboratory receiving cancelled.'));
  process.once('SIGINT',cancelled);process.once('SIGTERM',cancelled);
  const paths={source:options.source,...(options.baseline?{baseline:options.baseline}:{}),...(options.decisions?{decisions:options.decisions}:{}),
    ...(options['baseline-decisions']?{baseline_decisions:options['baseline-decisions']}:{}),...(options.reconciliation?{reconciliation:options.reconciliation}:{})};
  let held;
  try{
    held=await openLocalInputs(paths,{signal:controller.signal});
    if(options.command==='receive'){
      if(!options.out||!options.review)throw Error('Receive requires a stable --review and a new --out ZIP path.');
      const input={profile:profile.id,reviewName:options.review,...(options.encoding?{encoding:options.encoding}:{}),
        ...(options['expected-source-sha256']?{expectedSourceSha256:options['expected-source-sha256']}:{}),
        ...(options.scope?{tableScope:options.scope}:{}),...(options.fields?{tableFields:options.fields.split(',')}:{}),
        ...(options.format?{decisionFormat:options.format}:{}),
        ...(options['baseline-profile']?{baselineProfile:options['baseline-profile']}:{}),
        ...(options['baseline-encoding']?{baselineEncoding:options['baseline-encoding']}:{}),
        ...(options['expected-baseline-sha256']?{expectedBaselineSha256:options['expected-baseline-sha256']}:{}),
        ...(options['baseline-decision-format']?{baselineDecisionFormat:options['baseline-decision-format']}:{}),
        ...(options['reconciliation-format']?{reconciliationFormat:options['reconciliation-format']}:{})};
      const bytes=await laboratoryReview(input,{files:held.files,signal:controller.signal,jobId:'local-'+options.review});
      const saved=await output(options.out,bytes);process.stdout.write(json({status:'COMPLETE',...saved}));return saved;
    }
    const bytes=await held.files.read('source',{maxBytes:16777216});
    const delivery=await inspectDelivery(sourceMembers(bytes,held.files.metadata('source'),{signal:controller.signal}),profile,
      {encoding:options.encoding??'utf-8',signal:controller.signal});
    if(options['expected-source-sha256']&&options['expected-source-sha256']!==delivery.source.sourceSha256)throw Error('The selected original source changed.');
    const document=options.decisions?readLabDecisions(delivery,await held.files.read('decisions',{maxBytes:4194304}),
      held.files.metadata('decisions'),options.command.endsWith('table')?undefined:options.format):normalizeDecisions(delivery);
    let baseline=null,comparison=null;
    if(options.baseline){
      const bytes=await held.files.read('baseline',{maxBytes:16777216});
      baseline=await inspectDelivery(sourceMembers(bytes,held.files.metadata('baseline'),{signal:controller.signal}),
        labProfile(options['baseline-profile']??options.profile),{encoding:options['baseline-encoding']??options.encoding??'utf-8',signal:controller.signal});
      if(options['expected-baseline-sha256']&&options['expected-baseline-sha256']!==baseline.source.sourceSha256)throw Error('The selected original baseline changed.');
      comparison=baseline.source.profile.id===delivery.source.profile.id?compareDeliveries(delivery,baseline):reconcileDeliveries(delivery,baseline);
    }
    if(['reconcile','reconciliation-table'].includes(options.command)){
      if(!baseline||baseline.source.profile.id===delivery.source.profile.id)throw Error('Select the complete baseline file and its explicit different source profile.');
      const correspondence=options.reconciliation?readReconciliationDecisions(comparison,
        await held.files.read('reconciliation',{maxBytes:16777216}),held.files.metadata('reconciliation'),{format:options['reconciliation-format']}):normalizeReconciliation(comparison);
      if(options.command==='reconciliation-table'){
        if(!options.out)throw Error('Select a complete correspondence table output path.');
        const table=reconciliationTable(comparison,correspondence,{format:options.format??(/\.tsv$/i.test(options.out)?'tsv':'csv')});
        const saved=await output(options.out,table.text);process.stdout.write(json({...saved,comparisonSha256:table.comparisonSha256,groups:table.groups,rows:table.rows}));return saved;
      }
      const baselineDocument=options['baseline-decisions']?readLabDecisions(baseline,
        await held.files.read('baseline_decisions',{maxBytes:4194304}),held.files.metadata('baseline_decisions'),options['baseline-decision-format']):normalizeDecisions(baseline);
      const currentReview=previewDelivery(delivery,document),baselineReview=previewDelivery(baseline,baselineDocument);
      const result={comparison,review:previewReconciliation(comparison,correspondence),currentReview,baselineReview,
        outputComparison:reconcileDeliveries(delivery,baseline,{currentReview,baselineReview})};
      const saved=await output(options.out,json(result));if(saved)process.stdout.write(json(saved));return result;
    }
    let result;
    if(options.command==='table'){
      if(!options.out)throw Error('Select the complete editable-table output path.');
      const table=reviewTable(delivery,document,{format:options.format??(/\.tsv$/i.test(options.out)?'tsv':'csv'),
        scope:options.scope??'issues',...(options.fields?{fields:options.fields.split(',')}:{})});
      const saved=await output(options.out,table.text);process.stdout.write(json({...saved,sourceSha256:table.sourceSha256,rows:table.rows}));return saved;
    }
    if(options.command==='inspect')result={source:delivery.source,unassigned:delivery.unassigned,report:delivery.report,decisionTemplate:document};
    else result={review:previewDelivery(delivery,document),comparison};
    const saved=await output(options.out,json(result));if(saved)process.stdout.write(json(saved));return result;
  }finally{process.removeListener('SIGINT',cancelled);process.removeListener('SIGTERM',cancelled);await held?.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{
  process.stderr.write(json({error:error.code??'LAB_EDD',message:error.message,detail:error.detail}));process.exitCode=1;
});
