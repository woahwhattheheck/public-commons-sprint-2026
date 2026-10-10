// MIT. Launch SF-40 ops wrapper against the real source-integrated Bazaar catalog.
// This example is a local-process read-only smoke service with an EMPTY catalog.
import {createServer} from 'node:http';
import {BazaarCatalog, createDiscoveryServer} from '../../../scf46-stellar-bazaar/src/catalog.mjs';
import {createOpsHandler} from './ops.mjs';

const port=Number(process.env.SF40_PORT??8780);
const host=process.env.SF40_HOST??'127.0.0.1';
if (!Number.isSafeInteger(port)||port<1||port>65535||!['127.0.0.1','::1','0.0.0.0'].includes(host))throw Error('Invalid explicit host/port');
const catalog=new BazaarCatalog();
let draining=false;
const monitor=createOpsHandler({
 catalog,discoveryHandler:createDiscoveryServer(catalog),readyCheck:()=>!draining,
 requestsPerWindow:120,windowMs:60_000,maxInFlight:64,maxClients:2048,sampleCap:512,
 observe:o=>{
  if(process.env.SF40_LOCAL_LOGS==='1')process.stdout.write(JSON.stringify({kind:'sf40.request',...o})+'\n');
 },
});
const server=createServer(monitor.handler);
server.requestTimeout=15_000;
server.headersTimeout=10_000;
server.keepAliveTimeout=2_500;
server.maxRequestsPerSocket=200;
server.listen(port,host,()=>process.stdout.write(JSON.stringify({kind:'sf40.start',host,port,catalog:'in-memory-empty',ledger:'unchecked'})+'\n'));
const stop=signal=>{
 if(draining)return;draining=true;
 server.close(()=>process.stdout.write(JSON.stringify({kind:'sf40.stop',signal})+'\n'));
 server.closeIdleConnections?.();
};
process.once('SIGTERM',()=>stop('SIGTERM'));
process.once('SIGINT',()=>stop('SIGINT'));
