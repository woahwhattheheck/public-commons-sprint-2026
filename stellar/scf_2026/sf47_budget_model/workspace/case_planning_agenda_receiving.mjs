#!/usr/bin/env node
// MIT. Receive the original agenda through the managed client, MCP snapshots and CLI.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {inspectGrantAgentBinding,GrantWorkspaceClient} from './agent-client.mjs';
import {GRANT_TRANSFER_CHUNK_BYTES} from './agent-contracts.mjs';
import {MerchantGrantWorkspaces,GRANT_WORKSPACE_CONNECTION_SCHEMA} from '../../../../stellar-forge/mcp-merchant-operator/grant-workspace.mjs';

const HERE=dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const input=JSON.parse(await readFile(option('--context'),'utf8'));
const root=resolve(input.directory),directory=join(root,'agenda-native');
await mkdir(directory,{recursive:true,mode:0o700});
process.umask(0o077);
const json=value=>JSON.stringify(value,null,2)+'\n';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function atomic(path,value){
  const pending=path+'.pending-'+randomUUID();
  await writeFile(pending,typeof value==='string'||Buffer.isBuffer(value)?value:json(value),{mode:0o600});
  await rename(pending,path);
}
function comparable(report){
  const copy=structuredClone(report);delete copy.generatedAt;delete copy.sha256;
  for(const item of copy.cases){delete item.calendar.generatedAt;delete item.calendar.sha256;}
  return copy;
}
const browser=JSON.parse(await readFile(join(root,'browser-result.json'),'utf8'));
const selected=browser.phases['complete-multi-case-agenda-and-original-sources'].result.selection;
assert.equal(selected.asOfDate,input.asOfDate);assert.ok(selected.caseIds.includes(input.caseId));
const expected=JSON.parse(await readFile(join(root,'browser','delivery-agenda-native.json'),'utf8'));
assert.deepEqual(selected,expected.selection);
const files={};
async function retain(name,bytes){
  const path=join(directory,name);await atomic(path,bytes);
  files[name]={path,bytes:bytes.length,sha256:hash(bytes)};return path;
}
const binding=await inspectGrantAgentBinding({directory:resolve(input.workspace),pythonExecutable:input.python,
  allowStart:true,label:'Original case workbook and delivery agenda'});
const provider=new MerchantGrantWorkspaces({exportsDirectory:join(directory,'retained'),
  grantWorkspaces:{schema:GRANT_WORKSPACE_CONNECTION_SCHEMA,workspaces:{original:{...binding,inputs:{}}}}});
let client;
const descriptors=[];
async function receive(descriptor,name){
  assert.equal(descriptor.retention?.state,'COMPLETE');
  const chunks=[];let offset=0,readId;
  try{
    while(offset<descriptor.file.bytes){
      const row=await provider.call('merchant_grant_file_read',{workspace:'original',snapshotId:descriptor.id,
        expectedSha256:descriptor.file.sha256,offset,limit:GRANT_TRANSFER_CHUNK_BYTES,...(readId?{readId}:{})});
      const bytes=Buffer.from(row.data,'base64');
      assert.equal(row.offset,offset);assert.equal(row.bytesRead,bytes.length);assert.ok(bytes.length);
      assert.equal(row.file.sha256,descriptor.file.sha256);
      chunks.push(bytes);offset+=bytes.length;
      assert.ok(offset<=descriptor.file.bytes);
      assert.equal(row.nextOffset===null?descriptor.file.bytes:row.nextOffset,offset);
      readId=row.nextOffset===null?undefined:row.readId;
    }
  }finally{
    if(readId)await provider.call('merchant_grant_file_release',{workspace:'original',snapshotId:descriptor.id,readId});
  }
  const bytes=Buffer.concat(chunks);assert.equal(bytes.length,descriptor.file.bytes);
  assert.equal(hash(bytes),descriptor.file.sha256);await retain(name,bytes);
  descriptors.push({name,id:descriptor.id,file:descriptor.file});return bytes;
}
try{
  await provider.call('merchant_grant_open',{workspace:'original',expectedSelectionSha256:binding.selectionSha256});
  client=new GrantWorkspaceClient({...binding,allowStart:false});
  await client.open({expectedSelectionSha256:binding.selectionSha256});
  const typed=await client.read('delivery-agenda',selected);
  assert.deepEqual(comparable(typed.value),comparable(expected));
  await retain('typed-agenda.json',typed.bytes);
  const snapshot=await provider.call('merchant_grant_delivery_agenda',{workspace:'original',...selected});
  const source=JSON.parse((await receive(snapshot,'mcp-agenda.json')).toString('utf8'));
  assert.deepEqual(comparable(source),comparable(expected));
  for(const format of ['ics','csv','json']){
    const typedFile=await client.download('delivery-agenda',{...selected,format});
    await retain('typed-agenda.'+format,typedFile.bytes);
    const returned=await provider.call('merchant_grant_export',{workspace:'original',kind:'delivery-agenda',...selected,format});
    const raw=await receive(returned,'mcp-agenda.'+format);
    if(format==='json')assert.deepEqual(comparable(JSON.parse(raw.toString('utf8'))),comparable(expected));
  }
}finally{
  try{if(client)await client.close();}finally{await provider.close();}
}
// The original managed service has released the original workspace lock.
const cli=join(HERE,'cli.py'),selectionArgs=[];
for(const id of selected.caseIds)selectionArgs.push('--case',id,'--case-version',id+'='+selected.expectedVersions[id]);
const base=['operations','--workspace',resolve(input.workspace)];
const exec=command=>execFileSync(input.python,[cli,...command],{cwd:HERE,encoding:'utf8',maxBuffer:64*1024*1024,
  env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
const cliReport=JSON.parse(exec([...base,'delivery-agenda',...selectionArgs,'--as-of',selected.asOfDate]));
assert.deepEqual(comparable(cliReport),comparable(expected));
await retain('cli-agenda.json',Buffer.from(json(cliReport)));
for(const format of ['ics','csv','json']){
  const target=join(directory,'cli-export-'+randomUUID()+'.'+format);
  exec([...base,'delivery-agenda-export',...selectionArgs,'--as-of',selected.asOfDate,'--format',format,'--output',target]);
  const raw=await readFile(target);await retain('cli-export.'+format,raw);
  if(format==='json')assert.deepEqual(comparable(JSON.parse(raw.toString('utf8'))),comparable(expected));
}
const checkProgram=[
  'import csv,io,json,sys',
  'from pathlib import Path',
  'root=Path(sys.argv[1]);report=json.loads((root/"cli-agenda.json").read_text())',
  'wanted=sorted((row["caseId"],row["entry"]["id"]) for key in ("entries","undated") for row in report[key])',
  'counts={}',
  'for path in root.glob("*.csv"):',
  '    rows=list(csv.DictReader(io.StringIO(path.read_text(encoding="utf-8-sig"))))',
  '    assert sorted((row["caseId"],row["id"]) for row in rows)==wanted,str(path)',
  '    counts[path.name]=len(rows)',
  'print(json.dumps(counts))',
].join('\n');
const csvRows=JSON.parse(execFileSync(input.python,['-c',checkProgram,directory],{encoding:'utf8',maxBuffer:1024*1024}));
const normalizeIcs=bytes=>bytes.toString('utf8').replace(/\r\n[ \t]/g,'').split(/\r?\n/).filter(line=>!line.startsWith('DTSTAMP:')).join('\n');
const typedIcs=normalizeIcs(await readFile(join(directory,'typed-agenda.ics')));
for(const name of ['mcp-agenda.ics','cli-export.ics'])assert.equal(normalizeIcs(await readFile(join(directory,name))),typedIcs);
const result={schema:'stellar-forge.sf47-case-workbook-agenda-receiving.v1',operationId:input.operationId,
  selection:selected,clientSelectionSha256:binding.selectionSha256,complete:true,
  nativeRows:expected.entries.length,undatedRows:expected.undated.length,csvRows,
  completeMcpSnapshots:descriptors,files,completedAt:new Date().toISOString()};
await atomic(join(root,'AGENDA_NATIVE_RECEIVING.json'),result);
process.stdout.write(json({complete:true,selection:selected,files:Object.keys(files).length}));
