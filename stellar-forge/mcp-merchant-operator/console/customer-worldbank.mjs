// MIT. Original complete World Bank files through Merchant customer receiving.
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createWorldBankProgrammeDownload } from '../worldbank-programme-client.mjs';
import { WORLDBANK_ALIAS, WORLDBANK_SHA, WORLDBANK_FILE_BYTES, WORLDBANK_MANIFEST_NAME,
  parseWorldBankDelivery, encodeWorldBank, digest, canonical, worldBankNeed as need,
  worldBankFailure as fail } from '../worldbank-programme-contracts.mjs';

import { WORLDBANK_CUSTOMER_FAMILY, normalizeWorldBankCustomer, worldBankCustomerAccess,
  validateWorldBankCustomerRecord } from './worldbank-customer-records.mjs';
export { WORLDBANK_CUSTOMER_FAMILY, normalizeWorldBankCustomer, worldBankCustomerAccess, validateWorldBankCustomerRecord };
const prefix='merchant_worldbank_programme';
export function createWorldBankCustomerTransfer({operator,authorize},selection,request) {
  const selected=normalizeWorldBankCustomer(selection);
  const driver=createWorldBankProgrammeDownload(async()=>({
    endpoint:'urn:stellar-forge:merchant-host:'+selected.hostFingerprint+':worldbank-programme:'+selected.workspace,
    call:async(name,args)=>{
      const values={...args,workspace:selected.workspace};
      const context=await authorize(request,name,values);
      return operator.call(name,values,context?{authorization:context}:undefined);
    }
  }));
  return driver;
}
/** Stream the original already-received file on one verified descriptor. */
async function sendWorldBankFile({directory,record,file,response}) {
  validateWorldBankCustomerRecord(record);
  const expected=record.files.find(value=>value.name===file.name);
  need(expected&&expected.bytes===file.bytes&&expected.sha256===file.sha256,'Select a retained original file.','CONSOLE_CUSTOMER_FILE');
  const handle=await open(join(directory,file.name),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const before=await handle.stat({bigint:true});
    need(before.isFile()&&before.size===BigInt(file.bytes)&&before.nlink===1n&&!(before.mode&0o077n)&&
      (typeof process.getuid!=='function'||before.uid===BigInt(process.getuid())),
      'Read the original owned private customer file.','CONSOLE_CUSTOMER_CHANGED');
    const buffer=Buffer.alloc(1024*1024),hash=createHash('sha256');let offset=0;
    while(offset<file.bytes){
      const part=await handle.read(buffer,0,Math.min(buffer.length,file.bytes-offset),offset);
      need(part.bytesRead>0,'The original file ended early.','CONSOLE_CUSTOMER_CHANGED');
      hash.update(buffer.subarray(0,part.bytesRead));offset+=part.bytesRead;
    }
    const after=await handle.stat({bigint:true});
    need(hash.digest('hex')===file.sha256&&['dev','ino','size','mtimeNs','ctimeNs','mode','uid'].every(key=>before[key]===after[key]),
      'The original customer file changed.','CONSOLE_CUSTOMER_CHANGED');
    response.writeHead(200,{'content-type':file.contentType??'application/octet-stream','content-length':String(file.bytes),
      'cache-control':'no-store','x-content-type-options':'nosniff','x-content-sha256':file.sha256,
      'content-disposition':'attachment; filename="'+file.name+'"'});
    offset=0;
    while(offset<file.bytes){
      if(response.destroyed)throw fail('CONSOLE_CUSTOMER_CONNECTION_CLOSED','The original complete file remains retained.');
      const part=await handle.read(buffer,0,Math.min(buffer.length,file.bytes-offset),offset);
      need(part.bytesRead>0,'The original file changed while streaming.','CONSOLE_CUSTOMER_CHANGED');
      // Copy each outgoing chunk because the bounded read buffer is reused.
      if(!response.write(Buffer.from(buffer.subarray(0,part.bytesRead)))){
        await new Promise((resolve,reject)=>{
          const cleanup=()=>{response.off('drain',drain);response.off('close',closed);response.off('error',failed);};
          const drain=()=>{cleanup();resolve();};
          const closed=()=>{cleanup();reject(fail('CONSOLE_CUSTOMER_CONNECTION_CLOSED','The original complete file remains retained.'));};
          const failed=error=>{cleanup();reject(error);};
          response.once('drain',drain);response.once('close',closed);response.once('error',failed);
          if(response.destroyed)closed();
        });
      }
      offset+=part.bytesRead;
    }
    response.end();
  } catch(error) { if(response.headersSent)response.destroy(error); throw error; }
  finally { await handle.close(); }
}
export const worldBankCustomerFamily=Object.freeze({
  id:WORLDBANK_CUSTOMER_FAMILY,label:'World Bank programme, workbook and complete workspace',
  workspaceRequired:true,workspacePattern:WORLDBANK_ALIAS.source,exportPattern:WORLDBANK_SHA.source,
  toolPrefix:prefix,manifestName:WORLDBANK_MANIFEST_NAME,maximumBytes:WORLDBANK_FILE_BYTES,
  normalize:normalizeWorldBankCustomer,access:worldBankCustomerAccess,createTransfer:createWorldBankCustomerTransfer,
  parseManifest:parseWorldBankDelivery,validateRecord:validateWorldBankCustomerRecord,
  archiveFile:record=>record.manifest.files.find(file=>file.name==='WorldBank_Analysis_Delivery.zip')??null,
  sendFile:sendWorldBankFile
});
