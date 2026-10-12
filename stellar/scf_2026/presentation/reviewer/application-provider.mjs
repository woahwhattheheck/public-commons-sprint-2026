/** MIT. Original grant reviewer Applications registration and private launch handoff. */
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup, applicationPrivateUrl}
  from '../../../scf-starforge-20261009/distribution/runtime-workspace/application-provider.mjs';
import {need, processIdentity, operationRunning}
  from '../../../scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import {MAX_PACKET_BYTES, readSourceFile} from './workspace.mjs';
import {WORKBENCH_READY_SCHEMA, WORKBENCH_CONNECTION_SCHEMA} from './workbench.mjs';

const option = (request, name) => {
  const index = request.args.indexOf(name); return index >= 0 ? request.args[index + 1] : undefined;
};
async function startup(request, text) {
  const announced = JSON.parse(text), directory = option(request, '--dir');
  need(announced.schema === WORKBENCH_READY_SCHEMA && announced.directory === directory &&
    announced.connectionFile === join(directory, 'workbench-connection.json'), 'REVIEWER_APPLICATION_STARTUP_CHANGED');
  const current = JSON.parse(await readSourceFile(announced.connectionFile, {privateFile:true, maxBytes:16384}));
  need(current.schema === WORKBENCH_CONNECTION_SCHEMA && current.active === true &&
    current.workbenchId === announced.workbenchId && current.instanceId === announced.instanceId &&
    current.directory === directory && current.pid === announced.pid && current.processStart === announced.processStart &&
    current.url === announced.url && typeof current.accessToken === 'string' && current.accessToken.length >= 24,
    'REVIEWER_APPLICATION_CONNECTION_CHANGED');
  const identity = await processIdentity(current.pid);
  need(identity !== null ? identity === current.processStart : await operationRunning(join(directory, 'workbench.lock')),
    'REVIEWER_APPLICATION_NOT_RUNNING');
  const url = applicationPrivateUrl(current.url);
  need(url, 'REVIEWER_APPLICATION_URL_INVALID');
  const response = await fetch(new URL('/health', url), {redirect:'error', signal:AbortSignal.timeout(5000)});
  const health = await response.json();
  need(response.ok && health.active === true && health.instanceId === current.instanceId &&
    health.workbenchId === current.workbenchId, 'REVIEWER_APPLICATION_INSTANCE_CHANGED');
  return {url:url + '#' + encodeURIComponent(current.accessToken), original:{
    schema:WORKBENCH_CONNECTION_SCHEMA, workbenchId:current.workbenchId, instanceId:current.instanceId,
    directory, connectionFile:announced.connectionFile, pid:current.pid, processStart:current.processStart,
    source:'original-grant-reviewer-private-connection',
  }};
}
export default {
  schema:APPLICATION_PROVIDER_SCHEMA, id:'grant-reviewer', order:341,
  catalog({common, field}) { return [{
    id:'grant-reviewer', command:'grant-demo', title:'Grant purchase reviewer',
    description:'Review the original source, query, payment observation and complete Buyer results; export and receive the same purchase with a second operator.',
    terminal:false, fields:[
      field('directory', 'Private reviewer workbench', 'path', true, 'A new private directory or this reviewer’s existing workbench.'),
      field('packetFile', 'Selected receiving packet', 'path', false, 'Optional exact packet. Leave empty to review the bundled original purchase in the workbench.'),
      field('packetSha256', 'Selected packet SHA-256', 'text', false, 'Required with a selected packet; use its original export or inspect digest.'),
      ...common,
    ],
  }]; },
  validateSettings(type, settings) {
    need(Boolean(settings.packetFile) === Boolean(settings.packetSha256), 'REVIEWER_PACKET_DIGEST_REQUIRED');
    if (settings.packetSha256) need(/^[a-f0-9]{64}$/.test(settings.packetSha256), 'REVIEWER_PACKET_DIGEST_REQUIRED');
  },
  async prepare(type, settings, {inputPath}) {
    const prepared = applicationPreparation(settings, inputPath);
    const directory = await prepared.path('directory', 'directory', true, true);
    prepared.args.push('workbench', '--dir', directory.path);
    if (!directory.exists) prepared.createDirectories.push(directory.path);
    if (settings.packetFile) {
      const file = await prepared.path('packetFile', 'file');
      const bytes = await readSourceFile(file.path, {maxBytes:MAX_PACKET_BYTES});
      const digest = createHash('sha256').update(bytes).digest('hex');
      need(digest === settings.packetSha256, 'REVIEWER_PACKET_CHANGED');
      file.sha256 = digest;
      prepared.args.push('--packet', file.path, '--sha256', digest);
    }
    return {args:prepared.args, inputs:prepared.inputs, createDirectories:prepared.createDirectories};
  },
  matchRequest(request) { return !request.pythonCommand && request.command === 'grant-demo' && request.args?.[0] === 'workbench'; },
  async verifyLaunch(request) {
    const path = option(request, '--packet');
    if (path) need(createHash('sha256').update(await readSourceFile(path)).digest('hex') === option(request, '--sha256'),
      'REVIEWER_PACKET_CHANGED');
  },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text =>
      text.startsWith('{"schema":"' + WORKBENCH_READY_SCHEMA + '",') ? () => startup(request, text) : null);
  },
};
