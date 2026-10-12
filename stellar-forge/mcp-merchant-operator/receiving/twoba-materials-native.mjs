#!/usr/bin/env node
// MIT. Continue a complete xChange handover as a reviewed 2BA upload package.
import assert from 'node:assert/strict';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstat,realpath } from 'node:fs/promises';
import { join,dirname,resolve,relative,isAbsolute,sep,basename } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { acquireStateLease } from '../../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import { readXChange } from '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/catalog/supplier/xchange/input.mjs';
import { validateXChange,XCHANGE_SCHEMA,XCHANGE_SUPPLIER_SCHEMA,XCHANGE_PRODUCT_SCHEMA } from '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/catalog/supplier/xchange/schema.mjs';
import { TWO_BA_PARAMETER_NAMES } from '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/catalog/supplier/xchange/processing.mjs';
import { main as catalogCLI } from '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/catalog/cli.mjs';
import { initializeOpenSearchWorkspaceMerchant,readMerchantConfig } from '../config.mjs';
import { startMerchantMcp } from '../serve.mjs';
import { openMerchantFileClient } from '../retained-download.mjs';
import { createOpenSearchMaterialClient } from '../opensearch-material-client.mjs';
import { runOpenSearchMaterialCLI } from '../opensearch-material-cli.mjs';
import { openSearchMaterialTools,MATERIAL_EXPORT_FORMATS,SUPPLIER_EXPORT_FORMATS } from '../catalog/opensearch-materials.mjs';
import { materialReceivingIO } from './opensearch-materials-native.mjs';
import { xchangeReceivingIO } from './xchange-materials-native.mjs';

const {privateDirectory,readBytes,readJson,maybeJson,atomicBytes,retainedBytes,
  fileIdentity,digest,allPages,operationResult,sourceReport,retainedExportFile:exportFile}=materialReceivingIO;
const {bundleContent}=xchangeReceivingIO;
const HERE=dirname(fileURLToPath(import.meta.url));
const INPUTS=resolve(HERE,'../../../stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/catalog/supplier/xchange/source');
const SCHEMA='stellar-forge.twoba-materials-native-receiving.v1';
const PRIMARY='twoba-producer',CUSTOMER='twoba-customer';
const ORIGINAL_INPUT='original-producer-delivery',CUSTOMER_INPUT='original-customer-delivery',PACKAGE_INPUT='twoba-producer-delivery';
const FORMATS=Object.freeze(['review.json','issues.csv','products.jsonl','xchange.json',
  'recipient.jsonl','impact.csv','parameters.xml','2ba.zip']);
const PARAMETERS_SOURCE=Object.freeze({name:'2BA_parameters_example.xml',bytes:446,
  sha256:'a1e7a2e4d920126eecd45fa6cb603d9da2deeb508dc9ae0ab4de8b08f2db1d2e',
  gitBlob:'cb891b51299aacec45427dcea6150236234d58d1'});
const REQUIRED_TOOLS=Object.freeze(['merchant_opensearch_material_receive','merchant_opensearch_material_export',
  'merchant_opensearch_supplier_save','merchant_opensearch_supplier_correction','merchant_opensearch_supplier_review',
  'merchant_opensearch_supplier_recipient_rows','merchant_opensearch_supplier_row','merchant_opensearch_supplier_export',
  'merchant_opensearch_material_export_manifest','merchant_opensearch_material_export_file']);
const MODELLING_PATHS=Object.freeze(['/EtimClassification/0/EtimModellingClassCode',
  '/EtimClassification/0/EtimModellingClassVersion','/EtimClassification/0/EtimModellingPorts']);
const hash=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const clone=value=>structuredClone(value);
const failure=(code,message)=>Object.assign(new Error(message),{code});
const inside=(parent,child)=>{const p=relative(parent,child);return !p||!isAbsolute(p)&&p!=='..'&&!p.startsWith('..'+sep);};
const rowsOf=pages=>pages.flatMap(page=>page.rows??page.items??[]);
function sealed(value){
  const {sha256,...body}=value;assert.equal(digest(body),sha256,'The complete retained record changed.');return value;
}
async function existingDirectory(path){
  const info=await lstat(path);
  assert.ok(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(path)===resolve(path),
    'Select the existing canonical original operation directory.');
}
function assertFormats(value,formats){
  assert.deepEqual(value.manifest.selection.formats,formats);
  assert.equal(value.manifest.files.length,formats.length);
  for(const format of formats)exportFile(value,format);
}
function productMessage(original,{omitAttachments=false,omitPrices=false}={}){
  const selected=clone(original),removed=[];
  if(omitAttachments){delete selected.product.ProductAttachments;removed.push('/ProductAttachments');}
  if(omitPrices)for(let n=0;n<(selected.product.TradeItem??[]).length;n++){
    delete selected.product.TradeItem[n].Pricing;removed.push('/TradeItem/'+n+'/Pricing');
  }
  selected.numberTokens=Object.fromEntries(Object.entries(selected.numberTokens??{}).filter(([path])=>
    !removed.some(prefix=>path===prefix||path.startsWith(prefix+'/'))));
  return selected;
}
function omitUnreleasedModelling(original,decision){
  assert.deepEqual(decision.paths,[...MODELLING_PATHS]);
  assert.equal(original.product.EtimClassification[0].EtimModellingClassCode,decision.code);
  assert.equal(String(original.product.EtimClassification[0].EtimModellingClassVersion),decision.version);
  assert.equal(Object.keys(original.numberTokens).length,decision.originalNumberTokens);
  const message=clone(original),omittedFields=[];
  for(const path of MODELLING_PATHS){
    const parts=path.slice(1).split('/');let target=message.product;
    for(const key of parts.slice(0,-1))target=target[key];
    const key=parts.at(-1);assert.ok(Object.hasOwn(target,key));
    omittedFields.push({path,value:clone(target[key])});delete target[key];
  }
  const removedNumberTokens={};
  message.numberTokens=Object.fromEntries(Object.entries(original.numberTokens).filter(([path,value])=>{
    if(MODELLING_PATHS.some(prefix=>path===prefix||path.startsWith(prefix+'/'))){
      removedNumberTokens[path]=value;return false;
    }
    return true;
  }));
  assert.equal(Object.keys(message.numberTokens).length,decision.deliveredNumberTokens);
  assert.equal(Object.keys(removedNumberTokens).length,5);
  for(const[path,value]of Object.entries(message.numberTokens))assert.equal(value,original.numberTokens[path]);
  assert.deepEqual(validateXChange(message.product,{schema:XCHANGE_PRODUCT_SCHEMA,numberTokens:message.numberTokens}),[]);
  return {message,omittedFields,removedNumberTokens,reason:decision.reason};
}
function unchangedOriginal(report){
  return {schema:report.schema,operationId:report.operationId,state:report.state,lifetimes:report.lifetimes,directory:report.directory,
    xchangeOperationId:report.xchangeOperationId,xchangeDirectory:report.xchangeDirectory,
    source:report.source,original:report.original,workspaceIds:report.workspaceIds,
    catalog:report.catalog,supplier:report.supplier,customer:report.customer,files:report.files};
}
async function inspectNative(path,file,expected,profile){
  const products=[],suppliers=[],findings=[];let complete;
  for await(const event of readXChange(path,{expectedBytes:file.bytes,expectedSha256:file.sha256})){
    if(event.type==='product')products.push(event);
    else if(event.type==='supplier')suppliers.push(event);
    else if(event.type==='complete')complete=event;
  }
  assert.ok(complete);assert.equal(products.length,1);assert.equal(suppliers.length,1);
  assert.equal(complete.productCount,products.length);assert.equal(complete.supplierCount,suppliers.length);
  findings.push(...validateXChange(complete.header,{schema:XCHANGE_SCHEMA,numberTokens:complete.numberTokens,omit:['Supplier']}));
  for(const item of suppliers)findings.push(...validateXChange(item.header,{
    schema:XCHANGE_SUPPLIER_SCHEMA,numberTokens:item.numberTokens,omit:['Product']}));
  for(const item of products)findings.push(...validateXChange(item.product,{
    schema:XCHANGE_PRODUCT_SCHEMA,numberTokens:item.numberTokens}));
  assert.deepEqual(findings,[],'The complete native file must satisfy the original pinned publisher schema.');
  assert.deepEqual(products[0].product,expected.product);
  assert.deepEqual(products[0].numberTokens,expected.numberTokens);
  assert.deepEqual(suppliers[0].header,expected.supplier.header);
  assert.deepEqual(complete.header,profile.header?.value??expected.catalogue.header);
  return {bytes:complete.bytes,sha256:complete.sha256,products:products.length,
    tradeItems:products[0].product.TradeItem?.length??0,numberTokens:Object.keys(products[0].numberTokens).length,
    catalogueType:complete.header.CatalogueType,catalogueVersion:complete.header.CatalogueVersion};
}
async function pythonInspection(python,selected){
  const child=spawn(python,['-c',ARCHIVE_INSPECTOR],{stdio:['pipe','pipe','pipe'],shell:false});
  const stdout=[],stderr=[];let bytes=0,error=null,killer=null;
  const stop=problem=>{
    error??=problem;
    if(child.pid&&!child.killed)child.kill('SIGTERM');
    killer??=setTimeout(()=>{if(child.exitCode===null)child.kill('SIGKILL');},2000);
    killer.unref?.();
  };
  const timer=setTimeout(()=>stop(failure('TWO_BA_ARCHIVE_TIMEOUT','The original archive inspection exceeded 60 seconds.')),60000);
  timer.unref?.();
  const receive=(target,chunk)=>{
    bytes+=chunk.length;
    if(bytes>131072)stop(failure('TWO_BA_ARCHIVE_OUTPUT','The original archive inspection returned too much output.'));
    else target.push(chunk);
  };
  child.stdout.on('data',value=>receive(stdout,value));child.stderr.on('data',value=>receive(stderr,value));
  child.stdin.on('error',problem=>{if(problem.code!=='EPIPE')stop(problem);});
  try{
    const ended=new Promise(resolve=>{
      child.once('error',problem=>{error??=problem;});
      child.once('close',(code,signal)=>resolve({code,signal}));
    });
    child.stdin.end(json(selected));
    const result=await ended;
    if(error)throw error;
    assert.equal(result.code,0,Buffer.concat(stderr).toString('utf8')||'The original ZIP/XML inspection did not finish.');
    return JSON.parse(Buffer.concat(stdout).toString('utf8'));
  }finally{clearTimeout(timer);if(killer)clearTimeout(killer);}
}

const ARCHIVE_INSPECTOR=String.raw`import os,sys,json,stat,hashlib,zipfile,xml.etree.ElementTree as ET

selected=json.loads(sys.stdin.buffer.read(262145))
if len(json.dumps(selected).encode())>262144: raise ValueError("The archive selection is too large")
def identity(info): return (info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns,info.st_ctime_ns)
def original(item):
    fd=os.open(item["path"],os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    stream=os.fdopen(fd,"rb")
    before=os.fstat(stream.fileno())
    if not stat.S_ISREG(before.st_mode) or before.st_size!=item["bytes"]:
        stream.close();raise ValueError("The retained original file length changed")
    return stream,before
def verify_named(stream,before,item):
    after=os.fstat(stream.fileno());named=os.stat(item["path"],follow_symlinks=False)
    if not stat.S_ISREG(named.st_mode) or identity(before)!=identity(after) or identity(after)!=identity(named):
        raise ValueError("The retained original file changed while it was read")
def file_digest(stream,limit):
    h=hashlib.sha256();count=0
    while True:
        value=stream.read(min(65536,limit-count+1))
        if not value: break
        count+=len(value)
        if count>limit: raise ValueError("An archive member exceeds the selected length")
        h.update(value)
    if count!=limit: raise ValueError("An archive member ended before the selected length")
    return h.hexdigest()
archive,before=original(selected["archive"])
try:
    sha=file_digest(archive,selected["archive"]["bytes"])
    if sha!=selected["archive"]["sha256"]: raise ValueError("The full archive changed")
    archive.seek(0)
    members=[]
    with zipfile.ZipFile(archive,"r",allowZip64=True) as package:
        names=package.namelist()
        wanted=["parameters.xml",selected["native"]["name"]]
        if names!=wanted or package.comment: raise ValueError("Retain exactly the two original flat package members")
        for name,key in zip(wanted,["parameters","native"]):
            expected=selected[key]
            info=package.getinfo(name)
            if info.is_dir() or info.file_size!=expected["bytes"] or info.compress_type!=zipfile.ZIP_DEFLATED:
                raise ValueError("The selected complete compressed member changed")
            if info.flag_bits&1 or info.flag_bits&0x808!=0x808 or info.extract_version<45:
                raise ValueError("Use the original UTF-8 streaming ZIP64 member")
            with package.open(info,"r") as entry: observed=file_digest(entry,expected["bytes"])
            if observed!=expected["sha256"]: raise ValueError("The member differs from its separately retained native export")
            separate,initial=original(expected)
            try:
                if file_digest(separate,expected["bytes"])!=observed: raise ValueError("The separate original export changed")
                verify_named(separate,initial,expected)
            finally: separate.close()
            members.append({"name":name,"bytes":info.file_size,"sha256":observed,
                "compressedBytes":info.compress_size,"crc32":format(info.CRC,"08x")})
    verify_named(archive,before,selected["archive"])
finally: archive.close()
publisher,publisher_initial=original(selected["originalParameters"])
try:
    if publisher_initial.st_size>65536: raise ValueError("The publisher processing example exceeds 64 KiB")
    publisher_bytes=publisher.read(65537)
    if hashlib.sha256(publisher_bytes).hexdigest()!=selected["originalParameters"]["sha256"]:
        raise ValueError("The retained publisher processing example changed")
    publisher_root=ET.fromstring(publisher_bytes)
    namespace="{http://www.2ba.nl}"
    if publisher_root.tag!=namespace+"UCProcessParameters" or publisher_root.attrib:
        raise ValueError("The original downloaded publisher processing root changed")
    if [child.tag for child in publisher_root]!=[namespace+name for name in
            ["GeneratedBy","PackageDescription","SendReportToEmail","ReportLanguage"]]:
        raise ValueError("The original publisher example's case-sensitive element order changed")
    verify_named(publisher,publisher_initial,selected["originalParameters"])
finally: publisher.close()
xml_stream,initial=original(selected["parameters"])
try:
    if initial.st_size>65536: raise ValueError("The original processing XML exceeds 64 KiB")
    raw=xml_stream.read(65537)
    if b"<!DOCTYPE" in raw or b"<!ENTITY" in raw: raise ValueError("The original parameters XML has no document-type declarations")
    if hashlib.sha256(raw).hexdigest()!=selected["parameters"]["sha256"]: raise ValueError("The processing XML changed")
    root=ET.fromstring(raw)
    if root.tag!=namespace+"UCProcessParameters" or root.attrib: raise ValueError("Use the original 2BA processing root and namespace")
    expected=selected["processing"]
    if [entry.tag for entry in root]!=[namespace+name for name in selected["parameterOrder"] if name in expected]:
        raise ValueError("The original case-sensitive parameter selection or order changed")
    parsed={}
    for child in root:
        name=child.tag[len(namespace):]
        if child.attrib: raise ValueError("An ordinary parameter has unexpected attributes")
        if name=="InteractiveChecks":
            values=[]
            if child.text and child.text.strip(): raise ValueError("The check container has unexpected text")
            for check in child:
                if check.tag!=namespace+"Check" or list(check) or (check.text and check.text.strip()):
                    raise ValueError("The original interactive check changed")
                if set(check.attrib)!={"Code","SolutionId"}: raise ValueError("Retain both original interactive-check IDs")
                if check.tail and check.tail.strip(): raise ValueError("The check has unexpected trailing text")
                values.append(dict(check.attrib))
            if values!=expected[name]: raise ValueError("The selected original check IDs changed")
            parsed[name]=values
        else:
            if list(child): raise ValueError("A scalar original parameter has child elements")
            value=expected[name]
            text=("true" if value else "false") if isinstance(value,bool) else value
            if (child.text or "")!=text: raise ValueError("The XML parameter differs from the reviewed native selection")
            parsed[name]=value
        if child.tail and child.tail.strip(): raise ValueError("A parameter has unexpected trailing text")
    if root.text and root.text.strip(): raise ValueError("The processing root has unexpected text")
    verify_named(xml_stream,initial,selected["parameters"])
finally: xml_stream.close()
print(json.dumps({"schema":"stellar-forge.2ba-native-archive-inspection.v1",
    "runtime":{"python":sys.version.split()[0]},"archive":{"bytes":selected["archive"]["bytes"],"sha256":sha},
    "members":members,"root":"UCProcessParameters","namespace":namespace[1:-1],"parameters":parsed,
    "originalParameters":{"bytes":selected["originalParameters"]["bytes"],
        "sha256":selected["originalParameters"]["sha256"],"gitBlob":selected["originalParameters"]["gitBlob"]}},
    separators=(",",":")))
`;

/**
 * Receive both completed original xChange bundles into this operation's own stores.
 * Reuse all three directories and this operation ID after an interruption.
 */
export async function runTwoBaMaterialsReceiving({
  xchangeDirectory,materialsDirectory,directory,
  operationId='twoba-materials-2769',inputsDirectory=INPUTS,python='python3'
}={}){
  if([xchangeDirectory,materialsDirectory,directory,inputsDirectory,python].some(value=>typeof value!=='string'||!value)||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,50}$/.test(operationId))
    throw failure('TWO_BA_RECEIVING_INPUT','Select the two completed original operation directories, a new private receiving directory and one stable operation ID.');
  xchangeDirectory=resolve(xchangeDirectory);materialsDirectory=resolve(materialsDirectory);
  directory=resolve(directory);inputsDirectory=resolve(inputsDirectory);
  for(const a of [xchangeDirectory,materialsDirectory]){
    if(inside(a,directory)||inside(directory,a))
      throw failure('TWO_BA_RECEIVING_INPUT','Keep this receiving operation separate from both completed originals.');
    await existingDirectory(a);
  }
  assert.notEqual(xchangeDirectory,materialsDirectory);
  for(const format of FORMATS)assert.ok(SUPPLIER_EXPORT_FORMATS.includes(format),'The original product omits '+format+'.');
  await privateDirectory(directory);const control=join(directory,'control');await privateDirectory(control);
  const stateFile=join(control,'receiving-state.json'),reportFile=join(directory,'twoba-materials-native.json');
  const lease=await acquireStateLease(control);
  const selected={schema:SCHEMA,operationId,xchangeDirectory,materialsDirectory,directory,inputsDirectory,python};
  let state,server,primary,customer,environment,storageFault=null;
  const calls={};
  const save=async()=>{
    if(storageFault)throw storageFault;
    lease.assertHeld();state.updatedAt=new Date().toISOString();
    for(const[name,count]of Object.entries(calls)){state.observedTools[name]=(state.observedTools[name]??0)+count;delete calls[name];}
    try{await atomicBytes(stateFile,Buffer.from(json(state)));lease.assertHeld();}
    catch(error){storageFault=error;throw error;}
  };
  const step=async(name,action)=>{
    if(state.phases[name])return state.phases[name];
    const value=await action();state.phases[name]=value;await save();return value;
  };
  const mutate=async(client,key,method,prepare)=>{
    if(storageFault)throw storageFault;
    let request=state.requests[key];
    if(!request){
      const args=await prepare();
      request={method,args:{requestId:operationId+'-'+key,...args}};
      assert.equal(request.args.requestId,operationId+'-'+key);
      state.requests[key]=request;await save();
    }
    assert.equal(request.method,method);
    const result=await client[method](request.args);
    operationResult(result);assert.equal(result.id,request.args.requestId);
    const receipt={id:result.id,kind:result.kind,requestSha256:result.requestSha256,state:result.state};
    if(state.operations[key])assert.deepEqual(receipt,state.operations[key],'The original native request changed.');
    else{state.operations[key]=receipt;await save();}
    return result;
  };
  const connect=async alias=>{
    const transport=await openMerchantFileClient({url:server.url,environment});
    return createOpenSearchMaterialClient({workspace:alias,client:{endpoint:transport.endpoint,
      call:async(name,args,options)=>{
        const result=await transport.call(name,args,options);calls[name]=(calls[name]??0)+1;return result;
      }}});
  };
  const closeHost=async()=>{
    if(!server&&!primary&&!customer)return;
    const errors=[];
    if(customer){try{await customer.close();}catch(error){errors.push(error);}customer=null;}
    if(primary){try{await primary.close();}catch(error){errors.push(error);}primary=null;}
    if(server){try{await server.close();server=null;}catch(error){errors.push(error);}}
    if(errors.length)throw new AggregateError(errors,'The original 2BA MCP handles are still closing.');
    state.lifetimes={merchant:'CLOSED',producer:'CLOSED',receiver:'CLOSED'};
    if(!storageFault)await save();
  };
  try{
    state=await maybeJson(stateFile)??{...selected,startedAt:new Date().toISOString(),phases:{},requests:{},operations:{},
      observedTools:{},host:null,connection:null,lifetimes:{merchant:'CLOSED',producer:'CLOSED',receiver:'CLOSED'}};
    for(const[key,value]of Object.entries(selected))assert.deepEqual(state[key],value,'Continue the same complete receiving selection.');
    state.state='RUNNING';state.error=null;await save();
    const snapshot=async(name,inputPath,stable)=>{
      const currentBytes=await readBytes(inputPath),current=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(currentBytes));
      const target=join(control,name);let bytes;
      try{bytes=await readBytes(target);}catch(error){
        if(error.code!=='ENOENT')throw error;await retainedBytes(target,currentBytes);bytes=await readBytes(target);
      }
      const value=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));
      assert.deepEqual(stable(current),stable(value),'The original completed business/source selection changed.');
      return {value,receipt:await fileIdentity(target)};
    };
    const nativeSnapshot=await snapshot('original-xchange-report.json',join(xchangeDirectory,'xchange-delivery-native.json'),
      value=>({schema:value.schema,operationId:value.operationId,state:value.state,directory:value.directory,
        sourceFile:value.sourceFile,implementation:value.implementation,workspace:value.workspace,catalog:value.catalog,
        supplier:value.supplier,customer:value.customer,materialKeys:value.materialKeys,inputs:value.inputs,
        officialSource:value.officialSource,exports:value.exports,bundle:value.bundle,sourceCorrection:value.sourceCorrection}));
    const materialsSnapshot=await snapshot('original-materials-report.json',join(materialsDirectory,'xchange-materials-native.json'),unchangedOriginal);
    const journey=nativeSnapshot.value,originalReport=materialsSnapshot.value;
    assert.equal(journey.schema,'stellar-forge.xchange-delivery-native.v1');assert.equal(journey.state,'CLOSED');
    assert.equal(journey.directory,xchangeDirectory);
    assert.equal(originalReport.schema,'stellar-forge.xchange-materials-native-receiving.v1');assert.equal(originalReport.state,'CLOSED');
    assert.equal(originalReport.directory,materialsDirectory);assert.equal(originalReport.xchangeDirectory,xchangeDirectory);
    assert.equal(originalReport.xchangeOperationId,journey.operationId);
    assert.deepEqual(originalReport.catalog,journey.catalog);assert.deepEqual(originalReport.supplier,journey.supplier);
    assert.deepEqual(originalReport.original.customer,journey.customer);
    for(const lifetime of Object.values(originalReport.lifetimes))assert.equal(lifetime,'CLOSED');
    const originalFiles=[];
    for(const item of journey.exports){
      assert.equal(item.name,basename(item.name));
      originalFiles.push({...item,...await fileIdentity(join(xchangeDirectory,'exports',item.name),item)});
    }
    const originalSample=await fileIdentity(journey.inputs.officialSample.path,journey.inputs.officialSample);
    const originalSchema=await fileIdentity(journey.inputs.officialSchema.path,journey.inputs.officialSchema);
    originalFiles.push(originalSample,originalSchema);
    const readOriginalExport=async(group,workspaceId)=>{
      assert.ok(group&&inside(materialsDirectory,resolve(group.directory)));
      await existingDirectory(group.directory);
      const manifestPath=join(group.directory,'manifest.json'),bytes=await readBytes(manifestPath);
      assert.equal(hash(bytes),group.manifestSha256);
      const manifest=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));
      assert.equal(manifest.schema,'stellar-forge.opensearch-material-export.v1');
      assert.equal(manifest.exportId,group.exportId);assert.equal(manifest.workspaceId,workspaceId);
      const selected={exportId:manifest.exportId,manifest,manifestSha256:group.manifestSha256,
        manifestFile:{name:'manifest.json',bytes:bytes.length,sha256:hash(bytes)}};
      originalFiles.push(await fileIdentity(manifestPath,selected.manifestFile));
      for(const file of manifest.files){
        assert.equal(file.name,basename(file.name));
        originalFiles.push({...file,...await fileIdentity(join(group.directory,file.name),file)});
      }
      return {...selected,directory:group.directory};
    };
    const originalExports={
      producer:await readOriginalExport(originalReport.files.producerMaterials,originalReport.workspaceIds.producer),
      customer:await readOriginalExport(originalReport.files.customerMaterials,originalReport.workspaceIds.receiver)
    };
    await readOriginalExport(originalReport.files.producerXChange,originalReport.workspaceIds.producer);
    await readOriginalExport(originalReport.files.customerXChange,originalReport.workspaceIds.receiver);
    const originalBundles={};
    for(const[key,value]of Object.entries(originalExports)){
      const file=exportFile(value,'catalog-bundle.jsonl'),path=join(value.directory,file.name);
      originalBundles[key]={...file,path,content:await bundleContent(path,file)};
    }
    const originalConfig=await fileIdentity(journey.sourceFile,originalReport.original.artifacts.source);
    const sourceFile=join(control,'source.json');await retainedBytes(sourceFile,await readBytes(originalConfig.path));
    assert.equal((await fileIdentity(sourceFile)).sha256,originalConfig.sha256);
    const processingSource={...await fileIdentity(join(inputsDirectory,PARAMETERS_SOURCE.name),PARAMETERS_SOURCE),
      gitBlob:PARAMETERS_SOURCE.gitBlob};
    const referenceIndexPath=join(inputsDirectory,'2BA_RECEIVING_REFERENCES.json');
    const references=await readJson(referenceIndexPath),referenceFiles=[await fileIdentity(referenceIndexPath),processingSource];
    assert.equal(references.schema,'stellar-forge.2ba-receiving-references.v1');
    assert.ok(Array.isArray(references.modellingClasses));
    const released=[],known=new Set();
    for(const item of references.modellingClasses){
      assert.equal(item.file,basename(item.file));assert.ok(!['.','..'].includes(item.file));
      assert.ok(/^MC[0-9]{6}$/.test(item.code)&&/^[1-9][0-9]*$/.test(item.version));
      assert.ok(!known.has(item.code+':'+item.version));known.add(item.code+':'+item.version);
      const url=new URL(item.source.url);assert.ok(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password);
      referenceFiles.push(await fileIdentity(join(inputsDirectory,item.file),{bytes:item.bytes,sha256:item.source.sha256}));
      released.push({code:item.code,version:item.version,source:clone(item.source)});
    }
    assert.ok(!known.has('MC000023:5'),'The current original source does not establish this modelling version as released.');
    const modellingDecision=clone(references.modellingDecision);
    assert.equal(modellingDecision.action,'omit-unreleased-optional-modelling-fields');
    assert.equal(modellingDecision.code,'MC000023');assert.equal(modellingDecision.version,'5');
    assert.equal(modellingDecision.status,'Ready for publication');assert.equal(modellingDecision.release,'Dynamic');
    assert.deepEqual(modellingDecision.paths,[...MODELLING_PATHS]);
    assert.equal(modellingDecision.originalNumberTokens,38);assert.equal(modellingDecision.deliveredNumberTokens,33);
    assert.ok(typeof modellingDecision.reason==='string'&&modellingDecision.reason.length>20);
    assert.equal(modellingDecision.source.url,'https://viewer.etim-international.com/class/MC000023?lang=en-GB');
    assert.equal(modellingDecision.file,basename(modellingDecision.file));
    assert.ok(!['.','..'].includes(modellingDecision.file));
    referenceFiles.push(await fileIdentity(join(inputsDirectory,modellingDecision.file),{
      bytes:modellingDecision.bytes,sha256:modellingDecision.source.sha256}));
    const historical=modellingDecision.historicalSource;
    assert.equal(historical.file,basename(historical.file));assert.ok(!['.','..'].includes(historical.file));
    referenceFiles.push(await fileIdentity(join(inputsDirectory,historical.file),historical));
    const original={reports:{xchange:nativeSnapshot.receipt,materials:materialsSnapshot.receipt},
      originalOperations:{xchange:journey.operationId,materials:originalReport.operationId},catalog:journey.catalog,
      supplier:journey.supplier,customer:journey.customer,source:originalConfig,
      bundles:originalBundles,artifacts:originalFiles,references:referenceFiles,releasedModellingClasses:released,modellingDecision};
    if(state.original)assert.deepEqual(state.original,original,'The retained original complete input changed.');
    else{state.original=original;await save();}
    const sourceConfig=await readJson(sourceFile);
    assert.ok(/^[A-Z_][A-Z0-9_]{0,127}$/.test(sourceConfig.endpointEnv));
    environment={...process.env,[sourceConfig.endpointEnv]:'http://127.0.0.1:9200',
      MCP_ACCESS_TOKEN:randomBytes(32).toString('hex'),MCP_CLIENT_ORIGINS:''};
    delete environment.MCP_OAUTH_CONFIG;
    const workspaces={producer:join(directory,'producer'),customer:join(directory,'customer')};
    const downloadsRoot=join(directory,'downloads');await privateDirectory(downloadsRoot);
    const connectionPath=join(control,'opensearch-connection.json');
    const declared=file=>({path:file.path,name:file.name,bytes:file.bytes,sha256:file.sha256});
    const connectionFor=extra=>({schema:'stellar-forge.opensearch-workspace-connection.v1',workspaces:{
      [PRIMARY]:{label:'Received original xChange supplier',directory:workspaces.producer,sourceFile,
        materialInputs:{[ORIGINAL_INPUT]:declared(originalBundles.producer)}},
      [CUSTOMER]:{label:'Received original xChange customer',directory:workspaces.customer,sourceFile,
        materialInputs:{[CUSTOMER_INPUT]:declared(originalBundles.customer),
          [ORIGINAL_INPUT]:declared(originalBundles.producer),...(extra?{[PACKAGE_INPUT]:extra}:{})}}
    }});
    const installConnection=async value=>{
      const bytes=Buffer.from(json(value)),sha256=hash(bytes);
      if(!state.connection||state.connection.sha256!==sha256){
        assert.ok(!server,'Close the original merchant before selecting another retained input.');
        if(state.connectionIntent)assert.deepEqual(state.connectionIntent.value,value);
        else{state.connectionIntent={sha256,previousSha256:state.connection?.sha256??null,value};await save();}
      }
      const intent=state.connectionIntent??{sha256,previousSha256:sha256,value};
      assert.equal(intent.sha256,sha256);
      let previous=null;try{previous=await readBytes(connectionPath);}catch(error){if(error.code!=='ENOENT')throw error;}
      if(previous)assert.ok(hash(previous)===sha256||hash(previous)===intent.previousSha256);
      else assert.equal(intent.previousSha256,null,'The original private connection disappeared.');
      if(!previous||hash(previous)!==sha256)await atomicBytes(connectionPath,bytes);
      state.connection={path:connectionPath,sha256};delete state.connectionIntent;await save();
    };
    await installConnection(state.connectionIntent?.value??connectionFor(state.bundleInput));
    if(!state.host){
      let choice=state.hostInitialization,usable=false;
      if(choice){
        try{
          const raw=await readJson(choice.configuration);assert.equal(raw.opensearchWorkspaceConnection,connectionPath);
          await readMerchantConfig(choice.configuration);usable=true;
        }catch(error){if(error.code!=='ENOENT')throw error;}
      }
      if(!usable){
        const hostDirectory=join(directory,'merchant-'+randomUUID());
        choice={directory:hostDirectory,configuration:join(hostDirectory,'merchant-mcp.json')};
        state.hostInitialization=choice;await save();
        await initializeOpenSearchWorkspaceMerchant({directory:hostDirectory,connection:connectionPath,name:'2BA supplier package receiving'});
      }
      state.host={...choice,configurationSha256:hash(await readBytes(choice.configuration))};await save();
    }
    assert.equal(hash(await readBytes(state.host.configuration)),state.host.configurationSha256);
    const startHost=async()=>{
      assert.ok(!server);
      server=await startMerchantMcp({configPath:state.host.configuration,port:state.port??0,environment});
      const port=Number(new URL(server.url).port);
      if(state.port!==undefined)assert.equal(port,state.port,'Resume native downloads at the same retained endpoint.');
      else{state.port=port;await save();}
      const advertised=new Set(server.operator.tools.map(tool=>tool.name));
      for(const name of openSearchMaterialTools(value=>value))assert.ok(advertised.has(name),'The current product omitted '+name+'.');
      primary=await connect(PRIMARY);await primary.open();customer=await connect(CUSTOMER);await customer.open();
      state.lifetimes={merchant:'OPEN',producer:'OPEN',receiver:'OPEN'};await save();
    };
    await startHost();
    const inspectRows=async(client,review)=>{
      const pages=await allPages(client,'supplierRecipientRows',{reviewId:review.id,limit:1});
      assert.ok(pages.length);const rows=rowsOf(pages);assert.equal(rows.length,pages[0].total);
      assert.equal(pages.at(-1).nextOffset,null);
      const root=createHash('sha256');
      for(const page of pages){
        assert.equal(page.reviewSha256,review.sha256);assert.equal(page.reviewId,review.id);
        assert.deepEqual(page.recipient,review.recipient);
      }
      for(const row of rows){
        sealed(row);assert.equal(row.reviewId,review.id);
        assert.equal(row.beforeSha256,row.before===null?null:digest(row.before));
        assert.equal(row.afterSha256,row.after===null?null:digest(row.after));
        root.update(row.kind+':'+row.key+':'+row.sha256+'\n');
      }
      assert.equal(root.digest('hex'),review.recipient.rowsRootSha256);
      return rows;
    };
    const importOriginal=async(client,key,input)=>operationResult(await mutate(client,key,'materialReceive',()=>({inputId:input})));
    await step('import_complete_original_supplier_and_customer_bundles',async()=>{
      const producer=await importOriginal(primary,'original-producer',ORIGINAL_INPUT);
      const receiver=await importOriginal(customer,'original-customer',CUSTOMER_INPUT);
      return {producer,customer:receiver,sourceBundles:{producer:originalBundles.producer.sha256,customer:originalBundles.customer.sha256}};
    });
    const baseline=await step('retain_original_catalog_corrections_and_recipient_history',async()=>{
      const producerStatus=await primary.status(),customerStatus=await customer.status();
      assert.notEqual(producerStatus.workspaceId,originalReport.workspaceIds.producer);
      assert.notEqual(customerStatus.workspaceId,originalReport.workspaceIds.receiver);
      assert.notEqual(producerStatus.workspaceId,customerStatus.workspaceId);
      const catalog=await primary.materialCatalog({catalogId:journey.catalog.id});
      assert.equal(catalog.revision,journey.catalog.revision);assert.equal(catalog.activeEditionId,journey.catalog.editionId);
      const producerPlan=await primary.supplierPlan({planId:journey.supplier.planId});
      const producerReview=await primary.supplierReviewGet({reviewId:journey.supplier.reviewId});
      assert.equal(producerReview.sha256,journey.supplier.reviewSha256);assert.equal(producerPlan.profile.target,'xchange-2.0');
      const customerPlan=await customer.supplierPlan({planId:journey.customer.planId});
      const customerReview=await customer.supplierReviewGet({reviewId:journey.customer.reviewId});
      const customerCorrection=await customer.supplierCorrectionGet({correctionId:journey.customer.correctionId});
      assert.equal(customerReview.sha256,journey.customer.reviewSha256);
      assert.equal(customerCorrection.revision,journey.customer.correctionRevision);
      const materialKeys=[...journey.materialKeys].sort();assert.equal(materialKeys.length,1);
      const originalProduct=await primary.supplierProduct({planId:producerPlan.id,materialKey:materialKeys[0]});
      assert.ok(originalProduct.correctionApplicable);
      assert.equal(originalProduct.product.xChange.product.ProductIdentification.ManufacturerProductNumber,'04011969');
      assert.equal(originalProduct.product.xChange.product.TradeItem[0].ItemIdentification.SupplierItemNumber,'221099');
      assert.equal(Object.keys(originalProduct.product.xChange.numberTokens).length,38);
      const histories={producer:{},customer:{}};
      for(const[side,client]of [['producer',primary],['customer',customer]])for(const collection of ['plans','reviews','corrections']){
        const rows=rowsOf(await allPages(client,'supplierList',{collection,catalogId:catalog.id,limit:2}));
        histories[side][collection]=rows.map(value=>({id:value.id,revision:value.revision??null,sha256:value.sha256}));
      }
      const template=await primary.supplierTemplates({target:'2ba-xchange-2.0'});
      assert.equal(template.profile.target,'2ba-xchange-2.0');assert.ok(template.bindings['/xChange']);
      return {workspaceIds:{producer:producerStatus.workspaceId,customer:customerStatus.workspaceId},
        catalog,materialKeys,originalProduct,template,histories,
        producer:{plan:producerPlan,review:producerReview,rows:await inspectRows(primary,producerReview)},
        customer:{plan:customerPlan,review:customerReview,correction:customerCorrection,rows:await inspectRows(customer,customerReview)}};
    });
    const assertLegacy=async()=>{
      assert.deepEqual(await primary.supplierPlan({planId:baseline.producer.plan.id}),baseline.producer.plan);
      assert.deepEqual(await primary.supplierReviewGet({reviewId:baseline.producer.review.id}),baseline.producer.review);
      assert.deepEqual(await customer.supplierPlan({planId:baseline.customer.plan.id}),baseline.customer.plan);
      assert.deepEqual(await customer.supplierCorrectionGet({correctionId:baseline.customer.correction.id}),baseline.customer.correction);
      assert.deepEqual(await customer.supplierReviewGet({reviewId:baseline.customer.review.id}),baseline.customer.review);
      assert.deepEqual(await inspectRows(customer,baseline.customer.review),baseline.customer.rows);
    };

    const download=async(client,selection,path,options={})=>{
      const value=await client.downloadExport({exportId:selection.exportId,directory:path,
        expectedManifestSha256:selection.manifestSha256,chunkSize:16384,...options});
      assert.equal(value.state,'COMPLETE');assert.equal(value.files,selection.manifest.files.length);
      assert.equal(value.manifestSha256,selection.manifestSha256);
      const files=[await fileIdentity(join(path,'manifest.json'),selection.manifestFile)];
      for(const file of selection.manifest.files)files.push({...file,...await fileIdentity(join(path,file.name),file)});
      return {...value,artifacts:files};
    };
    const exportSelection=async(client,key,review,formats)=> {
      const selection=operationResult(await mutate(client,key,'supplierExport',()=>({
        reviewId:review.id,expectedReviewSha256:review.sha256,formats
      })));
      assertFormats(selection,formats);
      const readback=await client.inspectExport(selection.exportId);
      assert.deepEqual(readback.manifest,selection.manifest);assert.equal(readback.manifestSha256,selection.manifestSha256);
      return selection;
    };
    const inspectPackage=async(selection,path,review,message)=>{
      const archive=exportFile(selection,'2ba.zip'),parameters=exportFile(selection,'parameters.xml'),
        native=exportFile(selection,'xchange.json');
      assert.equal(archive.name,'ETIM_XCHANGE_'+review.id+'_2BA.zip');
      assert.equal(parameters.name,'parameters.xml');
      assert.equal(native.name,'ETIM_XCHANGE_'+review.id+'_'+review.recipient.header.CatalogueType+'.json');
      const result=await pythonInspection(python,{
        archive:{...archive,path:join(path,archive.name)},
        parameters:{...parameters,path:join(path,parameters.name)},
        native:{...native,path:join(path,native.name)},
        processing:review.plan.profile.processing.parameters,parameterOrder:[...TWO_BA_PARAMETER_NAMES],
        originalParameters:processingSource
      });
      assert.deepEqual(result.parameters,review.plan.profile.processing.parameters);
      assert.equal(result.members.length,2);assert.equal(result.members[1].sha256,native.sha256);
      const document=await inspectNative(join(path,native.name),native,message,review.plan.profile);
      return {archive:result,native:document};
    };
    const originalMessage=baseline.originalProduct.product.xChange;
    const modellingCorrection=omitUnreleasedModelling(originalMessage,modellingDecision);
    const baseProfile={...clone(baseline.template.profile),
      id:'etim-xchange-2ba-processing',header:clone(baseline.producer.plan.profile.header),
      supplierHeaders:clone(baseline.producer.plan.profile.supplierHeaders),
      releasedModellingClasses:clone(released),
      attachmentPolicy:{keepMimeUrlCodes:[...new Set((originalMessage.product.ProductAttachments??[])
        .map(value=>value.AttachmentTypeSpecification).filter(Boolean))].sort()}};
    const defaultParameters={GeneratedBy:'TokenJunkieLabs Starforge',ReportLanguage:'EN',
      SkipLoadProducts:false,SkipLoadArticlesAndPrices:false,SkipLoadPrices:false,SkipLoadAttachments:false,
      InteractiveChecks:[{Code:'7000160',SolutionId:'106'},{Code:'7000161',SolutionId:'166'}],
      OverrulePackageMutationCode:false,AutoConvertToMasterGLN:false};
    const sourceReview=await step('review_original_modelling_source_before_reasoned_correction',async()=>{
      const reason='Review the complete received original product against the current publisher modelling-class status before changing its optional delivery fields.';
      const profile={...clone(baseProfile),processing:{schema:'stellar-forge.2ba-processing.v1',reason,
        parameters:{...clone(defaultParameters),PackageDescription:'Original ETIM source & modelling review'}}};
      const plan=operationResult(await mutate(primary,'original-modelling-plan','supplierSave',()=>({
        catalogId:baseline.catalog.id,editionId:baseline.catalog.activeEditionId,
        title:'Original ETIM 2BA package receiving',profile,bindings:baseline.template.bindings,previousReviewId:null
      })),'supplierPlan');
      const correction=operationResult(await mutate(primary,'original-modelling-product','supplierCorrection',async()=>{
        const current=await primary.supplierProduct({planId:plan.id,materialKey:baseline.materialKeys[0]});
        return {planId:plan.id,expectedPlanRevision:plan.revision,materialKey:current.material.key,
          expectedMaterialSha256:current.material.sha256,expectedBaseProductSha256:current.baseProductSha256,
          expectedRevision:current.correction?.revision??0,patches:[{path:'/xChange',value:clone(originalMessage),
            reason:reason+' Retain the original URI correction and every one of the38 original numeric tokens.'}]};
      }),'supplierCorrection');
      const review=operationResult(await mutate(primary,'original-modelling-review','supplierReview',()=>({
        planId:plan.id,expectedRevision:plan.revision
      })),'supplierReview');
      const row=await primary.supplierRow({reviewId:review.id,materialKey:baseline.materialKeys[0]});
      assert.deepEqual(row.product.xChange,originalMessage);
      const errors=row.findings.filter(value=>value.severity==='error');
      assert.ok(errors.length>0&&errors.every(value=>value.code==='TWO_BA_MODELLING_RELEASE'));
      assert.equal(review.counts.errors,errors.length);
      assert.ok(review.findings.some(value=>value.code==='TWO_BA_MODELLING_RELEASE'));
      const selection=await exportSelection(primary,'original-modelling-diagnostics',review,
        ['review.json','issues.csv','products.jsonl','parameters.xml']);
      const files=await download(primary,selection,join(downloadsRoot,'original-modelling-review'));
      await assertLegacy();
      return {plan,correction,review,row,rows:await inspectRows(primary,review),
        decision:modellingDecision,correctionSelection:modellingCorrection,
        export:selection,download:files};
    });
    const variants=[
      {key:'complete',title:'Complete original product and trade item',parameters:{},message:{},
        reason:'Apply the current publisher-bound omission of the optional unreleased modelling fields; retain ordinary ETIM classification, the original corrected URI and all33 remaining numeric tokens.'},
      {key:'retention',title:'Retain prices and omitted product attachments',parameters:{SkipLoadPrices:true},
        message:{omitAttachments:true,omitPrices:true},
        reason:'This explicit delivery selection omits the existing attachment and Pricing subtrees. Keep the previous attachment references and prices under the original 2BA controls.'},
      {key:'trade-only',title:'Trade item refresh with the product lane skipped',parameters:{SkipLoadProducts:true},message:{},
        reason:'Process the original complete trade item while preserving the previous product exactly through SkipLoadProducts.'},
      {key:'product-only',title:'Product refresh with trade items and attachments retained',
        parameters:{SkipLoadArticlesAndPrices:true,SkipLoadAttachments:true},message:{omitAttachments:true},
        reason:'Process the original product fields while retaining the previous complete trade item and product attachments through the selected skip controls.'},
      {key:'override',title:'Explicit mutation processing with both data lanes skipped',
        parameters:{SkipLoadProducts:true,SkipLoadArticlesAndPrices:true,OverrulePackageMutationCode:true,
          PackageMutationCode:'UpdateExistingCatalog'},message:{},
        reason:'Keep the native FULL header and full source message. Select the original UpdateExistingCatalog processing method while explicitly preserving both previous business-data lanes.'},
      {key:'ready',title:'Complete reviewed 2BA customer package',parameters:{},message:{},
        reason:'Restore the complete original product, attachment and trade-item content for the final customer package with both import lanes enabled.'}
    ];
    const versions=[];let previous=null;
    for(const variant of variants){
      const current=await step('processing_'+variant.key,async()=>{
        const message=productMessage(modellingCorrection.message,variant.message);
        const processing={schema:'stellar-forge.2ba-processing.v1',reason:variant.reason,
          parameters:{...clone(defaultParameters),PackageDescription:variant.title+' & ETIM source',...clone(variant.parameters)}};
        const profile={...clone(baseProfile),processing};
        const plan=operationResult(await mutate(primary,'plan-'+variant.key,'supplierSave',()=>({
          planId:(previous?.plan??sourceReview.plan).id,expectedRevision:(previous?.plan??sourceReview.plan).revision,
          catalogId:baseline.catalog.id,editionId:baseline.catalog.activeEditionId,
          title:'Original ETIM 2BA package receiving',profile,bindings:baseline.template.bindings,
          previousReviewId:previous?.review.id??null
        })),'supplierPlan');
        const correction=operationResult(await mutate(primary,'correction-'+variant.key,'supplierCorrection',async()=>{
          const current=await primary.supplierProduct({planId:plan.id,materialKey:baseline.materialKeys[0]});
          assert.equal(current.material.sha256,baseline.originalProduct.material.sha256);
          return {planId:plan.id,expectedPlanRevision:plan.revision,materialKey:current.material.key,
            expectedMaterialSha256:current.material.sha256,expectedBaseProductSha256:current.baseProductSha256,
            expectedRevision:current.correction?.revision??0,patches:[{path:'/xChange',value:message,
              reason:modellingDecision.reason+' '+variant.reason+' The complete original source remains in its retained material and pre-correction review.'}]};
        }),'supplierCorrection');
        const review=operationResult(await mutate(primary,'review-'+variant.key,'supplierReview',()=>({
          planId:plan.id,expectedRevision:plan.revision
        })),'supplierReview');
        assert.equal(review.counts.errors,0,JSON.stringify(review.findings));assert.equal(review.counts.total,1);
        assert.equal(review.plan.profile.target,'2ba-xchange-2.0');
        assert.deepEqual(review.plan.profile.processing,plan.profile.processing);
        assert.equal(review.recipient.header.CatalogueType,'FULL');
        assert.equal(review.recipient.processing.nativeCatalogueType,'FULL');
        assert.deepEqual(review.recipient.header,baseline.producer.review.recipient.header);
        assert.deepEqual(review.recipient.processing.parameters,plan.profile.processing.parameters);
        assert.equal(review.recipient.processing.masterGln,'original-supplier');
        assert.equal(review.recipient.catalogueType,variant.key==='override'?'CHANGE':'FULL');
        assert.equal(review.recipient.processing.effectiveCatalogueType,review.recipient.catalogueType);
        assert.equal(review.recipient.previousReviewId,previous?.review.id??null);
        const rows=await inspectRows(primary,review),product=rows.find(value=>value.kind==='product'),
          trade=rows.find(value=>value.kind==='tradeItem');
        assert.equal(rows.length,2);assert.ok(product&&trade);
        const oldProduct=previous?.rows.find(value=>value.kind==='product'),oldTrade=previous?.rows.find(value=>value.kind==='tradeItem');
        if(plan.profile.processing.parameters.SkipLoadProducts){
          assert.equal(product.action,'skipped');assert.deepEqual(product.after,oldProduct.after);
          assert.equal(product.processing.applied,false);assert.equal(product.processing.parameter,'SkipLoadProducts');
          assert.equal(review.recipient.counts.productsSkipped,1);
        }else{
          assert.equal(product.processing.applied,true);assert.equal(review.recipient.counts.productsSkipped,0);
          if(variant.message.omitAttachments){
            assert.ok(!Object.hasOwn(message.product,'ProductAttachments'));
            assert.deepEqual(product.after.product.ProductAttachments,oldProduct.after.product.ProductAttachments);
          }else assert.deepEqual(product.after.product.ProductAttachments,originalMessage.product.ProductAttachments);
        }
        if(plan.profile.processing.parameters.SkipLoadArticlesAndPrices){
          assert.equal(trade.action,'skipped');assert.deepEqual(trade.after,oldTrade.after);
          assert.equal(trade.processing.applied,false);assert.equal(trade.processing.parameter,'SkipLoadArticlesAndPrices');
          assert.equal(review.recipient.counts.tradeItemsSkipped,1);
        }else{
          assert.equal(trade.processing.applied,true);assert.equal(review.recipient.counts.tradeItemsSkipped,0);
          if(variant.message.omitPrices){
            assert.ok(!Object.hasOwn(message.product.TradeItem[0],'Pricing'));
            assert.deepEqual(trade.after.item.Pricing,oldTrade.after.item.Pricing);
            assert.equal(trade.processing.retainedFields.prices,'retained-previous');
          }else assert.deepEqual(trade.after.item.Pricing,originalMessage.product.TradeItem[0].Pricing);
        }
        const skipped=rows.filter(value=>value.action==='skipped');
        const filtered=rowsOf(await allPages(primary,'supplierRecipientRows',{reviewId:review.id,change:'skipped',limit:1}));
        assert.deepEqual(filtered,skipped);
        const formats=variant.key==='ready'?[...FORMATS]:['parameters.xml','xchange.json','2ba.zip'];
        const selection=await exportSelection(primary,'export-'+variant.key,review,formats);
        const path=join(downloadsRoot,variant.key);
        if(variant.key==='ready'&&!state.archiveInterruption?.observed){
          const archive=exportFile(selection,'2ba.zip');assert.ok(archive.bytes>512);
          state.archiveInterruption={armed:true,observed:false,exportId:selection.exportId,file:archive.name};await save();
          let interrupted=false;
          try{
            await download(primary,selection,path,{chunkSize:512,onProgress:async progress=>{
              if(progress.file===archive.name&&progress.bytes>0&&progress.bytes<progress.total){
                state.archiveInterruption={armed:false,observed:true,exportId:progress.exportId,
                  file:progress.file,bytes:progress.bytes,total:progress.total};await save();
                throw failure('TWO_BA_DOWNLOAD_INTERRUPTED','Resume the original 2BA package from its verified nonfinal prefix.');
              }
            }});
          }catch(error){if(error.code!=='TWO_BA_DOWNLOAD_INTERRUPTED')throw error;interrupted=true;}
          assert.ok(interrupted,'Retain one actual nonfinal archive prefix.');await closeHost();await startHost();
        }
        const files=await download(primary,selection,path,{chunkSize:512});
        if(variant.key==='ready'){
          assert.ok(state.archiveInterruption?.observed);assert.ok(files.resumed&&files.resumedBytes>0);
        }
        const inspected=await inspectPackage(selection,path,review,message);
        await assertLegacy();
        return {key:variant.key,reason:variant.reason,plan,correction,review,rows,message,
          export:selection,download:files,inspection:inspected};
      });
      versions.push(current);previous=current;
    }
    const ready=versions.at(-1);
    const producerMaterial=await step('complete_processing_history_and_native_catalog_bundle',async()=>{
      const value=operationResult(await mutate(primary,'package-bundle','materialExport',()=>({
        catalogId:baseline.catalog.id,expectedCatalogRevision:baseline.catalog.revision,
        editionId:baseline.catalog.activeEditionId,index:'twoba-reviewed-materials',formats:[...MATERIAL_EXPORT_FORMATS]
      })));
      assertFormats(value,MATERIAL_EXPORT_FORMATS);
      const files=await download(primary,value,join(downloadsRoot,'producer-catalog'));
      const descriptor=exportFile(value,'catalog-bundle.jsonl');
      const content=await bundleContent(join(files.directory,descriptor.name),descriptor);
      assert.equal(content.rows.catalog_supplier_reviews,originalBundles.producer.content.rows.catalog_supplier_reviews+versions.length+1,
        'The portable package must retain every original and new immutable review.');
      assert.equal(content.rows.catalog_supplier_plan_history,originalBundles.producer.content.rows.catalog_supplier_plan_history+versions.length+1);
      assert.equal(content.rows.catalog_supplier_correction_history,originalBundles.producer.content.rows.catalog_supplier_correction_history+versions.length+1);
      return {...value,download:files,content};
    });
    const portable=exportFile(producerMaterial,'catalog-bundle.jsonl');
    const bundleInput={...portable,path:join(producerMaterial.download.directory,portable.name)};
    const inputDescriptor=declared(bundleInput);
    if(state.bundleInput)assert.deepEqual(state.bundleInput,inputDescriptor);
    else{state.bundleInput=inputDescriptor;await save();}
    if(state.connection.sha256!==hash(Buffer.from(json(connectionFor(inputDescriptor))))){
      await closeHost();await installConnection(connectionFor(inputDescriptor));await startHost();
    }
    const adopted=await step('customer_adopts_complete_2ba_package',async()=>{
      await assertLegacy();
      const operation=await mutate(customer,'receive-package','materialReceive',()=>({inputId:PACKAGE_INPUT}));
      assert.deepEqual(await customer.supplierPlan({planId:sourceReview.plan.id,revision:sourceReview.plan.revision}),sourceReview.plan);
      assert.deepEqual(await customer.supplierCorrectionGet({correctionId:sourceReview.correction.id,
        revision:sourceReview.correction.revision}),sourceReview.correction);
      assert.deepEqual(await customer.supplierReviewGet({reviewId:sourceReview.review.id}),sourceReview.review);
      assert.deepEqual(await inspectRows(customer,sourceReview.review),sourceReview.rows);
      for(const version of versions){
        assert.deepEqual(await customer.supplierPlan({planId:version.plan.id,revision:version.plan.revision}),version.plan);
        assert.deepEqual(await customer.supplierReviewGet({reviewId:version.review.id}),version.review);
        assert.deepEqual(await inspectRows(customer,version.review),version.rows);
      }
      assert.deepEqual(await customer.supplierCorrectionGet({correctionId:ready.correction.id}),ready.correction);
      await assertLegacy();
      return {operation:state.operations['receive-package'],planId:ready.plan.id,reviewId:ready.review.id,
        reviewSha256:ready.review.sha256,sourceReviewId:sourceReview.review.id,versions:versions.length+1,
        recipientRows:versions.reduce((n,value)=>n+value.rows.length,sourceReview.rows.length)};
    });
    const customerWork=await step('customer_confirms_original_fields_and_processing_selection',async()=>{
      const profile=clone(ready.plan.profile);
      profile.processing.reason='The receiving operator confirmed the original complete fields and the English processing report for this customer package.';
      profile.processing.parameters.PackageDescription='Received ETIM product & trade-item package';
      const plan=operationResult(await mutate(customer,'customer-plan','supplierSave',()=>({
        planId:ready.plan.id,expectedRevision:ready.plan.revision,catalogId:baseline.catalog.id,
        editionId:baseline.catalog.activeEditionId,title:'Received original ETIM 2BA package',
        profile,bindings:ready.plan.bindings,previousReviewId:ready.review.id
      })),'supplierPlan');
      const correction=operationResult(await mutate(customer,'customer-correction','supplierCorrection',async()=>{
        const current=await customer.supplierProduct({planId:plan.id,materialKey:baseline.materialKeys[0]});
        assert.equal(current.correction.id,ready.correction.id);assert.equal(current.correction.revision,ready.correction.revision);
        assert.deepEqual(current.product.xChange,ready.message);
        assert.equal(current.product.xChange.numberTokens['/ProductDetails/WarrantyConsumer'],'24');
        assert.equal(Object.keys(current.product.xChange.numberTokens).length,33);
        return {planId:plan.id,expectedPlanRevision:plan.revision,materialKey:current.material.key,
          expectedMaterialSha256:current.material.sha256,expectedBaseProductSha256:current.baseProductSha256,
          expectedRevision:current.correction.revision,patches:[{path:'/xChange',value:clone(current.product.xChange),
            reason:'The receiving operator confirmed the original 24-month consumer warranty, the33 unchanged native numeric tokens and all other original product, attachment and trade-item fields after the source-bound optional modelling omission. The complete original38-token product remains in the original material and pre-correction review.'}]};
      }),'supplierCorrection');
      const review=operationResult(await mutate(customer,'customer-review','supplierReview',()=>({
        planId:plan.id,expectedRevision:plan.revision
      })),'supplierReview');
      assert.equal(review.counts.errors,0);assert.equal(plan.revision,ready.plan.revision+1);
      assert.equal(correction.revision,ready.correction.revision+1);
      const rows=await inspectRows(customer,review);
      for(const row of rows)assert.equal(row.action,'unchanged');
      await assertLegacy();
      return {plan,correction,review,rows,message:ready.message};
    });
    const assertCustomer=async()=>{
      assert.deepEqual(await customer.supplierPlan({planId:customerWork.plan.id}),customerWork.plan);
      assert.deepEqual(await customer.supplierCorrectionGet({correctionId:customerWork.correction.id}),customerWork.correction);
      assert.deepEqual(await customer.supplierReviewGet({reviewId:customerWork.review.id}),customerWork.review);
      assert.deepEqual(await inspectRows(customer,customerWork.review),customerWork.rows);
      await assertLegacy();
    };
    const replay=await step('older_package_replay_preserves_newer_customer_work',async()=>{
      await assertCustomer();
      const same=await customer.materialReceive(state.requests['receive-package'].args);
      assert.equal(same.id,adopted.operation.id);assert.equal(same.requestSha256,adopted.operation.requestSha256);
      operationResult(same);
      await mutate(customer,'original-after-package','materialReceive',()=>({inputId:ORIGINAL_INPUT}));
      await mutate(customer,'customer-original-again','materialReceive',()=>({inputId:CUSTOMER_INPUT}));
      await assertCustomer();
      return {retainedOperationId:same.id,planId:customerWork.plan.id,planRevision:customerWork.plan.revision,
        correctionId:customerWork.correction.id,correctionRevision:customerWork.correction.revision,
        reviewId:customerWork.review.id,reviewSha256:customerWork.review.sha256,
        legacyCorrectionId:baseline.customer.correction.id,legacyCorrectionRevision:baseline.customer.correction.revision};
    });

    const customerExports=await step('customer_complete_package_from_installed_typed_cli',async()=>{
      const requestPath=join(control,'customer-supplier-export.json'),output=[],progress=[];
      const stdout={write(value){output.push(String(value));return true;}},
        stderr={write(value){progress.push(String(value));return true;}};
      const cliClient={supplierExport:async args=>{
        await retainedBytes(requestPath,json(args));output.length=0;
        const result=await runOpenSearchMaterialCLI(['supplier-export','--url',server.url,'--workspace',CUSTOMER,
          '--input',requestPath,'--timeout-ms','60000'],{environment,stdout,stderr});
        assert.deepEqual(JSON.parse(output.join('')),result);return result;
      }};
      const supplier=operationResult(await mutate(cliClient,'customer-package-export','supplierExport',()=>({
        reviewId:customerWork.review.id,expectedReviewSha256:customerWork.review.sha256,formats:[...FORMATS]
      })));
      assertFormats(supplier,FORMATS);output.length=0;
      const path=join(downloadsRoot,'customer-package');
      const downloaded=await runOpenSearchMaterialCLI(['download-export','--url',server.url,'--workspace',CUSTOMER,
        '--export-id',supplier.exportId,'--directory',path,'--expected-manifest-sha256',supplier.manifestSha256,
        '--chunk-size','512','--timeout-ms','60000'],{environment,stdout,stderr});
      assert.equal(downloaded.state,'COMPLETE');assert.equal(downloaded.files,FORMATS.length);
      assert.deepEqual(JSON.parse(output.join('')),downloaded);
      const files=await download(customer,supplier,path,{chunkSize:512});assert.ok(files.resumed);
      const inspection=await inspectPackage(supplier,path,customerWork.review,customerWork.message);
      const material=operationResult(await mutate(customer,'customer-complete-bundle','materialExport',()=>({
        catalogId:baseline.catalog.id,expectedCatalogRevision:baseline.catalog.revision,
        editionId:baseline.catalog.activeEditionId,index:'twoba-received-materials',formats:[...MATERIAL_EXPORT_FORMATS]
      })));
      assertFormats(material,MATERIAL_EXPORT_FORMATS);
      const materialFiles=await download(customer,material,join(downloadsRoot,'customer-catalog'));
      const bundle=exportFile(material,'catalog-bundle.jsonl');
      const content=await bundleContent(join(materialFiles.directory,bundle.name),bundle);
      assert.ok(content.rows.catalog_supplier_reviews>producerMaterial.content.rows.catalog_supplier_reviews);
      const recipientFile=exportFile(supplier,'recipient.jsonl');
      const exported=(await readBytes(join(path,recipientFile.name))).toString('utf8').trim().split('\n').map(line=>JSON.parse(line));
      assert.equal(exported[0].kind,'recipient-review');assert.equal(exported[0].reviewId,customerWork.review.id);
      assert.equal(exported[0].reviewSha256,customerWork.review.sha256);
      assert.deepEqual(exported[0].profile,customerWork.plan.profile);
      assert.deepEqual(exported[0].recipient,customerWork.review.recipient);
      assert.deepEqual(exported.slice(1),customerWork.rows);
      output.length=0;
      const pageInput=join(control,'customer-recipient-page.json');
      await retainedBytes(pageInput,json({reviewId:customerWork.review.id,limit:1}));
      const paged=await runOpenSearchMaterialCLI(['supplier-recipient-rows','--url',server.url,'--workspace',CUSTOMER,
        '--input',pageInput,'--all-pages'],{environment,stdout,stderr});
      const pages=output.join('').trim().split('\n').map(line=>JSON.parse(line));
      assert.equal(paged.pages,pages.length);assert.deepEqual(rowsOf(pages),customerWork.rows);
      return {supplier:{...supplier,download:files,inspection},material:{...material,download:materialFiles,content},
        cli:{supplierExportOperation:state.operations['customer-package-export'],files:downloaded.files,
          pages:pages.length,rows:rowsOf(pages).length,progressMessages:progress.length}};
    });
    const nativeCLI=await step('original_catalog_cli_exports_the_same_complete_customer_package',async()=>{
      await closeHost();
      const path=join(directory,'catalog-cli');await privateDirectory(path);const files=[];
      for(const format of ['parameters.xml','xchange.json','2ba.zip']){
        const expected=exportFile(customerExports.supplier,format),target=join(path,expected.name);let printed;
        const receipt=await catalogCLI(['catalog-supplier-export','--source',sourceFile,'--workspace',workspaces.customer,
          '--review',customerWork.review.id,'--review-sha256',customerWork.review.sha256,
          '--format',format,'--output',target],{env:environment,print(value){printed=value;}});
        assert.deepEqual(printed,receipt);assert.equal(receipt.bytes,expected.bytes);assert.equal(receipt.sha256,expected.sha256);
        files.push({format,...expected,...await fileIdentity(target,expected)});
      }
      const inspection=await inspectPackage(customerExports.supplier,path,customerWork.review,customerWork.message);
      await startHost();await assertCustomer();
      return {directory:path,files,inspection,lifetime:'CLOSED'};
    });
    const reopened=await step('reopen_same_merchant_and_original_package_operations',async()=>{
      await closeHost();await startHost();await assertCustomer();
      const supplier=operationResult(await primary.supplierExport(state.requests['export-ready'].args));
      assert.equal(supplier.exportId,ready.export.exportId);assert.equal(supplier.manifestSha256,ready.export.manifestSha256);
      const restored=operationResult(await customer.materialReceive(state.requests['receive-package'].args));
      assert.ok(restored.catalog);await assertCustomer();
      assert.deepEqual(await primary.supplierReviewGet({reviewId:sourceReview.review.id}),sourceReview.review);
      assert.deepEqual(await inspectRows(primary,sourceReview.review),sourceReview.rows);
      for(const version of versions){
        const inspected=await primary.inspectExport(version.export.exportId);
        assert.equal(inspected.manifestSha256,version.export.manifestSha256);
        assert.deepEqual(await primary.supplierReviewGet({reviewId:version.review.id}),version.review);
        assert.deepEqual(await inspectRows(primary,version.review),version.rows);
      }
      return {port:state.port,workspaceIds:baseline.workspaceIds,producerExportId:supplier.exportId,
        customerExportId:customerExports.supplier.exportId,receivedOperationId:adopted.operation.id};
    });
    const verifyGroup=async(client,selection,path)=>{
      const current=await client.inspectExport(selection.exportId);
      assert.equal(current.manifestSha256,selection.manifestSha256);assert.deepEqual(current.manifest,selection.manifest);
      const files=[await fileIdentity(join(path,'manifest.json'),selection.manifestFile)];
      for(const item of selection.manifest.files)files.push({...item,...await fileIdentity(join(path,item.name),item)});
      return {exportId:selection.exportId,manifestSha256:selection.manifestSha256,directory:path,files};
    };
    const artifacts={versions:{},sourceReview:await verifyGroup(primary,sourceReview.export,sourceReview.download.directory),producerCatalog:await verifyGroup(primary,producerMaterial,producerMaterial.download.directory),
      customerPackage:await verifyGroup(customer,customerExports.supplier,customerExports.supplier.download.directory),
      customerCatalog:await verifyGroup(customer,customerExports.material,customerExports.material.download.directory),
      catalogCLI:{directory:nativeCLI.directory,files:[]}};
    for(const version of versions)artifacts.versions[version.key]=await verifyGroup(primary,version.export,version.download.directory);
    for(const item of nativeCLI.files)artifacts.catalogCLI.files.push({...item,...await fileIdentity(item.path,item)});
    for(const item of originalFiles)await fileIdentity(item.path,item);
    for(const item of referenceFiles)await fileIdentity(item.path,item);
    await fileIdentity(nativeSnapshot.receipt.path,nativeSnapshot.receipt);
    await fileIdentity(materialsSnapshot.receipt.path,materialsSnapshot.receipt);
    await fileIdentity(originalConfig.path,originalConfig);
    await assertCustomer();
    const currentOriginal=await readJson(join(materialsDirectory,'xchange-materials-native.json'));
    assert.deepEqual(unchangedOriginal(currentOriginal),unchangedOriginal(originalReport));
    await save();
    for(const name of REQUIRED_TOOLS)assert.ok(state.observedTools[name]>0,'The complete receiving flow did not use '+name+'.');
    const source=await sourceReport();
    const sourcePaths={
      'receiving/twoba-materials-native.mjs':fileURLToPath(import.meta.url),
      'receiving/xchange-materials-native.mjs':join(HERE,'xchange-materials-native.mjs'),
      'xchange/processing.mjs':resolve(INPUTS,'../processing.mjs'),
      'xchange/package.mjs':resolve(INPUTS,'../package.mjs'),
      'xchange/profile.mjs':resolve(INPUTS,'../profile.mjs'),
      'xchange/recipient.mjs':resolve(INPUTS,'../recipient.mjs'),
      'xchange/exports.mjs':resolve(INPUTS,'../exports.mjs')
    };
    for(const[key,path]of Object.entries(sourcePaths)){
      const bytes=await readBytes(path);
      source[key]={bytes:bytes.length,sha256:hash(bytes),gitBlob:createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')};
    }
    await closeHost();
    state.state='COMPLETE';state.completedAt??=new Date().toISOString();state.artifacts=artifacts;await save();
    const report={schema:SCHEMA,operationId,state:'CLOSED',directory,xchangeDirectory,materialsDirectory,
      startedAt:state.startedAt,completedAt:state.completedAt,source,original:state.original,
      workspaces,workspaceIds:baseline.workspaceIds,catalog:baseline.catalog,
      supplier:{planId:ready.plan.id,planRevision:ready.plan.revision,reviewId:ready.review.id,
        reviewSha256:ready.review.sha256,recipientRootSha256:ready.review.recipient.rowsRootSha256},
      sourceQuality:{decision:modellingDecision,reviewId:sourceReview.review.id,reviewSha256:sourceReview.review.sha256,
        findings:sourceReview.review.findings,originalProductSha256:digest(originalMessage),
        deliveredProductSha256:digest(modellingCorrection.message),
        originalNumberTokens:Object.keys(originalMessage.numberTokens).length,
        deliveredNumberTokens:Object.keys(modellingCorrection.message.numberTokens).length,
        omittedFields:modellingCorrection.omittedFields,removedNumberTokens:modellingCorrection.removedNumberTokens,
        diagnosticsExportId:sourceReview.export.exportId},
      processing:versions.map(value=>({key:value.key,reason:value.reason,planRevision:value.plan.revision,
        reviewId:value.review.id,reviewSha256:value.review.sha256,processing:value.review.recipient.processing,
        counts:value.review.recipient.counts,exportId:value.export.exportId,archive:value.inspection})),
      customer:{planId:customerWork.plan.id,planRevision:customerWork.plan.revision,correctionId:customerWork.correction.id,
        correctionRevision:customerWork.correction.revision,reviewId:customerWork.review.id,
        reviewSha256:customerWork.review.sha256,recipientRootSha256:customerWork.review.recipient.rowsRootSha256},
      bundleAdoption:adopted,newerCustomerReplay:replay,cli:{...customerExports.cli,native:nativeCLI},
      reopen:reopened,phases:Object.keys(state.phases),operations:state.operations,
      archiveInterruption:state.archiveInterruption,observedTools:state.observedTools,
      files:artifacts,lifetimes:state.lifetimes};
    await atomicBytes(reportFile,Buffer.from(json(report)));return report;
  }catch(error){
    if(state){state.state='INTERRUPTED';state.error={code:error.code??'TWO_BA_RECEIVING_INTERRUPTED',message:error.message};
      if(!storageFault)await save().catch(()=>{});}
    throw error;
  }finally{
    try{if(state)await closeHost();}finally{await lease.close();}
  }
}
export async function main(args=process.argv.slice(2),{stdout=process.stdout}={}){
  if(!args.length||args.includes('--help')){
    stdout.write('Continue the completed original xChange handover as a complete 2BA upload package.\n\n'+
      '  node receiving/twoba-materials-native.mjs --xchange-directory ORIGINAL_XCHANGE_DIRECTORY\n'+
      '       --materials-directory ORIGINAL_MCP_RECEIVING_DIRECTORY --directory PRIVATE_2BA_DIRECTORY\n'+
      '       [--operation twoba-materials-2769] [--inputs ORIGINAL_REFERENCE_DIRECTORY] [--python python3]\n\n'+
      'The original xChange and MCP reports must be CLOSED. Their complete supplier/customer bundles\n'+
      'are imported into this operation’s own stores. The current publisher modelling decision is\n'+
      'reviewed before its reasoned optional-field correction. Retain all directories and the operation ID\n'+
      'to resume original requests, complete ZIP/XML exports and verified download checkpoints.\n'+
      'Python uses only its original standard ZIP64 and XML readers; the product generates every file.\n');
    return;
  }
  const fields={'--xchange-directory':'xchangeDirectory','--materials-directory':'materialsDirectory',
    '--directory':'directory','--operation':'operationId','--inputs':'inputsDirectory','--python':'python'},options={};
  for(let i=0;i<args.length;i+=2){
    const key=fields[args[i]],value=args[i+1];
    if(!key||!value||value.startsWith('--')||Object.hasOwn(options,key))
      throw failure('TWO_BA_RECEIVING_INPUT','Use each supported receiving option and its complete value once.');
    options[key]=value;
  }
  const report=await runTwoBaMaterialsReceiving(options);stdout.write(json(report));return report;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(error=>{process.stderr.write(json({error:{code:error.code??'TWO_BA_RECEIVING_INTERRUPTED',message:error.message}}));process.exitCode=1;});
