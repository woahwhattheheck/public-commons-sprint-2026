// MIT. The same retained actions for terminal operators and integration automation.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openStellarExpertWorkspace} from './core.mjs';
const USAGE=[
  'node cli.mjs --workspace PRIVATE_DIR [--inbox ORIGINAL_INBOX] schema|view',
  'node cli.mjs --workspace PRIVATE_DIR action --request PRIVATE_JSON [--wait]',
  'node cli.mjs --workspace PRIVATE_DIR editions [--offset 0] [--limit 100]',
  'node cli.mjs --workspace PRIVATE_DIR rows --edition SHA [--offset 0] [--limit 100]',
  'node cli.mjs --workspace PRIVATE_DIR export --id EXPORT_ID --out NEW_FILE',
  'node cli.mjs --workspace PRIVATE_DIR serve [--port 8436] [--release-runtime PRIVATE_JSON]',
  'Use --release-runtime PRIVATE_JSON for the original publisher port/facilitator on action or serve.',
  'Action JSON: {operationId,expectedRevision,action,payload}. Reuse the exact operationId after an interrupted response.',
  'The CLI and browser use the same private writer lease. Stop one before opening the other.'
].join('\n');
export async function main(args=process.argv.slice(2)){
  if(args.includes('--help')){console.log(USAGE);return;}
  const options={},words=[];
  for(let i=0;i<args.length;i++){
    const k=args[i];
    if(k==='--wait'){if(options[k])throw new TypeError('Duplicate --wait');options[k]=true;continue;}
    if(k.startsWith('--')){
      if(!['--workspace','--inbox','--request','--edition','--offset','--limit','--id','--out','--port','--release-runtime'].includes(k)||
        Object.hasOwn(options,k)||!args[i+1]||args[i+1].startsWith('--'))throw new TypeError(USAGE);
      options[k]=args[++i];
    }else words.push(k);
  }
  if(words.length!==1||!options['--workspace'])throw new TypeError(USAGE);
  const operation=words[0],permitted={
    schema:[],view:[],editions:['--offset','--limit'],rows:['--edition','--offset','--limit'],
    action:['--request','--wait'],export:['--id','--out'],serve:['--port']};
  if(!Object.hasOwn(permitted,operation)||Object.keys(options).some(k=>!['--workspace','--inbox','--release-runtime',...(permitted[operation]??[])].includes(k)))
    throw new TypeError(USAGE);
  for(const required of ({action:['--request'],rows:['--edition'],export:['--id','--out']}[operation]??[]))
    if(!options[required])throw new TypeError(required+' is required for '+operation+'.');
  if(operation==='serve')return(await import('./workspace.mjs')).main(['--workspace',options['--workspace'],
    ...(options['--inbox']?['--inbox',options['--inbox']]:[]),...(options['--port']?['--port',options['--port']]:[]),
    ...(options['--release-runtime']?['--release-runtime',options['--release-runtime']]:[])]);
  const app=await openStellarExpertWorkspace({directory:resolve(options['--workspace']),
    inboxDirectory:options['--inbox']?resolve(options['--inbox']):undefined,
    releaseRuntime:options['--release-runtime']?await(await import('./workspace.mjs')).readReleaseRuntime(options['--release-runtime']):undefined});
  try{
    let result;
    if(operation==='schema')result=app.schema();
    else if(operation==='view')result=await app.view();
    else if(operation==='editions')result=await app.editions({offset:Number(options['--offset']??0),limit:Number(options['--limit']??100)});
    else if(operation==='action'){
      const bytes=await readFile(options['--request']);if(bytes.length>128*1024)throw new TypeError('Request file exceeds128 KiB.');
      result=await app.action(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
      if(options['--wait']){await app.waitForCaptures();result.view=await app.view();}
    }else if(operation==='rows')result=await app.rows(options['--edition'],{offset:Number(options['--offset']??0),limit:Number(options['--limit']??100)});
    else if(operation==='export'){
      const selected=await app.exported(options['--id']);if(!options['--out'])throw new TypeError('--out is required.');
      await writeFile(resolve(options['--out']),selected.bytes,{flag:'wx',mode:0o600});
      result={...selected.item,destination:resolve(options['--out'])};
    }else throw new TypeError(USAGE);
    console.log(JSON.stringify(result,null,2));return result;
  }finally{await app.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(e=>{console.error(JSON.stringify({error:e.code??'STELLAR_CLI_ERROR',message:e.message,currentRevision:e.currentRevision??null}));process.exitCode=1;});
