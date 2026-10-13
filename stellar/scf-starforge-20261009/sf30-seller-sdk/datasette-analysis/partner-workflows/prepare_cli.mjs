#!/usr/bin/env node
/** Prepare and receive a complete editable commissioning bundle. Node >=20. */
import {readFile,writeFile,mkdir,lstat,rename,rm} from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";
import {resolve,join,isAbsolute} from "node:path";
import {fileURLToPath} from "node:url";
import {buildRetail,buildContacts,canonical,csv,renderReport} from "./preparation.mjs";
import {preparedFiles,nativeProfile} from "./profiles.mjs";
const HERE=fileURLToPath(new URL(".",import.meta.url));
const SOURCE_FILES=["preparation.mjs","profiles.mjs","prepare_cli.mjs","README.md","SOURCE_CONTRACTS.md"];
const sha=raw=>createHash("sha256").update(raw).digest("hex");
const bytes=raw=>Buffer.byteLength(raw,"utf8");
const fail=(code)=>{throw new Error(code);};
async function regular(path) {
  const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||s.size>128*1024*1024)fail("REGULAR_SOURCE_FILE_REQUIRED");
  return readFile(path);
}
function args(argv) {
  const [command,...values]=argv;if(!["prepare","receive"].includes(command))fail("USE_PREPARE_OR_RECEIVE");
  const result={command};
  for(let i=0;i<values.length;i+=2){if(!/^--(?:input|out|installation)$/.test(values[i])||values[i+1]===undefined)fail("INVALID_ARGUMENT");const k=values[i].slice(2);if(k in result)fail("DUPLICATE_ARGUMENT");result[k]=values[i+1];}
  if(!result.input||!result.out)fail("INPUT_AND_OUTPUT_REQUIRED");return result;
}
function file(path,content,contentType="text/plain; charset=utf-8"){return{path,bytes:bytes(content),sha256:sha(content),contentType,content};}
async function validate(directory) {
  const raw=await regular(join(directory,"manifest.json")),manifest=JSON.parse(raw);
  if(manifest.schema!=="stellar-forge.partner-workflow-bundle.v1"||!Array.isArray(manifest.files)||!manifest.files.length)fail("BUNDLE_MANIFEST_INVALID");
  const names=new Set(),contents=new Map(),descriptors=new Map();
  for(const f of manifest.files){
    if(!f||typeof f!=="object"||Array.isArray(f)||typeof f.path!=="string"||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(f.path)||f.path==="manifest.json"||names.has(f.path)||
      !Number.isSafeInteger(f.bytes)||f.bytes<0||typeof f.sha256!=="string"||!/^[a-f0-9]{64}$/.test(f.sha256)||
      typeof f.contentType!=="string"||!f.contentType.trim())fail("BUNDLE_MEMBER_INVALID");
    names.add(f.path);const content=await regular(join(directory,f.path));
    if(content.length!==f.bytes||sha(content)!==f.sha256)fail("BUNDLE_MEMBER_CHANGED");
    contents.set(f.path,content);descriptors.set(f.path,f);
  }
  const required=[...SOURCE_FILES,"Review.html","original-metadata.json","preparation.json","original-input.json"];
  if(required.some(name=>!names.has(name)))fail("BUNDLE_REQUIRED_MEMBER_MISSING");
  const saved=JSON.parse(contents.get("preparation.json"));
  if(saved.schema!=="stellar-forge.partner-workflow-preparation.v1"||
    !["retail-payout-reconciliation","odoo-contact-import-preparation"].includes(saved.kind)||
    !saved.tables||typeof saved.tables!=="object"||Array.isArray(saved.tables)||
    Object.entries(saved.tables).some(([name,rows])=>!/^[a-z][a-z0-9_]*$/.test(name)||!Array.isArray(rows)))fail("BUNDLE_PREPARATION_INVALID");
  const expectedTables=saved.kind==="retail-payout-reconciliation"?["transactions","payouts","orders","exceptions"]:["mapping","exceptions","companies","people","reconciliation"];
  if(canonical(Object.keys(saved.tables).sort())!==canonical(expectedTables.sort()))fail("BUNDLE_TABLE_SET_INVALID");
  if(saved.preparationSha256!==manifest.preparationSha256||saved.originalSha256!==manifest.originalSha256||
    saved.kind!==manifest.kind)fail("BUNDLE_PREPARATION_CHANGED");
  const original=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(contents.get("original-input.json")));
  if(sha(canonical(original))!==saved.originalSha256||canonical(original)!==canonical(saved.original))fail("BUNDLE_ORIGINAL_CHANGED");
  const {original:excluded,preparationSha256,...body}=saved;
  if(sha(canonical(body))!==preparationSha256)fail("PREPARATION_HASH_CHANGED");
  const metadata=JSON.parse(contents.get("original-metadata.json"));
  if(metadata.schema!=="stellar-forge.partner-workflow-source-metadata.v1"||
    canonical(metadata.source)!==canonical(saved.source)||
    metadata.originalInput?.path!=="original-input.json"||
    metadata.originalInput.bytes!==contents.get("original-input.json").length||
    metadata.originalInput.sha256!==sha(contents.get("original-input.json"))||
    metadata.originalInput.content!==contents.get("original-input.json").toString("utf8")||
    metadata.transformation?.preparationSha256!==saved.preparationSha256)fail("BUNDLE_METADATA_CHANGED");
  if(!Array.isArray(metadata.tables)||metadata.tables.length!==expectedTables.length||
    canonical(metadata.tables.map(t=>t.name).sort())!==canonical(expectedTables))fail("BUNDLE_TABLE_SET_INVALID");
  const expected=preparedFiles(saved,sha).tables;
  for(const t of metadata.tables){
    const original=expected.find(e=>e.name===t.name);
    if(t.path!==original.path||t.rows!==original.rows||!Array.isArray(t.columns)||
      t.columns.some(c=>typeof c!=="string"||!c.trim())||new Set(t.columns).size!==t.columns.length||
      canonical([...t.columns].sort())!==canonical([...original.columns].sort()))fail("BUNDLE_TABLE_DESCRIPTOR_CHANGED");
    if(!names.has(t.path))fail("BUNDLE_TABLE_MEMBER_MISSING");
    const content=contents.get(t.path).toString("utf8");
    if(t.sha256!==sha(content)||content!==csv(saved.tables[t.name],t.columns))fail("BUNDLE_TABLE_CONTENT_CHANGED");
  }
  const sourceFiles=metadata.transformation.sourceFiles;
  if(!Array.isArray(sourceFiles)||sourceFiles.length!==SOURCE_FILES.length||
    canonical(sourceFiles.map(f=>f.path).sort())!==canonical([...SOURCE_FILES].sort()))fail("BUNDLE_SOURCE_SET_INVALID");
  for(const f of sourceFiles){
    if(f.bytes!==descriptors.get(f.path).bytes||f.sha256!==descriptors.get(f.path).sha256||
      typeof f.content!=="string"||f.content!==contents.get(f.path).toString("utf8"))fail("BUNDLE_SOURCE_CHANGED");
  }
  if(names.has("profile-template.json")!==names.has("installation-selection.json"))fail("BUNDLE_INSTALLATION_PAIR_REQUIRED");
  return {manifest,manifestSha256:sha(raw)};
}
async function publish(out,files,manifest) {
  const directory=resolve(out);if(!isAbsolute(out))fail("ABSOLUTE_OUTPUT_REQUIRED");
  try{const current=await validate(directory);if(current.manifest.preparationSha256===manifest.preparationSha256 &&
    canonical(current.manifest.files)===canonical(manifest.files))return{...current,replayed:true,directory};fail("OUTPUT_ALREADY_HAS_DIFFERENT_DELIVERY");}
  catch(e){if(e.code!=="ENOENT")throw e;try{await lstat(directory);fail("OUTPUT_DIRECTORY_ALREADY_EXISTS");}catch(missing){if(missing.code!=="ENOENT")throw missing;}}
  const staging=directory+".receiving-"+randomUUID();
  await mkdir(staging,{mode:0o700});
  try{
    for(const f of files)await writeFile(join(staging,f.path),f.content,{encoding:"utf8",flag:"wx",mode:0o600});
    await writeFile(join(staging,"manifest.json"),canonical(manifest)+"\n",{encoding:"utf8",flag:"wx",mode:0o600});
    await validate(staging);await rename(staging,directory);
  }catch(e){await rm(staging,{recursive:true,force:true});throw e;}
  return {...await validate(directory),replayed:false,directory};
}
async function main() {
  const a=args(process.argv.slice(2));let files,manifest;
  if(a.command==="receive"){
    const source=resolve(a.input),v=await validate(source);files=[];
    for(const f of v.manifest.files)files.push({...f,content:(await regular(join(source,f.path))).toString("utf8")});
    manifest=v.manifest;
  }else{
    const raw=await regular(resolve(a.input)),input=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(raw));
    const result=input.kind==="retail-payout-reconciliation"?buildRetail(input,sha):
      input.kind==="odoo-contact-import-preparation"?buildContacts(input,sha):fail("WORKFLOW_KIND_REQUIRED");
    const prepared=preparedFiles(result,sha);
    files=prepared.files.map(f=>file(f.path,f.content,f.contentType));
    const sourceFiles=[];
    for(const path of SOURCE_FILES){
      const content=(await regular(join(HERE,path))).toString("utf8");sourceFiles.push(file(path,content));}
    files.push(...sourceFiles,file("original-input.json",raw.toString("utf8"),"application/json"),
      file("Review.html",renderReport(result),"text/html; charset=utf-8"));
    const metadata={schema:"stellar-forge.partner-workflow-source-metadata.v1",source:result.source,
      originalInput:{path:"original-input.json",bytes:raw.length,sha256:sha(raw),content:raw.toString("utf8")},
      transformation:{preparationSha256:result.preparationSha256,sourceFiles},tables:prepared.tables};
    files.push(file("original-metadata.json",canonical(metadata)+"\n","application/json"));
    if(a.installation){
      const installation=JSON.parse(await regular(resolve(a.installation)));
      installation.directory=resolve(a.out);
      const profile=nativeProfile(result,prepared.tables,installation);
      files.push(file("profile-template.json",canonical(profile)+"\n","application/json"),
        file("installation-selection.json",canonical(installation)+"\n","application/json"));
    }
    manifest={schema:"stellar-forge.partner-workflow-bundle.v1",kind:result.kind,
      originalSha256:result.originalSha256,preparationSha256:result.preparationSha256,
      files:files.map(({content,...f})=>f)};
  }
  const published=await publish(a.out,files,manifest);
  process.stdout.write(canonical({schema:manifest.schema,kind:manifest.kind,directory:published.directory,
    files:manifest.files.length,preparationSha256:manifest.preparationSha256,
    manifestSha256:published.manifestSha256,replayed:published.replayed})+"\n");
}
main().catch(e=>{process.stderr.write(JSON.stringify({error:e.code||e.message,detail:e.detail||null})+"\n");process.exitCode=1;});
