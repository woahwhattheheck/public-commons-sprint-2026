#!/usr/bin/env node
// MIT. Offline operation tickets, local status and explicit merchant recovery.
import { constants } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readUpstreamBindings, createUpstreamHandlers } from './upstream.mjs';
import { parseOperationResponse } from './upstream-operation-response.mjs';

const USAGE = `Usage: node upstream-operation.mjs COMMAND --upstreams BINDINGS.json --binding NAME
  [--allow-loopback-upstream]

issue   --request REQUEST.json --id ID --subject SUBJECT --expires ISO_TIME --out TICKET.json
status  --operation-key SHA256
recover --operation-key SHA256 --generation N --request-hash SHA256
        --action complete|retry --reference BACKEND_REFERENCE [--response RESPONSE.json]

Reads keyEnv from the environment without printing its value.
All commands use original upstream bindings and make no HTTP request or payment.
Recovery changes only the backend-operation record, with an exact generation guard.
See IDEMPOTENCY.md for merchant setup and the native payment contract.`;
const SWITCH = '--allow-loopback-upstream';
const optionNames = new Set(['--upstreams','--binding','--request','--id','--subject','--expires','--out',
  '--operation-key','--generation','--request-hash','--action','--reference','--response']);
function parse(args) {
  const command = args[0], options = new Map();
  if (!['issue','status','recover'].includes(command)) throw new TypeError(USAGE);
  for (let i=1;i<args.length;i++) {
    const key=args[i];
    if (options.has(key)) throw new TypeError('Duplicate option');
    if (key===SWITCH) { options.set(key,true); continue; }
    if (!optionNames.has(key) || !args[i+1] || args[i+1].startsWith('--')) throw new TypeError(USAGE);
    options.set(key,args[++i]);
  }
  const common=['--upstreams','--binding',SWITCH];
  const required=command==='issue'?['--request','--id','--subject','--expires','--out']:
    command==='status'?['--operation-key']:['--operation-key','--generation','--request-hash','--action','--reference'];
  const allowed=new Set([...common,...required,...(command==='recover'?['--response']:[])]);
  if (!options.has('--upstreams') || !options.has('--binding') || required.some(k=>!options.has(k)) ||
      [...options.keys()].some(k=>!allowed.has(k))) throw new TypeError(USAGE);
  if (command==='recover' && ((options.get('--action')==='complete') !== options.has('--response'))) {
    throw new TypeError('Exactly complete recovery requires an original backend response file');
  }
  return {command,options};
}

async function privateJSON(path, maxBytes=2097152) {
  const absolute=resolve(path), info=await lstat(absolute);
  if (!info.isFile() || info.isSymbolicLink() || info.size>maxBytes || (info.mode&0o077)!==0 ||
      await realpath(absolute)!==absolute) throw new TypeError('Input must be a private regular file within the size limit');
  const file=await open(absolute,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const bytes=await file.readFile();
    if(bytes.length>maxBytes)throw new TypeError('Input exceeds the size limit');
    return JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));
  } finally {await file.close();}
}
export async function writeTicket(path,value) {
  const absolute=resolve(path), parent=dirname(absolute), info=await lstat(parent);
  if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o077)!==0||await realpath(parent)!==parent) {
    throw new TypeError('Ticket parent must be a private existing directory');
  }
  const file=await open(absolute,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try {await file.writeFile(JSON.stringify(value,null,2)+'\n');await file.sync();}finally{await file.close();}
  const directory=await open(parent,constants.O_RDONLY);
  try{await directory.sync();}finally{await directory.close();}
  return absolute;
}

export async function main(args=process.argv.slice(2)) {
  if(args.length===1&&args[0]==='--help'){process.stdout.write(USAGE+'\n');return;}
  const {command,options:o}=parse(args);
  const bindings=await readUpstreamBindings(resolve(o.get('--upstreams')));
  const handlers=createUpstreamHandlers(bindings,{allowLoopback:o.has(SWITCH)});
  const name=o.get('--binding');
  if(!Object.hasOwn(handlers,name)||!handlers[name].idempotency)throw new TypeError('Select an original upstream binding with idempotency configured');
  const operation=handlers[name].idempotency;
  try {
    if(command==='issue') {
      const request=await privateJSON(o.get('--request'));
      if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(k=>!['method','url','pathParams','headers','body'].includes(k)))throw new TypeError('Expected original method, url, pathParams, headers and JSON body');
      const expiresAt=Date.parse(o.get('--expires'));
      const result=operation.issue({...request,url:new URL(request.url)},
        {id:o.get('--id'),subject:o.get('--subject'),expiresAt});
      const path=await writeTicket(o.get('--out'),{schema:'stellar-forge.upstream-operation-ticket.v1',...result});
      process.stdout.write(JSON.stringify({status:'ISSUED',path,operationKey:result.operationKey,requestHash:result.requestHash,expiresAt})+'\n');
    } else if(command==='status') {
      const result=await operation.inspect(o.get('--operation-key'));
      process.stdout.write(JSON.stringify(result??{state:'ABSENT',operationKey:o.get('--operation-key')})+'\n');
    } else {
      if(!/^[1-9][0-9]{0,14}$/.test(o.get('--generation')))throw new TypeError('Generation must be a positive integer');
      let response;
      if(o.has('--response')) {
        response=parseOperationResponse(await privateJSON(o.get('--response'),24000000));
      }
      const result=await operation.recover({operationKey:o.get('--operation-key'),expectedGeneration:Number(o.get('--generation')),
        requestHash:o.get('--request-hash'),action:o.get('--action'),reference:o.get('--reference'),response});
      process.stdout.write(JSON.stringify({status:'RECORDED',...result})+'\n');
    }
  }finally{await operation.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(error=>{process.stderr.write(error?.code&&/^[A-Z_]+$/.test(error.code)?error.code+'\n':
    error instanceof TypeError?error.message+'\n':'UPSTREAM_OPERATION_COMMAND_FAILED\n');process.exitCode=1;});
}
