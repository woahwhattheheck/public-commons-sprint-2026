// MIT. Retained HUD source and original publisher operation.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile,writeFile } from 'node:fs/promises';
import { openHudApplication } from './application.mjs';
import { startHudServer } from './server.mjs';
import { openHudSourcePacket } from './release.mjs';

const HELP=`HUD Section 8 published-source application
  hud init --workspace DIR
  hud import --workspace DIR --metadata JSON --capture-dir DIR
  hud import-packet --workspace DIR --input JSON
  hud source-packet --workspace DIR --out JSON
  hud acquire --workspace DIR --metadata JSON
  hud serve --workspace DIR [--port 8458] [--start-merchant | --start-release] [--python python3]
      [--facilitator HTTPS_URL] [--allow-local-facilitator]
  hud status --workspace DIR
  hud select --workspace DIR --input JSON
  hud localities --workspace DIR [--input JSON]
  hud compare --workspace DIR --input JSON --out JSON
  hud export --workspace DIR [--input JSON] --out JSON
  hud plan --workspace DIR [--input JSON]
  hud extract --workspace DIR --plan NUMBER
  hud inspect --workspace DIR --run UUID [--query STRING]
  hud review --workspace DIR --input JSON
  hud publish --workspace DIR --input JSON
  hud recover --workspace DIR --run UUID
  hud merchant-configure --workspace DIR --input JSON
  hud publication-handoff --workspace DIR --run UUID --out JSON
  hud release-status --workspace DIR
  hud release-stage --workspace DIR --input JSON
  hud release-activate --workspace DIR --input JSON
  hud release-rollback --workspace DIR --input JSON

An existing running desk owns its original workspace lock. Use its authenticated
local HTTP/UI operation, or close it before using these direct commands.
Input paths are host-owned CLI arguments. Output files are create-only.
Import keeps four original public HUD documents and their four capture receipts.
The source selection uses explicit original county/locality/area identifiers.
`;
const allowed=new Set(['--facilitator','--workspace','--metadata','--capture-dir','--port','--python','--input','--out','--plan','--run','--query']);
export async function main(args=process.argv.slice(2)){
  if(!args.length||args.includes('--help')){process.stdout.write(HELP);return;}
  const [command,...tail]=args,options={};
  for(let i=0;i<tail.length;i++){
    const key=tail[i];
    if(['--start-merchant','--allow-local-facilitator','--start-release'].includes(key)){if(options[key])throw new TypeError('Duplicate option');options[key]=true;continue;}
    if(!allowed.has(key)||Object.hasOwn(options,key)||!tail[i+1]||tail[i+1].startsWith('--'))throw new TypeError('Invalid or missing option; use --help.');
    options[key]=tail[++i];
  }
  if(!options['--workspace'])throw new TypeError('--workspace is required.');
  const json=async name=>{
    if(!options[name])throw new TypeError(name+' is required.');
    const raw=await readFile(resolve(options[name]));if(raw.length>(command==='import-packet'?90*1024**2:262144))throw new RangeError('Input JSON exceeds the command intake limit.');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  };
  let nativeFactory=null;
  if(options['--facilitator']){
    const url=new URL(options['--facilitator']);
    const local=options['--allow-local-facilitator']&&url.protocol==='http:'&&url.hostname==='127.0.0.1';
    if(!local&&url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new TypeError('Use the original HTTPS facilitator URL, or explicitly allowed loopback HTTP.');
    const [{HTTPFacilitatorClient},{createNativeSellerServer}]=await Promise.all([import('@x402/core/server'),import('../native-factory.mjs')]);
    nativeFactory=compiled=>createNativeSellerServer(compiled,{facilitatorClient:new HTTPFacilitatorClient({url:url.href.replace(/\/$/,'')})});
  }else if(options['--allow-local-facilitator'])throw new TypeError('--allow-local-facilitator requires --facilitator.');
  const app=await openHudApplication({nativeFactory,directory:resolve(options['--workspace']),create:command==='init',python:options['--python']??'python3'});
  let server;
  try{
    if(command==='serve'){
      if(options['--start-merchant']&&options['--start-release'])throw new TypeError('Choose one original seller owner.');
      if(options['--start-merchant'])await app.startMerchant();
      if(options['--start-release'])await app.releaseLifecycle('start');
      server=await startHudServer({application:app,port:Number(options['--port']??8458)});
      process.stdout.write(JSON.stringify({workspace:app.directory,url:server.sessionUrl})+'\n');
      const stop=async()=>{await server.close();process.exitCode=0;};
      process.once('SIGINT',stop);process.once('SIGTERM',stop);
      await new Promise(resolveDone=>server.server.once('close',resolveDone));return;
    }
    let result;
    const input=()=>options['--input']?json('--input'):Promise.resolve({});
    if(command==='init'||command==='status')result=await app.status();
    else if(command==='import'||command==='acquire')result=await app.importRelease(await json('--metadata'),
      command==='import'?{sourceDirectory:resolve(options['--capture-dir']??(()=>{throw new TypeError('--capture-dir is required');})())}:{});
    else if(command==='import-packet'){
      const opened=openHudSourcePacket(await json('--input'));result=await app.importRelease(opened.metadata,{uploads:opened.uploads});
    }else if(command==='source-packet')result=await app.sourcePacket();
    else if(command==='select')result=await app.select(await json('--input'));
    else if(command==='localities')result=await app.localities(await input());
    else if(command==='compare')result=await app.comparison(await json('--input'));
    else if(command==='export')result=await app.exportSelection(await input());
    else if(command==='plan'){
      const supplied=await input();
      result=await app.savePlan({expectedRevision:(await app.status()).revision,...supplied});
    }else if(command==='extract'){
      const started=await app.extract(Number(options['--plan']));result=await started.completion;
    }else if(command==='inspect')result=await(await app.publisher()).inspect(options['--run'],options['--query']);
    else if(command==='review'||command==='publish')result=await app.operate(command,await json('--input'));
    else if(command==='recover')result=await app.operate('recover',{id:options['--run']});
    else if(command==='merchant-configure')result=await app.configureMerchant(await json('--input'));
    else if(['release-status','release-stage','release-activate','release-rollback'].includes(command))result=await app.releaseLifecycle(command.slice(8),await input());
    else if(command==='publication-handoff')result=await app.publicationHandoff(options['--run']);
    else throw new TypeError('Unknown HUD operation; use --help.');
    const output=JSON.stringify(result,null,2)+'\n';
    if(options['--out']){await writeFile(resolve(options['--out']),output,{flag:'wx',mode:0o600});process.stdout.write(JSON.stringify({created:resolve(options['--out'])})+'\n');}
    else process.stdout.write(output);
    return result;
  }finally{if(!server)await app.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write('HUD: '+(error.code?error.code+' · ':'')+error.message+'\n');process.exitCode=1;});
