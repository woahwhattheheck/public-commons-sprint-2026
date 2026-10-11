// MIT. Native SubQuery product launcher using original SF30 seller.
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSellerConfig, startSellerService } from '../sf30-seller-sdk/serve.mjs';
import { compileSellerRoutes } from '../sf30-seller-sdk/resource-server.mjs';
import { createSubQueryMerchantHandlers, validateSubQuerySellerRoutes } from './adapter.mjs';

const HELP = 'node launch.mjs --seller SELLER.json --queries QUERIES.json [--port 8423] ' +
  '[--check] [--allow-loopback-upstream] [--facilitator HTTPS_URL] ' +
  '[--allow-local-facilitator] [--max-in-flight 64] [--drain-grace-ms 60000]';
function parse(argv) {
  const out = new Map(), flags = new Set(['--check', '--allow-loopback-upstream', '--allow-local-facilitator']);
  const names = new Set(['--seller', '--queries', '--port', '--facilitator', '--max-in-flight', '--drain-grace-ms']);
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (out.has(name)) throw new TypeError('Duplicate launcher option');
    if (flags.has(name)) { out.set(name, true); continue; }
    if (!names.has(name) || typeof argv[i+1] !== 'string' || argv[i+1].startsWith('--')) {
      throw new TypeError(HELP);
    }
    out.set(name, argv[++i]);
  }
  if (!out.has('--seller') || !out.has('--queries') ||
      out.has('--allow-local-facilitator') && !out.has('--facilitator')) throw new TypeError(HELP);
  for (const [name,min,max,def] of [
    ['--port',0,65535,8423],['--max-in-flight',1,1024,64],['--drain-grace-ms',1000,300000,60000]]) {
    const txt = out.get(name);
    if (txt !== undefined && !/^\d+$/.test(txt)) throw new TypeError('Invalid ' + name);
    const v = txt === undefined ? def : Number(txt);
    if (!Number.isSafeInteger(v) || v < min || v > max) throw new TypeError('Invalid ' + name);
    out.set(name,v);
  }
  if (out.has('--facilitator')) {
    const u = new URL(out.get('--facilitator'));
    const local = out.has('--allow-local-facilitator') &&
      u.protocol === 'http:' && u.hostname === '127.0.0.1';
    if ((!local && u.protocol !== 'https:') || u.username || u.password || u.search || u.hash) {
      throw new TypeError('Invalid facilitator endpoint');
    }
    out.set('--facilitator',u.href.replace(/\/$/, ''));
  }
  return out;
}
async function readApproved(path) {
  const file = resolve(path), meta = await stat(file);
  if (!meta.isFile() || meta.size > 1048576) throw new TypeError('Queries file must be <=1MiB');
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readFile(file)));
}
export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') { process.stdout.write(HELP+'\n'); return null; }
  const a = parse(argv);
  const [seller, approved] = await Promise.all([readSellerConfig(a.get('--seller')),readApproved(a.get('--queries'))]);
  validateSubQuerySellerRoutes(seller,approved);
  if (a.has('--check')) {
    const origin = seller.publicOrigin ?? 'http://127.0.0.1:8423';
    compileSellerRoutes(seller.routes.map(r => ({
      id:r.id,
      ...(r.offer ? {offer:r.offer} : {definition:{...r.definition,url:origin+r.path}}),
      handler:()=>({status:503,body:{error:'OFFLINE_ONLY'}}),
    })),{allowLocalhost:!seller.publicOrigin});
    process.stdout.write(JSON.stringify({status:'CONFIG_VALID',routes:seller.routes.length,queries:approved.operations.length})+'\n');
    return null;
  }
  const handlers = createSubQueryMerchantHandlers(approved,{
    allowLoopback:a.has('--allow-loopback-upstream'),env:{...process.env},
  });
  let nativeFactory = null;
  if (a.has('--facilitator')) {
    const [{HTTPFacilitatorClient},{createNativeSellerServer}] = await Promise.all([
      import('@x402/core/server'),import('../sf30-seller-sdk/native-factory.mjs'),
    ]);
    nativeFactory = routes => createNativeSellerServer(routes,{
      facilitatorClient:new HTTPFacilitatorClient({url:a.get('--facilitator')}),
    });
  }
  const session = await startSellerService({config:seller,handlers,nativeFactory,
    port:a.get('--port'),maxInFlight:a.get('--max-in-flight'),drainGraceMs:a.get('--drain-grace-ms')});
  process.stdout.write(JSON.stringify({url:session.url,mode:session.mode,
    offers:session.url+'/_seller/offers',ready:session.url+'/_seller/ready',
    operations:approved.operations.length})+'\n');
  for(const signal of ['SIGINT','SIGTERM']) process.once(signal,() => {
    session.close().then(()=>{process.exitCode=0},()=>{process.exitCode=1});
  });
  return session;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(err => {
    process.stderr.write(err instanceof TypeError ? err.message+'\n' : 'SUBQUERY_LAUNCH_FAILED\n');
    process.exitCode=1;
  });
}
