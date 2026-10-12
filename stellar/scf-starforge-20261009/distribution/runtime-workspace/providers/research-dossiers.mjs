// MIT. research-dossiers Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { join } from "node:path";
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../../sf46-release/runtime-package.mjs';
import { regular, need, plain, absolute, digest } from "../storage.mjs";

const PIPELINE_ROOT = 'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers';
const DOCUMENT_FILES = [
  'unstructured-workspace.mjs',
  '../node/client.mjs',
  '../node/unstructured/contract.mjs',
  '../node/unstructured/dossier.mjs',
  '../node/unstructured/purchase.mjs',
];
async function documentSourceSelection(filename, modulePath) {
  const { openSavedDocumentBuyerSource } = await import(pathToFileURL(modulePath).href);
  need(typeof openSavedDocumentBuyerSource === 'function', 'APPLICATION_DOCUMENT_SOURCE_READER_REQUIRED');
  return openSavedDocumentBuyerSource(absolute(filename));
}
const PIPELINE_FILES = [
  'unstructured-pipelines-workspace.mjs',
  'unstructured-pipelines/contract.mjs',
  'unstructured-pipelines/client.mjs',
  'unstructured-pipelines/operations.mjs',
  'unstructured-pipelines/edition.mjs',
];
async function pipelineSelection(filename) {
  const bytes = await regular(absolute(filename), 1024 * 1024);
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  need(plain(value) && value.schema === 'stellar-forge.unstructured-pipelines-source.v1' &&
    Object.keys(value).every(key => ['schema', 'workspaceId', 'directory', 'configurationFile'].includes(key)) &&
    typeof value.workspaceId === 'string' && value.workspaceId.trim().length > 0 &&
    Buffer.byteLength(value.workspaceId) <= 128 && !/[\u0000-\u001f\u007f]/.test(value.workspaceId),
    'APPLICATION_PIPELINE_SOURCE_INVALID', 'Choose the original saved document-pipeline source selection.');
  absolute(value.directory); absolute(value.configurationFile);
  return { value, sha256: digest(bytes) };
}


export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "research-dossiers", order: 480,
  catalog({ common, field }) { return [{ id: 'research-dossiers', command: 'research-workspace', requiredSource: 'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/server.mjs',
    title: 'Research dossiers', terminal: false,
    description: 'Reopen research questions, original source editions, selections, findings, revision comparison and portable reports.',
    fields: [field('workspaceDirectory', 'Private research dossiers directory', 'path', true,
      'An existing directory or one new directory in an existing private parent.'),
      field('openalexWorkspaceDirectory', 'Existing OpenAlex research workspace', 'path', false,
        'Optional saved collection with its original queries, editions, pages and review decisions.'),
      field('openalexModule', 'Original OpenAlex workspace module', 'path', false,
        'Optional explicit workspace.mjs from the original provider source; otherwise use this selected runtime.'),
      field('editionAdapter', 'Original provider edition adapter', 'path', false,
        'Optional local adapter module for retained provider references such as Valyu.'),
      field('crossrefState', 'Private Crossref source directory', 'path', false,
        'Optional retained source directory. Enables DOI metadata using public Crossref.'),
      field('crossrefConfig', 'Original Crossref merchant configuration', 'path', false,
        'Optional existing configuration; requires the Crossref source directory.'),
      field('documentSourceConfig', 'Original document buyer source selection', 'path', false,
        'Optional private source JSON selecting an existing document buyer or inbox. Reopen its saved original purchases and receive them into research.'),
      field('pipelineSourceConfig', 'Original document-pipeline source selection', 'path', false,
        'Optional private source JSON selecting the retained pipeline jobs directory and original account configuration. Reopening keeps the same saved jobs and source.'), ...common] }]; },
  validateSettings(type, settings) {
    need(!settings.openalexModule || settings.openalexWorkspaceDirectory,
      'APPLICATION_OPENALEX_WORKSPACE_REQUIRED', 'Choose the original saved OpenAlex workspace with its module');
    need(!settings.crossrefConfig || settings.crossrefState,
      'APPLICATION_CROSSREF_STATE_REQUIRED', 'Choose the original Crossref source directory with its configuration');
  },
  async checkRuntime(type, settings, runtime) {
    if (settings.documentSourceConfig) {
      for (const path of DOCUMENT_FILES)
        await regular(join(runtime.sourceRoot, PIPELINE_ROOT, path), 4 * 1024 * 1024).catch(() =>
          need(false, 'APPLICATION_NOT_IN_RUNTIME',
            'Choose a runtime containing the original document buyer and research receiving source.'));
    }
    if (settings.pipelineSourceConfig) {
      for (const path of PIPELINE_FILES)
        await regular(join(runtime.sourceRoot, PIPELINE_ROOT, path), 4 * 1024 * 1024).catch(() =>
          need(false, 'APPLICATION_NOT_IN_RUNTIME',
            'Choose a runtime containing the original document-pipeline research workspace and operations.'));
    }
    if (type.id === 'research-dossiers' && settings.openalexWorkspaceDirectory && !settings.openalexModule)
      await regular(join(runtime.sourceRoot,
        'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research/workspace.mjs'), 4 * 1024 * 1024).catch(() =>
        need(false, 'APPLICATION_NOT_IN_RUNTIME',
          'Choose a runtime containing the original OpenAlex workspace or select its explicit original module'));
    if (type.id === 'research-dossiers' && settings.crossrefState) {
      const required = [
        'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/crossref-workspace.mjs',
        'stellar/scf-starforge-20261009/sf30-seller-sdk/crossref/source.mjs',
        ...(settings.crossrefConfig ? [
          'stellar/scf-starforge-20261009/sf30-seller-sdk/crossref/config.mjs',
          'stellar/scf-starforge-20261009/sf30-seller-sdk/crossref/merchant.mjs',
        ] : []),
      ];
      for (const path of required) await regular(join(runtime.sourceRoot, path), 4 * 1024 * 1024).catch(() =>
        need(false, 'APPLICATION_NOT_IN_RUNTIME', 'Choose a runtime containing the original Crossref research workspace and source'));
    }
  },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    const workspace = await path('workspaceDirectory', 'directory', true, true);
    if (!workspace.exists) createDirectories.push(workspace.path);
    await path('editionAdapter', 'file');
    await path('openalexModule', 'file');
    if (settings.crossrefState) {
      const source = await path('crossrefState', 'directory', true, true);
      if (!source.exists && !createDirectories.includes(source.path)) createDirectories.push(source.path);
      await path('crossrefConfig', 'file');
    }
    if (settings.openalexWorkspaceDirectory) {
      await path('openalexWorkspaceDirectory', 'directory', false, true);
      for (const part of ['queries', 'editions'])
        inputs.push(await inputPath(join(settings.openalexWorkspaceDirectory, part), 'directory'));
    }
    const selectedRuntime = settings.documentSourceConfig || settings.pipelineSourceConfig
      ? await inspectMerchantRuntime(absolute(runtimeDirectory), { load: false, source: false }) : null;
    if (settings.documentSourceConfig) {
      const selectedInput = await path('documentSourceConfig', 'file');
      const modulePath = join(selectedRuntime.sourceRoot, PIPELINE_ROOT, 'unstructured-workspace.mjs');
      inputs.push(await inputPath(modulePath, 'file'));
      const selected = await documentSourceSelection(selectedInput.path, modulePath);
      need(selectedInput.sha256 === digest(await regular(selectedInput.path, 1024 * 1024)),
        'APPLICATION_INPUTS_CHANGED', 'Review the current original document buyer source selection again.');
      const directories = new Set([selected.runtimeDirectory, selected.buyer.stateDirectory,
        ...(selected.inboxDirectory === undefined ? [] : [selected.inboxDirectory])]);
      for (const directory of directories) inputs.push(await inputPath(directory, 'directory'));
    }
    if (settings.pipelineSourceConfig) {
      const selectedInput = await path('pipelineSourceConfig', 'file');
      const selected = await pipelineSelection(selectedInput.path);
      need(selectedInput.sha256 === selected.sha256, 'APPLICATION_INPUTS_CHANGED',
        'Review the current original pipeline source selection again.');
      const jobs = await inputPath(selected.value.directory, 'directory', true, true);
      inputs.push(jobs);
      if (!jobs.exists && !createDirectories.includes(jobs.path)) createDirectories.push(jobs.path);
      const configuration = await inputPath(selected.value.configurationFile, 'file');
      const bytes = await regular(configuration.path, 1024 * 1024);
      need(configuration.sha256 === digest(bytes), 'APPLICATION_INPUTS_CHANGED',
        'Review the current original pipeline account configuration again.');
      inputs.push(configuration);
      const contractPath = join(selectedRuntime.sourceRoot, PIPELINE_ROOT, 'unstructured-pipelines/contract.mjs');
      inputs.push(await inputPath(contractPath, 'file'));
      const { normalizeConfiguration } = await import(pathToFileURL(contractPath).href);
      need(typeof normalizeConfiguration === 'function', 'APPLICATION_PIPELINE_CONTRACT_REQUIRED');
      normalizeConfiguration(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    }
    option('--dir', settings.workspaceDirectory);
    option('--edition-adapter', settings.editionAdapter);
    option('--openalex-workspace', settings.openalexWorkspaceDirectory);
    option('--openalex-module', settings.openalexModule);
    option('--crossref-state', settings.crossrefState);
    option('--crossref-config', settings.crossrefConfig);
    option('--document-source', settings.documentSourceConfig);
    option('--pipeline-source', settings.pipelineSourceConfig);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "research-workspace"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      try {
        const ready = JSON.parse(text), directoryIndex = request.args.indexOf('--dir');
        const crossrefSelected = request.args.includes('--crossref-state');
        const pipelineIndex = request.args.indexOf('--pipeline-source');
        const documentIndex = request.args.indexOf('--document-source');
        if (ready.mode !== 'RESEARCH_DOSSIER_WORKSPACE' || directoryIndex < 0 ||
            ready.directory !== request.args[directoryIndex + 1] ||
            crossrefSelected && ready.crossrefConfigured !== true || typeof ready.url !== 'string') return null;
        if (pipelineIndex < 0 && documentIndex < 0) return ready.url;
        if (pipelineIndex >= 0 && ready.pipelineSourceConfigured !== true ||
            documentIndex >= 0 && ready.documentSourceConfigured !== true) return null;
        return async () => {
          if (pipelineIndex >= 0) {
            const selected = await pipelineSelection(request.args[pipelineIndex + 1]);
            need(ready.pipelineWorkspaceId === selected.value.workspaceId,
              'APPLICATION_PIPELINE_STARTUP_CHANGED',
              'The original research listener opened a different document-pipeline source.');
          }
          if (documentIndex >= 0) {
            const modulePath = join(absolute(request.releaseDirectory), 'source', PIPELINE_ROOT, 'unstructured-workspace.mjs');
            const selected = await documentSourceSelection(request.args[documentIndex + 1], modulePath);
            need(ready.documentWorkspaceId === selected.workspaceId,
              'APPLICATION_DOCUMENT_STARTUP_CHANGED',
              'The original research listener opened a different document buyer source.');
          }
          return { url: ready.url, original: ready };
        };
      } catch {}
      return null;
    });
  },
};
