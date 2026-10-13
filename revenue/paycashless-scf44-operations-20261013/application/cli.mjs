#!/usr/bin/env node
// MIT. Direct CLI for the same durable Paycashless workspace and native requests.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { createReadStream, createWriteStream, constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {parseSourceJSON} from './lib/source-json.mjs';
import {assertExactNativeNumbers} from './lib/provider-auth.mjs';
import { openPaycashlessWorkspace } from './lib/workspace.mjs';
import {
  retainPaycashlessRuntime, verifyPaycashlessRuntime, restorePaycashlessRuntime,
} from './lib/runtime.mjs';
import {
  inspectPaycashlessDelivery, receivePaycashlessDelivery,
} from './lib/receiving.mjs';
import { streamPaycashlessDelivery, unpackPaycashlessDelivery } from './lib/archive.mjs';
import { readJSON, jsonBytes, need, publicError, writeExact, directory, fileDescriptor, syncDirectory } from './lib/files.mjs';
import { startPaycashlessServer } from './server.mjs';

export function parseArguments(argv) {
  const [command = 'help', ...rest] = argv;
  const flags = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    need(key?.startsWith('--') && rest[index + 1] !== undefined, 'ARGUMENT_REQUIRED');
    need(!Object.hasOwn(flags, key.slice(2)), 'DUPLICATE_ARGUMENT');
    flags[key.slice(2)] = rest[index + 1];
  }
  return { command, flags };
}

const HELP = [
  'Paycashless operations — original bank-rail API, Horizon evidence and complete receiving',
  '',
  'node cli.mjs serve --directory /private/workspace --configuration /private/config.json',
  'node cli.mjs worker --directory /private/workspace --configuration /private/config.json',
  'node cli.mjs import-source --directory /private/workspace --configuration /private/config.json --source /private/original.json --connection ALIAS --action ORIGINAL_ACTION --request-id UUID',
  'node cli.mjs file-retain --directory /private/workspace --source /private/evidence.json --request-id UUID',
  'node cli.mjs describe --directory /private/workspace --configuration /private/config.json',
  'node cli.mjs command --directory /private/workspace --configuration /private/config.json --request /private/request.json',
  'node cli.mjs list --directory /private/workspace --table operations [--cursor CURSOR]',
  'node cli.mjs item --directory /private/workspace --table sources --id ID',
  'node cli.mjs file --directory /private/workspace --id ID --destination /private/original.bin [--private true]',
  'node cli.mjs runtime-retain --destination /private/runtime [--node /selected/node]',
  'node cli.mjs runtime-verify --directory /private/runtime [--manifest-sha256 HASH]',
  'node cli.mjs runtime-restore --source /package/runtime/source --destination /private/runtime --manifest-sha256 HASH',
  'node cli.mjs package-inspect --source /private/package --manifest-sha256 HASH',
  'node cli.mjs package-receive --source /private/package --destination /private/received --request-id UUID',
  'node cli.mjs archive --source /private/package --destination /private/package.tar.gz',
  'node cli.mjs unpack --source /private/package.tar.gz --destination /private/unpacked',
  '',
  'Request JSON is {requestId,expectedRevision?,method,args}. Provider API keys stay in private configuration.',
  'The browser operator bearer is in configuration.operatorToken or workspace/operator-token.private.json.',
  '',
].join('\n');

export async function runPaycashlessCLI(argv = process.argv.slice(2)) {
  const { command, flags } = parseArguments(argv);
  if (command === 'help') { process.stdout.write(HELP); return; }
  const configuration = flags.configuration ? await readJSON(path.resolve(flags.configuration)) : {};
  if (command === 'serve') {
    const server = await startPaycashlessServer({
      directory: path.resolve(flags.directory), configuration,
      host: flags.host ?? '127.0.0.1', port: Number(flags.port ?? 8781),
      runtimeDirectory: flags.runtime ?? configuration.runtimeDirectory,
      expectedManifestSha256: flags['runtime-sha256'] ?? configuration.expectedManifestSha256,
      token: process.env.PAYCASHLESS_OPERATOR_TOKEN,
    });
    process.stdout.write('PAYCASHLESS_OPERATIONS_READY ' + JSON.stringify(server.startup) + '\n');
    for (const event of ['SIGTERM', 'SIGINT']) process.once(event, () => server.close());
    return server;
  }
  let result;
  if(command==='worker') {
    const {startPaycashlessWorker}=await import('./worker.mjs');
    const worker=await startPaycashlessWorker({
      directory:path.resolve(flags.directory),configuration,
      pollSeconds:Number(flags['poll-seconds']??15),
      onResult:value=>process.stdout.write(JSON.stringify(value)+'\n'),
    });
    for(const event of ['SIGTERM','SIGINT'])process.once(event,()=>worker.close());
    await worker.done;return worker;
  }
  if (command === 'runtime-retain') {
    result = await retainPaycashlessRuntime({
      directory: path.resolve(flags.destination),
      nodeExecutable: flags.node ?? process.execPath,
      licenseFiles: configuration.runtimeLicenseFiles ?? [],
    });
  } else if (command === 'runtime-verify') {
    result = await verifyPaycashlessRuntime({
      directory: path.resolve(flags.directory), expectedManifestSha256: flags['manifest-sha256'],
    });
  } else if (command === 'runtime-restore') {
    result = await restorePaycashlessRuntime({
      sourceDirectory: path.resolve(flags.source), destination: path.resolve(flags.destination),
      expectedManifestSha256: flags['manifest-sha256'],
    });
  } else if (command === 'package-inspect') {
    result = await inspectPaycashlessDelivery({
      sourceDirectory: path.resolve(flags.source), expectedManifestSha256: flags['manifest-sha256'],
    });
  } else if (command === 'package-receive') {
    need(flags['request-id'], 'REQUEST_ID_REQUIRED');
    result = await receivePaycashlessDelivery({
      sourceDirectory: path.resolve(flags.source), destination: path.resolve(flags.destination),
      requestId: flags['request-id'], expectedManifestSha256: flags['manifest-sha256'],
    });
  } else if (command === 'archive') {
    need(flags.source && flags.destination, 'ARCHIVE_SOURCE_AND_DESTINATION_REQUIRED');
    const destination = path.resolve(flags.destination);
    await directory(path.dirname(destination));
    const temporary = destination + '.pending-' + randomUUID();
    let input = null, output = null;
    try {
      input = await streamPaycashlessDelivery({
        sourceDirectory: path.resolve(flags.source), expectedManifestSha256: flags['manifest-sha256'],
      });
      output = createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
      await pipeline(input, output);
      const handle = await fs.open(temporary, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { await handle.sync(); } finally { await handle.close(); }
      const identity = await fileDescriptor(temporary);
      try { await fs.link(temporary, destination); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = await fileDescriptor(destination);
        need(existing.bytes === identity.bytes && existing.sha256 === identity.sha256,
          'IMMUTABLE_FILE_CONFLICT');
      }
      await syncDirectory(path.dirname(destination));
      result = { file: destination, descriptor: await fileDescriptor(destination) };
    } finally {
      input?.destroy(); output?.destroy();
      await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  } else if (command === 'unpack') {
    result = await unpackPaycashlessDelivery({
      input: createReadStream(path.resolve(flags.source)),
      destination: path.resolve(flags.destination),
      expectedManifestSha256: flags['manifest-sha256'],
    });
  } else {
    const workspace = await openPaycashlessWorkspace({
      directory: path.resolve(flags.directory), connections: configuration.connections ?? {},
      name: configuration.name,
      sourceDirectory: configuration.sourceDirectory??path.dirname(fileURLToPath(import.meta.url)),
      runtimeDirectory: flags.runtime ?? configuration.runtimeDirectory,
      expectedManifestSha256: flags['runtime-sha256'] ?? configuration.expectedManifestSha256,
    });
    try {
      if(command==='import-source' || command==='file-retain') {
        need(flags.source && flags['request-id'],'ORIGINAL_FILE_AND_REQUEST_ID_REQUIRED');
        const body=await fs.readFile(path.resolve(flags.source));
        const descriptor=await workspace.retainFile(body,{
          filename:path.basename(flags.source),contentType:flags['content-type'] ??
            (flags.format==='csv'?'text/csv':'application/json'),private:true,
        });
        if(command==='file-retain') result=await workspace.command({requestId:flags['request-id'],
          method:'file.retain',args:{fileId:descriptor.id}});
        else {
          const args={
            connectionAlias:flags.connection,action:flags.action,fileId:descriptor.id,
            ...(flags.input?{inputJSON:await fs.readFile(path.resolve(flags.input),'utf8')}:{input:{}}),
            status:Number(flags.status??200),bodyComplete:flags.complete!=='false',
          };
          result=await workspace.command({requestId:flags['request-id'],
            method:'source.import',args});
        }
      } else if (command === 'describe') result = workspace.describe();
      else if (command === 'list') result = workspace.list({
        table: flags.table, cursor: flags.cursor, limit: Number(flags.limit ?? 100),
      });
      else if (command === 'item') result = workspace.item(flags.table, flags.id);
      else if (command === 'command') {
        need(flags.request, 'REQUEST_FILE_REQUIRED');
        result = await workspace.command(assertExactNativeNumbers(parseSourceJSON(await fs.readFile(path.resolve(flags.request)),{maxBytes:16*1024*1024})));
      } else if (command === 'file') {
        need(flags.destination, 'DESTINATION_REQUIRED');
        const privateRead = flags.private === 'true';
        const body = await workspace.fileBytes(flags.id, { private: privateRead });
        await writeExact(path.resolve(flags.destination), body);
        result = { file: path.resolve(flags.destination), descriptor: workspace.file(flags.id, { private: privateRead }) };
      } else need(false, 'UNKNOWN_COMMAND');
    } finally { await workspace.close(); }
  }
  if (result?.manifest && result?.nodeExecutable) {
    const { manifest, ...descriptor } = result;
    result = descriptor;
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  runPaycashlessCLI().catch(error => {
    process.stderr.write(JSON.stringify({ error: publicError(error) }) + '\n');
    process.exitCode = 1;
  });
}
