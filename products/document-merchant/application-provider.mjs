// MIT. Document merchant Applications over the original setup and managed paid Jobs lifetime.
import {lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {
  APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup
} from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/application-provider.mjs';
import {
  absolute, plain, need, digest
} from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import {inspectMerchantRuntime} from '../../stellar/scf-starforge-20261009/sf46-release/runtime-package.mjs';
import {
  JOB_MERCHANT_APPLICATION_ID, jobMerchantApplication, validateJobMerchantSettings
} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/managed/application.mjs';
import {
  jobServiceLaunchPath
} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/managed/launch.mjs';

const SOURCE = 'products/document-merchant';
const SELECTION = 'stellar-forge.document-service-selection.v1';
const COMMISSIONING='stellar-forge.document-commissioning-application.v1';
const STARTUP = 'stellar-forge.job-service-launch.v1';
export const DOCUMENT_APPLICATION_ID = 'document-merchant';
const PATHS = Object.freeze([
  ['configurationFile', 'configurationFile', '--initialize'],
  ['nativeFactoryFile', 'nativeFactoryPath', '--native-factory'],
  ['intakeConfigurationFile', 'intakeConfigPath', '--intake-config'],
  ['deliveryConfigurationFile', 'deliveryConfigPath', '--delivery-config'],
  ['deliveryDirectory', 'deliveryDirectory', '--delivery-state']
]);
const PORTS = Object.freeze([
  ['sellerPort', 'sellerPort', '--seller-port'], ['customerPort', 'customerPort', '--customer-port'],
  ['port', 'operatorPort', '--operator-port'], ['operationsPort', 'operationsPort', '--operations-port']
]);
const BOOLEANS = Object.freeze([['startWorker', '--start-worker'], ['startDelivery', '--start-delivery']]);

export function documentApplication(context) {
  const original = jobMerchantApplication(context);
  return {
    ...original, id: DOCUMENT_APPLICATION_ID, command: 'document-merchant',
    title: 'Document merchant', requiredSource: SOURCE + '/launch.mjs',
    description: 'Prepare and operate a MintPDF, snaplab or PDFMint merchant with original native prices, whole HTML or Markdown inputs, paid jobs and complete PDF/source delivery.',
    fields: [
      context.field('directory', 'Private document merchant directory', 'path', true,
        'Reopen this merchant, or select one new directory inside an existing private parent. Its original setup and paid jobs remain here.'),
      context.field('commissioningOptionsFile', 'Original account commissioning JSON', 'path', false,
        'Optional complete commission options JSON selecting the actual original account or commerce setup, supplier and customer. First Start prepares this exact installation. It supplies ports and service settings; use the private environment field for original key values.'),
      context.field('configurationFile', 'Document setup JSON', 'path', false,
        'Required for a new merchant. Select the completed provider, plan, public HTTPS origin, native price and recipient from document-merchant template. A saved setup can reopen without this file.'),
      ...original.fields.filter(item => !['stateDirectory', 'configurationFile'].includes(item.name))
        .map(item => item.name === 'environmentFile'
          ? {...item, description: 'Private environment JSON for the selected provider key and original payment factory, intake or delivery secrets. Values remain on this host.'}
          : item)
    ]
  };
}

export function validateDocumentApplicationSettings(settings) {
  validateJobMerchantSettings(settings);
  if(settings.commissioningOptionsFile){
    need(typeof settings.commissioningOptionsFile==='string'&&settings.commissioningOptionsFile.length>0,
      'APPLICATION_DOCUMENT_COMMISSIONING_REQUIRED');
    need(!PATHS.some(([key])=>settings[key])&&!PORTS.some(([key])=>settings[key])&&
      !BOOLEANS.some(([key])=>settings[key])&&(settings.landing===undefined||settings.landing===''||settings.landing==='jobs'),
      'APPLICATION_DOCUMENT_COMMISSIONING_OPTIONS_OWNED',
      'Use ports, service and customer choices in the complete commissioning JSON. Keep the original environment field selected.');
  }
  need(typeof settings.directory === 'string' && settings.directory.length > 0,
    'APPLICATION_DOCUMENT_DIRECTORY_REQUIRED');
}

async function reader(directory) {
  directory = absolute(directory);
  const original = await import(pathToFileURL(join(directory, 'launch.mjs')).href);
  need(original.DOCUMENT_SERVICE_SELECTION_SCHEMA === SELECTION &&
    typeof original.readDocumentServiceSelection === 'function' &&
    typeof original.assertDocumentServiceSelection === 'function' &&
    typeof original.assertDocumentServiceSource === 'function' &&
    typeof original.readDocumentServiceLaunch === 'function',
  'APPLICATION_DOCUMENT_SOURCE_REQUIRED', 'Choose the complete installed document merchant.');
  return original;
}

async function commissioningReader(directory){
  directory=absolute(directory);
  const original=await import(pathToFileURL(join(directory,'commissioning-application.mjs')).href);
  need(original.DOCUMENT_COMMISSIONING_APPLICATION_SCHEMA===COMMISSIONING&&
    typeof original.readDocumentCommissioningApplicationSelection==='function'&&
    typeof original.assertDocumentCommissioningApplicationSelection==='function'&&
    typeof original.readDocumentCommissioningApplicationLaunch==='function',
    'APPLICATION_DOCUMENT_COMMISSIONING_SOURCE_REQUIRED');
  return original;
}
async function prepareCommissioningApplication(settings,{inputPath,runtimeDirectory}){
  const state=await inputPath(settings.directory,'directory',true,true);
  const configuration=await inputPath(settings.commissioningOptionsFile,'file',false,true),inputs=[state,configuration];
  const runtime=await inspectMerchantRuntime(absolute(runtimeDirectory),{load:false,source:false});
  const native=join(runtime.sourceRoot,SOURCE),original=await commissioningReader(native);
  const selected=original.assertDocumentCommissioningApplicationSelection(
    await original.readDocumentCommissioningApplicationSelection({optionsFile:configuration.path}));
  need(selected.sourceDirectory===native&&selected.review.options.directory===state.path,
    'APPLICATION_DOCUMENT_COMMISSIONING_DIRECTORY_CHANGED');
  for(const file of [selected.optionsFile,...selected.sourceFiles,...selected.review.sourceFiles,
    ...selected.review.configurationFiles]){
    const current=await inputPath(file.path,'file');
    need(current.bytes===file.bytes&&current.sha256===file.sha256,'APPLICATION_DOCUMENT_SOURCE_CHANGED');
    if(!inputs.some(value=>value.path===current.path))inputs.push(current);
  }
  return {
    args:['commission','launch','--options',configuration.path,'--managed-source',native,
      '--expected-selection',selected.selectionSha256],inputs,createDirectories:[],
    resourceKey:digest(JSON.stringify({family:JOB_MERCHANT_APPLICATION_ID,directory:selected.merchantState})),
    documentMerchant:{schema:COMMISSIONING,directory:state.path,sourceDirectory:native,
      selectionSha256:selected.selectionSha256,merchantState:selected.merchantState,
      provider:selected.review.request.provider,publicOrigin:selected.review.original.publicOrigin,
      payment:selected.review.request.payment,...(selected.review.request.assembly?
        {assemblyPayment:selected.review.request.assembly.payment}:{}),originalOperator:selected.review.original.operatorWorkspace??
        selected.review.original.operatorProfile?.path,
      customerDirectory:selected.review.customer.directory,customerOptions:selected.review.paths.customerOptions,
      consumerOptions:selected.review.paths.consumerOptions,ports:{
        seller:selected.review.options.sellerPort,customer:selected.review.options.customerPort,
        operator:selected.review.options.operatorPort,operations:selected.review.options.operationsPort}}
  };
}
function commissioningRequest(request){
  need(request.command==='document-merchant'&&request.args?.[0]==='commission'&&request.args?.[1]==='launch'&&
    request.terminal!==true&&!request.pythonCommand,'APPLICATION_DOCUMENT_REQUEST_CHANGED');
  const allowed=new Map([['--options','optionsFile'],['--managed-source','sourceDirectory'],
    ['--expected-selection','expectedSelection']]),value=Object.create(null),seen=new Set();
  for(let i=2;i<request.args.length;i++){
    const flag=request.args[i],entry=request.args[++i];
    need(allowed.has(flag)&&!seen.has(flag)&&typeof entry==='string'&&entry&&!entry.startsWith('--'),
      'APPLICATION_DOCUMENT_REQUEST_CHANGED');seen.add(flag);value[allowed.get(flag)]=entry;
  }
  absolute(value.optionsFile);absolute(value.sourceDirectory);
  need(/^[a-f0-9]{64}$/.test(value.expectedSelection??''),'APPLICATION_DOCUMENT_REQUEST_CHANGED');
  return {commissioning:true,sourceDirectory:value.sourceDirectory,expectedSelection:value.expectedSelection,
    options:{optionsFile:value.optionsFile}};
}

export async function prepareDocumentApplication(settings, {inputPath, runtimeDirectory}) {
  validateDocumentApplicationSettings(settings);
  if(settings.commissioningOptionsFile)return prepareCommissioningApplication(settings,{inputPath,runtimeDirectory});
  const state = await inputPath(settings.directory, 'directory', Boolean(settings.configurationFile), true);
  const inputs = [state], options = {directory: state.path, landing: settings.landing ?? 'jobs'};
  for (const [setting, name] of PATHS) {
    if (!settings[setting]) continue;
    const kind = setting === 'deliveryDirectory' ? 'directory' : 'file';
    const selected = await inputPath(settings[setting], kind, kind === 'directory', true);
    inputs.push(selected); options[name] = selected.path;
  }
  for (const [setting, name] of PORTS) options[name] = settings[setting] ?? 0;
  for (const [name] of BOOLEANS) options[name] = settings[name] === true;
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), {load: false, source: false});
  const native = join(runtime.sourceRoot, SOURCE), original = await reader(native);
  const selected = original.assertDocumentServiceSelection(await original.readDocumentServiceSelection(options));
  need(selected.sourceDirectory === native && selected.directory === state.path,
    'APPLICATION_DOCUMENT_SOURCE_CHANGED', 'Review the selected original document service source.');
  for (const file of [...selected.sourceFiles, ...selected.optionalFiles,
    ...(selected.configurationFile ? [selected.configurationFile] : [])]) {
    const current = await inputPath(file.path, 'file');
    need(current.bytes === file.bytes && current.sha256 === file.sha256,
      'APPLICATION_DOCUMENT_SOURCE_CHANGED', 'Review the current original source and configuration.');
    if (!inputs.some(value => value.path === current.path)) inputs.push(current);
  }
  // Existing setup files are ordinary reviewed original inputs. The preparer
  // creates missing files only at Start, inside its existing setup lease.
  for (const name of ['setup.json', 'setup-complete.json', ...selected.setup.files.map(file => file.name)]) {
    const path = join(state.path, name);
    try {
      const info = await lstat(path);
      need(info.isFile() && !info.isSymbolicLink() && !(info.mode & 0o077),
        'APPLICATION_DOCUMENT_PRIVATE_SETUP_REQUIRED');
      if (!inputs.some(value => value.path === path)) inputs.push(await inputPath(path, 'file'));
    } catch (error) {if (error.code !== 'ENOENT') throw error;}
  }
  const args = ['launch', '--directory', state.path, '--managed-source', native,
    '--expected-selection', selected.selectionSha256, '--landing', options.landing];
  for (const [, name, flag] of PATHS) if (options[name]) args.push(flag, options[name]);
  for (const [, name, flag] of PORTS) args.push(flag, String(options[name]));
  for (const [name, flag] of BOOLEANS) if (options[name]) args.push(flag);
  return {
    args, inputs, createDirectories: [],
    // A saved generic Paid-job merchant and this document application acquire
    // the exact same original merchant resource. Neither opens a second owner.
    resourceKey: digest(JSON.stringify({family: JOB_MERCHANT_APPLICATION_ID,
      directory: selected.setup.merchantState})),
    documentMerchant: {
      schema: SELECTION, directory: selected.directory, sourceDirectory: selected.sourceDirectory,
      runtimeDirectory: selected.runtimeDirectory, selectionSha256: selected.selectionSha256,
      setupInputSha256: selected.setup.inputSha256, jobsConfig: selected.setup.jobsConfig,
      merchantState: selected.setup.merchantState, customerSetup: selected.setup.customerSetup,
      summary: selected.summary, ports: {
        seller: options.sellerPort, customer: options.customerPort,
        operator: options.operatorPort, operations: options.operationsPort
      }
    }
  };
}

export function documentApplicationRequest(request) {
  if(request.args?.[0]==='commission')return commissioningRequest(request);
  need(request.command === 'document-merchant' && Array.isArray(request.args) &&
    request.args[0] === 'launch' && request.terminal !== true && !request.pythonCommand,
  'APPLICATION_DOCUMENT_REQUEST_CHANGED');
  const pairs = new Map([
    ['--directory', 'directory'], ['--managed-source', 'sourceDirectory'],
    ['--expected-selection', 'expectedSelection'], ['--landing', 'landing'],
    ...PATHS.map(([, name, flag]) => [flag, name]), ...PORTS.map(([, name, flag]) => [flag, name])
  ]);
  const booleans = new Map(BOOLEANS.map(([name, flag]) => [flag, name]));
  const values = Object.create(null), seen = new Set();
  for (let index = 1; index < request.args.length; index++) {
    const flag = request.args[index];
    need(!seen.has(flag), 'APPLICATION_DOCUMENT_REQUEST_CHANGED'); seen.add(flag);
    if (booleans.has(flag)) {values[booleans.get(flag)] = true; continue;}
    need(pairs.has(flag), 'APPLICATION_DOCUMENT_REQUEST_CHANGED');
    const value = request.args[++index];
    need(typeof value === 'string' && value && !value.startsWith('--'), 'APPLICATION_DOCUMENT_REQUEST_CHANGED');
    values[pairs.get(flag)] = value;
  }
  absolute(values.directory); absolute(values.sourceDirectory);
  need(/^[a-f0-9]{64}$/.test(values.expectedSelection ?? ''), 'APPLICATION_DOCUMENT_REQUEST_CHANGED');
  for (const [, name] of PORTS) {
    need(/^(?:0|[1-9][0-9]*)$/.test(values[name] ?? ''), 'APPLICATION_DOCUMENT_PORT_INVALID');
    values[name] = Number(values[name]);
    need(Number.isInteger(values[name]) && values[name] <= 65535, 'APPLICATION_DOCUMENT_PORT_INVALID');
  }
  const {sourceDirectory, expectedSelection, ...options} = values;
  return {sourceDirectory, expectedSelection, options};
}

export async function verifyDocumentApplicationLaunch(request) {
  const requested = documentApplicationRequest(request);
  if(requested.commissioning){
    const original=await commissioningReader(requested.sourceDirectory);
    const selected=original.assertDocumentCommissioningApplicationSelection(
      await original.readDocumentCommissioningApplicationSelection(requested.options),requested.expectedSelection);
    const service=await reader(requested.sourceDirectory);
    await service.assertDocumentServiceSource(join(absolute(request.releaseDirectory),'source',SOURCE));
    need(selected.sourceDirectory===requested.sourceDirectory,'APPLICATION_DOCUMENT_SOURCE_CHANGED');
    return selected;
  }
  const original = await reader(requested.sourceDirectory);
  const selected = original.assertDocumentServiceSelection(
    await original.readDocumentServiceSelection(requested.options), requested.expectedSelection);
  need(selected.sourceDirectory === requested.sourceDirectory, 'APPLICATION_DOCUMENT_SOURCE_CHANGED');
  const launchSourceDirectory = join(absolute(request.releaseDirectory), 'source', SOURCE);
  await original.assertDocumentServiceSource(launchSourceDirectory);
  return selected;
}

export async function prepareDocumentApplicationChild(request, directory, originalArgs, environment) {
  documentApplicationRequest(request);
  need(Array.isArray(originalArgs) && originalArgs.every(value => typeof value === 'string') &&
    !originalArgs.includes('--managed-launch'), 'APPLICATION_DOCUMENT_REQUEST_CHANGED');
  return {
    executable: process.execPath,
    args: [...originalArgs, '--managed-launch', jobServiceLaunchPath(absolute(directory))],
    options: {cwd: request.homeDirectory, shell: false, env: environment,
      stdio: ['ignore', request.applicationId ? 'pipe' : 'inherit', request.applicationId ? 'pipe' : 'inherit', 3]}
  };
}

export async function documentApplicationStartup(request, text, directory) {
  if (request.command !== 'document-merchant' || !['launch','commission'].includes(request.args?.[0]) ||
    typeof text !== 'string' || text.length > 16384 || !text.startsWith('{')) return null;
  let announcement; try {announcement = JSON.parse(text);} catch {return null;}
  if (!plain(announcement) || announcement.schema !== STARTUP || announcement.state !== 'LISTENING') return null;
  const requested = documentApplicationRequest(request), original = requested.commissioning?
    await commissioningReader(requested.sourceDirectory):await reader(requested.sourceDirectory);
  const privateLaunch = jobServiceLaunchPath(absolute(directory));
  need(announcement.privateLaunch === privateLaunch && Number.isSafeInteger(announcement.pid) &&
    announcement.pid > 0 && typeof announcement.instanceId === 'string',
  'APPLICATION_DOCUMENT_STARTUP_CHANGED');
  const receiving={file:privateLaunch,expectedSelection:requested.expectedSelection,
    expected:{pid:announcement.pid,instanceId:announcement.instanceId}};
  const received=requested.commissioning?
    await original.readDocumentCommissioningApplicationLaunch({...requested.options,...receiving}):
    await original.readDocumentServiceLaunch({options:requested.options,...receiving});
  if(requested.commissioning)need(announcement.documentCommissioningSha256===received.applicationSelection.selectionSha256,
    'APPLICATION_DOCUMENT_STARTUP_CHANGED');
  const {launch, nativeSelection, documentSelection} = received;
  need(announcement.selectionSha256 === nativeSelection.selectionSha256 &&
    announcement.entryUrl === launch.entryUrl &&
    ['seller', 'customer', 'operator', 'operations', 'intake', 'mode', 'inputReceiving',
      'resolution', 'deliveries', 'deliveryState', 'landing'].every(name => announcement[name] === launch[name]),
  'APPLICATION_DOCUMENT_STARTUP_CHANGED', 'Read this saved document merchant\'s original live service.');
  const serviceOptions=requested.commissioning?received.commissioning.serviceOptions:requested.options;
  for (const [, name] of PORTS) {
    const key = {sellerPort: 'seller', customerPort: 'customer', operatorPort: 'operator',
      operationsPort: 'operations'}[name];
    need(serviceOptions[name] === 0 || Number(new URL(launch[key]).port || 80) === serviceOptions[name],
      'APPLICATION_DOCUMENT_PORT_CHANGED');
  }
  const links = [
    ['jobs', 'Document jobs', 'operator'], ['inputs', 'Input receiving', 'inputReceiving'],
    ['resolutions', 'Job resolution', 'resolution'], ['deliveries', 'Result delivery', 'deliveries']
  ].filter(([, , key]) => launch[key] !== null).map(([id, label, key]) => ({id, label, url: launch[key]}));
  return {
    url: launch.entryUrl, links,
    original: {
      schema: STARTUP, directory: launch.directory, configPath: launch.configPath,
      runtimeDirectory: launch.runtimeDirectory, source: launch.source,
      selectionSha256: launch.selectionSha256, pid: launch.pid, instanceId: launch.instanceId,
      privateLaunch, landing: launch.landing, documentDirectory: documentSelection.directory,
      documentSelectionSha256: documentSelection.selectionSha256,
      setupInputSha256: documentSelection.setup.inputSha256,
      provider: documentSelection.summary.provider.provider,
      ...(requested.commissioning?{commissioningSelectionSha256:received.applicationSelection.selectionSha256,
        commissioningDirectory:received.commissioning.directory,customerOptions:received.commissioning.customerOptions,
        consumerOptions:received.commissioning.consumerOptions}:{})
    }
  };
}

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: DOCUMENT_APPLICATION_ID, order: 112,
  appendPort: false,
  catalog(context) {return [documentApplication(context)];},
  validateSettings(type, settings) {validateDocumentApplicationSettings(settings);},
  prepare(type, settings, context) {return prepareDocumentApplication(settings, context);},
  verifyLaunch(request) {return verifyDocumentApplicationLaunch(request);},
  prepareChild(request, directory, args, environment) {
    return prepareDocumentApplicationChild(request, directory, args, environment);
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'document-merchant' && (request.args?.[0] === 'launch'||
      request.args?.[0] === 'commission'&&request.args?.[1] === 'launch');
  },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"stellar-forge.job-service-launch.v1",')) return null;
      return () => documentApplicationStartup(request, text, directory);
    });
  }
};
