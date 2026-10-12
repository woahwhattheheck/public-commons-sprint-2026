// MIT. Prepare a real laboratory configuration for the original paid-job merchant.
import { readFile, open, mkdir, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileJobMerchant, digest, canonical } from '../jobs/config.mjs';

export const LABORATORY_APPLICATION_ID = 'laboratory-edd';
export const LABORATORY_SOURCE_FILES = Object.freeze([
  'application.mjs','profiles.mjs','profiles/equis.mjs','profiles/dts8.mjs',
  'model.mjs','table.mjs','decisions.mjs','zip.mjs','report.mjs','report-client.mjs',
  'reconciliation-profile.mjs','reconciliation.mjs','reconciliation-table.mjs',
  'reconciliation-editor.mjs','reconciliation-report.mjs','reconciliation-application.mjs',
  'workbook.mjs','workbook_bridge.py','merchant.example.json','merchant-configuration.mjs','application-provider.mjs',
]);

const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const need=(condition,message)=>{if(!condition)throw Object.assign(new TypeError(message),{code:'LAB_MERCHANT_CONFIGURATION'});};

/** The installed application owns its format, file and output contracts. */
export async function createLabMerchantConfiguration({
  publicOrigin,payment,serviceName='Laboratory EDD Receiving',memoryLimitMb
}={}){
  need(typeof publicOrigin==='string'&&plain(payment),'Select the actual public HTTPS origin and complete payment option.');
  need(payment.scheme==='exact'&&typeof payment.network==='string'&&typeof payment.asset==='string'&&
    typeof payment.payTo==='string'&&typeof payment.amount==='string',
    'Use the original exact payment option with its network, asset, recipient and atomic amount.');
  need(![payment.asset,payment.payTo].some(value=>/UNVERIFIED_DEMO|ACTUAL_|REPLACE|YOUR_/i.test(value)),
    'Select the real asset and recipient for this merchant configuration.');
  need(typeof serviceName==='string'&&serviceName.trim().length>0&&serviceName.length<=160,
    'Use a nonempty laboratory service name up to 160 characters.');
  const template=JSON.parse(await readFile(new URL('./merchant.example.json',import.meta.url),'utf8'));
  const application=await realpath(fileURLToPath(new URL('./application.mjs',import.meta.url)));
  const configuration={...template,application,publicOrigin,serviceName,
    functions:{...template.functions,laboratoryReview:{...template.functions.laboratoryReview,payment:structuredClone(payment)}}};
  if(memoryLimitMb!==undefined)configuration.memoryLimitMb=memoryLimitMb;
  const compiled=compileJobMerchant(configuration,{baseDir:dirname(application)});
  need(compiled.functions?.laboratoryReview?.output?.format==='bytes'&&
    compiled.functions.laboratoryReview.output.contentType==='application/zip',
    'Use the complete laboratory byte-result contract.');
  return {configuration,application,definition:compiled.functions.laboratoryReview,
    configurationSha256:digest(canonical(configuration))};
}

/** Create one original private configuration; an existing file remains a separate edition. */
export async function writeLabMerchantConfiguration({file,...options}={}){
  need(typeof file==='string'&&file.length>0,'Select a new configuration output path.');
  const prepared=await createLabMerchantConfiguration(options),requested=resolve(file);
  await mkdir(dirname(requested),{recursive:true,mode:0o700});
  const path=resolve(await realpath(dirname(requested)),basename(requested));
  const bytes=Buffer.from(JSON.stringify(prepared.configuration,null,2)+'\n');
  const handle=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  const retained=await readFile(path);
  need(retained.equals(bytes),'The saved laboratory configuration changed during publication.');
  return {path,bytes:bytes.length,sha256:digest(bytes),configurationSha256:prepared.configurationSha256,
    application:prepared.application,functionId:'laboratoryReview',publicOrigin:prepared.configuration.publicOrigin,
    payment:prepared.definition.payment,inputFiles:prepared.definition.inputFiles,output:prepared.definition.output};
}
