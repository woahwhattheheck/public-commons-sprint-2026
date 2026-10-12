#!/usr/bin/env node
// MIT. Installed operator entry for the original QGIS workspace and receiver.
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {constants} from 'node:os';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PYTHON_ENTRY = [
  'import runpy,sys',
  'sys.path.insert(0,sys.argv.pop(1))',
  'runpy.run_module("starforge_stac.cli",run_name="__main__")'
].join(';');

const ACTIONS = Object.freeze({
  'source-open': {command:'source-open',required:['directory'],optional:['expected-sha256']},
  'workspace-create': {command:'create',required:['workspace'],optional:['title']},
  'workspace-open': {command:'open',required:['workspace']},
  'workspace-import': {command:'import',required:['workspace','input']},
  'workspace-select': {command:'select',required:['workspace','input']},
  'workspace-scenes': {command:'scenes',required:['workspace'],optional:['source-id']},
  'workspace-assets': {command:'assets',required:['workspace'],optional:['source-id','scene-key']},
  'workspace-layers': {command:'layers',required:['workspace','input']},
  'workspace-compare': {command:'compare',required:['workspace','left','right']},
  'workspace-review': {command:'review',required:['workspace','input']},
  'workspace-history': {command:'history',required:['workspace']},
  'workspace-operation': {command:'operation',required:['workspace','request-id']},
  'field': {command:'field',required:['workspace','input']},
  'project-export': {command:'export',required:['workspace','file'],optional:['revision']},
  'project-receive': {command:'receive',required:['workspace','file'],optional:['expected-sha256']},
  'native-inspect': {command:'native-inspect',required:['workspace','input'],native:true},
  'native-save': {command:'native-save',required:['workspace','input'],native:true},
  'native-open': {command:'native-open',required:['workspace','project-id'],native:true}
});
const PATH_FLAGS = new Set(['directory','workspace','input','file']);

export const QGIS_HELP = [
  'Original STAC and vector receiving, native QGIS projects and complete handover',
  '',
  'Original customer delivery and plugin:',
  '  starforge stac-qgis export --directory ORIGINAL_CUSTOMER_DIR --out NEW_QGIS_SOURCE_DIR',
  '  starforge stac-qgis open --directory QGIS_SOURCE_DIR [--expected-manifest-sha256 SHA256]',
  '  starforge stac-qgis plugin --out PLUGIN_ZIP [--python EXISTING_PYTHON]',
  '',
  'Original STAC or vector source:',
  '  starforge stac-qgis source-open --directory SOURCE_DIR [--expected-sha256 SHA256]',
  '',
  'Analyst workspace:',
  '  starforge stac-qgis workspace-create --workspace NEW_DIR [--title TITLE]',
  '  starforge stac-qgis workspace-open --workspace DIR',
  '  starforge stac-qgis workspace-import --workspace DIR --input ORIGINAL_IMPORT_JSON',
  '  starforge stac-qgis workspace-select --workspace DIR --input ORIGINAL_SELECTION_JSON',
  '  starforge stac-qgis workspace-scenes --workspace DIR [--source-id ID]',
  '  starforge stac-qgis workspace-assets --workspace DIR [--source-id ID] [--scene-key JSON_KEY]',
  '  starforge stac-qgis workspace-layers --workspace DIR --input ORIGINAL_LAYERS_JSON',
  '  starforge stac-qgis workspace-compare --workspace DIR --left SOURCE_ID --right SOURCE_ID',
  '  starforge stac-qgis workspace-review --workspace DIR --input ORIGINAL_REVIEW_JSON',
  '  starforge stac-qgis workspace-history --workspace DIR',
  '  starforge stac-qgis workspace-operation --workspace DIR --request-id REQUEST_ID',
  '',
  'Native map commands, using QGIS Python:',
  '  starforge stac-qgis native-inspect --workspace DIR --input ASSET_JSON --python QGIS_PYTHON',
  '  starforge stac-qgis native-save --workspace DIR --input ORIGINAL_SAVE_JSON --python QGIS_PYTHON',
  '  starforge stac-qgis native-open --workspace DIR --project-id ID --python QGIS_PYTHON',
  '',
  'Original QField commissioning and field-to-office receiving:',
  '  starforge stac-qgis field --workspace DIR --input ORIGINAL_FIELD_ACTION_JSON',
  '  Native field actions use nativeRuntime from that same original action file.',
  '',
  'Complete project receiving:',
  '  starforge stac-qgis project-export --workspace DIR --file NEW_ZIP [--revision REVISION]',
  '  starforge stac-qgis project-receive --workspace RECEIVER_DIR --file ZIP [--expected-sha256 SHA256]',
  '',
  'Workspace commands accept --python EXISTING_PYTHON and --progress.',
  'Native commands use --python or the existing STARFORGE_QGIS_PYTHON binding.',
  'Original action JSON retains revision, requestId and actor; the installed entry passes it unchanged.',
  'Complete native JSON streams to stdout and progress/errors to stderr. Shell redirection preserves it.',
  'Install the generated ZIP through QGIS Plugins > Manage and Install Plugins > Install from ZIP.',
  'The desktop operates the same original workspace, maps, edition review and receiving archive.',
  'The existing stac qgis-export, qgis-open and qgis-plugin aliases remain available.',
  'Read qgis/OPERATIONS.md, VECTOR_RECEIVING.md and FIELD_OPERATIONS.md for complete handover.'
].join('\n') + '\n';

function flags(argv) {
  const values = Object.create(null), args = [];
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (!value.startsWith('--')) {args.push(value);continue;}
    const at = value.indexOf('='), key = at < 0 ? value.slice(2) : value.slice(2, at);
    if (Object.hasOwn(values,key)) throw new TypeError('Supply --' + key + ' once for the original action.');
    if (at >= 0) values[key] = value.slice(at + 1);
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) values[key] = argv[++i];
    else values[key] = true;
  }
  return {values,args};
}
function required(values,key) {
  if (typeof values[key] !== 'string' || !values[key]) throw new TypeError('--' + key + ' is required.');
  return values[key];
}
function existingPython(values,native=false) {
  const selected = values.python ?? process.env.STARFORGE_QGIS_PYTHON ?? (native ? undefined : 'python3');
  if (typeof selected !== 'string' || !selected)
    throw new TypeError('Select the existing QGIS Python with --python or STARFORGE_QGIS_PYTHON.');
  return selected;
}

/** Stream the maintained process output; source inventories and histories remain complete. */
function runOriginal(python,argv) {
  return new Promise((resolvePromise,reject) => {
    const child = spawn(python,argv,{stdio:'inherit'});
    let settled = false;
    const forward = signal => {if (!child.killed) child.kill(signal);};
    const interrupt = () => forward('SIGINT'), terminate = () => forward('SIGTERM');
    process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
    const cleanup = () => {
      process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',terminate);
    };
    child.once('error',error => {if (settled) return;settled=true;cleanup();reject(error);});
    child.once('close',(code,signal) => {
      if (settled) return;
      settled=true;cleanup();
      resolvePromise({exitCode:code ?? (128 + (constants.signals[signal] ?? 1)),signal:signal ?? null});
    });
  });
}

async function workspaceCommand(command,values) {
  const action = ACTIONS[command], allowed = new Set([...action.required,...(action.optional ?? []),'python','progress']);
  for (const key of Object.keys(values))
    if (!allowed.has(key)) throw new TypeError('--' + key + ' is not an option for ' + command + '.');
  for (const key of action.required) required(values,key);
  const argv = ['-B','-c',PYTHON_ENTRY,ROOT,action.command];
  for (const key of [...action.required,...(action.optional ?? [])]) {
    if (values[key] === undefined) continue;
    const value = required(values,key);
    if (key === 'revision' && !/^(0|[1-9][0-9]*)$/.test(value))
      throw new TypeError('--revision must be the original non-negative integer revision.');
    argv.push('--' + key,PATH_FLAGS.has(key) ? resolve(value) : value);
  }
  if (values.progress !== undefined) {
    if (values.progress !== true) throw new TypeError('--progress is a flag.');
    argv.push('--progress');
  }
  return runOriginal(existingPython(values,action.native),argv);
}

export async function runQgisCommand({command,flags:values={}}={}) {
  command = command?.replace(/^qgis-/,'');
  if (command === 'help' || !command) return {text:QGIS_HELP};
  if (Object.hasOwn(ACTIONS,command)) return workspaceCommand(command,values);
  if (command === 'export') {
    const {exportQgisReceiving}=await import('./bridge.mjs');
    return {result:await exportQgisReceiving({directory:resolve(required(values,'directory')),
      out:resolve(required(values,'out'))})};
  }
  if (command === 'open') {
    const {openQgisReceiving}=await import('./bridge.mjs');
    const opened = await openQgisReceiving({directory:resolve(required(values,'directory')),
      expectedManifestSha256:values['expected-manifest-sha256']});
    return {result:{directory:opened.directory,source:opened.manifest.source,
      summary:opened.manifest.summary,manifest:opened.manifestFile.record}};
  }
  if (command === 'plugin') {
    const script = fileURLToPath(new URL('./plugin-package.py',import.meta.url));
    const out=resolve(required(values,'out'));
    return {result:await new Promise((resolvePromise,reject) => {
      const child=spawn(existingPython(values),['-B',script,'--out',out],{stdio:['ignore','pipe','pipe']});
      let stdout='',stderr='',tooLarge=false;
      child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
      child.stdout.on('data',value => {
        stdout+=value;
        if (stdout.length > 1024*1024) {tooLarge=true;child.kill();}
      });
      child.stderr.on('data',value => {stderr=(stderr+value).slice(-65536);});
      child.once('error',reject);
      child.once('close',code => {
        if (tooLarge) return reject(new Error('The plugin packaging receipt exceeds its supported size.'));
        if (code !== 0) return reject(new Error(stderr || 'QGIS plugin packaging exited ' + code));
        try {resolvePromise(JSON.parse(stdout));} catch {reject(new Error('Invalid native plugin packaging response.'));}
      });
    })};
  }
  throw new TypeError('Unknown QGIS receiving command: ' + command);
}
export async function main(argv=process.argv.slice(2)) {
  const parsed=flags(argv);
  if (parsed.args.length > 1) throw new TypeError('Select one QGIS command and its named options.');
  const answer=await runQgisCommand({command:parsed.args[0] ?? 'help',flags:parsed.values});
  if (answer.exitCode !== undefined) {if (answer.exitCode) process.exitCode=answer.exitCode;return answer;}
  if (answer.text) process.stdout.write(answer.text);
  else process.stdout.write(JSON.stringify(answer.result,null,2)+'\n');
  return answer;
}
export const run=main;
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => {process.stderr.write(JSON.stringify({error:error.code ?? error.name,message:error.message})+'\n');process.exitCode=1;});
