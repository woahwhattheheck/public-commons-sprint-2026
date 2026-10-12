#!/usr/bin/env node
// MIT. Receive one complete original Study package through the installed Merchant.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const APP = 'stellar/scf-starforge-20261009/sf30-seller-sdk/study-source-refresh';
const CLI = 'stellar/scf-starforge-20261009/distribution/cli.mjs';
const sha = data => createHash('sha256').update(data).digest('hex');
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' :
  value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key =>
    JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const equal = (left, right) => canonical(left) === canonical(right);
function need(value, message) { if (!value) throw new Error(message); }
const sleep = milliseconds => new Promise(done => { const timer = setTimeout(done, milliseconds); timer.unref(); });

async function save(path, value) {
  const temporary = path + '.new';
  const file = await open(temporary, 'w', 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + '\n'); await file.sync(); }
  finally { await file.close(); }
  await rename(temporary, path);
}
async function command(node, cli, args, directory, logName) {
  const child = spawn(node, [cli, ...args], {cwd:directory, env:process.env,
    stdio:['ignore','pipe','pipe'], windowsHide:true});
  const output = [], errors = []; let bytes = 0;
  child.stdout.on('data', part => {
    bytes += part.length;
    if (bytes > 32 * 1024 * 1024) child.kill('SIGTERM');
    else output.push(part);
  });
  child.stderr.on('data', part => { if (Buffer.concat(errors).length < 65536) errors.push(part); });
  const result = await new Promise((done, reject) => {
    child.once('error', reject); child.once('close', (code, signal) => done({code, signal}));
  });
  await save(join(directory, logName + '.json'), {args, ...result,
    stdout:Buffer.concat(output).toString('utf8'), stderr:Buffer.concat(errors).toString('utf8')});
  need(result.code === 0 && bytes <= 32 * 1024 * 1024, 'Original installed command failed: ' + logName);
  const body = Buffer.concat(output).toString('utf8').trim();
  return body ? JSON.parse(body) : null;
}

/** Standard newline MCP messages to the original installed stdio transport. */
async function connect(node, cli, config, directory, serial) {
  const stderr = await open(join(directory, 'merchant-' + serial + '.stderr.log'), 'a', 0o600);
  const child = spawn(node, [cli, 'merchant-mcp-stdio', '--config', config],
    {cwd:directory, env:process.env, stdio:['pipe','pipe',stderr.fd], windowsHide:true});
  const pending = new Map(); let sequence = 0, text = '', closed = false;
  const done = new Promise(resolveDone => {
    const finish = value => {
      closed = true;
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Original MCP transport closed')); }
      pending.clear(); resolveDone(value);
    };
    child.once('error', error => finish({error:error.code}));
    child.once('exit', (code, signal) => finish({code, signal}));
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', part => {
    text += part;
    if (Buffer.byteLength(text) > 32 * 1024 * 1024) { child.kill('SIGTERM'); return; }
    let newline;
    while ((newline = text.indexOf('\n')) >= 0) {
      const line = text.slice(0, newline); text = text.slice(newline + 1);
      if (!line.trim()) continue;
      let reply;
      try { reply = JSON.parse(line); } catch { child.kill('SIGTERM'); return; }
      const request = pending.get(reply.id);
      if (!request) continue;
      pending.delete(reply.id); clearTimeout(request.timer);
      if (reply.error) request.reject(Object.assign(new Error(reply.error.message), {code:reply.error.code}));
      else request.resolve(reply.result);
    }
  });
  const rpc = (method, params) => new Promise((resolveResult, reject) => {
    if (closed) { reject(new Error('Original MCP transport is closed')); return; }
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Original MCP reply is uncertain; inspect the retained native operation before another write'));
    }, 360000);
    pending.set(id, {resolve:resolveResult, reject, timer});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0', id, method, params}) + '\n', error => {
      if (error && pending.delete(id)) { clearTimeout(timer); reject(error); }
    });
  });
  try {
    const initialized = await rpc('initialize', {protocolVersion:'2025-03-26',
      capabilities:{}, clientInfo:{name:'study-original-package-receiver', version:'1.0.0'}});
    need(typeof initialized.protocolVersion === 'string', 'Original MCP initialization did not complete');
    child.stdin.write(JSON.stringify({jsonrpc:'2.0', method:'notifications/initialized'}) + '\n');
    return {
      rpc,
      async tool(name, args = {}) {
        const result = await rpc('tools/call', {name:'merchant_study_' + name, arguments:args});
        const value = result.structuredContent ?? JSON.parse(result.content.find(item => item.type === 'text').text);
        if (result.isError) throw Object.assign(new Error(value.message ?? value.error?.message ?? 'Original Study tool refused'),
          {code:value.code ?? value.error?.code});
        return value;
      },
      async close() {
        if (!closed) child.stdin.end();
        let result = await Promise.race([done, sleep(30000).then(() => null)]);
        if (result === null) { child.kill('SIGTERM'); result = await Promise.race([done, sleep(15000).then(() => null)]); }
        need(result !== null, 'Original owned MCP process has not completed shutdown; retain this process identity');
        await stderr.close();
      },
      pid:child.pid,
    };
  } catch (error) {
    child.stdin.end();
    if (!closed) child.kill('SIGTERM');
    await Promise.race([done, sleep(15000)]);
    await stderr.close();
    throw error;
  }
}

async function jsonResult(mcp, workspace, snapshot) {
  need(snapshot.retention?.state === 'COMPLETE' && snapshot.id, 'Complete original native response was not retained');
  const parts = []; let offset = 0, readId;
  try {
    do {
      const part = await mcp.tool('file_read', {workspace, snapshotId:snapshot.id,
        expectedSha256:snapshot.file.sha256, offset, limit:65536, ...(readId ? {readId} : {})});
      readId = part.readId;
      need(part.offset === offset && part.encoding === 'base64', 'Original response part changed');
      const bytes = Buffer.from(part.data, 'base64');
      need(bytes.length === part.bytesRead, 'Original response part length changed');
      parts.push(bytes); offset += bytes.length;
      if (part.nextOffset === null) break;
      need(part.nextOffset === offset, 'Original response offset changed');
    } while (offset < snapshot.file.bytes);
  } finally {
    if (readId) await mcp.tool('file_release', {workspace, snapshotId:snapshot.id, readId});
  }
  const bytes = Buffer.concat(parts);
  need(bytes.length === snapshot.file.bytes && sha(bytes) === snapshot.file.sha256, 'Complete original response identity changed');
  const body = JSON.parse(bytes);
  need(body.ok === true, 'Original native operation refused: ' + (body.code ?? body.error?.code ?? 'UNKNOWN'));
  return body.result;
}

export async function receiveOriginalStudyPackage(options) {
  const packageDirectory = resolve(options.package), directory = resolve(options.out);
  const sourceWorkspace = resolve(options.workspace), python = resolve(options.python), node = process.execPath;
  need(/^[a-f0-9]{40}$/.test(options.commit) && /^[a-f0-9]{64}$/.test(options.exportId), 'Use exact installed source and original export IDs');
  const manifest = JSON.parse(await readFile(join(packageDirectory, 'manifest.json'), 'utf8'));
  need(manifest.schema === 'stellar-forge.merchant-distribution-manifest.v1' && manifest.sourceCommit === options.commit,
    'Use the original package built from the selected source commit');
  const files = new Set(manifest.files.map(item => item.path));
  for (const path of [APP + '/agent-client.mjs', APP + '/merchant-registration.mjs', APP + '/cli.py', CLI])
    need(files.has(path), 'The installed package is missing its declared Study command: ' + path);
  const cli = join(packageDirectory, 'source', CLI);
  const module = await import(pathToFileURL(join(packageDirectory, 'source', APP, 'agent-client.mjs')));
  await mkdir(directory, {recursive:true, mode:0o700});
  const receiver = join(directory, 'received-workspace');
  const intent = {schema:'stellar-forge.study-agent-receiving.v1', packageDirectory,
    sourceCommit:options.commit, sourceWorkspace, exportId:options.exportId, receiver, python};
  try { need(equal(JSON.parse(await readFile(join(directory, 'operation.json'), 'utf8')), intent),
    'This receiving directory already belongs to another original operation'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; await save(join(directory, 'operation.json'), intent); }
  const result = {...intent, startedAt:new Date().toISOString(), phases:[]};
  const record = async (phase, value = {}) => {
    result.phases.push({phase, ...value});
    await save(join(directory, 'result.json'), result);
    process.stdout.write(JSON.stringify({phase, ...value}) + '\n');
  };
  const sourceBinding = await module.inspectStudyBinding({directory:sourceWorkspace, pythonExecutable:python, allowStart:true});
  // This original typed owner remains outside Merchant, which must borrow it.
  const sourceOwner = new module.StudyWorkspaceClient(sourceBinding);
  let mcp, serial = 0;
  try {
    const source = await sourceOwner.open();
    await record('original-source-operator', {instanceId:source.original.instance_id,
      sourceSha256:source.original.source_sha256, pid:source.original.pid, sourceOwner:source.state});
    await command(node, cli, ['study-source-refresh','--python',python,'--workspace',receiver,'init'], directory, 'receiver-init');
    const connection = join(directory, 'study-connection.json'), merchant = join(directory, 'merchant');
    await save(connection, {schema:'stellar-forge.study-workspace-connection.v1', workspaces:{
      source:{label:'Original completed Study', directory:sourceWorkspace, pythonExecutable:python, nodeExecutable:node, allowStart:false},
      receiving:{label:'Original package receiving', directory:receiver, pythonExecutable:python, nodeExecutable:node, allowStart:true},
    }});
    const setup = join(directory, 'setup.json');
    await save(setup, {directory:merchant, connection, name:'Original Study package receiving'});
    await command(node, cli, ['merchant-providers','init','study-workspaces','--options',setup], directory, 'merchant-setup');
    const configuration = join(merchant, 'merchant-mcp.json');
    const start = async () => connect(node, cli, configuration, directory, ++serial);
    mcp = await start();
    const names = new Set(); let cursor;
    do {
      const catalog = await mcp.rpc('tools/list', cursor ? {cursor} : {});
      for (const tool of catalog.tools) if (tool.name.startsWith('merchant_study_')) names.add(tool.name);
      cursor = catalog.nextCursor;
    } while (cursor);
    need(names.size === 51, 'The installed Study provider does not expose its complete original tool catalog');
    const sourceOpen = await mcp.tool('open', {workspace:'source'});
    need(sourceOpen.original.instance_id === source.original.instance_id && sourceOpen.state === 'BORROWED_ORIGINAL_OPERATOR',
      'Merchant did not borrow the selected original operator');
    const native = async (tool, workspace, args = {}) => jsonResult(mcp, workspace,
      await mcp.tool(tool, {workspace, ...args}));
    const verified = await native('export_verify','source',{export_id:options.exportId});
    need(verified.package_id === options.exportId && verified.kind === 'property-research', 'Select the original complete property package');
    const selectionId = verified.selection_id;
    const report = await native('property_selection_report','source',{selection_id:selectionId});
    const selection = await native('property_selection_read','source',{selection_id:selectionId});
    await native('export_archive','source',{export_id:options.exportId});
    const archive = await mcp.tool('download',{workspace:'source',kind:'archive',id:options.exportId});
    need(archive.retention?.state === 'COMPLETE' && archive.id, 'The complete native archive was not retained');
    await record('original-package-selected', {packageId:verified.package_id, selectionId,
      sourceFiles:verified.files.length, archive:archive.file, catalogTools:names.size});
    const declaration = {workspace:'receiving', transferKey:'original-package-' + options.exportId,
      filename:archive.file.name, bytes:archive.file.bytes, sha256:archive.file.sha256, mediaType:archive.file.mediaType};
    let transfer = await mcp.tool('receive_begin', declaration), chunks = 0, readId;
    // The same payload and complete native snapshot survive this actual transport restart.
    while (transfer.state !== 'COMPLETE' && transfer.missingParts > 0) {
      for (const offset of transfer.missingOffsets) {
        const part = await mcp.tool('file_read',{workspace:'source',snapshotId:archive.id,
          expectedSha256:archive.file.sha256,offset,limit:65536,...(readId ? {readId} : {})});
        readId = part.readId;
        need(part.offset === offset && part.encoding === 'base64', 'Original archive part changed');
        const args = {workspace:'receiving',transferId:transfer.transferId,offset,data:part.data};
        await mcp.tool('receive_chunk',args); chunks++;
        if (chunks === 1) await mcp.tool('receive_chunk',args);
        if (chunks === 2) {
          await mcp.close(); mcp = null; readId = undefined;
          const still = await sourceOwner.inspect();
          need(still.original.instance_id === source.original.instance_id, 'Closing Merchant changed its borrowed operator');
          mcp = await start();
          const borrowed = await mcp.tool('open', {workspace:'source'});
          need(borrowed.original.instance_id === source.original.instance_id &&
            borrowed.state === 'BORROWED_ORIGINAL_OPERATOR', 'Restart did not reopen the same borrowed source');
          transfer = await mcp.tool('receive_begin', declaration);
          await record('same-transfer-reopened', {transferId:transfer.transferId, receivedParts:transfer.receivedParts,
            borrowedInstance:still.original.instance_id});
          break;
        }
      }
      transfer = await mcp.tool('receive_status',{workspace:'receiving',transferId:transfer.transferId,limit:200});
    }
    if (readId) await mcp.tool('file_release',{workspace:'source',snapshotId:archive.id,readId});
    transfer = await mcp.tool('receive_commit',{workspace:'receiving',transferId:transfer.transferId});
    need(transfer.file.sha256 === archive.file.sha256 && transfer.file.bytes === archive.file.bytes, 'Complete original transfer changed');
    const receiving = await mcp.tool('open', {workspace:'receiving'});
    need(receiving.state === 'OWNED_ORIGINAL_OPERATOR', 'This private receiving operation already has another operator owner');
    const imported = await native('package_import','receiving',{input:{transferId:transfer.transferId},expectedSha256:archive.file.sha256});
    need(imported.package_id === verified.package_id, 'Native receiving selected another package');
    const receivedReport = await native('property_selection_report','receiving',{selection_id:selectionId});
    const receivedSelection = await native('property_selection_read','receiving',{selection_id:selectionId});
    need(equal(receivedReport,report) && equal(receivedSelection,selection), 'Frozen original report or review changed during receiving');
    for (const documentId of verified.property_bundle.document_ids) {
      const original = await native('property_document_read','source',{document_id:documentId});
      const received = await native('property_document_read','receiving',{document_id:documentId});
      need(equal(original,received), 'Original source document changed during receiving');
    }
    const repeat = await native('package_import','receiving',{input:{transferId:transfer.transferId},expectedSha256:archive.file.sha256});
    need(repeat.package_id === verified.package_id, 'Reopening the original package changed its identity');
    const status = await native('status','receiving');
    need(status.exports.some(value => value.id === verified.package_id), 'The complete received package is absent from the original operator');
    await record('original-package-received', {packageId:verified.package_id, transferId:transfer.transferId,
      completeSha256:transfer.file.sha256, sourceDocuments:verified.property_bundle.document_ids.length,
      selectionId, reportSha256:sha(Buffer.from(canonical(report)))});
    await mcp.close(); mcp = null;
    const receiverProbe = new module.StudyWorkspaceClient(await module.inspectStudyBinding({directory:receiver,
      pythonExecutable:python, allowStart:false}));
    try {
      need((await receiverProbe.inspect()).state === 'ORIGINAL_OPERATOR_UNAVAILABLE',
        'The original Merchant-owned receiving operator has not completed shutdown');
    } finally {await receiverProbe.close();}
    const sourceStill = await sourceOwner.inspect();
    need(sourceStill.original.instance_id === source.original.instance_id, 'Merchant shutdown stopped a borrowed original operator');
    const argumentsFile = join(directory,'selection.json');
    await save(argumentsFile,{selection_id:selectionId});
    const reopened = await command(node,cli,['study-source-refresh','--python',python,'--workspace',receiver,
      'call','property.selection.report','--arguments',argumentsFile],directory,'received-cli-report');
    need(equal(reopened,report), 'The installed CLI reopened another original report');
    await record('installed-cli-reopened',{selectionId,borrowedInstance:sourceStill.original.instance_id});
    result.state = 'COMPLETE'; result.completedAt = new Date().toISOString();
    await save(join(directory,'result.json'),result);
    return result;
  } catch (error) {
    result.state='FAILED';result.failure={code:error.code ?? error.name,message:error.message};
    await save(join(directory,'result.json'),result);
    throw error;
  } finally {
    await mcp?.close();
    await sourceOwner.close();
  }
}

const HELP = 'node agent_receive.mjs --package INSTALLED_PACKAGE --commit SOURCE_SHA --workspace ORIGINAL_COMPLETED_STUDY --export-id PACKAGE_ID --python PYTHON --out PRIVATE_RECEIVING_DIRECTORY\n';
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args=process.argv.slice(2);
  if (args.length === 1 && ['--help','-h'].includes(args[0])) process.stdout.write(HELP);
  else {
    const options={}; const names={'--package':'package','--commit':'commit','--workspace':'workspace',
      '--export-id':'exportId','--python':'python','--out':'out'};
    try {
      for(let i=0;i<args.length;i+=2) {
        need(names[args[i]] && args[i+1] && !args[i+1].startsWith('--') && options[names[args[i]]]===undefined, HELP);
        options[names[args[i]]]=args[i+1];
      }
      need(Object.keys(options).length===6,HELP);
      await receiveOriginalStudyPackage(options);
    } catch(error) {process.stderr.write(JSON.stringify({state:'FAILED',code:error.code ?? error.name,message:error.message})+'\n');process.exitCode=1;}
  }
}
