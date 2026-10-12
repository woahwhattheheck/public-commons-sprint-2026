#!/usr/bin/env node
// MIT. Portable front-door forwarding to the original CoCart managed application.
import {constants} from 'node:fs';
import {open,lstat,realpath,mkdir,readFile} from 'node:fs/promises';
import {resolve,dirname,join,isAbsolute,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const PACKET=dirname(fileURLToPath(import.meta.url));
const SCHEMA='stellar-forge.frontdoor-cocart-packet.v1';
const SOURCE='stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/cocart';
const MAX=64*1024*1024;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const need=(ok,message)=>{if(!ok)throw new Error(message);};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const parse=(bytes,label)=>{
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));}
  catch{throw new Error(label+' must be complete original UTF-8 JSON.');}
};
const help=[
  'CoCart customer setup — original native tools','',
  'node cocart.mjs inspect --toolkit /absolute/checkout-or-installed-package',
  'node cocart.mjs prepare --toolkit /absolute/checkout-or-installed-package',
  'node cocart.mjs status --toolkit /absolute/checkout-or-installed-package',
  'node cocart.mjs open --toolkit /absolute/checkout-or-installed-package [--port 0]',
  'node cocart.mjs export --toolkit /absolute/checkout-or-installed-package --out /private/CoCart_Receiving_Workspace.json',
  'node cocart.mjs plugin --toolkit /absolute/checkout-or-installed-package --out /private/new-profile-plugin','',
  'Inspect checks exact input bytes and original profile/receiving/handoff contracts.',
  'Prepare invokes native managed setup in the selected private directory.',
  'Open runs the original local customer application; cart/order actions stay explicit.',
  'Export retains the complete original workspace and reachable objects.',
  'Plugin copies the original saved-profile PHP companion and source guides.',
  'Use the existing WooCommerce setup flow for its complete SF104 plugin and seller/delivery configuration.'
].join('\n');

function options(argv) {
  const args=[...argv],command=args.shift()||'help',out={command};
  while(args.length) {
    const name=args.shift();need(/^--[a-z-]+$/.test(name),'Use named command options.');
    const key=name.slice(2);need(['toolkit','out','port'].includes(key)&&!(key in out),'Unknown or repeated option: '+name);
    const value=args.shift();need(typeof value==='string'&&value&&!value.startsWith('--'),'Supply a value for '+name);
    out[key]=value;
  }
  return out;
}
function absolute(value,label) {
  need(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value&&value!=='/'&&
    !/[\u0000-\u001f\u007f]/.test(value),label+' must be a real absolute path without dot segments.');
  return value;
}
async function regular(path,{maximum=MAX,privateOnly=false}={}) {
  absolute(path,'File path');
  need(await realpath(dirname(path))===dirname(path),'Select the original real parent directory: '+dirname(path));
  const h=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  try {
    const before=await h.stat();
    need(before.isFile()&&before.size>0&&before.size<=maximum,'Select a complete regular input within its native size limit.');
    if(privateOnly)need(!(before.mode&0o077)&&(process.getuid===undefined||before.uid===process.getuid()),'The selected file must be private and operator-owned.');
    const bytes=await h.readFile(),after=await h.stat();
    need(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&
      before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs&&bytes.length===before.size,'A selected file changed during reading.');
    return {path,bytes,sha256:sha(bytes),size:bytes.length};
  } finally{await h.close();}
}
async function native(toolkit) {
  absolute(toolkit,'Toolkit');
  const bases=[join(toolkit,SOURCE),join(toolkit,'source',SOURCE)];
  let selected=null;
  for(const candidate of bases) {
    try {
      const info=await lstat(join(candidate,'managed.mjs'));
      if(info.isFile()){selected=await realpath(candidate);break;}
    }catch(e){if(e.code!=='ENOENT')throw e;}
  }
  need(selected,'This toolkit has no original CoCart managed source. Select the maintained complete checkout or installed package.');
  const module=await import(pathToFileURL(join(selected,'managed.mjs')).href);
  const workspace=await import(pathToFileURL(join(selected,'workspace.mjs')).href);
  const buyer=await import(pathToFileURL(join(selected,'../buyer.mjs')).href);
  need(typeof module.setupCocartWorkspace==='function'&&typeof module.inspectCocartLaunchSource==='function'&&
    typeof module.inspectCocartSDK==='function'&&typeof module.main==='function'&&
    typeof workspace.validateProfile==='function'&&typeof workspace.inspectReceiving==='function'&&
    workspace.SOURCE?.sdk?.version==='1.2.1'&&workspace.SOURCE?.plugin?.version==='4.9.7',
    'Select the original CoCart Community 4.9.7 and SDK 1.2.1 application source.');
  const source=await module.inspectCocartLaunchSource(selected);
  return {directory:selected,module,workspace,buyer,source};
}
function setupOptions(raw) {
  need(plain(raw)&&Object.keys(raw).every(k=>['label','workspaceDirectory','sdkModule','connectionFile','workspaceAlias','merchantDirectory'].includes(k)),
    'Use the original generated setup options.');
  need(typeof raw.label==='string'&&raw.label.trim()&&raw.label.length<=160&&!/[\u0000-\u001f\u007f]/.test(raw.label),'Enter the original workspace label.');
  absolute(raw.workspaceDirectory,'Customer workspace');
  for(const key of ['sdkModule','connectionFile','merchantDirectory'])if(raw[key]!==null&&raw[key]!==undefined&&raw[key]!=='')absolute(raw[key],key);
  need(!raw.connectionFile||/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(raw.workspaceAlias||''),'Choose the original connection alias.');
  need(!raw.merchantDirectory||raw.connectionFile,'A merchant directory needs the private connection.');
  return raw;
}
async function inspectInputs(selected) {
  const manifestFile=await regular(join(PACKET,'setup.json'),{maximum:1024*1024});
  const manifest=parse(manifestFile.bytes,'setup.json');
  need(plain(manifest)&&manifest.schema===SCHEMA&&Object.keys(manifest).every(k=>['schema','options','files','selectedSource','preview'].includes(k)),
    'Use the complete original CoCart setup packet.');
  const setting=setupOptions(manifest.options);
  need(Array.isArray(manifest.files)&&manifest.files.length>0&&manifest.files.length<=34,'Choose the original selected input list.');
  const files=[],paths=new Set(),roles=new Map();let total=0;
  for(const row of manifest.files) {
    need(plain(row)&&Object.keys(row).every(k=>['role','alias','kind','path','originalName','bytes','sha256'].includes(k))&&
      ['primary','transport','handoff','receivingInput'].includes(row.role),'A setup input has an unsupported role.');
    need(typeof row.path==='string'&&/^inputs\/[A-Za-z0-9_-]+\.json$/.test(row.path)&&!paths.has(row.path),'Select unique original packet input paths.');
    need(typeof row.sha256==='string'&&/^[a-f0-9]{64}$/.test(row.sha256)&&Number.isSafeInteger(row.bytes),'An input needs its exact saved SHA-256 and length.');
    const path=join(PACKET,row.path),part=relative(PACKET,path);
    need(part===row.path,'A setup input must remain in this packet.');
    const file=await regular(path,{maximum:row.role==='handoff'?65536:MAX});
    need(file.size===row.bytes&&file.sha256===row.sha256,'Original file differs from setup.json: '+row.originalName);
    const value=parse(file.bytes,row.originalName);
    total+=file.size;need(total<=96*1024*1024,'The selected setup inputs exceed 96 MiB.');
    if(row.role==='primary') {
      need(!roles.has('primary')&&['profile','receiving'].includes(row.kind),'Choose one original profile or complete receiving export.');
      if(row.kind==='profile')selected.workspace.validateProfile(value);else selected.workspace.inspectReceiving(file.bytes);
      need(row.alias===null,'A primary input does not have a merchant alias.');
      roles.set('primary',{row,file,value});
    }else if(row.role==='transport') {
      need(!roles.has('transport')&&row.kind==='transport'&&row.alias===null,'Choose one explicit receiving transport.');
      need(plain(value)&&Object.keys(value).every(k=>['store_url','checkout_url','reason'].includes(k))&&
        ['store_url','checkout_url','reason'].every(k=>typeof value[k]==='string'&&value[k]),'The receiving transport needs original URLs and a reason.');
      roles.set('transport',{row,file,value});
    }else {
      const kind=row.role==='handoff'?'handoff':'receiving';
      need(row.kind===kind&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(row.alias||''),'Use the original named native input.');
      const alias=row.role+':'+row.alias;need(!roles.has(alias),'A native input alias is repeated.');
      if(row.role==='handoff')selected.buyer.validateHandoff(value);else selected.workspace.inspectReceiving(file.bytes);
      roles.set(alias,{row,file,value});
    }
    paths.add(row.path);files.push({role:row.role,alias:row.alias,kind:row.kind,path:file.path,bytes:file.size,sha256:file.sha256});
  }
  need(roles.has('primary'),'Import the original profile or receiving workspace.');
  need(!roles.has('transport')||roles.get('primary').row.kind==='profile','Use an initial transport only with profile creation.');
  need(setting.connectionFile||![...roles.keys()].some(k=>k.startsWith('handoff:')||k.startsWith('receivingInput:')),'Named original inputs need the private connection.');
  const primary=roles.get('primary'),transport=roles.get('transport');
  need(!(primary.row.kind==='receiving'&&roles.has('receivingInput:original')),'The primary receiving file owns the original alias.');
  if(transport) {
    const profile=primary.value,t=transport.value;
    const store=new URL(t.store_url),checkout=new URL(t.checkout_url);
    need(['127.0.0.1','localhost','[::1]'].includes(store.hostname)&&store.origin===checkout.origin&&
      !store.username&&!store.password&&!store.search&&!store.hash&&!checkout.username&&!checkout.password&&!checkout.hash,
      'The local receiving transport must name the same actual loopback store and checkout.');
    selected.workspace.validateProfile({...profile,store_url:t.store_url,checkout_url:t.checkout_url,
      merchant_origin:profile.merchant_origin||new URL(profile.store_url).origin,transport:'loopback_receiving'});
  }
  // Resolve the actual original SDK before any native setup writes.
  const sdk=await selected.module.inspectCocartSDK(setting.sdkModule||'@cocartheadless/sdk');
  return {manifest,manifestFile,setting,files,roles,primary,transport,sdk,summary:{
    schema:'stellar-forge.frontdoor-cocart-inspection.v1',packetSha256:manifestFile.sha256,
    source:selected.source,sdk,mode:primary.row.kind,inputs:files,
    customerDirectory:setting.workspaceDirectory,connectionFile:setting.connectionFile,
    receiving:primary.row.kind==='receiving'?{revision:primary.value.workspace.revision,
      workspaceVersion:primary.value.workspace_version,contentSha256:primary.value.content_sha256,
      carts:primary.value.workspace.carts.length,objects:primary.value.objects.length}:null}};
}
async function privateParent(path) {
  path=dirname(absolute(path,'Connection file'));
  let info;
  try{info=await lstat(path);}
  catch(e) {
    if(e.code!=='ENOENT')throw e;
    need(await realpath(dirname(path))===dirname(path),'Create the real parent directory before preparation.');
    await mkdir(path,{mode:0o700});info=await lstat(path);
  }
  need(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(path)===path&&
    !(info.mode&0o077)&&(process.getuid===undefined||info.uid===process.getuid()),'Use an existing operator-owned mode-0700 connection parent.');
}
async function writeExact(path,bytes) {
  absolute(path,'Output file');need(bytes.length>0&&bytes.length<=MAX,'The complete output must fit the original 64 MiB receiving limit.');need(await realpath(dirname(path))===dirname(path),'Choose a real output parent.');
  let h;
  try{h=await open(path,'wx',0o600);}
  catch(e) {
    if(e.code!=='EEXIST')throw e;
    const previous=await regular(path,{privateOnly:true});
    need(previous.bytes.equals(bytes),'The output already contains different bytes. Choose a new receiving filename.');
    return {path,bytes:bytes.length,sha256:sha(bytes),reused:true};
  }
  try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}
  const after=await regular(path,{privateOnly:true});need(after.bytes.equals(bytes),'The output readback differs.');
  return {path,bytes:bytes.length,sha256:after.sha256,reused:false};
}
async function plugin(selected,out) {
  absolute(out,'Plugin preparation directory');
  need(await realpath(dirname(out))===dirname(out),'Select a real plugin destination parent.');
  try{await mkdir(out,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
  const info=await lstat(out);
  need(info.isDirectory()&&!info.isSymbolicLink()&&!(info.mode&0o077),'Use a private plugin preparation directory.');
  const files=[];
  for(const [source,name]of [
    ['profile-export.php','starforge-cocart-profile.php'],['README.md','COCART.md'],
    ['MANAGED.md','MANAGED.md'],['../GATEWAY.md','GATEWAY.md']
  ]) {
    const original=await regular(resolve(selected.directory,source),{maximum:4*1024*1024});
    files.push({source:original.path,...await writeExact(join(out,name),original.bytes)});
  }
  return {schema:'stellar-forge.frontdoor-cocart-plugin.v1',directory:out,source:selected.source,files,
    installation:'Install starforge-cocart-profile.php in the original Woo shop alongside its selected WooCommerce, CoCart and SF104 plugins.'};
}
export async function main(argv=process.argv.slice(2)) {
  const args=options(argv);
  if(args.command==='help'){console.log(help);return;}
  need(['inspect','prepare','status','open','export','plugin'].includes(args.command),'Use inspect, prepare, status, open, export or plugin.');
  need(args.toolkit,'Select --toolkit /absolute/checkout-or-installed-package.');
  need(!args.port||args.command==='open','Only Open accepts a local port.');
  need(!args.out||['export','plugin'].includes(args.command),'Only Export or Plugin accepts --out.');
  const selected=await native(args.toolkit);
  if(args.command==='plugin') {
    need(args.out,'Plugin preparation needs --out /absolute/new-directory.');
    const result=await plugin(selected,args.out);console.log(JSON.stringify(result,null,2));return result;
  }
  const state=await inspectInputs(selected),s=state.setting;
  if(args.command==='inspect'){console.log(JSON.stringify(state.summary,null,2));return state.summary;}
  if(args.command==='prepare') {
    if(s.connectionFile)await privateParent(s.connectionFile);
    const named=prefix=>Object.fromEntries([...state.roles.entries()].filter(([key])=>key.startsWith(prefix+':'))
      .map(([,row])=>[row.row.alias,row.file.path]));
    const result=await selected.module.setupCocartWorkspace({
      directory:s.workspaceDirectory,
      ...(state.primary.row.kind==='profile'?{profileFile:state.primary.file.path}:{receivingFile:state.primary.file.path}),
      ...(state.transport?{receivingTransportFile:state.transport.file.path}:{}),
      sdkModule:state.sdk.entry,connectionFile:s.connectionFile||undefined,alias:s.workspaceAlias,label:s.label,
      handoffs:named('handoff'),receivingInputs:named('receivingInput'),
      merchantDirectory:s.merchantDirectory||undefined,merchantName:s.label
    });
    for(const original of state.files){const current=await regular(original.path,{maximum:original.role==='handoff'?65536:MAX});need(current.sha256===original.sha256&&current.size===original.bytes,'An original input changed during setup. Inspect the retained native workspace before continuing.');}
    if(state.primary.row.kind==='profile')need(result.workspace.profileSourceSha256===state.primary.file.sha256,'The native workspace selected different profile bytes.');
    // CartWorkspace.receive validates the original marker and first-receive revision.
    // A repeated same-input receive preserves the customer's subsequent native history.
    const receiving=state.primary.row.kind==='receiving'?{
      inputWorkspaceVersion:state.primary.value.workspace_version,
      currentWorkspaceVersion:result.workspace.version,
      inputContentSha256:state.primary.value.content_sha256
    }:null;
    console.log(JSON.stringify({inspection:state.summary,result,receiving},null,2));return result;
  }
  const identity=await selected.module.inspectCocartWorkspace(s.workspaceDirectory);
  if(args.command==='status') {
    const result={workspace:identity,source:selected.source,sdk:state.sdk};
    console.log(JSON.stringify(result,null,2));return result;
  }
  if(args.command==='export') {
    need(args.out,'Export needs --out /absolute/new-receiving.json.');
    const workspace=new selected.workspace.CartWorkspace({root:s.workspaceDirectory});
    // The native reader captures one original revision; all referenced objects are immutable.
    // The original receiver validates its complete closure before publication.
    const bytes=workspace.receivingBundle(),value=selected.workspace.inspectReceiving(bytes);
    const result={...await writeExact(args.out,bytes),schema:value.schema,
      workspaceVersion:value.workspace_version,contentSha256:value.content_sha256,
      revision:value.workspace.revision,carts:value.workspace.carts.length,objects:value.objects.length};
    console.log(JSON.stringify(result,null,2));return result;
  }
  const port=args.port===undefined?0:Number(args.port);
  need(Number.isInteger(port)&&port>=0&&port<=65535,'Choose a loopback port from 0 to 65535.');
  return selected.module.main(['serve','--directory',s.workspaceDirectory,'--sdk',state.sdk.entry,'--port',String(port),
    ...(s.connectionFile?['--connection',s.connectionFile,'--alias',s.workspaceAlias]:[])]);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{console.error(JSON.stringify(error.toJSON?.()??{error:error.name,message:error.message}));process.exitCode=1;});
