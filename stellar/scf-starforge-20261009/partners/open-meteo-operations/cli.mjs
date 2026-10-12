#!/usr/bin/env node
// MIT. Complete native weather product, customer operations and same-root recovery.
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readProductInput,compileWeatherDistribution,launchWeatherMerchant,initializeWeatherWithOperator} from './application.mjs';
import {initializeWeather,readWeatherSettings,WeatherWorkspace,cleanResult,safeCode,verifyWeather,restoreWeather} from './workspace.mjs';
import {exportFrozenReport} from './exports.mjs';
import {publishJson,absolute} from './files.mjs';
import {need,keys} from './contract.mjs';

const HELP=[
 'Weather operations — original SF30 merchant and SF88 customer',
 '',
 'merchant compile --config PRODUCT.json --out NEW_DIRECTORY',
 'merchant serve --config PRODUCT.json [--port 8423] [--facilitator HTTPS_URL]',
 '  [--allow-local-facilitator] [--descriptor PRIVATE_NEW_JSON]',
 '',
 'init --state-root NEW_PRIVATE_ROOT --operator ORIGINAL_OPERATOR [--client SELLER_CLIENT.mjs] [--provider PROFILE.json]',
 'init --state-root NEW_PRIVATE_ROOT --review OFFLINE_REVIEW.json --operator-preset PRIVATE_PRESET.json',
 '  --total-atomic N --daily-atomic N [--client SELLER_CLIENT.mjs] [--provider PROFILE.json]',
 'serve --settings PRIVATE_ROOT/settings.json [--port 0] [--descriptor PRIVATE_NEW_JSON]',
 '',
 'status | site-save | request-save | decision-save | report-freeze',
 '  --settings SETTINGS [--input JSON]',
 'source | source-reprocess | prepare | execute | recover | inspect --settings SETTINGS --request REQUEST_ID [--input JSON]',
 'series --settings SETTINGS --capture CAPTURE_ID --variable VARIABLE',
 'compare --settings SETTINGS --left CAPTURE_ID --right CAPTURE_ID --variable VARIABLE',
 'report-export --settings SETTINGS --report REPORT_ID --output NEW_FILE [--format zip|html|json]',
 '',
 'recovery review --settings SETTINGS',
 'recovery snapshot --settings SETTINGS --output NEW_DIRECTORY [--passphrase-env NAME]',
 'recovery verify|restore --bundle ARCHIVE_DIRECTORY --record-sha ORIGINAL_RECORD_SHA256 [--passphrase-env NAME]',
 '',
 'Input JSON preserves expected revisions, original configuration and explicit budgets.',
 'Private launch URLs are local control capabilities. Keep descriptors private.',
 'SIGINT/SIGTERM drain the original active operation. Restore never executes a request.'
].join('\n');
function options(args,allowed){
 const values={};for(let i=0;i<args.length;i++){
  const name=args[i];need(allowed.includes(name)&&!Object.hasOwn(values,name),'CLI_OPTION_INVALID');
  if(name==='--allow-local-facilitator'){values[name]=true;continue;}
  need(i+1<args.length&&!args[i+1].startsWith('--'),'CLI_OPTION_VALUE_REQUIRED');values[name]=args[++i];
 }return values;
}
const print=value=>process.stdout.write(JSON.stringify(cleanResult(value),null,2)+'\n');
async function serveLifetime(session,descriptor,details){
 const result={...details,url:session.url};
 try{if(descriptor)await publishJson(absolute(descriptor),result);print(result);}catch(error){await session.close();throw error;}
 let closing;
 const stop=()=>closing??=session.close();
 const listeners=['SIGINT','SIGTERM'].map(name=>{const fn=()=>stop().catch(()=>{process.exitCode=1;});process.once(name,fn);return[name,fn];});
 return {session,stop,listeners};
}
export async function main(args=process.argv.slice(2)){
 if(!args.length||args[0]==='--help'){process.stdout.write(HELP+'\n');return;}
 const command=args.shift();
 if(command==='merchant'){
  const action=args.shift(),opt=options(args,['--config','--out','--port','--facilitator','--allow-local-facilitator','--descriptor']);
  const input=await readProductInput(absolute(opt['--config']));
  if(action==='compile'){const result=await compileWeatherDistribution(input,{output:absolute(opt['--out'])});print(result);return result;}
  need(action==='serve','CLI_COMMAND_INVALID');
  const session=await launchWeatherMerchant(input,{port:Number(opt['--port']??8423),facilitator:opt['--facilitator'],allowLocalFacilitator:opt['--allow-local-facilitator']??false});
  return serveLifetime(session,opt['--descriptor'],{schema:'stellar-forge.weather-merchant-runtime.v1',mode:session.mode,
   docs:session.url+'/_seller/docs',openapi:session.url+'/_seller/openapi.json',providerMode:input.provider.mode});
 }
 if(command==='init'){
  const opt=options(args,['--state-root','--operator','--review','--operator-preset','--total-atomic','--daily-atomic','--client','--provider']);
  const provider=opt['--provider']?await readProductInput(absolute(opt['--provider'])):{mode:'evaluation'};
  const common={stateRoot:absolute(opt['--state-root']),...(opt['--client']?{sellerClient:absolute(opt['--client'])}:{}),provider};
  let result;
  if(opt['--operator']){need(!opt['--review']&&!opt['--operator-preset'],'ONE_ORIGINAL_OPERATOR_SOURCE_REQUIRED');result=await initializeWeather({...common,originalOperatorDirectory:absolute(opt['--operator'])});}
  else result=await initializeWeatherWithOperator({...common,review:absolute(opt['--review']),operatorPreset:absolute(opt['--operator-preset']),totalAtomic:opt['--total-atomic'],dailyAtomic:opt['--daily-atomic']});
  print(result);return result;
 }
 if(command==='recovery'){
  const action=args.shift(),opt=options(args,['--settings','--output','--bundle','--record-sha','--passphrase-env']);
  const passphraseEnv=opt['--passphrase-env']??'OPEN_METEO_BACKUP_PASSPHRASE';
  const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
  if(action==='verify'||action==='restore'){
   const result=await (action==='verify'?verifyWeather:restoreWeather)({bundle:absolute(opt['--bundle']),expectedRecordSha256:opt['--record-sha'],passphraseEnv,signal:controller.signal});print(result);return result;
  }
  need(action==='review'||action==='snapshot','CLI_COMMAND_INVALID');
  const workspace=await WeatherWorkspace.open(await readWeatherSettings(absolute(opt['--settings'])));
  try{const result=action==='review'?await workspace.recoveryReview():await workspace.snapshot({output:absolute(opt['--output']),passphraseEnv,signal:controller.signal});print(result);return result;}finally{await workspace.close();}
  }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
 }
 const opt=options(args,['--settings','--input','--request','--capture','--variable','--unit','--left','--right','--report','--output','--format','--port','--descriptor']);
 const workspace=await WeatherWorkspace.open(await readWeatherSettings(absolute(opt['--settings'])));
 if(command==='serve'){
  try{const {startWeatherServer}=await import('./server.mjs');const session=await startWeatherServer({workspace,port:Number(opt['--port']??0)});return serveLifetime(session,opt['--descriptor'],{schema:'stellar-forge.weather-operator-runtime.v1'});}
  catch(error){await workspace.close();throw error;}
 }
 const controller=new AbortController(),stop=()=>controller.abort(Object.assign(new Error('OPERATOR_CANCELLED'),{code:'OPERATOR_CANCELLED'}));
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{
  const input=opt['--input']?await readProductInput(absolute(opt['--input'])):{};
  let result;
  if(command==='status')result=await workspace.summary();
  else if(command==='site-save')result=await workspace.saveSite(input);
  else if(command==='request-save')result=await workspace.saveRequest(input);
  else if(command==='decision-save')result=await workspace.saveDecision(input);
  else if(command==='report-freeze')result=await workspace.freezeReport(input);
  else if(command==='source')result=await workspace.sourceCapture(opt['--request'],{...input,signal:controller.signal});
  else if(command==='source-reprocess')result=await workspace.reprocessSource(opt['--request'],input);
  else if(command==='prepare')result=await workspace.prepare(opt['--request'],{...input,signal:controller.signal});
  else if(command==='execute')result=await workspace.execute(opt['--request'],{signal:controller.signal});
  else if(command==='recover')result=await workspace.recover(opt['--request']);
  else if(command==='inspect')result=await workspace.inspect(opt['--request']);
  else if(command==='series')result=await workspace.series(opt['--capture'],opt['--variable'],{unit:opt['--unit']});
  else if(command==='compare')result=await workspace.compare(opt['--left'],opt['--right'],{variable:opt['--variable'],unit:opt['--unit']});
  else if(command==='report-export')result=await workspace.serial(async()=>{const report=workspace.store.report(opt['--report']),captures=report.captures.map(c=>workspace.store.capture(c.id));return exportFrozenReport(report,captures,{output:absolute(opt['--output']),format:opt['--format']??'zip',signal:controller.signal});});
  else need(false,'CLI_COMMAND_INVALID');
  print(result);return result;
 }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);await workspace.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(JSON.stringify({error:safeCode(error)})+'\n');process.exitCode=1;});
