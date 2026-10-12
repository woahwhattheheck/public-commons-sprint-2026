#!/usr/bin/env node
// MIT. Original SF93 continuous incident operation and portable support handoff.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {initializeIncidentStore,readPrivateFile,openIncidentStore} from './incident-store.mjs';
import {resolveDestination} from './notifications.mjs';
import {inspectSlackDestination} from './notifications-slack.mjs';
import {runIncidentWatch} from './watch.mjs';
import {acknowledgeIncident,configureIncidents,incidentStatus,remindIncident,
  operateNotification,pruneIncidents,exportIncident} from './incident-operator.mjs';

const usage=`SF93 merchant incident operations (Node 22+, Linux flock)

init      --state NEW_DIRECTORY --config PRIVATE_CONFIG
run       --state DIRECTORY
status    --state DIRECTORY [--details]
destination --state DIRECTORY
ack       --state DIRECTORY --incident ID --revision N --by OPERATOR [--note-file PRIVATE_FILE]
notify    --state DIRECTORY --incident ID --revision N
retry     --state DIRECTORY --event ID --attempts N --by OPERATOR
cancel    --state DIRECTORY --event ID --attempts N --by OPERATOR
configure --state DIRECTORY --config PRIVATE_CONFIG --config-revision N
prune     --state DIRECTORY
export    --state DIRECTORY --incident ID --revision N --workspace PRIVATE_SF74_FILE --route ID --out NEW_DIRECTORY

run owns only the watcher. SIGINT/SIGTERM finishes its current state write and releases its kernel lease.
Notifications use the configured webhook URL/signing key or Slack token environment reference.
destination reads the current Slack actor/workspace; its command sends no notification.
status contains private merchant operational metadata; --details also includes acknowledgment notes.
See INCIDENT_OPERATIONS.md for original runtime startup, webhook signature and case import.
`;
const shapes={init:['config'],run:[],status:[],destination:[],ack:['incident','revision','by','note-file'],
  notify:['incident','revision'],retry:['event','attempts','by'],cancel:['event','attempts','by'],
  configure:['config','config-revision'],prune:[],export:['incident','revision','workspace','route','out']};
function parse(args) {
  if(!args.length||args.length===1&&['--help','help'].includes(args[0]))return null;
  const [command,...flags]=args;if(!Object.hasOwn(shapes,command))throw new TypeError(usage);
  const values={};
  for(let i=0;i<flags.length;i++) {
    const flag=flags[i];
    if(command==='status'&&flag==='--details'&&!Object.hasOwn(values,'details')){values.details=true;continue;}
    const key=flag.slice(2);
    if(!flag.startsWith('--')||!['state',...shapes[command]].includes(key)||Object.hasOwn(values,key)||
        !flags[i+1]||flags[i+1].startsWith('--'))throw new TypeError(usage);
    values[key]=flags[++i];
  }
  const required=['state',...shapes[command].filter(key=>key!=='note-file')];
  if(required.some(key=>!values[key]))throw new TypeError(usage);
  for(const key of ['revision','attempts','config-revision'])if(values[key]!==undefined) {
    if(!/^(0|[1-9]\d*)$/.test(values[key]))throw new TypeError('Expected an exact integer for --'+key);
    values[key]=Number(values[key]);
    if(!Number.isSafeInteger(values[key])||values[key]<(key==='attempts'?0:1))throw new TypeError('Invalid --'+key);
  }
  return {command,values};
}
const privateText=async(path,max)=>new TextDecoder('utf-8',{fatal:true}).decode(await readPrivateFile(resolve(path),max));
export async function main(args=process.argv.slice(2)) {
  const parsed=parse(args);if(!parsed){process.stdout.write(usage);return;}
  const {command,values:v}=parsed,directory=resolve(v.state);let result;
  const incident={directory,id:v.incident,expectedRevision:v.revision};
  if(command==='init'||command==='configure') {
    const config=JSON.parse(await privateText(v.config,65_536));
    result=command==='init'?await initializeIncidentStore({directory,config}):
      await configureIncidents({directory,config,expectedConfigRevision:v['config-revision']});
  } else if(command==='run') {
    const controller=new AbortController(),stop=()=>controller.abort();
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
    try {result=await runIncidentWatch({directory,signal:controller.signal,
      onReady:state=>process.stdout.write(JSON.stringify({event:'WATCH_READY',...state})+'\n')});}
    finally {process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
  } else if(command==='status')result=await incidentStatus({directory,details:Boolean(v.details)});
  else if(command==='destination') {
    const state=await(await openIncidentStore(directory)).read();
    const selected=resolveDestination(state.config,process.env);
    if(selected.reason)result={accepted:false,reason:selected.reason};
    else if(selected.transport!=='slack')result={accepted:true,reason:'WEBHOOK_CONFIGURATION_RESOLVED',
      destinationId:selected.binding.id};
    else result=await inspectSlackDestination(selected,state.config.notification);
    if(!result.accepted)process.exitCode=1;
  }
  else if(command==='ack')result=await acknowledgeIncident({...incident,by:v.by,
    notes:v['note-file']?await privateText(v['note-file'],2000):''});
  else if(command==='notify')result=await remindIncident(incident);
  else if(command==='retry'||command==='cancel')result=await operateNotification({directory,id:v.event,
    expectedAttempts:v.attempts,action:command,by:v.by});
  else if(command==='prune')result=await pruneIncidents({directory});
  else if(command==='export')result=await exportIncident({...incident,workspaceFile:v.workspace,routeId:v.route,out:v.out});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
}

