#!/usr/bin/env node
// MIT. Offline report from two independent SHA-verified SF41 original captures.
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {resolve,dirname,basename,join} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {snapshotFromNative} from '../sf56-live-catalog-diff/diff.mjs';
import {reconcileNativeProviders,renderCrossProviderHtml} from './reconcile.mjs';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw new Error(code);};
async function bounded(path,max){
  const info=await stat(path);
  if(!info.isFile()||info.size<1||info.size>max)fail('INVALID_INPUT_FILE_SIZE');
  return readFile(path);
}
export async function loadNativeCapture(file){
  const full=resolve(file),raw=await bounded(full,1024*1024);
  const manifest=JSON.parse(raw.toString('utf8'));
  if(manifest?.schema!=='SCF-SF41/capture-v1'||!Array.isArray(manifest.sources)||
    !manifest.sources.length||manifest.sources.length>500)fail('ORIGINAL_SF41_MANIFEST_REQUIRED');
  const pages=[];
  for(const source of manifest.sources){
    if(typeof source?.file!=='string'||basename(source.file)!==source.file||
      !/^[A-Za-z0-9_.-]+\.json$/.test(source.file))fail('UNSAFE_CAPTURE_PAGE_FILENAME');
    pages.push(await bounded(join(dirname(full),source.file),4*1024*1024));
  }
  return snapshotFromNative({manifest,pages,manifestSha256:sha256(raw)});
}
export async function runCli(args=process.argv.slice(2)){
  if(args.length===1&&args[0]==='--help'){
    process.stdout.write('node cli.mjs --left /provider-a/sources.json --right /provider-b/sources.json --out-dir /new-reports\n');return;
  }
  const options={};
  for(let i=0;i<args.length;i+=2){
    if(!['--left','--right','--out-dir'].includes(args[i])||!args[i+1]||options[args[i]])fail('BAD_CLI_ARGUMENT');
    options[args[i]]=args[i+1];
  }
  if(Object.keys(options).length!==3)fail('LEFT_RIGHT_AND_OUT_DIR_REQUIRED');
  const [left,right]=await Promise.all([loadNativeCapture(options['--left']),loadNativeCapture(options['--right'])]);
  const report=reconcileNativeProviders(left,right);
  const html=renderCrossProviderHtml(report);
  const json=JSON.stringify(report,null,2)+'\n';
  const out=resolve(options['--out-dir']);
  await mkdir(out,{recursive:true});
  await writeFile(join(out,'report.json'),json,{flag:'wx'});
  await writeFile(join(out,'report.html'),html,{flag:'wx'});
  const receipts={schema:'SCF-SF65/report-receipts-v1',reportSha256:sha256(Buffer.from(json)),
    htmlSha256:sha256(Buffer.from(html)),leftManifestSha256:left.manifest_sha256,
    rightManifestSha256:right.manifest_sha256,network:report.network,
    observed:report.summary,paymentCalls:0};
  await writeFile(join(out,'receipts.json'),JSON.stringify(receipts,null,2)+'\n',{flag:'wx'});
  process.stdout.write(JSON.stringify({out,network:report.network,summary:report.summary,
    capturePair:report.capturePair,receipts})+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  runCli().catch(error=>{process.stderr.write('SF65: '+String(error.message||error)+'\n');process.exitCode=1;});
