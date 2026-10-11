#!/usr/bin/env node
// MIT. Launch and recover the original SF96 private provider workspace.
import {open as openFile, lstat} from 'node:fs/promises';
import {openSync,closeSync,writeSync} from 'node:fs';
import {ReadStream} from 'node:tty';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startProviderWorkspace} from './server.mjs';
import {validateProfiles} from './model.mjs';
import {createRecovery,inspectRecovery,restoreRecovery,inspectRestoreOperation,retireInterruptedRestore} from './archive.mjs';
import {absolutePath,privateDirectory,readJSON,encodeJSON,writeNew,replaceJSON,
  requireValue as need,nativeErrorCode} from '../operator-lock.mjs';

const usage = String.raw`Provider workspace — original SF96/SF88 operations

  node workspace/cli.mjs serve --state ABS_PRIVATE_DIRECTORY [--profiles ABS_JSON] [--port 8469]
  node workspace/cli.mjs profile --out ABS_JSON --id NAME --label LABEL --actor ACTOR
    --service SERVICE --payer PUBLIC_G_ADDRESS --python ABS_PYTHON
    [--secret-env NAME | --signer-provider ABS_MODULE] [--rpc HTTPS_URL]
    [--https-proxy HTTPS_URL | --https-proxy-env NAME] [--sandbox-egress-range 198.18.0.0/15]
    [--total-atomic INTEGER] [--daily-atomic INTEGER] [--max-response-bytes INTEGER]
    [--response-timeout-ms INTEGER] [--replace]
  node workspace/cli.mjs backup --dir ABS_CASE --out ABS_NEW.sf96case [--passphrase-env NAME]
  node workspace/cli.mjs inspect --archive ABS_FILE [--passphrase-env NAME]
  node workspace/cli.mjs restore --archive ABS_FILE --expect-directory ABS_ORIGINAL_CASE
    [--passphrase-env NAME]
  node workspace/cli.mjs restore-status --dir ABS_ORIGINAL_CASE
  node workspace/cli.mjs restore-retire --dir ABS_ORIGINAL_CASE --expect-operation-sha SHA256

The private browser desk binds to 127.0.0.1 and opens with the capability URL printed
at launch. Keep its terminal open. Native review/execute use that same terminal and
the original /dev/tty approval. Profiles contain public setup and secret references,
never wallet values. The original operator CLI continues to work.

Recovery encrypts the complete original case, including its accounting keys.
Restore refuses an existing destination and preserves the original absolute paths.
By default the passphrase is read without echo from /dev/tty.
`;
function options(argv,allowed,booleans=[]) {
  const out={};
  for(let i=0;i<argv.length;i++) {
    const key=argv[i];need(key.startsWith('--')&&allowed.includes(key)&&out[key]===undefined,'DESK_CLI_OPTION_INVALID');
    if(booleans.includes(key)){out[key]=true;continue;}
    need(typeof argv[i+1]==='string'&&!argv[i+1].startsWith('--'),'DESK_CLI_VALUE_REQUIRED');out[key]=argv[++i];
  }
  return out;
}
function hiddenPrompt(label) {
  return new Promise((accept,reject)=>{
    let fd,input,value='',finished=false;
    const finish=(error)=>{
      if(finished)return;finished=true;
      try{input.setRawMode(false);}catch{}
      input.removeAllListeners('data');input.pause();
      try{writeSync(fd,'\n');}catch{}
      input.once('close',()=>{if(error)reject(error);else accept(value);});
      input.destroy();
    };
    try {
      fd=openSync('/dev/tty','r+');input=new ReadStream(fd);
      need(input.isTTY,'RECOVERY_TRUSTED_TERMINAL_REQUIRED');input.setEncoding('utf8');input.setRawMode(true);
      writeSync(fd,label);input.on('error',finish);
      input.on('data',chunk=>{
        for(const char of chunk) {
          if(char==='\r'||char==='\n'){finish();return;}
          if(char==='\u0003'||char==='\u0004'){finish(Object.assign(new Error('RECOVERY_CANCELLED'),{code:'RECOVERY_CANCELLED'}));return;}
          if(char==='\u007f'||char==='\b'){value=Array.from(value).slice(0,-1).join('');continue;}
          if(char>='\u0020'&&char!=='\u007f')value+=char;
          if(Buffer.byteLength(value)>4096){finish(Object.assign(new Error('RECOVERY_PASSPHRASE_TOO_LONG'),{code:'RECOVERY_PASSPHRASE_TOO_LONG'}));return;}
        }
      });input.resume();
    }catch(error){if(input)finish(error);else{try{if(fd!==undefined)closeSync(fd);}catch{}reject(error);}}
  });
}
async function passphrase(opts,repeat=false) {
  if(opts['--passphrase-env']) {
    const name=opts['--passphrase-env'];need(/^[A-Z][A-Z0-9_]{0,127}$/.test(name),'RECOVERY_ENV_NAME_INVALID');
    const value=process.env[name];need(typeof value==='string'&&value.length>=12,'RECOVERY_PASSPHRASE_MINIMUM_12_CHARACTERS');return value;
  }
  const value=await hiddenPrompt('Recovery passphrase: ');
  need(value.length>=12,'RECOVERY_PASSPHRASE_MINIMUM_12_CHARACTERS');
  if(repeat)need(value===await hiddenPrompt('Repeat passphrase: '),'RECOVERY_PASSPHRASES_DIFFER');return value;
}
async function profileCommand(argv) {
  const fields={id:'id',label:'label',actor:'actor',service:'service',payer:'payer',python:'python',
    'secret-env':'secretEnv','signer-provider':'signerProvider',rpc:'rpc',
    'https-proxy':'httpsProxy','https-proxy-env':'httpsProxyEnv','sandbox-egress-range':'sandboxEgressRange',
    'total-atomic':'totalAtomic','daily-atomic':'dailyAtomic','max-response-bytes':'maxResponseBytes',
    'response-timeout-ms':'responseTimeoutMs'};
  const opts=options(argv,['--out','--replace',...Object.keys(fields).map(k=>'--'+k)],['--replace']);
  const path=absolutePath(opts['--out']);await privateDirectory(dirname(path));
  const profile={};
  for(const[key,field]of Object.entries(fields))if(opts['--'+key]!==undefined) {
    const raw=opts['--'+key];
    if(['maxResponseBytes','responseTimeoutMs'].includes(field)){
      need(/^[1-9][0-9]*$/.test(raw)&&Number.isSafeInteger(Number(raw)),'DESK_PROFILE_LIMIT_INVALID');profile[field]=Number(raw);
    }else profile[field]=raw;
  }
  let document,exists=true;
  try{document=await readJSON(path,65536);}catch(error){if(error.code!=='ENOENT')throw error;exists=false;document={schema:'scf.sf96.host-profiles.v1',profiles:[]};}
  const current=validateProfiles(document),index=current.findIndex(p=>p.id===profile.id);
  need(index<0||opts['--replace'],'DESK_PROFILE_ALREADY_EXISTS');
  need(!opts['--replace']||index>=0,'DESK_PROFILE_REPLACE_ID_NOT_FOUND');
  const profiles=[...current];if(index>=0)profiles[index]=profile;else profiles.push(profile);
  const value={schema:'scf.sf96.host-profiles.v1',profiles};validateProfiles(value);
  if(exists)await replaceJSON(path,value);else await writeNew(path,encodeJSON(value));
  process.stdout.write(JSON.stringify({status:'HOST_PROFILE_SAVED',path,id:profile.id,profiles:profiles.length,loadedWallet:false})+'\n');
}
export async function main(argv=process.argv.slice(2)) {
  const[name,...rest]=argv;
  if(!name||name==='help'||name==='--help'){process.stdout.write(usage);return;}
  need(Number(process.versions.node.split('.')[0])>=22,'DESK_NODE_22_OR_NEWER_REQUIRED');
  if(name==='profile')return profileCommand(rest);
  if(name==='serve') {
    const opts=options(rest,['--state','--profiles','--port']);
    const port=opts['--port']===undefined?8469:Number(opts['--port']);
    need(opts['--port']===undefined||/^(0|[1-9][0-9]{0,4})$/.test(opts['--port']),'DESK_PORT_INVALID');
    const server=await startProviderWorkspace({stateDirectory:absolutePath(opts['--state']),
      profilesPath:opts['--profiles']?absolutePath(opts['--profiles']):null,port});
    process.stdout.write(JSON.stringify({status:'PROVIDER_WORKSPACE_READY',url:server.url,stateDirectory:server.model.root,
      execution:'ORIGINAL_TRUSTED_TERMINAL'})+'\n');
    let closing=false;
    const close=()=>{if(closing)return;closing=true;server.close().catch(error=>{
      process.stderr.write(nativeErrorCode(error)+'\n');process.exitCode=1;
    });};
    process.once('SIGINT',close);process.once('SIGTERM',close);return;
  }
  if(name==='restore-status') {
    const opts=options(rest,['--dir']);
    process.stdout.write(JSON.stringify(await inspectRestoreOperation(opts['--dir']),null,2)+'\n');return;
  }
  if(name==='restore-retire') {
    const opts=options(rest,['--dir','--expect-operation-sha']);
    process.stdout.write(JSON.stringify(await retireInterruptedRestore(opts['--dir'],opts['--expect-operation-sha']),null,2)+'\n');return;
  }
  if(name==='backup') {
    const opts=options(rest,['--dir','--out','--passphrase-env']),secret=await passphrase(opts,true);
    const result=await createRecovery(opts['--dir'],opts['--out'],secret);
    process.stdout.write(JSON.stringify(result,null,2)+'\n');return;
  }
  if(name==='inspect') {
    const opts=options(rest,['--archive','--passphrase-env']),secret=await passphrase(opts);
    const result=await inspectRecovery(opts['--archive'],secret);
    process.stdout.write(JSON.stringify({manifest:result.manifest,files:result.entries.length},null,2)+'\n');return;
  }
  if(name==='restore') {
    const opts=options(rest,['--archive','--expect-directory','--passphrase-env']),secret=await passphrase(opts);
    const result=await restoreRecovery(opts['--archive'],secret,{expectedDirectory:opts['--expect-directory']});
    process.stdout.write(JSON.stringify(result,null,2)+'\n');return;
  }
  need(false,'DESK_CLI_COMMAND_INVALID');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===absolutePath(process.argv[1]))
  main().catch(error=>{process.stderr.write(nativeErrorCode(error)+'\n');process.exitCode=1;});
