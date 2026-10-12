// MIT. Original managed Ruby runtime commands; each action retains its selected operation.
import { open, link, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { once as eventOnce } from 'node:events';
import { openRubyRuntime, probeRuby } from './model.mjs';
import { absolute, need, exists, directory, fingerprint, syncParent } from './files.mjs';

const HELP = `Managed Ruby runtime

  ruby-runtime init --directory DIR
  ruby-runtime probe --ruby /absolute/ruby [--bundler-version VERSION]
  ruby-runtime create --directory DIR --id ENV --title TITLE --ruby /absolute/ruby
    --bundler-version VERSION --request-id UUID [--project-directory DIR --gemfile Gemfile]
  ruby-runtime install|verify --directory DIR --id ENV --operation-id UUID [--offline] [--wait]
  ruby-runtime run --directory DIR --id ENV --operation-id UUID
    --entry native-dataset-lifecycle|baserow-customer-lifecycle [--wait] -- ORIGINAL_ARGS
  ruby-runtime inspect --directory DIR
  ruby-runtime operation|resume|cancel --directory DIR --operation-id UUID [--wait]
  ruby-runtime log --directory DIR --operation-id UUID [--offset BYTES --limit BYTES]
  ruby-runtime register --directory DIR --id APP --title TITLE --environment-id ENV
    --application-directory ORIGINAL_RECEIVED_APP --request-id UUID [--wait]
  ruby-runtime application|stop --directory DIR --id APP
  ruby-runtime launch --directory DIR --id APP --operation-id UUID [--port 9292]
  ruby-runtime export --directory DIR --id ENV --operation-id UUID [--application-id APP] [--wait]
  ruby-runtime file --directory DIR --operation-id UUID --name ORIGINAL_FILE [--out ABSOLUTE_FILE]
  ruby-runtime receive --directory DIR --id ENV --title TITLE --ruby /absolute/ruby
    --archive ABSOLUTE_TAR --expected-sha256 SHA --operation-id UUID [--bundler-version VERSION] [--wait]
  ruby-runtime serve --directory DIR [--create] [--port 8474] [--startup-json]

The source workspace owns the original operation and complete output. Repeat its UUID
and arguments to read the retained operation; resume explicitly continues an interrupted
or failed attempt. Export includes exact selected source, lock, complete gem cache and
optionally the stopped application's complete database and files. Receive installs
that archive offline with the selected compatible Ruby interpreter.
`;
const KEYS = {
  '--directory':'directory','--id':'id','--title':'title','--ruby':'ruby',
  '--bundler-version':'bundlerVersion','--project-directory':'projectDirectory','--gemfile':'gemfile',
  '--request-id':'requestId','--operation-id':'operationId','--application-id':'applicationId',
  '--environment-id':'environmentId','--application-directory':'applicationDirectory',
  '--archive':'archive','--expected-sha256':'expectedSha256','--entry':'entry',
  '--application-sha256':'expectedApplicationSha256','--environment-selection-sha256':'expectedEnvironmentSelectionSha256',
  '--port':'port','--offset':'offset','--limit':'limit','--name':'name','--out':'out',
};
const FLAGS = { '--create':'create','--offline':'offline','--wait':'wait','--startup-json':'startupJson' };
const ALLOWED = {
  init:['directory'],probe:['ruby','bundlerVersion'],inspect:['directory'],
  create:['directory','id','title','ruby','bundlerVersion','projectDirectory','gemfile','requestId'],
  install:['directory','id','operationId','offline','wait'],verify:['directory','id','operationId','applicationId','wait'],
  export:['directory','id','operationId','applicationId','wait'],
  run:['directory','id','operationId','entry','wait'],
  operation:['directory','operationId','wait'],resume:['directory','operationId','wait'],
  cancel:['directory','operationId','wait'],log:['directory','operationId','offset','limit'],
  register:['directory','id','title','environmentId','applicationDirectory','requestId','wait'],
  application:['directory','id'],launch:['directory','id','operationId','port'],
  'serve-application':['directory','id','operationId','port','expectedApplicationSha256','expectedEnvironmentSelectionSha256'],
  stop:['directory','id'],file:['directory','operationId','name','out'],
  receive:['directory','id','title','ruby','bundlerVersion','archive','expectedSha256','operationId','wait'],
};
function parse(argv) {
  argv = [...argv];
  let prefix = [];
  if (argv[0] === '--directory') { need(argv.length >= 3, 'RUBY_CLI_ARGUMENTS'); prefix = argv.splice(0,2); }
  const action = argv.shift();
  if (!action || action === 'help' || action === '--help' || action === '-h') return { action:'help' };
  if (action === 'serve') return { action, argv:[...prefix,...argv] };
  need(Object.hasOwn(ALLOWED,action), 'RUBY_CLI_ACTION_INVALID', HELP);
  argv = [...prefix,...argv];
  const input = {}, original = [];
  while (argv.length) {
    const key = argv.shift();
    if (key === '--') { need(action === 'run','RUBY_CLI_ARGUMENTS'); original.push(...argv); break; }
    const name = KEYS[key] ?? FLAGS[key];
    need(name && ALLOWED[action].includes(name) && !Object.hasOwn(input,name), 'RUBY_CLI_ARGUMENTS', 'Unknown or repeated option: ' + key);
    if (FLAGS[key]) input[name] = true;
    else {
      const value = argv.shift();
      need(typeof value === 'string' && !value.includes('\0'), 'RUBY_CLI_ARGUMENTS', 'Missing value: ' + key);
      input[name] = ['port','offset','limit'].includes(name) ? Number(value) : value;
    }
  }
  return { action, input, original };
}
async function waitFor(core,key) {
  let offset = 0, stopped = false;
  const stop = () => { stopped = true; };
  process.on('SIGINT',stop); process.on('SIGTERM',stop);
  try {
    while (true) {
      if (stopped) { await core.cancel({operationId:key}); stopped = false; }
      const log = await core.log({operationId:key,offset});
      if (log.text) process.stderr.write(log.text);
      offset = log.nextOffset;
      const value = await core.operation({operationId:key});
      if (['SUCCEEDED','FAILED','CANCELLED','INTERRUPTED'].includes(value.phase) && !value.active) return value;
      await new Promise(accept => setTimeout(accept,300));
    }
  } finally { process.off('SIGINT',stop); process.off('SIGTERM',stop); }
}
async function receiveFile(core,input) {
  const source = await core.openFile({operationId:input.operationId,name:input.name});
  let temporary;
  try {
    if (!input.out) {
      for await (const bytes of source.handle.createReadStream({start:0,autoClose:false}))
        if (!process.stdout.write(bytes)) await eventOnce(process.stdout,'drain');
      return null;
    }
    const destination = absolute(input.out);
    await directory(dirname(destination));
    if (await exists(destination)) {
      const old = await fingerprint(destination,{privateOnly:true});
      need(old.bytes === source.bytes && old.sha256 === source.sha256, 'RUBY_RETAINED_FILE_CHANGED');
      return {file:destination,name:source.name,bytes:source.bytes,sha256:source.sha256};
    }
    temporary = destination + '.pending-' + randomUUID();
    const output = await open(temporary,constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,0o600);
    try {
      for await (const bytes of source.handle.createReadStream({start:0,autoClose:false})) {
        let offset = 0;
        while (offset < bytes.length) {
          const result = await output.write(bytes,offset,bytes.length-offset);
          need(result.bytesWritten > 0,'RUBY_WRITE_FAILED'); offset += result.bytesWritten;
        }
      }
      await output.sync();
    } finally { await output.close(); }
    try { await link(temporary,destination); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const old = await fingerprint(destination,{privateOnly:true});
      need(old.bytes === source.bytes && old.sha256 === source.sha256, 'RUBY_RETAINED_FILE_CHANGED');
    }
    await syncParent(destination);
    return {file:destination,name:source.name,bytes:source.bytes,sha256:source.sha256};
  } finally {
    await source.handle.close();
    if (temporary) await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
}
export async function main(argv = process.argv.slice(2)) {
  const selected = parse(argv);
  if (selected.action === 'help') { process.stdout.write(HELP); return null; }
  if (selected.action === 'serve') {
    const server = await import('./workspace/cli.mjs');
    return server.main(selected.argv);
  }
  const {action,input,original} = selected;
  if (action === 'probe') return probeRuby(input);
  const core = await openRubyRuntime({directory:input.directory,create:action==='init'});
  try {
    let value;
    switch (action) {
      case 'init': case 'inspect': value = await core.inspect(); break;
      case 'create': value = await core.create(input); break;
      case 'install': case 'verify': case 'export': value = await core.start({...input,action}); break;
      case 'run': value = await core.run({...input,argv:original}); break;
      case 'operation': value = await core.operation(input); break;
      case 'resume': value = await core.resume(input); break;
      case 'cancel': value = await core.cancel(input); break;
      case 'log': value = await core.log(input); break;
      case 'register': value = await core.registerApplication({...input,directory:input.applicationDirectory}); break;
      case 'application': value = await core.application(input); break;
      case 'launch': value = await core.launchApplication(input); break;
      case 'serve-application': value = await core.runApplication(input); break;
      case 'stop': value = await core.stopApplication(input); break;
      case 'receive': value = await core.receive(input); break;
      case 'file': return receiveFile(core,input);
      default: throw new Error('RUBY_CLI_ACTION_INVALID');
    }
    if (input.wait) value = await waitFor(core,input.operationId ?? input.requestId);
    if (value && ['FAILED','CANCELLED','INTERRUPTED'].includes(value.phase)) process.exitCode = 1;
    return value;
  } finally { await core.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().then(value => { if(value!==null && value!==undefined) process.stdout.write(JSON.stringify(value,null,2)+'\n'); })
    .catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code??'RUBY_RUNTIME_FAILED',message:error.message}})+'\n');process.exitCode=1;});
