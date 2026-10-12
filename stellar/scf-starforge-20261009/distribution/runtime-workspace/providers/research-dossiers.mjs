// MIT. research-dossiers Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { join } from "node:path";
import { regular, need } from "../storage.mjs";

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
        'Optional existing configuration; requires the Crossref source directory.'), ...common] }]; },
  validateSettings(type, settings) {
    need(!settings.openalexModule || settings.openalexWorkspaceDirectory,
      'APPLICATION_OPENALEX_WORKSPACE_REQUIRED', 'Choose the original saved OpenAlex workspace with its module');
    need(!settings.crossrefConfig || settings.crossrefState,
      'APPLICATION_CROSSREF_STATE_REQUIRED', 'Choose the original Crossref source directory with its configuration');
  },
  async checkRuntime(type, settings, runtime) {
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
    option('--dir', settings.workspaceDirectory);
    option('--edition-adapter', settings.editionAdapter);
    option('--openalex-workspace', settings.openalexWorkspaceDirectory);
    option('--openalex-module', settings.openalexModule);
    option('--crossref-state', settings.crossrefState);
    option('--crossref-config', settings.crossrefConfig);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "research-workspace"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      try {
        const ready = JSON.parse(text), directoryIndex = request.args.indexOf('--dir');
        const crossrefSelected = request.args.includes('--crossref-state');
        if (ready.mode === 'RESEARCH_DOSSIER_WORKSPACE' && directoryIndex >= 0 &&
            ready.directory === request.args[directoryIndex + 1] &&
            (!crossrefSelected || ready.crossrefConfigured === true) && typeof ready.url === 'string') return ready.url;
      } catch {}
      return null;
    });
  },
};
