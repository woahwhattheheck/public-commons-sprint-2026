#!/usr/bin/env node
// MIT — Foreground operation of the original buyer's delivered-resource library.
import { open, link, unlink } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openLibrary } from './library.mjs';
import { absolute, directory, requireValue, readSnapshot } from './files.mjs';

async function saveNew(path, write) {
  path = absolute(path); await directory(dirname(path),true);
  const temporary = join(dirname(path),'.resource-' + randomUUID() + '.partial');
  const file = await open(temporary,'wx',0o600);
  try { await write(file); await file.sync(); await file.close(); await link(temporary,path); }
  finally { await file.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
}
export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.length === 0) {
    process.stdout.write(`Buyer resource library — Node 22.16+\n\nnode cli.mjs COMMAND --state ABS [OPTIONS]\n\nCommands: serve | scan | search | show | preview | download | annotate | export\nFirst open: --inbox ABS or --snapshot ABS, with --files-root ABS (repeatable)\nLimits on first open: --index-bytes N, --max-file-bytes N\nserve: --port N (default an available loopback port)\nsearch: --query TEXT --offset N --limit N --status VERIFIED|UNAVAILABLE|INCOMPLETE --starred true\nshow, preview, download, annotate: --id RESOURCE_ID\ndownload, export: --out ABS (new file in a private directory)\nannotate: --annotation ABS (JSON with expectedRevision, operationId, note, tags, starred)\nReopen the same --state without repeating the source or roots.\n`); return; }
  const [command,...rest] = args;
  const specific = {serve:['--port'],scan:[],search:['--query','--offset','--limit','--status','--starred'],
    show:['--id'],preview:['--id'],download:['--id','--out'],annotate:['--id','--annotation'],export:['--out']};
  requireValue(Object.hasOwn(specific,command),'COMMAND_REQUIRED');
  const allowed = ['--state','--inbox','--snapshot','--files-root','--index-bytes','--max-file-bytes',...specific[command]];
  requireValue(rest.length % 2 === 0,'OPTION_VALUE_REQUIRED');
  const flags = new Map(), roots = [];
  for (let i=0;i<rest.length;i+=2) {
    requireValue(allowed.includes(rest[i]) && (!flags.has(rest[i]) || rest[i] === '--files-root'),'OPTION_INVALID');
    flags.set(rest[i],rest[i+1]); if (rest[i] === '--files-root') roots.push(rest[i+1]);
  }
  requireValue(!(flags.has('--inbox') && flags.has('--snapshot')),'SELECT_ONE_SOURCE');
  const numeric = flag => flags.has(flag) ? Number(flags.get(flag)) : undefined;
  const library = await openLibrary({state:flags.get('--state'),
    kind:flags.has('--inbox') ? 'inbox' : flags.has('--snapshot') ? 'snapshot' : undefined,
    source:flags.get('--inbox') ?? flags.get('--snapshot'), roots:roots.length ? roots : undefined,
    indexBytes:numeric('--index-bytes'),maxFileBytes:numeric('--max-file-bytes')});
  const controller = new AbortController();
  const stop = () => controller.abort(new Error('OPERATOR_CANCELLED'));
  process.once('SIGINT',stop); process.once('SIGTERM',stop);
  const print = value => process.stdout.write(JSON.stringify(value,null,2)+'\n');
  let host;
  try {
    if (command === 'serve') {
      const {serveLibrary} = await import('./server.mjs');
      host = await serveLibrary(library,{port:numeric('--port') ?? 0});
      print({url:host.url,state:library.state});
      if (!controller.signal.aborted) await new Promise(resolve => controller.signal.addEventListener('abort',resolve,{once:true}));
    } else if (command === 'scan') print(await library.scan({signal:controller.signal}));
    else if (command === 'search') print(library.search({q:flags.get('--query') ?? '',offset:numeric('--offset') ?? 0,
      limit:numeric('--limit') ?? 50,status:flags.get('--status') ?? '',starred:flags.get('--starred') === 'true'}));
    else if (command === 'show') print({resource:library.resource(flags.get('--id')),revisions:library.revisions(flags.get('--id'))});
    else if (command === 'preview') print(await library.preview(flags.get('--id'),{signal:controller.signal}));
    else if (command === 'annotate') print(library.saveAnnotation(flags.get('--id'),JSON.parse((await readSnapshot(flags.get('--annotation'),65536)).toString('utf8'))));
    else if (command === 'export') {
      await saveNew(flags.get('--out'),file => file.writeFile(JSON.stringify(library.exportReview(),null,2)+'\n'));
      print({path:absolute(flags.get('--out'))});
    } else if (command === 'download') {
      const saved = await library.download(flags.get('--id'),{signal:controller.signal});
      try {
        await saveNew(flags.get('--out'),async output => {
          for await (const chunk of saved.file.createReadStream({start:0,autoClose:false})) {
            controller.signal.throwIfAborted(); await output.writeFile(chunk);
          }
        });
        print({path:absolute(flags.get('--out')),bytes:saved.bytes,sha256:saved.sha256});
      } finally { await saved.dispose(); }
    }
  } finally {
    process.off('SIGINT',stop);process.off('SIGTERM',stop);
    if (host) await host.close(); await library.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => {
  process.stderr.write(JSON.stringify({error:error.code ?? error.message})+'\n');process.exitCode=1;
});
