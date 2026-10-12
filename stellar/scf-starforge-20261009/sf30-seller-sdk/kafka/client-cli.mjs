#!/usr/bin/env node
// MIT. Complete command-line consumer of the original running Kafka Application.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KafkaWorkspaceClient, KafkaWorkspaceError, parseKafkaJson, stringifyKafkaJson,
  readKafkaHostFile, inspectKafkaDownload, KAFKA_LIMITS
} from './client.mjs';

const HELP = [
'Kafka workspace client — use the original running Kafka Application',
'',
'node client-cli.mjs COMMAND --connection /private/kafka.connection [OPTIONS]',
'',
'Inspect and configure',
'  inspect                              Authenticate the current original launch',
'  state                                Read retained Kafka and dataset state',
'  topics                               List saved exact-topic connections',
'  connection --id NAME                 Read a saved connection',
'  connection-save --request FILE       Save its original revision-checked config',
'  inspect-source --request FILE        Inspect the selected real broker/topic',
'  inspection --id SHA                  Read its immutable partition bounds',
'',
'Capture and read',
'  capture-prepare --request FILE       Freeze original exact offset ranges',
'  capture --id SHA                     Read status, revisions and retained bounds',
'  capture-run --request FILE [--wait]  Start the original prepared capture',
'  capture-resume --request FILE        Resume the same original capture',
'  capture-cancel --id SHA              Ask the original writer to cancel',
'  capture-wait --id SHA                Wait for the same capture to stop running',
'  messages --id SHA [--offset N --limit N]  Read compact message history',
'  message --id SHA                     Read one exact retained message',
'',
'Project and use the original dataset',
'  project --request FILE               Freeze an explicit source projection',
'  projection --id SHA                  Read projection, coverage and default plan',
'  source --id SHA                      Read original source inventory',
'  plan --id SHA                        Read an original mapping plan',
'  plan-save --request FILE             Save the complete native NDJSON plan',
'  build --request FILE                 Build its original dataset',
'  query --request FILE                 Query with original scalar-string params',
'  compare --request FILE               Compare original compatible editions',
'  changes --id SHA [--offset N --limit N]  Read one exact comparison page',
'',
'Receive complete files',
'  source-add --input FILE [--name NAME --label LABEL]',
'  import-kafka --input FILE            Receive the complete Kafka project ZIP',
'  import-native --input FILE           Receive an original NDJSON project ZIP',
'  export-kafka --build SHA [--projection SHA] --out FILE',
'  export-native --build SHA --out FILE',
'  export-dataset --build SHA --out FILE',
'  export-changes --id SHA --out FILE',
'  export-merchant --request FILE --out FILE',
'  download-record --kind KIND --id ID --out FILE',
'  download-query --request FILE --out FILE',
'  download-message --id SHA --out FILE',
'  download-state --out FILE',
'  download-projection --id SHA --out FILE',
'  inspect-file --input FILE [--sha256 SHA]  Reopen a completed local download',
'',
'Common options',
'  --expect-workspace UUID  --expect-binding SHA  --timeout-ms N',
'  --json-limit N  --max-bytes N  --sha256 SHA  --tagged-numbers',
'  --poll-ms N applies to capture-wait or capture-run/capture-resume --wait.',
'',
'Connection files are the original private printed URL or Applications URL record.',
'Requests come from complete UTF-8 JSON files; credentials stay in server environment variables.',
'Receiving directories must already be private (0700). Files publish create-only.',
'Existing outputs are preserved. Use inspect-file and the retained original selection to reopen them.',
'Default JSON output retains exact numeric lexemes. --tagged-numbers emits {$kafkaNumber: text}.',
'Exit: 0 completed command; 1 error; 2 waited capture stopped short of COMPLETE; 130/143 signal.',
''
].join('\n');
const REQUESTS = Object.freeze({
  'connection-save':'saveConnection','inspect-source':'inspectConnection',
  'capture-prepare':'prepareCapture','capture-run':'runCapture','capture-resume':'resumeCapture',
  project:'project','plan-save':'savePlan',build:'build',query:'query',compare:'compare'
});
const READS = Object.freeze({
  connection:'connection',inspection:'inspection',capture:'capture',message:'message',
  projection:'projection',source:'source',plan:'plan'
});
const SIMPLE = Object.freeze({inspect:'inspect',state:'state',topics:'configuredTopics'});
const COMMON = ['connection','expect-workspace','expect-binding','timeout-ms','json-limit','tagged-numbers'];
function issue(message) {return new KafkaWorkspaceError('KAFKA_CLI_INPUT',message);}
function parseArguments(argv) {
  const args=[...argv], command=args.shift();
  if(!command||command==='help'||command==='--help'||command==='-h')return {command:'help',values:{}};
  const values=Object.create(null);
  while(args.length) {
    const key=args.shift();
    if(!/^--[a-z][a-z-]*$/.test(key))throw issue('Use complete named command options.');
    const name=key.slice(2);
    if(Object.hasOwn(values,name))throw issue('Supply each command option once.');
    if(['wait','tagged-numbers'].includes(name))values[name]=true;
    else {
      const value=args.shift();
      if(value===undefined||value.startsWith('--'))throw issue('Supply the value for '+key+'.');
      values[name]=value;
    }
  }
  return {command,values};
}
function choose(values,allowed,required=[]) {
  if(Object.keys(values).some(name=>!allowed.includes(name)) || required.some(name=>!Object.hasOwn(values,name)))
    throw issue('Supply the declared options and every required option for this command.');
}
function number(value,fallback,label) {
  if(value===undefined)return fallback;
  if(!/^(0|[1-9][0-9]*)$/.test(value)||!Number.isSafeInteger(Number(value)))throw issue(label+' must be an exact nonnegative integer.');
  return Number(value);
}
async function requestFile(path) {
  return parseKafkaJson(new TextDecoder('utf-8',{fatal:true}).decode(
    await readKafkaHostFile(path,KAFKA_LIMITS.requestBytes)));
}
async function emit(stream,text) {
  await new Promise((resolve,reject)=>stream.write(text,error=>error?reject(error):resolve()));
}
/** Invoke one complete native client command; the original server retains writer ownership. */
export async function runKafkaClientCli(argv=process.argv.slice(2),{stdout=process.stdout,stderr=process.stderr}={}) {
  let client,signalExit=0;
  const controller=new AbortController();
  const interrupt=()=>{signalExit ||=130;controller.abort();};
  const terminate=()=>{signalExit ||=143;controller.abort();};
  process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
  try {
    const {command,values:v}=parseArguments(argv);
    if(command==='help'){await emit(stdout,HELP);return 0;}
    if(command==='inspect-file') {
      choose(v,['input','sha256','max-bytes','tagged-numbers'],['input']);
      const result=await inspectKafkaDownload(v.input,{
        signal:controller.signal,
        ...(v.sha256?{sha256:v.sha256}:{}),
        ...(v['max-bytes']?{maximumBytes:number(v['max-bytes'],undefined,'Maximum bytes')}:{})
      });
      await emit(stdout,(v['tagged-numbers']?JSON.stringify(result,null,2):stringifyKafkaJson(result,2))+'\n');
      return signalExit;
    }
    const perCommand=Object.hasOwn(REQUESTS,command)?['request',...(command==='capture-run'||command==='capture-resume'?['wait','poll-ms']:[])]:
      Object.hasOwn(READS,command)?['id']:
      Object.hasOwn(SIMPLE,command)?[]:
      ['messages','changes'].includes(command)?['id','offset','limit']:
      command==='capture-cancel'?['id']:
      command==='capture-wait'?['id','poll-ms']:
      command==='source-add'?['input','name','label','sha256']:
      ['import-kafka','import-native'].includes(command)?['input','sha256']:
      command==='export-kafka'?['build','projection','out','max-bytes','sha256']:
      ['export-native','export-dataset'].includes(command)?['build','out','max-bytes','sha256']:
      ['export-changes','download-message','download-projection'].includes(command)?['id','out','max-bytes','sha256']:
      command==='download-state'?['out','max-bytes','sha256']:
      command==='download-record'?['kind','id','out','max-bytes','sha256']:
      command==='download-query'?['request','out','max-bytes','sha256']:
      command==='export-merchant'?['request','out','max-bytes','sha256']:null;
    if(!perCommand)throw issue('Choose a listed Kafka client command. Run help for the complete interface.');
    choose(v,[...COMMON,...perCommand],['connection']);
    if((command==='capture-run'||command==='capture-resume')&&v['poll-ms']&&!v.wait)
      throw issue('--poll-ms requires --wait for this capture command.');
    const requestOptions={
      signal:controller.signal,
      ...(v['timeout-ms']?{timeoutMs:number(v['timeout-ms'],undefined,'Timeout')}:{}),
      ...(v['json-limit']?{maximumJsonBytes:number(v['json-limit'],undefined,'JSON byte limit')}:{}),
      ...(v['max-bytes']?{maximumBytes:number(v['max-bytes'],undefined,'Maximum bytes')}:{}),
      ...(v.sha256?{sha256:v.sha256}:{})
    };
    client=new KafkaWorkspaceClient({
      connectionFile:v.connection,
      ...(v['expect-workspace']?{expectedWorkspaceId:v['expect-workspace']}:{}),
      ...(v['expect-binding']?{expectedBindingSha256:v['expect-binding']}:{})
    },{signal:controller.signal,...(requestOptions.timeoutMs?{timeoutMs:requestOptions.timeoutMs}:{}),
      ...(requestOptions.maximumJsonBytes?{maximumJsonBytes:requestOptions.maximumJsonBytes}:{})});
    const need=name=>{if(v[name]===undefined)throw issue('Supply --'+name+' for this command.');return v[name];};
    let result;
    if(Object.hasOwn(REQUESTS,command)) {
      result=await client[REQUESTS[command]](await requestFile(need('request')),requestOptions);
      if(v.wait)result=await client.waitForCapture(result.id,{signal:controller.signal,
        timeoutMs:requestOptions.timeoutMs??240000,pollMs:number(v['poll-ms'],500,'Polling interval')});

    } else if(Object.hasOwn(READS,command))result=await client[READS[command]](need('id'),requestOptions);
    else if(Object.hasOwn(SIMPLE,command))result=await client[SIMPLE[command]](requestOptions);
    else if(command==='messages'||command==='changes')result=await client[command](need('id'),
      {offset:number(v.offset,0,'Page offset'),limit:number(v.limit,50,'Page size')},requestOptions);
    else if(command==='capture-cancel')result=await client.cancelCapture(need('id'),requestOptions);
    else if(command==='capture-wait')result=await client.waitForCapture(need('id'),{
      signal:controller.signal,timeoutMs:requestOptions.timeoutMs??240000,pollMs:number(v['poll-ms'],500,'Polling interval')});
    else if(command==='source-add') {
      const input=need('input');
      const name=v.name??'source.ndjson';
      result=await client.addSource(input,{name,label:v.label??name},requestOptions);
    } else if(command==='import-kafka'||command==='import-native')
      result=await client[command==='import-kafka'?'importKafka':'importNative'](need('input'),requestOptions);
    else if(command==='export-kafka')result=await client.exportKafka({build:need('build'),...(v.projection?{projection:v.projection}:{})},need('out'),requestOptions);
    else if(command==='export-native'||command==='export-dataset')
      result=await client[command==='export-native'?'exportNative':'exportDataset'](need('build'),need('out'),requestOptions);
    else if(command==='export-changes'||command==='download-message'||command==='download-projection') {
      const method={'export-changes':'exportChanges','download-message':'downloadMessage','download-projection':'downloadProjection'}[command];
      result=await client[method](need('id'),need('out'),requestOptions);
    } else if(command==='download-record')result=await client.downloadRecord(need('kind'),need('id'),need('out'),requestOptions);
    else if(command==='download-query')result=await client.downloadQuery(await requestFile(need('request')),need('out'),requestOptions);
    else if(command==='download-state')result=await client.downloadState(need('out'),requestOptions);
    else if(command==='export-merchant')result=await client.exportMerchant(await requestFile(need('request')),need('out'),requestOptions);
    await emit(stdout,(v['tagged-numbers']?JSON.stringify(result,null,2):stringifyKafkaJson(result,2))+'\n');
    return signalExit || ((command==='capture-wait'||v.wait)&&result.status!=='COMPLETE'?2:0);
  } catch(error) {
    const output=error instanceof KafkaWorkspaceError?error.toJSON():
      {code:'KAFKA_CLI_FAILED',message:'The original client command could not complete.'};
    await emit(stderr,JSON.stringify(output)+'\n').catch(()=>{});
    return signalExit||1;
  } finally {
    await client?.close();
    process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',terminate);
  }
}
if(process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1]))
  process.exitCode=await runKafkaClientCli();
