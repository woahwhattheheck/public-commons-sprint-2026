import fs from 'node:fs';
import {check} from './files.mjs';
export function receivingLease(){
 const selected=process.env.LDW_RECEIVING_LEASE_FD,raw=process.env.LDW_RECEIVING_LEASE_IDENTITY;
 if(selected===undefined&&raw===undefined)return null;
 const fd=Number(selected);let identity;try{identity=JSON.parse(raw);}catch{check(false,'LIGHTDASH_RECEIVING_LEASE','The receiving lease identity is incomplete.');}
 check(Number.isInteger(fd)&&fd>=3&&identity&&Number.isSafeInteger(identity.device)&&Number.isSafeInteger(identity.inode)&&typeof identity.operationId==='string'&&/^[a-f0-9]{64}$/.test(identity.inputSha256),'LIGHTDASH_RECEIVING_LEASE','Invalid original receiving lease.');
 const stat=fs.fstatSync(fd);
 check(stat.isFile()&&stat.dev===identity.device&&stat.ino===identity.inode,'LIGHTDASH_RECEIVING_LEASE','The inherited original receiving lease changed.');
 return {fd,identity};
}
export function inheritReceiving(stdio,environment=process.env){
 const selected=receivingLease();if(!selected)return {stdio,env:environment};
 const descriptors=[...stdio],fd=descriptors.length;descriptors.push(selected.fd);
 return {stdio:descriptors,env:{...environment,LDW_RECEIVING_LEASE_FD:String(fd),LDW_RECEIVING_LEASE_IDENTITY:JSON.stringify(selected.identity)}};
}
