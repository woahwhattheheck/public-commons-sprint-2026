// MIT. Create-only preparation through the original Operating Plan writer.
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadCommandCatalog } from '../../stellar/scf-starforge-20261009/distribution/discovery/load.mjs';
import { saveExport } from '../../stellar/scf-starforge-20261009/distribution/discovery/write-json.mjs';
import { createOperatingFile } from '../../stellar/scf-starforge-20261009/distribution/discovery/operating-plan.mjs';
import { WORLD_BANK_BRIEF_SCHEMA, inspectWorldBankCommissioningBrief, createWorldBankCommissioningPlan } from './commissioning-plan.mjs';

export const COMMISSIONING_HELP = [
  'World Bank customer commissioning',
  '',
  'starforge worldbank-product commissioning example --out NEW-BRIEF.json',
  'starforge worldbank-product commissioning create --brief BRIEF.json --out NEW-PLAN.json',
  '  [--source-root DIRECTORY] [--selection worldbank]',
  '',
  'Edit the complete brief before creating the plan. All work begins planned.',
  'The output is ordinary editable Operating Plan JSON; import it in Operating plans.',
  'Creation retains the original brief and every explicitly selected complete supporting file.',
  'It reads the selected catalog and input files; it does not run an acquisition or customer operation.',
  'Existing output files are preserved. Continue an existing plan through discover plan or its editor.',
].join('\n');
export function commissioningExample({ id = randomUUID(), operationId = randomUUID().replaceAll('-',''),
  createdAt = new Date().toISOString() } = {}) {
  return {
    schema: WORLD_BANK_BRIEF_SCHEMA, id, createdAt,
    title:'World Bank reference course — edit for the selected customer',
    customer:'Reference course', purpose:'Review economic observations and receive editable reports, workbook and portable Analysis.',
    period:'2018–2024 reference edition; agree the actual customer period',
    owner:'Receiving operator', receiving:'Agree the customer owner, private destination and acceptance meeting before acquisition.',
    operationId, prefix:'customer_economy', python:'python3',
    paths:{ sourceWorkspace:'/srv/starforge/customer/worldbank', analysisWorkspace:'/srv/starforge/customer/analysis',
      handover:'/srv/starforge/customer/accepted-worldbank-handover.zip', customerWorkspace:'/srv/starforge/customer/received-analysis' },
    scope:{
      source:'World Bank source 2 — World Development Indicators',
      countries:['CAN','MEX','USA'], indicators:['NY.GDP.MKTP.CD','SP.POP.TOTL'], periods:['2018','2019','2020','2021','2022','2023','2024'],
      rights:'Confirm the selected source terms, attribution and permitted customer use.',
      missingValues:'Preserve missing values separately from zero and retain the original numeric tokens.',
      review:'Inspect country/indicator/year coverage; record each exclusion with its reason against the original capture.',
      calculations:'Agree units and denominators. Review annual change and GDP per person only where the required observations exist.',
      workbook:'Keep original values as text; label reviewed calculated numeric columns and preserve customer formatting.',
      acceptance:'Reconcile the accepted source count and selected observations; reopen report, workbook and restored workspace; record unresolved exceptions.',
      care:'Name the customer editor and operating contact; agree correction and source-change handling.',
      recurrence:'Agree whether another edition is required, its source trigger, review owner and period; no schedule is created by this brief.',
    }, assignments:{}, attachments:[],
  };
}
function options(args, allowed) {
  const result={};
  for(let i=0;i<args.length;i+=2) {
    const key=args[i], value=args[i+1];
    if(!allowed.includes(key) || Object.hasOwn(result,key) || typeof value!=='string' || !value || value.startsWith('--'))
      throw new TypeError('Unknown, repeated or incomplete commissioning option: '+key);
    result[key]=value;
  }
  return result;
}
async function originalFile(path, maxBytes) {
  const file = await open(resolve(path), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat({ bigint:true });
    if(!before.isFile() || before.size > BigInt(maxBytes)) throw new TypeError('Choose a complete regular input within its byte limit: '+path);
    const bytes = await file.readFile(), after = await file.stat({ bigint:true });
    if(bytes.length>maxBytes || before.dev!==after.dev || before.ino!==after.ino ||
      before.size!==after.size || before.mtimeNs!==after.mtimeNs || before.ctimeNs!==after.ctimeNs)
      throw new TypeError('The selected input changed while being received: '+path);
    return bytes;
  } finally { await file.close(); }
}
export async function mainCommissioning(args, { log=console.log }={}) {
  if(!args.length || args.includes('--help') || args.includes('-h')) { log(COMMISSIONING_HELP); return 0; }
  const [action,...words]=args;
  if(!['example','create'].includes(action)) throw new TypeError('Choose commissioning example or create.');
  const opts=options(words,action==='example'?['--out']:['--brief','--out','--source-root','--selection']);
  if(!opts['--out'] || action==='create' && !opts['--brief']) throw new TypeError('--out and, for create, --brief are required.');
  let value;
  if(action==='example') value=commissioningExample();
  else {
    const briefBytes=await originalFile(opts['--brief'],1024*1024);
    const brief=inspectWorldBankCommissioningBrief(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(briefBytes)));
    let remaining=24*1024*1024-briefBytes.length;
    const files=[];
    for(const selected of brief.attachments??[]) {
      const bytes=await originalFile(selected.path,remaining);
      remaining-=bytes.length;
      files.push({step:selected.step,file:createOperatingFile({
        id:selected.id,name:selected.name,mediaType:selected.mediaType,note:selected.note,bytes,
      })});
    }
    const catalog=await loadCommandCatalog({sourceRoot:opts['--source-root'],selection:opts['--selection']});
    value=createWorldBankCommissioningPlan({brief,catalog,briefBytes,files});
  }
  await saveExport(opts['--out'],value);
  log(JSON.stringify({file:resolve(opts['--out']),action,planId:value.id,
    revision:value.revisions?.length??null,steps:value.revisions?.at(-1)?.steps.length??null}));
  return 0;
}
