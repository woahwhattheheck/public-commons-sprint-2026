// Original UTF-8 package receiving for the maintained Partner Batch Desk. MIT.
import * as core from "./core.mjs";
export const ORIGINAL_TEXT_SCHEMA="tjlabs.defarm.original-package-text/1";
export function decodeReceivedCase(value,hash){
 let text;
 if(core.object(value)&&value.schema===ORIGINAL_TEXT_SCHEMA){
  core.need(typeof value.original_package_text==="string","Choose the complete original package text");
  core.need(Object.keys(value).every(k=>["schema","original_package_text"].includes(k)),"Unexpected receiving envelope field");
  text=value.original_package_text;
 }else{
  core.need(core.object(value),"Choose a complete case package");
  text=JSON.stringify(value,null,2)+"\n";
 }
 core.need(core.bytes(text)<=80*1024*1024,"Original package exceeds the 80 MiB receiving limit");
 const pkg=JSON.parse(text.replace(/^\uFEFF/,"")),original=core.importCase(pkg,hash);
 return {text,pkg,original,bytes:core.bytes(text),sha256:hash(text)};
}
export function receiveCaseState(selected,{previousPackageText=null,current=null,at},hash){
 const original=selected.original;
 if(previousPackageText!==null){
  const prior=decodeReceivedCase({schema:ORIGINAL_TEXT_SCHEMA,original_package_text:previousPackageText},hash);
  core.need(prior.pkg.case_sha256===selected.pkg.case_sha256&&prior.pkg.case_text===selected.pkg.case_text,
   "A different incoming edition is already retained; receive into a separate workspace");
 }
 if(current){
  core.assertCase(current,hash);
  core.need(current.id===original.id,"Receiving identity differs from the selected case");
  if(previousPackageText!==null&&JSON.stringify(current)!==JSON.stringify(original)){
   if(current.notes.some(n=>n.kind==="received"&&n.original_package_sha256===selected.pkg.case_sha256))
    return {case:current,replayed:true};
   const c=core.clone(current);
   c.notes.push({at,kind:"received",original_package_sha256:selected.pkg.case_sha256,
    original_package_bytes_sha256:selected.sha256,original_package_bytes:selected.bytes});
   c.revision++;
   return {case:c,replayed:false};
  }
  core.need(JSON.stringify(current)===JSON.stringify(original),
   "An existing case has different history; receive into a fresh desk directory to preserve both");
 }
 const c=core.interrupted(core.clone(original),at,hash);
 c.notes.push({at,kind:"received",original_package_sha256:selected.pkg.case_sha256,
  original_package_bytes_sha256:selected.sha256,original_package_bytes:selected.bytes});
 for(const e of c.events)delete e.execution_scope;
 if(!c.events.some(e=>e.kind==="commit"||e.kind==="reconcile"))c.state="draft";
 c.revision++;
 return {case:c,replayed:false};
}
