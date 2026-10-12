// MIT. Installed command for the original Applications connection-setup facade.
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { link, unlink } from 'node:fs/promises';
import { OPENAPI_SETUP_ROUTES, openApiConnectionSetupAction } from '../../../distribution/runtime-workspace/openapi-connection-setup.mjs';
import { MAX_SOURCE_BYTES, need, plain, revision, setupError } from './model.mjs';
import { absolute, privateDirectory, readPrivate, createFile, syncDirectory } from '../../postgres/publisher/files.mjs';
import { regular } from '../../../distribution/runtime-workspace/storage.mjs';

const HELP=String.raw`Usage:
  starforge oauth-connection setup catalog --workspace ROOT --runtime ID [--context PRIVATE.json]
  starforge oauth-connection setup import-source --workspace ROOT --runtime ID --source OPENAPI --label TEXT --request-id ID --expected-revision N [--context PRIVATE.json]
  starforge oauth-connection setup inspect-source --workspace ROOT --runtime ID --input PRIVATE.json
  starforge oauth-connection setup review --workspace ROOT --runtime ID --context PRIVATE.json --input PRIVATE.json
  starforge oauth-connection setup commit --workspace ROOT --runtime ID --context PRIVATE.json --input PRIVATE.json
  starforge oauth-connection setup status --workspace ROOT --runtime ID [--input PRIVATE.json]
  starforge oauth-connection setup recover --workspace ROOT --runtime ID --input PRIVATE.json
  starforge oauth-connection setup activate --workspace ROOT --runtime ID --input PRIVATE.json
  starforge oauth-connection setup download --workspace ROOT --runtime ID --input PRIVATE.json [--out FILE]

ROOT is the original runtime operator workspace; ID is one of its existing runtime
entries. The current console prepares setup for a compatible verified READY runtime.
Context JSON: environmentFile, connectionsFile, port, allowLoopbackOAuth. Input JSON
uses the same action fields as the Applications setup API. Context and input files
are private regular UTF-8 JSON. The original OpenAPI file may be JSON or YAML and
is retained byte-for-byte; its imported size is at most 4 MiB.

All writes use the host-owned oauth-setup and oauth-grants children of ROOT.
Existing declared environment values are preserved in a private immutable edition.
Profiles reference existing client secrets by environment name; never put secret
values into setup inputs. --allow-loopback-oauth explicitly enables development
provider profiles for this CLI host, separately from the selected context flag.

Read catalog revision before review/commit. Retain exact request IDs and input
files for retries. status/recover with {"requestId":"original-id"} use the original
retained operation even if the current form context has changed. A committed
edition returns the four settings to apply through original Applications
Save -> Review start -> Start. Setup does not authorize an account or hot-swap a
running application. Downloads exclude private environment and grant files.
`;
const BOOL=new Set(['allow-loopback-oauth']);
function argumentsFor(argv) {
  const [action,...rest]=argv;
  if(!action || ['--help','help'].includes(action))return {action:'help'};
  need(Object.hasOwn(OPENAPI_SETUP_ROUTES,action),'INPUT_INVALID','Choose a setup action from --help.');
  const allowed=new Set(['workspace','runtime','context','input','allow-loopback-oauth',
    ...(action==='import-source'?['source','label','request-id','expected-revision']:[]),
    ...(action==='download'?['out']:[])]);
  const result={action};
  for(let index=0;index<rest.length;index++) {
    const option=rest[index];
    need(typeof option==='string' && option.startsWith('--') &&
      allowed.has(option.slice(2)) && !Object.hasOwn(result,option.slice(2)),
      'INPUT_INVALID','Use each declared setup option once.');
    const key=option.slice(2);
    if(BOOL.has(key)){result[key]=true;continue;}
    const value=rest[++index];
    need(typeof value==='string' && value.length>0 && !value.startsWith('--'),
      'INPUT_INVALID','Provide the value for each declared setup option.');
    result[key]=value;
  }
  need(result.workspace && result.runtime,'INPUT_INVALID','Select the original --workspace and --runtime entry.');
  return result;
}
async function privateJSON(path,maximum) {
  if(path===undefined)return {};
  absolute(path);
  let value;
  try { value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readPrivate(path,maximum))); }
  catch { need(false,'INPUT_INVALID','Use a private regular UTF-8 JSON input or context file.'); }
  need(plain(value),'INPUT_INVALID','Setup input and context files must contain JSON objects.');
  return value;
}
async function publicDownload(path,result) {
  absolute(path);await privateDirectory(dirname(path));
  const temporary=join(dirname(path),'.oauth-setup-download-'+randomUUID());
  let failure;
  try {
    await createFile(temporary,Buffer.from(result.content,'utf8'));
    await link(temporary,path);
    await syncDirectory(dirname(path));
  } catch(error) { failure=error;throw error; }
  finally {
    try{await unlink(temporary);await syncDirectory(dirname(path));}
    catch(error){if(error.code!=='ENOENT' && !failure)throw error;}
  }
}

/** The installed top-level oauth-connection command forwards only this subcommand. */
export async function setupMain(argv=process.argv.slice(2),{write=value=>process.stdout.write(value)}={}) {
  try {
    const args=argumentsFor(argv);
    if(args.action==='help'){write(HELP);return;}
    need(typeof write==='function','INPUT_INVALID','Use the original command output callback.');
    const context=await privateJSON(args.context,32768);
    let input=await privateJSON(args.input,args.action==='review'?32*1024*1024:32768);
    if(args.action==='import-source') {
      need(!args.input && args.source && args.label && args['request-id'] &&
        typeof args['expected-revision']==='string' && /^(?:0|[1-9]\d*)$/.test(args['expected-revision']),
        'INPUT_INVALID','Import needs --source, --label, --request-id and --expected-revision, without --input.');
      const raw=await regular(absolute(args.source),MAX_SOURCE_BYTES);
      let sourceText;
      try { sourceText=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw); }
      catch { need(false,'SOURCE_INVALID','The original source must be valid UTF-8 JSON or YAML.'); }
      need(Buffer.from(sourceText,'utf8').equals(raw),'SOURCE_INVALID','Retain the exact original UTF-8 source bytes.');
      input={sourceText,label:args.label,requestId:args['request-id'],
        expectedRevision:revision(Number(args['expected-revision']))};
    }
    const result=await openApiConnectionSetupAction(absolute(args.workspace),{
      action:args.action,runtimeId:args.runtime,context,input,
    },{policy:{allowLoopbackOAuth:args['allow-loopback-oauth']===true}});
    if(args.out) {
      await publicDownload(args.out,result);
      const {content,...metadata}=result;
      write(JSON.stringify({...metadata,path:args.out,bytes:Buffer.byteLength(content)},null,2)+'\n');
    } else write(JSON.stringify(result,null,2)+'\n');
    return result;
  } catch(error) { throw setupError(error); }
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  setupMain().catch(error=>{
    const safe=setupError(error);
    process.stderr.write(safe.code+': '+safe.message+'\n');process.exitCode=1;
  });
}
