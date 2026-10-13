// MIT. Complete original Source Desk collection receiving with durable private checkpoints.
import {readFile,open,link,unlink,mkdir,realpath,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,dirname,basename,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {GrantWorkspaceClient,inspectGrantAgentBinding,readGrantAgentFile} from './agent-client.mjs';
import {SOURCE_COLLECTION_MAX_COPY_BYTES,InstallationSourceCollectionStore} from './installation-source-collection-store.mjs';
import {initializeInstallationSourceCollection,openInstallationSourceCollection,
  performInstallationSourceCollection,SOURCE_COLLECTION_ACTIONS} from './installation-source-collection-session.mjs';

export const SOURCE_COLLECTION_CLI_SCHEMA='stellar-forge.installation-source-collection-cli.v1';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'SOURCE_COLLECTION_CLI_INPUT'});};
const decode=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
const help=[
  'starforge grant-source-collection <command> --workspace DIR --store PRIVATE_DIR --actor NAME [options]',
  '',
  'create --case CASE_ID --draft DRAFT_ID [--name NAME] [--staff-context JSON_FILE]',
  'import --file COMPLETE_BROWSER_WORKING_COPY.json',
  'inspect | history | export --out NEW_PRIVATE_FILE [--sequence N]',
  'start | edit | use-existing | clear-existing --input ARGUMENTS.json --expected-sequence N',
  'stage --input FILE_SELECTION.json --expected-sequence N',
  'review | refresh | retire-rejected --expected-sequence N',
  'receive --expected-signature SHA256 --expected-sequence N',
  'reconcile [--retry] --expected-sequence N',
  '',
  'FILE_SELECTION.json: {"files":[{"path":"/absolute/file","name":"Original.pdf","type":"application/pdf",',
  '  "expectedSha256":"complete sha256","lastModified":0}]}',
  'Each original file is <=8 MiB; staged bytes <=64 MiB. Full browser copy <=512 MiB.',
  'New collection defaults: {"title":"...","sourceUrl":"https://...","observedAt":"..."}',
  'edit input: {"rowId":"...","field":"sourceUrl|observedAt|filename|mediaType|included","value":"..."}',
  'use-existing input: {"rowId":"...","selection":{"revision":1,"fileId":"input-...",',
  ' "sha256":"...","bytes":1,"filename":"..."}}. Copy the exact IDENTICAL review identity.',
  '',
  'Optional: --note TEXT --python ABSOLUTE_PYTHON --scenario FILE --allow-start.',
  'The configured original service is borrowed. --allow-start explicitly allows its original launcher.',
  'All complete checkpoints and native requests remain in --store. Reopen the same store after interruption.',
  'export writes a complete browser-importable copy; history lists exact immutable sequences.',
].join('\n')+'\n';
function parse(argv){
  const [command,...rest]=argv,flags={};
  for(let i=0;i<rest.length;i++){
    const key=rest[i];need(/^--[a-z-]+$/.test(key),'Use declared named options.');
    need(!Object.hasOwn(flags,key),'Use each option once.');
    if(['--retry','--allow-start','--help'].includes(key))flags[key]=true;
    else{need(i+1<rest.length&&!rest[i+1].startsWith('--'),'Supply '+key+'.');flags[key]=rest[++i];}
  }
  const allowed=['--workspace','--store','--actor','--note','--python','--scenario','--allow-start','--case','--draft',
    '--name','--staff-context','--file','--input','--out','--sequence','--expected-sequence','--expected-signature','--retry','--help'];
  need(Object.keys(flags).every(key=>allowed.includes(key)),'Use the declared complete command options.');
  return {command,flags};
}
function number(value,label){need(typeof value==='string'&&/^(0|[1-9]\d*)$/.test(value)&&Number.isSafeInteger(Number(value)),
  'Use the exact original '+label+'.');return Number(value);}
async function originalJSON(file,maximum=32*1024*1024){return decode(await readGrantAgentFile(resolve(file),maximum));}
async function prepareParent(file){
  const parent=dirname(file),stat=await lstat(parent);
  need(stat.isDirectory()&&!stat.isSymbolicLink()&&await realpath(parent)===parent&&
    (process.platform==='win32'||stat.uid===process.getuid()&&(stat.mode&0o077)===0),
    'Choose an existing owned private parent directory.');
}
async function saveNew(file,bytes){
  await prepareParent(file);const pending=join(dirname(file),'pending-'+randomUUID());
  const handle=await open(pending,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  try{
    try{await link(pending,file);}
    catch(error){if(error.code!=='EEXIST')throw error;
      const original=await readGrantAgentFile(file,SOURCE_COLLECTION_MAX_COPY_BYTES);
      need(original.equals(bytes),'The output path already contains a different complete original.');}
    await unlink(pending);const directory=await open(dirname(file),constants.O_RDONLY|(constants.O_DIRECTORY??0));
    try{await directory.sync();}finally{await directory.close();}
  }finally{await unlink(pending).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  return {path:file,bytes:bytes.length,sha256:hash(bytes)};
}
async function stageOriginals(value){
  need(value&&Array.isArray(value.files)&&value.files.length>0,'Select complete original source files.');
  const files=[];let total=0;
  for(const row of value.files){
    need(row&&typeof row.path==='string'&&typeof row.name==='string'&&typeof row.type==='string'&&
      typeof row.expectedSha256==='string'&&/^[a-f0-9]{64}$/.test(row.expectedSha256),
      'Keep each original path, receiving filename, media type and reviewed SHA256.');
    const bytes=await readGrantAgentFile(resolve(row.path),8*1024*1024);total+=bytes.length;
    need(bytes.length>0&&hash(bytes)===row.expectedSha256&&total<=64*1024*1024,
      'The original source selection changed or exceeds the staged limit.');
    files.push({name:row.name,type:row.type,lastModified:row.lastModified??0,bytes:bytes.length,
      sha256:row.expectedSha256,contentBase64:bytes.toString('base64')});
  }
  return {files};
}
export async function runInstallationSourceCollectionCLI(argv,{stdout=process.stdout}={}){
  const {command,flags:f}=parse(argv);
  if(!command||command==='help'||command==='--help'||f['--help']){stdout.write(help);return {help:true};}
  const action=command.replaceAll('-','_');
  need(['create','import','inspect','history','export',...Object.keys(SOURCE_COLLECTION_ACTIONS)].includes(action),
    'Choose a declared original collection command.');
  need(f['--workspace']&&f['--store']&&f['--actor'],'Choose the original workspace, private store and recording actor.');
  const workspaceDirectory=await realpath(resolve(f['--workspace'])),directory=resolve(f['--store']),
    context={actor:f['--actor'],...(f['--note']===undefined?{}:{note:f['--note']})};
  let result;
  if(action==='history'||action==='export'){
    const store=await new InstallationSourceCollectionStore({directory,workspaceDirectory}).init();
    if(action==='history')result=await store.history();
    else{
      need(f['--out'],'Choose a new private output path.');
      const options=f['--sequence']===undefined?{}:{sequence:number(f['--sequence'],'sequence')};
      const bytes=await store.export(options);result=await saveNew(resolve(f['--out']),bytes);
    }
  }else{
    const binding=await inspectGrantAgentBinding({directory:workspaceDirectory,
      ...(f['--python']?{pythonExecutable:resolve(f['--python'])}:{}),
      ...(f['--scenario']?{scenarioFile:resolve(f['--scenario'])}:{}),allowStart:f['--allow-start']===true});
    const client=new GrantWorkspaceClient(binding);let primary;
    try{
      let session;
      if(action==='create'||action==='import'){
        await prepareParent(directory);
        let workingCopy,originalBytes,staffContext=null;
        if(action==='import'){
          need(f['--file'],'Choose the complete original browser working-copy file.');
          originalBytes=await readGrantAgentFile(resolve(f['--file']),SOURCE_COLLECTION_MAX_COPY_BYTES);
          workingCopy=decode(originalBytes);
        }else if(f['--staff-context'])staffContext=await originalJSON(f['--staff-context'],128*1024);
        if(action==='create')await client.open({expectedSelectionSha256:binding.selectionSha256});
        session=await initializeInstallationSourceCollection({directory,workspaceDirectory,client,context,workingCopy,
          originalBytes,caseId:f['--case'],draftId:f['--draft'],name:f['--name'],staffContext});
        result=session.agent.inspect();
      }else{
        const mutation=action!=='inspect';
        need(!mutation||f['--expected-sequence']!==undefined,'Select the current complete working-copy sequence.');
        session=await openInstallationSourceCollection({directory,workspaceDirectory,client,context,
          ...(f['--expected-sequence']===undefined?{}:{expectedSequence:number(f['--expected-sequence'],'sequence')})});
        if(action==='inspect')result=session.agent.inspect();
        else{
          let args=f['--input']?await originalJSON(f['--input']):{};
          if(action==='stage')args=await stageOriginals(args);
          if(action==='receive'){
            need(f['--expected-signature'],'Use the exact reviewed collection signature.');
            args={expectedSignature:f['--expected-signature']};
          }else if(action==='reconcile')args={retry:f['--retry']===true};
          if(['refresh','review','receive','reconcile','retire_rejected','use_existing'].includes(action))
            await client.open({expectedSelectionSha256:binding.selectionSha256});
          if(action==='receive'){
            const pause=()=>session.agent.pause();process.once('SIGINT',pause);
            try{result=await performInstallationSourceCollection(session.agent,action,args);}
            finally{process.removeListener('SIGINT',pause);}
          }else result=await performInstallationSourceCollection(session.agent,action,args);
        }
      }
    }catch(error){primary=error;throw error;}
    finally{try{await client.close();}catch(error){if(!primary)throw error;}}
  }
  const output={schema:SOURCE_COLLECTION_CLI_SCHEMA,command,workspaceDirectory,directory,result};
  stdout.write(JSON.stringify(output)+'\n');return output;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  runInstallationSourceCollectionCLI(process.argv.slice(2)).catch(error=>{
    process.stderr.write(JSON.stringify({code:error.code??'SOURCE_COLLECTION_FAILED',message:error.message,
      status:error.status??null,uncertain:error.uncertain===true,outcomeUnknown:error.outcomeUnknown===true,
      reopenRequired:error.reopenRequired===true,requestId:error.requestId??null})+'\n');process.exitCode=1;
  });
