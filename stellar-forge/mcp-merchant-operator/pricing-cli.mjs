#!/usr/bin/env node
// MIT. Original pricing reviews and saved commercial plans from merchant-mcp.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { callMerchantPricing,downloadMerchantScenario,pricingClientOperations } from './pricing-client.mjs';

const fail=(code,message)=>Object.assign(new Error(message),{code:'PRICING_CLIENT_'+code});
const HELP = `merchant-mcp pricing

  status|open|close|capture --url MCP_ENDPOINT [--workspace ALIAS] [--input PRIVATE_JSON]
  review-preview|review-save|review-load --url MCP_ENDPOINT --input PRIVATE_JSON
  source --url MCP_ENDPOINT --workspace ALIAS --version SAVED_REVIEW
  preview|save|apply --url MCP_ENDPOINT --input PRIVATE_JSON
  list --url MCP_ENDPOINT --workspace ALIAS
  load|selection --url MCP_ENDPOINT --workspace ALIAS --plan-id UUID [--scenario-id ID]
  manifest --url MCP_ENDPOINT --workspace ALIAS --plan-id UUID
  download --url MCP_ENDPOINT --workspace ALIAS --plan-id UUID --out PRIVATE_DIRECTORY
      [--manifest-sha256 REVIEWED_DIGEST] [--chunk-bytes BYTES]

All commands accept --token-env NAME (default MCP_ACCESS_TOKEN).
Paged reads accept --view, --offset, --limit, --scenario-id and --suggestion-kind.
The private JSON contains the exact MCP arguments, including stable requestId,
reviewSha256 and expectedRevision for writes. Repeat the same file after an
interrupted reply. capture returns current seller/snapshot/revision for apply.
Download resumes the same private directory using original manifest/file hashes.
See PRICING.md for scenario inputs, suggestions and the complete saved workflow.
`;

const flags=new Set(['--url','--workspace','--input','--version','--plan-id','--scenario-id',
  '--view','--offset','--limit','--suggestion-kind','--out','--token-env','--manifest-sha256','--chunk-bytes']);
const fieldFlags={'--workspace':'workspace','--version':'version','--plan-id':'planId',
  '--scenario-id':'scenarioId','--view':'view','--offset':'offset','--limit':'limit','--suggestion-kind':'suggestionKind'};
function options(args) {
  const result=new Map();
  for (let i=0;i<args.length;i+=2) {
    if (!flags.has(args[i]) || result.has(args[i]) || typeof args[i+1] !== 'string' || args[i+1].startsWith('--'))
      throw fail('ARGUMENTS','Use each documented flag once with its value.');
    result.set(args[i],args[i+1]);
  }
  return result;
}
function count(value,name) {
  if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw fail('ARGUMENTS','Supply a safe nonnegative whole number for '+name+'.');
  return Number(value);
}
async function inputFile(path) {
  const handle=await open(resolve(path),constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try {
    const stat=await handle.stat();
    if (!stat.isFile() || stat.size > 8*1024*1024 || process.platform !== 'win32' && stat.mode&0o077)
      throw fail('PRIVATE_INPUT_REQUIRED','Use a private regular input JSON file of at most 8 MiB (mode 0600).');
    const bytes=await handle.readFile();
    if (bytes.length > 8*1024*1024) throw fail('PRIVATE_INPUT_REQUIRED','The input file grew beyond 8 MiB.');
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw fail('ARGUMENTS','The private input JSON must be an argument object.');
    return value;
  } finally {await handle.close();}
}

export async function main(argv=process.argv.slice(2),{environment=process.env,write=value=>process.stdout.write(JSON.stringify(value)+'\n')}={}) {
  if (!argv.length || argv.length===1 && ['--help','help'].includes(argv[0])) {process.stdout.write(HELP);return;}
  const [operation,...rest]=argv, values=options(rest);
  if (!Object.hasOwn(pricingClientOperations,operation) && operation !== 'download')
    throw fail('ARGUMENTS','Choose an operation listed by merchant-mcp pricing --help.');
  if (!values.has('--url')) throw fail('ARGUMENTS','Supply the existing --url MCP endpoint.');
  const args=values.has('--input') ? await inputFile(values.get('--input')) : {};
  for (const [flag,key] of Object.entries(fieldFlags)) if (values.has(flag)) {
    const value=['offset','limit'].includes(key) ? count(values.get(flag),flag) : values.get(flag);
    if (Object.hasOwn(args,key) && args[key] !== value)
      throw fail('ARGUMENTS','The '+flag+' value differs from the retained input JSON.');
    args[key]=value;
  }
  const controller=new AbortController();
  const stop=()=>controller.abort(fail('INTERRUPTED','The request was interrupted. Recover with the same request ID, inputs or download directory.'));
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try {
    const connection={url:values.get('--url'),tokenEnv:values.get('--token-env')??'MCP_ACCESS_TOKEN',environment,signal:controller.signal};
    let result;
    if (operation === 'download') {
      if (!values.has('--out') || Object.keys(args).some(key=>!['workspace','planId'].includes(key)))
        throw fail('ARGUMENTS','Download selects only --workspace, --plan-id and --out.');
      result=await downloadMerchantScenario({...connection,...args,directory:values.get('--out'),
        ...(values.has('--manifest-sha256')?{expectedManifestSha256:values.get('--manifest-sha256')}:{ }),
        ...(values.has('--chunk-bytes')?{chunkSize:count(values.get('--chunk-bytes'),'--chunk-bytes')}:{ }),
        onProgress:progress=>process.stderr.write(JSON.stringify(progress)+'\n')});
    } else {
      if (['--out','--manifest-sha256','--chunk-bytes'].some(flag=>values.has(flag)))
        throw fail('ARGUMENTS','Output and chunk flags belong to download.');
      if (operation === 'manifest' && Object.hasOwn(args,'planId')) {
        if (Object.hasOwn(args,'id') && args.id !== args.planId || Object.hasOwn(args,'kind') && args.kind !== 'scenario')
          throw fail('ARGUMENTS','The plan selector conflicts with the original manifest selector.');
        args.id=args.planId;args.kind='scenario';delete args.planId;
      }
      result=await callMerchantPricing({...connection,operation,args});
    }
    write(result);return result;
  } finally {process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write(JSON.stringify({code:error.code??'PRICING_CLIENT_ERROR',message:error.message})+'\n');process.exitCode=1;});
