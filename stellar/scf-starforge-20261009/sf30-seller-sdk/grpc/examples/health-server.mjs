#!/usr/bin/env node
// MIT. Standard native health service and an original demonstration merchant RPC.
import grpc from '@grpc/grpc-js';
import {fileURLToPath} from 'node:url';
import {captureProtoSource,compileProtoSource} from '../proto.mjs';

export async function startHealthExample({port=0,authorization,credentials,observeCall}={}) {
  if(!Number.isInteger(port)||port<0||port>65535||typeof authorization!=='string'||!authorization)
    throw new TypeError('GRPC_HEALTH_EXAMPLE_CONFIGURATION_REQUIRED');
  if(observeCall!==undefined&&typeof observeCall!=='function')throw new TypeError('GRPC_HEALTH_EXAMPLE_OBSERVER_INVALID');
  const [healthSource,applicationSource]=await Promise.all([
    captureProtoSource({directory:fileURLToPath(new URL('../health/',import.meta.url)),entrypoints:['health.proto']}),
    captureProtoSource({directory:fileURLToPath(new URL('./proto/',import.meta.url)),entrypoints:['analytics.proto']}),
  ]);
  const health=grpc.loadPackageDefinition(compileProtoSource(healthSource).definition).grpc.health.v1.Health.service;
  const analytics=grpc.loadPackageDefinition(compileProtoSource(applicationSource).definition).stellarforge.analytics.v1.Analytics.service;
  const server=new grpc.Server({'grpc.max_receive_message_length':1048576,'grpc.max_send_message_length':1048576});
  const watches=new Set();
  const counts={healthCalls:0,applicationCalls:0,watchOpened:0,watchClosed:0,authorized:0};
  let closing=false,closed;
  const error=code=>Object.assign(new Error('Included health example response.'),{code,details:'Included health example response.'});
  async function observe(method,call){
    if(call.metadata.get('authorization')[0]!==authorization)throw error(grpc.status.UNAUTHENTICATED);
    counts.authorized++;
    const observation={method,service:call.request?.service??'',observedAt:new Date().toISOString(),
      ordinal:method==='Summary'?++counts.applicationCalls:++counts.healthCalls};
    if(observeCall)await observeCall(observation);
    return observation;
  }
  async function unary(method,call,done,value){
    try{await observe(method,call);if(closing)throw error(grpc.status.UNAVAILABLE);done(null,await value(call));}
    catch(issue){done(issue);}
  }
  server.addService(health,{
    check(call,done){void unary('Check',call,done,()=>{
      const name=call.request.service??'';
      if(name.startsWith('missing'))throw error(grpc.status.NOT_FOUND);
      if(name.startsWith('unsupported'))throw error(grpc.status.UNIMPLEMENTED);
      return name.startsWith('unknown')?{}:{status:'SERVING'};
    });},
    list(call,done){void unary('List',call,done,()=>{
      const statuses=Object.create(null);
      const add=(name,value)=>Object.defineProperty(statuses,name,{value,enumerable:true,configurable:true,writable:true});
      add('',{status:'SERVING'});add('unknown',{});add('__proto__',{status:'NOT_SERVING'});add('constructor',{status:'SERVING'});
      for(let i=0;i<125;i++)add('merchant.service.'+String(i).padStart(3,'0'),{status:i%7?'SERVING':'NOT_SERVING'});
      return {statuses};
    });},
    watch(call){
      let timer,finished=false;
      const finish=()=>{
        if(finished)return;finished=true;clearTimeout(timer);
        if(watches.delete(call))counts.watchClosed++;
      };
      call.once('close',finish);call.once('cancelled',finish);call.on('error',finish);
      void (async()=>{
        await observe('Watch',call);
        if(closing)throw error(grpc.status.UNAVAILABLE);
        if(finished||call.cancelled)return;
        watches.add(call);counts.watchOpened++;
        const name=call.request.service??'';
        if(name.startsWith('unsupported')){call.destroy(error(grpc.status.UNIMPLEMENTED));return;}
        if(name.startsWith('transition')){
          call.write({status:'SERVICE_UNKNOWN'});
          timer=setTimeout(()=>{if(!finished&&!call.cancelled)call.write({status:'SERVING'});},30);
        }else call.write({status:'SERVING'});
        if(name.startsWith('renew'))call.end();
      })().catch(issue=>{if(!finished)call.destroy(issue);});
    },
  });
  const summary=call=>({record_id:String(call.request.account_id??'0'),amount:'123456789012345678901234567890.1234567',
    evidence:Buffer.from('native-health-example-merchant').toString('base64'),observed_sequence:'-9223372036854775808',
    attributes:{source:'included-native-health-example',day:call.request.day??''},
    items:[{id:'9007199254740993',amount:'42.0000001',state:'posted'}]});
  server.addService(analytics,{
    summary(call,done){void unary('Summary',call,done,()=>summary(call));},
    watch(call){void (async()=>{await observe('ApplicationWatch',call);call.write(summary(call));call.end();})()
      .catch(issue=>call.destroy(issue));},
  });
  const secure=credentials?grpc.ServerCredentials.createSsl(credentials.ca,[{
    private_key:credentials.key,cert_chain:credentials.certificate}],true):grpc.ServerCredentials.createInsecure();
  const selected=await new Promise((done,reject)=>server.bindAsync('127.0.0.1:'+port,secure,(issue,value)=>issue?reject(issue):done(value)));
  return {target:'127.0.0.1:'+selected,healthSource,applicationSource,counts:()=>({...counts,activeWatches:watches.size}),
    close(){
      if(closed)return closed;
      closing=true;
      for(const call of watches)call.destroy(error(grpc.status.CANCELLED));
      closed=new Promise((done,reject)=>{
        const timer=setTimeout(()=>{server.forceShutdown();reject(new Error('GRPC_HEALTH_EXAMPLE_CLOSE_TIMEOUT'));},5000);
        server.tryShutdown(()=>{clearTimeout(timer);done();});
      });return closed;
    }};
}
