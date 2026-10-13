// MIT. Complete unfinished author-return preparation in the existing working copy.
import {MAX_BYTES, measureText} from './grant-submission-core.mjs';
export const APPLICATION_RETURN_WORKING_SCHEMA='stellar-forge.grant-application-return-working.v1';
const SCHEMA=APPLICATION_RETURN_WORKING_SCHEMA;
const need=(value,message)=>{if(!value)throw new Error(message);};
export function newApplicationReturnWorking(){return {schema:SCHEMA,raw:'',filename:'',issueLabel:'',recipient:'',issueNote:'',reviewer:'',note:'',choices:{},basisSha256:null,selectedIssue:null};}
export function validateApplicationReturnWorking(value){
  if(value===null||value===undefined)return value;
  need(value&&typeof value==='object'&&!Array.isArray(value)&&value.schema===SCHEMA,'Retain the complete returned-application preparation.');
  for(const key of ['raw','filename','issueLabel','recipient','issueNote','reviewer','note']){
    const maximum=key==='raw'?MAX_BYTES*2+65536:['note','issueNote'].includes(key)?65536:10000;
    need(typeof value[key]==='string'&&measureText(value[key]).utf8Bytes<=maximum,'Retain complete '+key+' within its receiving allowance.');
  }
  need(value.choices&&typeof value.choices==='object'&&!Array.isArray(value.choices),'Retain the original returned-application choices.');
  for(const [key,choice]of Object.entries(value.choices))need(key.length<=2000&&['current','returned'].includes(choice),'Keep explicit original application choices.');
  need(value.basisSha256===null||/^[a-f0-9]{64}$/.test(value.basisSha256),'Retain the original comparison identity.');
  need(value.selectedIssue===null||typeof value.selectedIssue==='string','Retain the selected issued copy.');
  return value;
}
