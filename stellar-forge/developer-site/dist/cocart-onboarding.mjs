// MIT. Browser-local setup for the original CoCart managed customer workspace.
import {zipWorkspace} from './onboarding.mjs';

export const DRAFT_SCHEMA='stellar-forge.frontdoor-cocart.v1';
export const PACKET_SCHEMA='stellar-forge.frontdoor-cocart-packet.v1';
export const SOURCE_PATH='stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/cocart';
export const MAX_FILE_BYTES=64*1024*1024;
export const MAX_TOTAL_BYTES=96*1024*1024;
export const NATIVE_RECEIVING='stellar-forge.cocart.receiving.v1';
export const NATIVE_HANDOFF='stellar-forge.sf104.checkout-handoff.v1';
const encoder=new TextEncoder();
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const copy=value=>structuredClone(value);
const need=(ok,message)=>{if(!ok)throw new Error(message);};
const controls=/[\u0000-\u001f\u007f]/;
const identifier=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const hash=/^[a-f0-9]{64}$/;
export const DEFAULT_INPUT=Object.freeze({
  schema:DRAFT_SCHEMA,folder:'cocart-customer',label:'CoCart customer workspace',
  workspaceDirectory:'',sdkModule:'',connectionFile:'',workspaceAlias:'customer',
  merchantDirectory:'',primary:null,transport:null,handoffs:[],receivingInputs:[]
});
export function absolutePath(value,{optional=false,label='Path'}={}) {
  if(optional&&(value===undefined||value===''))return '';
  need(typeof value==='string'&&value.startsWith('/')&&value!=='/'&&value.length<=4096&&!controls.test(value),
    label+' must be an absolute Linux or macOS path.');
  need(!value.endsWith('/')&&!value.split('/').slice(1).some(part=>!part||part==='.'||part==='..'),
    label+' must use its real path without dot segments or a trailing slash.');
  return value;
}
export function bytesToBase64(bytes) {
  let binary='';
  for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(binary);
}
export function base64ToBytes(value) {
  need(typeof value==='string'&&value.length<=Math.ceil(MAX_FILE_BYTES/3)*4&&
    value.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(value),'An original file has invalid Base64 bytes.');
  const binary=atob(value),bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return bytes;
}
export async function sha256(bytes) {
  need(globalThis.crypto?.subtle,'This browser needs a secure context for exact file hashes.');
  const result=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(result)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function jsonBytes(bytes,label='File') {
  let text;
  try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}
  catch{throw new Error(label+' must contain complete UTF-8 bytes.');}
  try{return JSON.parse(text);}
  catch{throw new Error(label+' must contain the original UTF-8 JSON, without an added byte-order mark.');}
}
function recognize(value,kind) {
  need(object(value),'Choose an original JSON object.');
  if(kind==='profile') {
    need(typeof value.store_url==='string'&&typeof value.checkout_url==='string'&&
      value.schema!==NATIVE_RECEIVING,'Choose Download saved headless profile from the mapped Woo product.');
  } else if(kind==='receiving') {
    need(value.schema===NATIVE_RECEIVING&&value.workspace?.schema==='stellar-forge.cocart.workspace.v1'&&
      Array.isArray(value.objects)&&typeof value.content_sha256==='string',
      'Choose the complete original CoCart receiving JSON, including its workspace and objects.');
  } else if(kind==='handoff') {
    need(value.schema===NATIVE_HANDOFF,'Choose the original single-product Woo checkout handoff for this CoCart profile.');
  } else if(kind==='transport') {
    need(Object.keys(value).every(k=>['store_url','checkout_url','reason'].includes(k))&&
      ['store_url','checkout_url','reason'].every(k=>typeof value[k]==='string'&&value[k].length>0),
      'The local receiving transport needs store_url, checkout_url and reason.');
    let store,checkout;
    try{store=new URL(value.store_url);checkout=new URL(value.checkout_url);}catch{throw new Error('Use actual absolute URLs for the local receiving transport.');}
    need(['http:','https:'].includes(store.protocol)&&['127.0.0.1','localhost','[::1]'].includes(store.hostname)&&
      store.origin===checkout.origin&&!store.username&&!store.password&&!checkout.username&&!checkout.password&&
      !store.search&&!store.hash&&!checkout.hash,'The receiving transport must select the same actual loopback store and checkout.');
  } else throw new Error('Unknown input kind.');
  return value;
}
export async function readInputFile(bytes,name,kind) {
  need(bytes instanceof Uint8Array&&bytes.length>0&&bytes.length<=MAX_FILE_BYTES,'Choose a complete file from 1 byte to 64 MiB.');
  need(kind!=='handoff'||bytes.length<=65536,'The native Woo handoff accepts at most 64 KiB.');
  need(typeof name==='string'&&name.length>0&&name.length<=240&&!controls.test(name),'The source filename must be readable text.');
  const value=recognize(jsonBytes(bytes,name),kind);
  return {kind,name,bytes:bytes.length,sha256:await sha256(bytes),base64:bytesToBase64(bytes)};
}
export function sourceSummary(file) {
  if(!file)return null;
  const value=recognize(jsonBytes(base64ToBytes(file.base64),file.name),file.kind);
  const profile=file.kind==='receiving'?value.workspace.profile:file.kind==='profile'?value:null;
  if(profile) {
    const mapping=profile.gateway_mapping;
    return {
      kind:file.kind,label:profile.label||'Selected Woo store',merchant:profile.merchant_origin||profile.store_url,
      store:profile.store_url,checkout:profile.checkout_url,
      plugin:profile.expected_plugin_version||'4.9.7',productId:mapping?.productId??null,
      currency:mapping?.storefront?.currency??null,total:mapping?.storefront?.total??null,
      route:mapping?.routeId??null,method:mapping?.method??null,resource:mapping?.url??null,
      network:mapping?.network??null,asset:mapping?.asset??null,recipient:mapping?.payTo??null,
      atomic:mapping?.amountAtomic??null,timeout:mapping?.maxTimeoutSeconds??null,
      approvedAt:mapping?.approvedAt??null,
      ...(file.kind==='receiving'?{revision:value.workspace.revision,carts:value.workspace.carts?.length,
        events:value.workspace.events?.length,objects:value.objects.length,workspaceVersion:value.workspace_version,
        contentSha256:value.content_sha256}:{})
    };
  }
  return file.kind==='handoff'?{kind:file.kind,order:value.orderReference,attempt:value.attemptGeneration,
    productId:value.productId,merchant:value.storeOrigin,total:value.storefront?.total,currency:value.storefront?.currency}
    :{kind:file.kind,store:value.store_url,checkout:value.checkout_url,reason:value.reason};
}
function selections(input) {
  const rows=[];
  if(input.primary)rows.push({role:'primary',alias:null,file:input.primary});
  if(input.transport)rows.push({role:'transport',alias:null,file:input.transport});
  for(const row of input.handoffs||[])rows.push({role:'handoff',alias:row.alias,file:row.file});
  for(const row of input.receivingInputs||[])rows.push({role:'receivingInput',alias:row.alias,file:row.file});
  return rows;
}
export function validateSettings(input) {
  need(object(input)&&input.schema===DRAFT_SCHEMA,'Choose a CoCart setup draft.');
  need(Object.keys(input).every(k=>Object.keys(DEFAULT_INPUT).includes(k)),'The draft contains an unsupported setup setting.');
  need(typeof input.folder==='string'&&identifier.test(input.folder),'Use a package name of 1–64 letters, numbers, underscores or hyphens.');
  need(typeof input.label==='string'&&input.label.trim().length>0&&input.label.length<=160&&!controls.test(input.label),'Enter a workspace label of 1–160 characters.');
  absolutePath(input.workspaceDirectory,{label:'Customer workspace'});
  absolutePath(input.sdkModule,{optional:true,label:'SDK module'});
  absolutePath(input.connectionFile,{optional:true,label:'Merchant connection'});
  absolutePath(input.merchantDirectory,{optional:true,label:'Merchant directory'});
  need(!input.merchantDirectory||input.connectionFile,'A merchant agent needs the private connection file.');
  need(!input.connectionFile||identifier.test(input.workspaceAlias||''),'Use a connection alias of 1–64 letters, numbers, underscores or hyphens.');
  need(input.primary&&['profile','receiving'].includes(input.primary.kind),'Import the native profile or complete receiving workspace.');
  need(!input.transport||input.transport.kind==='transport','Choose an original receiving transport JSON.');
  need(!input.transport||input.primary.kind==='profile','An initial receiving transport belongs with a native profile. Rebind an existing receiving workspace in its original application.');
  need(Array.isArray(input.handoffs)&&input.handoffs.length<=16&&Array.isArray(input.receivingInputs)&&input.receivingInputs.length<=16,'Each named-input group accepts up to 16 original files.');
  need(input.connectionFile||(!input.handoffs.length&&!input.receivingInputs.length),'Named handoffs and receiving files need the private merchant connection.');
  for(const [kind,rows]of [['handoff',input.handoffs],['receiving',input.receivingInputs]]) {
    const aliases=new Set();
    for(const row of rows) {
      need(object(row)&&Object.keys(row).every(k=>['alias','file'].includes(k))&&
        identifier.test(row.alias||'')&&!aliases.has(row.alias),'Give each '+kind+' input a distinct readable alias.');
      need(row.file?.kind===kind,'The '+row.alias+' input has the wrong native format.');
      need(!(kind==='receiving'&&input.primary.kind==='receiving'&&row.alias==='original'),'The receiving setup reserves original for its primary complete export.');
      aliases.add(row.alias);
    }
  }
  const paths=[input.workspaceDirectory,input.connectionFile,input.merchantDirectory].filter(Boolean);
  need(!input.merchantDirectory||(!input.workspaceDirectory.startsWith(input.merchantDirectory+'/')&&!input.merchantDirectory.startsWith(input.workspaceDirectory+'/')),'Use separate customer and merchant directories.');
  need(new Set(paths).size===paths.length,'The customer directory, connection file and merchant directory need distinct paths.');
  for(const directory of [input.workspaceDirectory,input.merchantDirectory].filter(Boolean))
    need(!input.connectionFile||!input.connectionFile.startsWith(directory+'/'),'Put the private connection outside the customer and merchant directories.');
  return input;
}
export async function reviewSetup(input) {
  validateSettings(input);
  const rows=selections(input),reviewed=[],seen=new Set();let total=0;
  for(const row of rows) {
    const file=row.file;
    need(object(file)&&Object.keys(file).every(k=>['kind','name','bytes','sha256','base64'].includes(k))&&hash.test(file.sha256||''),'A selected source file needs its exact digest.');
    const bytes=base64ToBytes(file.base64);
    need(Number.isSafeInteger(file.bytes)&&file.bytes===bytes.length&&file.bytes>0&&file.bytes<=MAX_FILE_BYTES,'A source file length changed.');
    need(row.role!=='handoff'||bytes.length<=65536,'The original Woo handoff accepts at most 64 KiB.');
    need(await sha256(bytes)===file.sha256,'The original '+file.name+' bytes changed. Import that native file again.');
    recognize(jsonBytes(bytes,file.name),file.kind);total+=bytes.length;
    need(total<=MAX_TOTAL_BYTES,'This setup packet accepts up to 96 MiB of original inputs.');
    const stem=row.role==='primary'?'primary':row.role==='transport'?'receiving-transport':row.role+'-'+row.alias;
    const path='inputs/'+stem+'.json';
    need(!seen.has(path),'A selected input path is repeated.');seen.add(path);
    reviewed.push({...row,path,bytes});
  }
  return {summary:sourceSummary(input.primary),totalBytes:total,files:reviewed};
}
export async function importDraft(text) {
  let input;try{input=JSON.parse(text);}catch{throw new Error('Choose a complete CoCart draft JSON.');}
  need(object(input)&&input.schema===DRAFT_SCHEMA,'This is a different kind of setup draft.');
  const merged={...copy(DEFAULT_INPUT),...input};
  // Incomplete path selections can be saved; original file identity is still checked.
  for(const row of selections(merged)) {
    const f=row.file,b=base64ToBytes(f.base64);
    need(b.length===f.bytes&&await sha256(b)===f.sha256,'A retained draft file differs from its original digest.');
    recognize(jsonBytes(b,f.name),f.kind);
  }
  return merged;
}
export function commands(input) {
  const output=input.workspaceDirectory?input.workspaceDirectory+'-receiving.json':'/absolute/private/CoCart_Receiving_Workspace.json';
  const shell=value=>"'"+value.replaceAll("'","'\\''")+"'";
  return [
    {title:'Review original inputs and installed tools',command:'TOOLKIT=/absolute/path/to/checkout-or-installed-package\nnode cocart.mjs inspect --toolkit "$TOOLKIT"'},
    {title:'Create or receive the customer workspace',command:'node cocart.mjs prepare --toolkit "$TOOLKIT"'},
    {title:'Open the original customer application',command:'node cocart.mjs open --toolkit "$TOOLKIT"\n# Use the exact private URL printed by the original listener.\n# Stop with Ctrl+C before moving this source directory.'},
    {title:'Export the same customer work',command:'node cocart.mjs status --toolkit "$TOOLKIT"\nnode cocart.mjs export --toolkit "$TOOLKIT" --out '+shell(output)}
  ];
}
export function installationGuide(input,review) {
  const s=review.summary,rows=review.files.map(r=>'| '+r.role+(r.alias?' / '+r.alias:'')+' | '+r.path+' | '+r.file.bytes+' | '+r.file.sha256+' |');
  return [
    '# CoCart customer installation and receiving',
    '',
    'Workspace: '+input.label,'',
    'This package prepares the original CoCart customer application from the selected native profile or complete receiving export. It keeps the original input bytes, saved cart/order history and merchant mapping.',
    '',
    '## Selected source',
    '',
    '- Input: '+input.primary.name+' ('+input.primary.kind+').',
    '- Merchant: '+s.merchant+'.',
    '- Selected Community plugin: '+s.plugin+'.',
    '- Original SDK: @cocartheadless/sdk 1.2.1; Node.js 22 or later.',
    ...(s.productId!==null?['- Saved product: '+s.productId+'; store total '+s.currency+' '+s.total+'.']:[]),
    ...(s.revision!==undefined?['- Receiving revision: '+s.revision+'; '+s.carts+' carts; '+s.objects+' retained objects.']:[]),
    '',
    '| Role | Original file | Bytes | SHA-256 |','| --- | --- | ---: | --- |',...rows,'',
    'Browser review identifies the input and checks its bytes. The installed original validator checks the full profile, handoff and reachable receiving-object closure during Inspect, before setup.',
    '',
    '## Prepare the host',
    '',
    'Choose the full maintained source checkout or installed merchant package. Its source must include '+SOURCE_PATH+'/managed.mjs and the shared merchant provider. Select the original SDK 1.2.1 entry or use the SDK installed with that runtime.',
    '',
    'Create the real parent of the selected customer directory. The customer directory itself may be absent or may be its original retained workspace. Existing directories and connection files keep their original permissions and content. The runner creates a missing selected connection parent as mode 0700; an existing parent must already be private and operator-owned.',
    '',
    '- Customer directory: '+input.workspaceDirectory,
    '- SDK: '+(input.sdkModule||'the selected runtime’s installed @cocartheadless/sdk'),
    '- Private connection: '+(input.connectionFile||'not selected'),
    '- Workspace alias: '+(input.connectionFile?input.workspaceAlias:'not selected'),
    '- Merchant agent directory: '+(input.merchantDirectory||'not selected'),
    '',
    ...commands(input).flatMap(c=>['## '+c.title,'','~~~sh',c.command,'~~~','']),
    'Inspect reports the actual native source and SDK identities alongside the verified input hashes. Prepare calls setupCocartWorkspace in that original source. It receives the same complete export or creates from the saved product profile, then writes the optional original merchant connection and merchant configuration.',
    '',
    'Keep setup.json, its exact inputs and the selected source directory together. Repeating Prepare follows the original same-input reopen rules and keeps later native customer revisions. An unchanged original creation transport is checked against its retained creation event and remains connection metadata; it never overwrites a later transport.rebind. If a connection already contains different bytes, retain it and select its intended existing configuration or a different output in the setup page. Ordinary customer actions use the original application’s revision checks and operation identities.',
    '',
    '## Use managed Applications',
    '',
    'In the installed merchant workspace, choose Applications → CoCart customer workspace. Enter:',
    '',
    '| Setting | Value |','| --- | --- |',
    '| Original private CoCart workspace | '+input.workspaceDirectory+' |',
    '| Original CoCart SDK module | '+(input.sdkModule||'use installed SDK')+' |',
    '| Private CoCart merchant connection | '+(input.connectionFile||'leave empty')+' |',
    '| Connection workspace alias | '+(input.connectionFile?input.workspaceAlias:'leave empty')+' |',
    '| Local port | 0, or an explicitly selected available loopback port |','',
    'Review, Save, Review start, Start and Open. The existing manager verifies the live source, directory, SDK and instance before opening its private URL. Stop through that manager. Reopen the same saved application and review its current revision before the next Start.',
    '',
    '## Merchant product and checkout',
    '',
    'For a first installation, use the existing WooCommerce setup page to prepare the complete original SF104 plugin and seller/delivery configuration. Add the original profile-export.php companion with the plugin preparation command below. Activate it alongside WooCommerce, the selected CoCart Community source and SF104. Save the actual simple virtual product and its Stellar mapping in Woo. Download saved headless profile on that product.',
    '',
    '~~~sh','node cocart.mjs plugin --toolkit "$TOOLKIT" --out /absolute/new/profile-plugin','~~~','',
    'The plugin command copies the original companion PHP bytes and original guides into the selected new directory. Install the PHP file under wp-content/plugins and activate it. Keep the existing Woo plugin, seller and continuous SF98 delivery worker on their selected compatible release.',
    '',
    'In the customer application, load the real catalog, create or reopen a named guest cart, apply reviewed item and quantity changes, and select Replace or Merge checkout. The original profile currently selects one mapped simple virtual product at quantity one, its exact saved currency/total and original payment terms. The native comparison explains changes in product, shipping, fees, discounts or totals before checkout. Woo performs its own admission on the real order.',
    '',
    'Complete the actual Woo checkout. Attach the downloaded original handoff to that same preview, then continue through the existing buyer and merchant delivery tools. Named handoffs in this packet are only made available to the merchant agent; setup does not attach one to an invented cart or submit a payment.',
    '',
    '## Customer receiving and care',
    '',
    'Export from the original application or this runner. The export retains the workspace, native exchanges, snapshots, operations, checkout previews, original Woo handoff and every referenced object. A receiver can import that complete JSON into this setup page, choose its private destination and run the same native Prepare operation. Keep the original order and attempt generation when reviewing a returned customer issue.',
    '',
    'The operating handover should name the store owner, seller/delivery operator, selected source and SDK, configured product, actual order/attempt, backup destination and support contact. Confirm one ordinary catalog/cart/checkout/handoff workflow, export the complete case, Stop, reopen and inspect the same order before releasing the installation.',
    '',
    'For an explicitly received local Woo instance, keep the original merchant profile unchanged and import its separate loopback transport file while creating from that profile. A received existing workspace keeps its saved transport; use its native transport.rebind action, with a reason, if its actual local port moves.',
    '',
    '## Source and support references',
    '',
    'Selected original source: '+SOURCE_PATH,
    'Native application: README.md and MANAGED.md in that source.',
    'Merchant/buyer handover: ../GATEWAY.md and ../OPERATIONS.md.',
    'The installed source remains the authority for the running product. Browser-local files and private workspace data remain under the receiving operator’s control.',''
  ].join('\n');
}
export async function createPacket(input,runner) {
  const review=await reviewSetup(input);
  need(typeof runner==='string'&&runner.startsWith('#!/usr/bin/env node')&&runner.length>1000,'Load the complete original setup runner before exporting.');
  const options={label:input.label,workspaceDirectory:input.workspaceDirectory,sdkModule:input.sdkModule||null,
    connectionFile:input.connectionFile||null,workspaceAlias:input.workspaceAlias,
    merchantDirectory:input.merchantDirectory||null};
  const declared=review.files.map(r=>({role:r.role,alias:r.alias,kind:r.file.kind,path:r.path,
    originalName:r.file.name,bytes:r.file.bytes,sha256:r.file.sha256}));
  const manifest={schema:PACKET_SCHEMA,options,files:declared,
    selectedSource:{path:SOURCE_PATH,plugin:'4.9.7',sdk:'1.2.1'},
    preview:review.summary};
  const prefix=input.folder+'/';
  const files=[
    {path:prefix+'setup.json',content:JSON.stringify(manifest,null,2)+'\n'},
    {path:prefix+'cocart.mjs',content:runner},
    {path:prefix+'INSTALL.md',content:installationGuide(input,review)},
    ...review.files.map(r=>({path:prefix+r.path,content:r.bytes}))
  ];
  return {files,manifest,summary:{folder:input.folder,inputCount:review.files.length,inputBytes:review.totalBytes,
    merchant:review.summary.merchant,mode:input.primary.kind},zip:()=>zipWorkspace(files)};
}
