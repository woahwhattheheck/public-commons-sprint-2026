// MIT. Complete original portfolio receiving through the maintained merchant transport.
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRetainedDownload} from '../../../../stellar-forge/mcp-merchant-operator/retained-download.mjs';
import {connectGrantPortfolio} from './client.mjs';
import {
  GRANT_PORTFOLIO_MANIFEST,GRANT_PORTFOLIO_MAX_BYTES,GRANT_PORTFOLIO_SHA,
  GRANT_PORTFOLIO_OPERATION,portfolioChecked,portfolioNeed,portfolioInteger,
  parseGrantPortfolioManifest,
} from './merchant-contract.mjs';

const transport=createRetainedDownload({
  manifestName:GRANT_PORTFOLIO_MANIFEST,parseManifest:parseGrantPortfolioManifest,
  maximumBytes:GRANT_PORTFOLIO_MAX_BYTES,
  stateSchema:'stellar-forge.grant-portfolio-download-state.v1',
  resultSchema:'stellar-forge.grant-portfolio-download.v1',
  toolPrefix:'merchant_grant_portfolio',errorPrefix:'GRANT_PORTFOLIO',
  clientName:'starforge-grant-portfolio-receiving',
  validateExportId:value=>portfolioChecked(value,GRANT_PORTFOLIO_SHA,'retained portfolio export ID'),
  describe:manifest=>({workspace:manifest.workspace,workspaceId:manifest.workspaceId,
    operationId:manifest.operationId,portfolioId:manifest.portfolioId,revision:manifest.revision,
    snapshot:manifest.snapshot,nativeExport:manifest.nativeExport}),
});

/** Repeat calls retain the same endpoint, export, manifest and downloaded byte prefix. */
export async function downloadGrantPortfolioExport(options) {
  const value=await transport.download(options);
  return {...value,portfolioFile:join(value.directory,'portfolio.zip'),
    manifestFile:join(value.directory,GRANT_PORTFOLIO_MANIFEST)};
}
export async function inspectGrantPortfolioExport(options={}) {
  if(options.expectedManifestSha256!==undefined)
    portfolioChecked(options.expectedManifestSha256,GRANT_PORTFOLIO_SHA,'original manifest SHA-256');
  const result=await transport.inspect(options);
  portfolioNeed(options.expectedManifestSha256===undefined||result.manifestSha256===options.expectedManifestSha256,
    'MANIFEST_CHANGED','The inspected manifest differs from the original selected manifest.');
  return result;
}

/** Receive the downloaded native packet into the caller's original target action ledger.
 * The caller keeps operationId and expectedRevision before invoking this function.
 * The borrowed target client and its running server retain their original owners.
 */
export async function receiveGrantPortfolioExport({
  target,operationId,expectedRevision,wait=true,waitOptions={},...options
}={}) {
  portfolioNeed(target&&typeof target.uploadFile==='function'&&typeof target.receivePortfolio==='function'&&
    typeof target.wait==='function','RECEIVING_CONFIGURATION','Supply the original target portfolio client.');
  portfolioChecked(operationId,GRANT_PORTFOLIO_OPERATION,'receiving operation ID');
  if(expectedRevision!==undefined)portfolioInteger(expectedRevision);
  const downloaded=await downloadGrantPortfolioExport(options);
  const object=await target.uploadFile(downloaded.portfolioFile,{sha256:downloaded.nativeExport.sha256,signal:options.signal});
  let request=await target.receivePortfolio(operationId,{object:object.sha256},{
    ...(expectedRevision===undefined?{}:{expectedRevision}),signal:options.signal});
  if(wait&&request.state==='RUNNING')request=await target.wait(operationId,{...waitOptions,signal:options.signal});
  return {schema:'stellar-forge.grant-portfolio-receiving.v1',state:request.state,
    operationId,downloaded,object,request};
}

const HELP='Grant portfolio receiving\n\n'+
  '  grant-portfolio-receive inspect --url MCP_URL --export EXPORT_ID [--token-env NAME]\n'+
  '  grant-portfolio-receive download --url MCP_URL --export EXPORT_ID --out DIRECTORY [--manifest-sha SHA256]\n'+
  '  grant-portfolio-receive receive --url MCP_URL --export EXPORT_ID --out DIRECTORY --console-url-file PRIVATE_FILE --operation-id ORIGINAL_ID [--expected-revision N]\n\n'+
  'Every download retains the complete original manifest and ZIP. Repeat the same directory to continue its verified prefix.\n'+
  'receive imports that unchanged native ZIP into the original target workspace and waits on the same retained action.\n';
export async function main(args=process.argv.slice(2)) {
  if(!args.length||args.length===1&&['help','--help'].includes(args[0])){process.stdout.write(HELP);return;}
  const [command,...flags]=args;
  portfolioNeed(['inspect','download','receive'].includes(command)&&flags.length%2===0,
    'RECEIVING_CONFIGURATION','Choose an original receiving command and complete option pairs.');
  const values=new Map(),allowed=new Set(['--url','--export','--token-env','--out','--manifest-sha',
    '--console-url-file','--operation-id','--expected-revision','--wait-ms']);
  for(let index=0;index<flags.length;index+=2){
    portfolioNeed(allowed.has(flags[index])&&!values.has(flags[index])&&typeof flags[index+1]==='string'&&
      !flags[index+1].startsWith('--'),'RECEIVING_CONFIGURATION','Use each declared option once.');
    values.set(flags[index],flags[index+1]);
  }
  portfolioNeed(values.has('--url')&&values.has('--export'),'RECEIVING_CONFIGURATION','Select the original MCP endpoint and retained export ID.');
  if(command==='inspect')portfolioNeed(!['--out','--console-url-file','--operation-id','--expected-revision','--wait-ms'].some(key=>values.has(key)),
    'RECEIVING_CONFIGURATION','Inspect selects the original endpoint and export only.');
  if(command==='download')portfolioNeed(!['--console-url-file','--operation-id','--expected-revision','--wait-ms'].some(key=>values.has(key)),
    'RECEIVING_CONFIGURATION','Download selects the original export and receiving directory.');
  const options={url:values.get('--url'),exportId:values.get('--export'),
    ...(values.has('--token-env')?{tokenEnv:values.get('--token-env')}:{}),
    ...(values.has('--manifest-sha')?{expectedManifestSha256:values.get('--manifest-sha')}:{})};
  let result;
  if(command==='inspect')result=await inspectGrantPortfolioExport(options);
  else {
    portfolioNeed(values.has('--out'),'RECEIVING_CONFIGURATION','Select the original private receiving directory.');
    options.directory=resolve(values.get('--out'));
    if(command==='download')result=await downloadGrantPortfolioExport(options);
    else {
      portfolioNeed(values.has('--console-url-file')&&values.has('--operation-id'),
        'RECEIVING_CONFIGURATION','Select the original target console connection and saved receiving operation ID.');
      const number=(key,minimum=0,maximum=Number.MAX_SAFE_INTEGER)=>{
        const raw=values.get(key);
        portfolioNeed(/^(0|[1-9]\d*)$/.test(raw??''),'RECEIVING_CONFIGURATION','Use the exact nonnegative revision or wait interval.');
        return portfolioInteger(Number(raw),minimum,maximum);
      };
      const target=await connectGrantPortfolio({consoleUrlFile:resolve(values.get('--console-url-file'))});
      try {
        result=await receiveGrantPortfolioExport({...options,target,operationId:values.get('--operation-id'),
          ...(values.has('--expected-revision')?{expectedRevision:number('--expected-revision')}:{}),
          ...(values.has('--wait-ms')?{waitOptions:{timeoutMs:number('--wait-ms',1,3600000)}}:{})});
      }finally{await target.dispose();}
    }
  }
  process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(error=>{console.error((error.code?error.code+': ':'')+error.message);process.exitCode=1;});
