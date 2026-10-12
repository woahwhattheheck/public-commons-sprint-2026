#!/usr/bin/env node
import { readFile, mkdir, open, rename, unlink, link } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { openOpportunityStore } from './model.mjs';
import { startOpportunityWorkspace, opportunityExport } from './server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_INPUT = 256 * 1024 * 1024;
const HELP = [
  'Opportunity operations — source, capability, response and receiving workspace',
  '',
  'node cli.mjs <command> --workspace <directory> [options]',
  '',
  'serve    [--port 0] [--operator "Name"] [--dossier-directory dir] [--award-directory dir]',
  'list',
  'show     --id opp_ID [--revision N]',
  'seed     [--input references/operator-seed.json] [--operator "Name"]',
  'action   --action ACTION --input payload.json',
  'source   --id opp_ID --source src_SHA256 [--out original.file] [--force]',
  'compare  --id opp_ID --before N --after N',
  'export   --id opp_ID --out file [--format portable|html|md|requirements|capabilities|teaming|milestones|questions]',
  '         [--package pkg_ID | --revision N] [--force]',
  'receive  --input opportunity-package.json',
  '',
  'All mutations are local to --workspace. JSON input may be "-" for stdin.',
  'action takes the exact engine payload, including expectedRevision on existing projects.',
  'seed retains seven issued/company/award sources and all 34 MCC requirement items.',
  'It resumes the same intake after interruption using its original prepared calls.',
  'serve prints a private loopback URL; keep its fragment token with the operator.',
  'export writes a complete portable packet by default. Named packages retain their reviewed revision.',
  'Existing export files require --force. Files and state use owner-only permissions.',
  'Guide: README.md',
].join('\n');

function fail(message, code='INVALID_ARGUMENT') {
  const error = new Error(message); error.code = code; throw error;
}
function parse(argv) {
  const args = [...argv]; const command = args.shift() || 'help'; const flags = {};
  for (let i=0; i<args.length; i++) {
    const arg = args[i]; if (!arg.startsWith('--')) fail('Unexpected positional argument: '+arg);
    const split = arg.indexOf('='); const key = arg.slice(2, split < 0 ? undefined : split);
    if (!key || Object.hasOwn(flags,key)) fail('Missing or repeated option: '+arg);
    if (['help','force'].includes(key)) { if(split>=0) fail('--'+key+' is a flag'); flags[key]=true; continue; }
    const value = split>=0 ? arg.slice(split+1) : args[++i];
    if (value===undefined || value.startsWith('--')) fail('--'+key+' requires a value');
    flags[key]=value;
  }
  return {command,flags};
}
function required(flags,key) { if(!flags[key]) fail('--'+key+' is required'); return flags[key]; }
function positiveInteger(value,label,{zero=false}={}) {
  if (!/^\d+$/.test(String(value))) fail(label+' must be an integer');
  const number=Number(value);
  if (!Number.isSafeInteger(number) || number<(zero?0:1)) fail(label+' is out of range');
  return number;
}
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function utf8Bytes(value) { return Buffer.byteLength(value,'utf8'); }
function json(value) { return JSON.stringify(value,null,2)+'\n'; }
async function inputText(path) {
  if(path==='-') {
    const chunks=[];let bytes=0;
    for await(const chunk of process.stdin) {
      const data=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
      bytes+=data.length;if(bytes>MAX_INPUT) fail('Input exceeds the 256 MiB local packet limit','INPUT_TOO_LARGE');
      chunks.push(data);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  const handle=await open(resolve(path),'r');
  try {
    if((await handle.stat()).size>MAX_INPUT) fail('Input exceeds the 256 MiB local packet limit','INPUT_TOO_LARGE');
    const data=await handle.readFile();
    if(data.length>MAX_INPUT) fail('Input exceeds the 256 MiB local packet limit','INPUT_TOO_LARGE');
    return data.toString('utf8');
  } finally {await handle.close();}
}
function parseJson(text,label) {
  try { return JSON.parse(text); } catch { fail(label+' must contain complete JSON','INVALID_JSON'); }
}
async function syncDirectory(directory) {
  let handle;
  try { handle=await open(directory,'r'); await handle.sync(); }
  finally { if(handle) await handle.close(); }
}
async function atomicWrite(path, bytes, {replace=true}={}) {
  const target=resolve(path); await mkdir(dirname(target),{recursive:true,mode:0o700});
  const temporary=target+'.tmp-'+randomUUID(); let handle;
  try {
    handle=await open(temporary,'wx',0o600); await handle.writeFile(bytes); await handle.sync();
    await handle.close(); handle=null;
    if(replace) await rename(temporary,target);
    else { await link(temporary,target); await unlink(temporary); }
    await syncDirectory(dirname(target));
  } catch(error) {
    if(handle) await handle.close().catch(()=>{});
    await unlink(temporary).catch(()=>{});
    if(error.code==='EEXIST') fail('Output already exists; choose a new --out or pass --force','OUTPUT_EXISTS');
    throw error;
  }
  return {path:target,bytes:Buffer.byteLength(bytes),sha256:hash(bytes)};
}
function pick(value,keys) {
  return Object.fromEntries(keys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
}
async function projectAfter(store,result,knownId) {
  const id=result?.project?.id || result?.id || knownId;
  if(!id) fail('The source operation did not return its project identity','INTAKE_RESULT');
  return store.get(id);
}

/**
 * Run the original complete seed against one durable store.
 * Each prepared action is written before dispatch and replayed byte-for-byte after
 * an uncertain return. Finished steps are not regenerated into a second project.
 */
export async function seedOpportunityWorkspace({
  store, directory, seed, seedText, operator='Opportunity operator', onProgress,
}={}) {
  if(!store || !directory) fail('seed requires store and directory');
  const original=seedText ?? json(seed);
  const data=seed ?? parseJson(original,'Seed');
  if(data.schema!=='tjlabs.lgndx.operator-seed.v1') fail('Unsupported operator seed schema','SEED_SCHEMA');
  if(!Array.isArray(data.sources)||!Array.isArray(data.requirements)||!Array.isArray(data.capabilities)||!Array.isArray(data.questions)) fail('The complete seed arrays are required','SEED_SCHEMA');
  const seedSha256=hash(original);
  const sourceKeys=new Set();
  for(const source of data.sources) {
    if(!source.key||sourceKeys.has(source.key)) fail('Seed source keys must be unique','SEED_SCHEMA');
    sourceKeys.add(source.key);
    const payload=source.payload;
    if(!payload||typeof payload.contentText!=='string') fail('Each seed source must embed its retained original text','SEED_SCHEMA');
    if(hash(payload.contentText)!==source.sha256||utf8Bytes(payload.contentText)!==source.bytes) fail('Seed source digest or byte count changed: '+source.key,'SEED_SOURCE_MISMATCH');
  }
  const intakeDirectory=join(resolve(directory),'intake');
  const journalPath=join(intakeDirectory,'seed-'+seedSha256+'.json');
  let journal;
  try { journal=parseJson(await readFile(journalPath,'utf8'),'Intake journal'); }
  catch(error) { if(error.code!=='ENOENT') throw error; }
  if(journal && (journal.schema!=='stellar-forge.opportunity-intake.v1'||journal.seedSha256!==seedSha256)) fail('Intake journal belongs to a different source','INTAKE_MISMATCH');
  const resumed=!!journal;
  if(journal && journal.operator!==operator) fail('Resume the intake with its original --operator label','INTAKE_OPERATOR');
  if(!journal) {
    journal={
      schema:'stellar-forge.opportunity-intake.v1', seedSha256, operator,
      createdAt:new Date().toISOString(), projectId:null, sourceMap:{},
      steps:{}, pending:null, status:'running',
    };
    await atomicWrite(journalPath,json(journal));
  }
  const persist=async()=>{journal.updatedAt=new Date().toISOString();await atomicWrite(journalPath,json(journal));};
  async function execute(key,action,makePayload) {
    if(journal.steps[key]) return journal.steps[key];
    if(journal.pending && journal.pending.key!==key) fail('Resume the original pending intake action before changing its sequence','INTAKE_ORDER');
    if(!journal.pending) {
      const current=journal.projectId?await store.get(journal.projectId):null;
      const payload=await makePayload(current);
      if(action!=='create') {payload.id=journal.projectId;payload.expectedRevision=current.revision;}
      payload.requestId='seed-'+seedSha256.slice(0,32)+'-'+key;
      journal.pending={key,action,payload,preparedAt:new Date().toISOString()};
      await persist();
    }
    const pending=journal.pending;
    const result=await store.dispatch(pending.action,pending.payload);
    const project=await projectAfter(store,result,journal.projectId);
    journal.projectId=project.id;
    const completed={
      action,projectId:project.id,revision:project.revision,completedAt:new Date().toISOString(),
    };
    if(action==='retain_source') {
      const originalSource=data.sources.find(item=>'source-'+item.key===key);
      const match=project.sources.find(item=>item.sha256===originalSource.sha256 && item.role===originalSource.payload.role);
      if(!match) fail('Retained source is absent from its committed project: '+originalSource.key,'INTAKE_RESULT');
      completed.sourceId=match.id; journal.sourceMap[originalSource.key]=match.id;
    }
    journal.steps[key]=completed; journal.pending=null; await persist();
    if(onProgress) await onProgress({key,...completed});
    return completed;
  }
  const evidence=(items=[])=>items.map(item=>{
    const sourceId=item.sourceId||journal.sourceMap[item.sourceKey];
    if(!sourceId) fail('Seed evidence refers to an unresolved source: '+item.sourceKey,'SEED_REFERENCE');
    return {sourceId,locator:item.locator,...(item.excerpt?{excerpt:item.excerpt}:{})};
  });
  await execute('create','create',async()=>pick(data,['title','description','company','opportunity']));
  for(const source of data.sources) await execute('source-'+source.key,'retain_source',async()=>({...source.payload}));
  if(data.responseRules) await execute('response-rules','update',async()=>({
    responseRules:{...data.responseRules,evidence:evidence(data.responseRules.evidence)},
  }));
  for(let i=0;i<data.requirements.length;i++) {
    const item=data.requirements[i];
    await execute('requirement-'+String(i+1).padStart(2,'0'),'save_requirement',async()=>({
      ...pick(item,['number','title','text','category','mandatory','responseDisposition','owner','status','evidenceRule']),
      evidence:evidence(item.evidence),
    }));
  }
  for(let i=0;i<data.capabilities.length;i++) {
    const item=data.capabilities[i];
    await execute('capability-'+String(i+1).padStart(2,'0'),'save_capability',async()=>({
      ...pick(item,['title','kind','description','owner','status','tags','deliveryStatus']),
      evidence:evidence(item.evidence),
    }));
  }
  for(let i=0;i<data.questions.length;i++) {
    const item=data.questions[i];
    await execute('question-'+String(i+1).padStart(2,'0'),'save_question',async()=>({
      text:(item.topic?item.topic+': ':'')+item.text, owner:'', status:'open',
      evidence:evidence((item.sources||[]).map(sourceKey=>({sourceKey,locator:'Retained source; exact question text records the affected issue'}))),
    }));
  }
  journal.status='complete'; journal.completedAt=journal.completedAt||new Date().toISOString(); await persist();
  const project=await store.get(journal.projectId);
  return {projectId:project.id,revision:project.revision,journalPath,seedSha256,
    sources:project.sources.length,requirements:project.requirements.length,
    capabilities:project.capabilities.length,questions:project.questions.length,
    completedSteps:Object.keys(journal.steps).length,resumed};
}

export async function runOpportunityCli(argv=process.argv.slice(2), options={}) {
  const {command,flags}=parse(argv);
  const output=options.output||((value)=>process.stdout.write(typeof value==='string'?value+'\n':json(value)));
  if(command==='help'||flags.help||command==='--help') {output(HELP);return {help:true};}
  const allowed=['serve','list','show','seed','action','source','compare','export','receive'];
  if(!allowed.includes(command)) fail('Unknown command '+command+'; use help');
  const directory=resolve(flags.workspace||'opportunity-workspace');
  const operator=flags.operator||'Opportunity operator';
  const dossierDirectory=flags['dossier-directory']?resolve(flags['dossier-directory']):undefined;
  const awardDirectory=flags['award-directory']?resolve(flags['award-directory']):undefined;
  if(command==='serve') {
    const port=positiveInteger(flags.port??'0','--port',{zero:true});
    if(port>65535) fail('--port must be between 0 and 65535');
    const server=await startOpportunityWorkspace({directory,operator,dossierDirectory,awardDirectory,port});
    output({url:server.url,directory,operator});
    if(options.waitForClose===false) return server;
    await new Promise((resolveWait,rejectWait)=>{
      let closing=false;
      const close=async()=>{
        if(closing) return;closing=true;
        process.off('SIGINT',close);process.off('SIGTERM',close);
        try{await server.close();resolveWait();}catch(error){rejectWait(error);}
      };
      process.once('SIGINT',close);process.once('SIGTERM',close);
    });
    return {closed:true};
  }
  const store=await openOpportunityStore({directory,operator,dossierDirectory,awardDirectory});
  try {
    let result;
    if(command==='list') result=await store.list();
    else if(command==='show') result=await store.get(required(flags,'id'),{
      ...(flags.revision?{revision:positiveInteger(flags.revision,'--revision')}:{})
    });
    else if(command==='seed') {
      const seedPath=flags.input||join(HERE,'references','operator-seed.json');
      const seedText=await inputText(seedPath);
      result=await seedOpportunityWorkspace({store,directory,seedText,operator,
        onProgress:options.onProgress});
    } else if(command==='action') {
      const payload=parseJson(await inputText(required(flags,'input')),'Action payload');
      result=await store.dispatch(required(flags,'action'),payload);
    } else if(command==='source') {
      const source=await store.dispatch('read_source',{id:required(flags,'id'),sourceId:required(flags,'source')});
      if(flags.out) {
        const bytes=Buffer.from(source.contentBase64,'base64');
        result={source:source.source,...await atomicWrite(flags.out,bytes,{replace:!!flags.force})};
      } else result=source;
    } else if(command==='compare') {
      result=await store.dispatch('compare',{
        id:required(flags,'id'),before:positiveInteger(required(flags,'before'),'--before'),
        after:positiveInteger(required(flags,'after'),'--after'),
      });
    } else if(command==='export') {
      if(flags.package&&flags.revision) fail('Select either --package or --revision');
      const exported=await opportunityExport(store,required(flags,'id'),{
        format:flags.format==='md'?'markdown':(flags.format||'portable'),packageId:flags.package,
        ...(flags.revision?{revision:positiveInteger(flags.revision,'--revision')}:{})
      });
      const bytes=Buffer.isBuffer(exported.bytes)?exported.bytes:Buffer.from(exported.bytes);
      result={...await atomicWrite(required(flags,'out'),bytes,{replace:!!flags.force}),
        mediaType:exported.mediaType,filename:exported.filename};
    } else if(command==='receive') {
      const packet=parseJson(await inputText(required(flags,'input')),'Opportunity packet');
      result=await store.importPackage(packet);
    }
    output(result);return result;
  } finally {await store.close();}
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  runOpportunityCli().catch(error=>{
    process.stderr.write(JSON.stringify({error:error.code||'OPPORTUNITY_ERROR',message:error.message})+'\n');
    process.exitCode=1;
  });
}
