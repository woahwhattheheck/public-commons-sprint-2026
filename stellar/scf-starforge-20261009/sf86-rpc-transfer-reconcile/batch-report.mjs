// MIT. Resume the original accounting writer against a retained exported proof set.
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,readFile,mkdir,rename,realpath,open} from 'node:fs/promises';
import {isAbsolute,resolve,join} from 'node:path';
import {exportBatch,inspectBatchExport} from './batch.mjs';
import {ReconciliationError,requireTruth} from './terms.mjs';
import {runOriginalAccounting} from '../merchant-settlement-accounting/reconcile.mjs';
import {writeOriginalAccountingPack} from '../merchant-settlement-accounting/cli.mjs';
import {withDeliveryLease} from '../sf98-merchant-delivery/delivery-lock.mjs';
import {publish} from './private-files.mjs';

const expectedFiles=['report.json','ledger.csv','options.csv','exceptions.csv','review.html'];
async function privateDirectory(path) {
  const info=await lstat(path);
  requireTruth(info.isDirectory()&&!(info.mode&0o077)&&await realpath(path)===path,
    'COLLECTION_REPORT_DIRECTORY_INVALID');
}
async function read(path,max=8_000_000) {
  const info=await lstat(path);
  requireTruth(info.isFile()&&!info.isSymbolicLink()&&info.size<=max,'COLLECTION_REPORT_FILE_INVALID');
  const bytes=await readFile(path);
  requireTruth(bytes.length<=max,'COLLECTION_REPORT_FILE_INVALID');return bytes;
}
async function completedReport(path) {
  let raw;
  try{raw=await read(join(path,'manifest.json'),100_000);}
  catch(error){if(error.code==='ENOENT')return false;throw error;}
  const manifest=JSON.parse(raw);
  requireTruth(manifest.schema==='stellar-forge.merchant-accounting-manifest.v1'&&
    Array.isArray(manifest.outputs)&&manifest.outputs.length===expectedFiles.length&&
    new Set(manifest.outputs.map(file=>file.name)).size===expectedFiles.length,
  'COLLECTION_ACCOUNTING_MANIFEST_INVALID');
  for(const file of manifest.outputs) {
    requireTruth(expectedFiles.includes(file.name),'COLLECTION_ACCOUNTING_FILE_INVALID');
    const handle=await open(join(path,file.name),constants.O_RDONLY|(constants.O_NOFOLLOW??0));
    try {
      const info=await handle.stat();
      requireTruth(info.isFile()&&info.size===file.bytes,'COLLECTION_ACCOUNTING_FILE_CHANGED');
      const hash=createHash('sha256');let bytes=0;
      for await(const chunk of handle.createReadStream({autoClose:false})) {
        hash.update(chunk);bytes+=chunk.length;
        requireTruth(bytes<=file.bytes,'COLLECTION_ACCOUNTING_FILE_CHANGED');
      }
      requireTruth(bytes===file.bytes&&hash.digest('hex')===file.sha256,'COLLECTION_ACCOUNTING_FILE_CHANGED');
    } finally {await handle.close();}
  }
  return true;
}
export async function reportBatch({directory,output,outboxDir,termsFile,recoveredDir,resume=false}) {
  const paths=[directory,output,outboxDir,termsFile,...(recoveredDir===undefined?[]:[recoveredDir])];
  for(const path of paths)requireTruth(typeof path==='string'&&
    isAbsolute(path)&&resolve(path)===path&&path!=='/','ABSOLUTE_NORMALIZED_PATH_REQUIRED');
  requireTruth(new Set(paths).size===paths.length&&!output.startsWith(outboxDir+'/')&&
    (recoveredDir===undefined||!output.startsWith(recoveredDir+'/')),
  'COLLECTION_REPORT_INPUT_OUTPUT_OVERLAP');
  if(!resume)await exportBatch({directory,output});
  const exported=await inspectBatchExport({directory,output});
  return withDeliveryLease(output,async()=>{
    const requestFile=join(output,'report-request.json');
    const request={schema:'stellar-forge.sf86.collection-report.v1',
      exportManifestSha256:exported.manifestSha256,outboxDir,termsFile,
      ...(recoveredDir===undefined?{}:{recoveredDir})};
    let existing;
    try{existing=JSON.parse(await read(requestFile,100_000));}
    catch(error){if(error.code!=='ENOENT')throw error;}
    if(existing)requireTruth(JSON.stringify(existing)===JSON.stringify(request),
      'COLLECTION_REPORT_INPUTS_CHANGED');
    else await publish(requestFile,JSON.stringify(request));
    const reportDirectory=join(output,'accounting');
    let present=false;
    try{await privateDirectory(reportDirectory);present=true;}
    catch(error){if(error.code!=='ENOENT')throw error;}
    if(present) {
      let complete=false;
      try{complete=await completedReport(reportDirectory);}
      catch(error){if(!resume)throw error;}
      if(complete)return {...exported,reportDirectory,reused:true};
      requireTruth(resume,'COLLECTION_REPORT_RESUME_REQUIRED');
      // Preserve interrupted output in place; the original writer gets its
      // required fresh directory and owns every report byte again.
      const retained=join(output,'interrupted');
      await mkdir(retained,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
      await privateDirectory(retained);
      await rename(reportDirectory,join(retained,'accounting-'+randomUUID()));
    }
    const result=await runOriginalAccounting({outboxDir,proofDir:exported.proofDirectory,termsFile,recoveredDir});
    await writeOriginalAccountingPack(result,reportDirectory);
    requireTruth(await completedReport(reportDirectory),'COLLECTION_ACCOUNTING_REPORT_INCOMPLETE');
    return {...exported,reportDirectory,reused:false};
  },{purpose:'drain'});
}
