// MIT. Complete operator/customer workflow over the maintained SF30/SF88 APIs.
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readSellerConfig, startSellerService } from '../serve.mjs';
import { compileSellerRoutes } from '../resource-server.mjs';
import { Buyer } from '../../sf88-operator-buyer-cli/node/client.mjs';
import { CONTRACT, compileMarketPlan, integer, fail } from './config.mjs';
import { createTwelveDataSource } from './source.mjs';
import { MarketDataDelivery } from './customer.mjs';
import { MarketWorkspace, loadMarketPlan, exportMarketSeller, readMarketSeller } from './workspace.mjs';
import { readJson, readBytes, digest } from './files.mjs';

const HELP = [
  'Twelve Data operator and customer workflow',
  '',
  'contract [--openapi FILE]',
  'plan --plan PLAN.json',
  'capture --workspace DIR --id ID --plan PLAN.json --product ID --query JSON',
  'import-response --workspace DIR --id ID --plan PLAN.json --product ID --query JSON --response FILE --source FILE',
  'inspect --workspace DIR --id ID',
  'list --workspace DIR',
  'export --workspace DIR --id ID --out NEW_DIR',
  'read --delivery DIR [--offset 0] [--limit 100]',
  'package --plan PLAN.json --terms TERMS.json --out NEW_DIR',
  'serve --package DIR [--check] [--port 8423] [--facilitator HTTPS_URL]',
  '      [--allow-local-facilitator] [--max-in-flight 64] [--drain-grace-ms 60000]',
  'consume-buyer --buyer-config CONFIG.json --intent ID --plan PLAN.json --product ID --out NEW_DIR',
  '',
  'capture makes one operator-authorized native API request under its stable ID.',
  'import-response, inspect, list, read, export, package and consume-buyer do not query Twelve Data.',
  'serve uses the original SF30 challenge or configured native payment lifecycle.',
].join('\n');
const OPTIONS = {
  contract:['openapi'],plan:['plan'],capture:['workspace','id','plan','product','query'],
  'import-response':['workspace','id','plan','product','query','response','source'],
  inspect:['workspace','id'],list:['workspace'],export:['workspace','id','out'],
  read:['delivery','offset','limit'],package:['plan','terms','out'],
  serve:['package','check','port','facilitator','allow-local-facilitator','max-in-flight','drain-grace-ms'],
  'consume-buyer':['buyer-config','intent','plan','product','out'],
};
function args(argv) {
  const [command,...tail]=argv;
  if (!Object.hasOwn(OPTIONS,command)) fail('MARKET_COMMAND_INVALID',HELP);
  const result={command};
  for (let i=0;i<tail.length;i++) {
    const key=tail[i].startsWith('--')?tail[i].slice(2):'';
    if (!OPTIONS[command].includes(key)||Object.hasOwn(result,key)) fail('MARKET_OPTION_INVALID',HELP);
    if (['check','allow-local-facilitator'].includes(key)) result[key]=true;
    else {
      if (typeof tail[i+1]!=='string'||tail[i+1].startsWith('--')) fail('MARKET_OPTION_VALUE_REQUIRED');
      result[key]=tail[++i];
    }
  }
  return result;
}
function required(options,name) {
  if (!options[name]) fail('MARKET_OPTION_REQUIRED','--'+name+' is required');
  return options[name];
}
function number(options,name,fallback,min,max) {
  const value=options[name];
  if (value!==undefined&&!/^(?:0|[1-9]\d*)$/.test(value)) fail('MARKET_OPTION_NUMBER_INVALID');
  return integer(value===undefined?fallback:Number(value),min,max,name);
}
const print=value=>process.stdout.write(JSON.stringify(value)+'\n');
function compact(value) {
  return {directory:value.directory,manifestSha256:value.manifestSha256,
    ...(value.reused===undefined?{}:{reused:value.reused}),
    ...(value.report?{state:value.report.state,observation:value.report.observation,
      responseBytes:value.report.responseBytes,responseSha256:value.report.responseSha256,
      retainedUntil:value.report.retainedUntil}:{}),
    ...(value.state?{state:value.state}:{}),
    ...(value.retentionExpired===undefined?{}:{retentionExpired:value.retentionExpired})};
}
async function serve(options) {
  const saved=await readMarketSeller(resolve(required(options,'package')));
  const seller=await readSellerConfig(join(saved.directory,'service.json'));
  if (options.check) {
    compileSellerRoutes(seller.routes.map(route=>({id:route.id,offer:route.offer,
      handler:()=>({status:503,body:{error:'OFFLINE_ONLY'}})})));
    return {status:'CONFIG_VALID',routes:seller.routes.length,manifestSha256:saved.manifestSha256,
      dataUse:saved.plan.usage,credentialEnvironment:saved.plan.apiKeyEnv};
  }
  if (options.facilitator && saved.plan.usage.purpose==='internal-evaluation')
    fail('MARKET_EVALUATION_PLAN','A demo evaluation plan serves challenges; configure the actual authorized-service plan for native paid deployment');
  if (options['allow-local-facilitator']&&!options.facilitator) fail('MARKET_FACILITATOR_REQUIRED');
  let nativeFactory=null;
  if (options.facilitator) {
    const url=new URL(options.facilitator);
    const local=options['allow-local-facilitator']&&url.protocol==='http:'&&url.hostname==='127.0.0.1';
    if ((!local&&url.protocol!=='https:')||url.username||url.password||url.search||url.hash)
      fail('MARKET_FACILITATOR_INVALID');
    const [{HTTPFacilitatorClient},{createNativeSellerServer}]=await Promise.all([
      import('@x402/core/server'),import('../native-factory.mjs'),
    ]);
    nativeFactory=routes=>createNativeSellerServer(routes,{
      facilitatorClient:new HTTPFacilitatorClient({url:url.href.replace(/\/$/,'')}),
    });
  }
  const source=createTwelveDataSource(saved.plan);
  const session=await startSellerService({config:seller,handlers:source.handlers,nativeFactory,
    port:number(options,'port',8423,0,65535),
    maxInFlight:number(options,'max-in-flight',64,1,1024),
    drainGraceMs:number(options,'drain-grace-ms',60000,1000,300000)});
  print({url:session.url,mode:session.mode,offers:session.url+'/_seller/offers',
    ready:session.url+'/_seller/ready',manifestSha256:saved.manifestSha256});
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{
    source.close();session.close().then(()=>{process.exitCode=0},()=>{process.exitCode=1});
  });
  return {session,source};
}
export async function main(argv=process.argv.slice(2)) {
  if (!argv.length||argv.includes('--help')) {process.stdout.write(HELP+'\n');return;}
  const options=args(argv),command=options.command;
  let result;
  if (command==='contract') {
    result={...CONTRACT,endpoints:['time_series','quote','price']};
    if (options.openapi) {
      const bytes=await readBytes(resolve(options.openapi),8388608);
      const spec=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      result={...result,observedSha256:digest(bytes),matchesPublishedContract:digest(bytes)===CONTRACT.openapiSha256,
        operations:['time_series','quote','price'].map(endpoint=>({
          endpoint,operationId:spec.paths?.['/'+endpoint]?.get?.operationId??null,
          parameters:spec.paths?.['/'+endpoint]?.get?.parameters?.map(parameter=>parameter.name)??[],
        }))};
    }
  } else if (command==='plan') {
    result={plan:await loadMarketPlan(required(options,'plan')),contract:CONTRACT};
  } else if (command==='package') {
    result=compact(await exportMarketSeller({
      plan:await loadMarketPlan(required(options,'plan')),
      terms:await readJson(resolve(required(options,'terms')),262144),
      directory:resolve(required(options,'out')),
    }));
  } else if (command==='serve') {
    result=await serve(options);
    if (result.session) return result;
  } else if (command==='read') {
    const delivery=await MarketDataDelivery.open(resolve(required(options,'delivery')));
    result={metadata:delivery.metadata,page:delivery.rows({
      offset:number(options,'offset',0,0,Number.MAX_SAFE_INTEGER),
      limit:number(options,'limit',100,1,5000),
    })};
  } else if (command==='consume-buyer') {
    const config=await readJson(resolve(required(options,'buyer-config')),65536);
    const buyer=new Buyer(config);
    const delivery=await MarketDataDelivery.fromOperation(buyer.operation(required(options,'intent')),{
      plan:await loadMarketPlan(required(options,'plan')),productId:required(options,'product'),
    });
    result=compact(await delivery.export(resolve(required(options,'out'))));
  } else {
    const workspace=new MarketWorkspace(required(options,'workspace'));
    if (command==='list') result=await workspace.list();
    else if (command==='inspect') result=compact(await workspace.inspect(required(options,'id')));
    else if (command==='export') {
      const delivery=await MarketDataDelivery.fromCapture(workspace.captureDirectory(required(options,'id')));
      result=compact(await delivery.export(resolve(required(options,'out'))));
    } else {
      let query;
      try {query=JSON.parse(required(options,'query'));}
      catch {fail('MARKET_QUERY_JSON_INVALID');}
      const input={
        id:required(options,'id'),plan:await loadMarketPlan(required(options,'plan')),
        productId:required(options,'product'),query,
      };
      result=compact(command==='import-response' ? await workspace.importResponse({...input,
        responseFile:required(options,'response'),sourceFile:required(options,'source'),
      }) : await workspace.capture(input));
    }
  }
  print(result);
  if (['capture','import-response'].includes(command)&&result.state==='FAILED') process.exitCode=2;
  return result;
}
if (process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(error=>{
    process.stderr.write(JSON.stringify({error:error.code??'MARKET_OPERATION_FAILED',
      message:error instanceof TypeError?error.message:'The operation failed; retain the existing capture/intent and inspect its state.'})+'\n');
    process.exitCode=1;
  });
