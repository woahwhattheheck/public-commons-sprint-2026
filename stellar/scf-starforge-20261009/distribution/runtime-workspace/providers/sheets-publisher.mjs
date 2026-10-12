// MIT. sheets-publisher Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { join } from "node:path";
import { readJSON, need, json } from "../storage.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "sheets-publisher", order: 440,
  catalog({ common, field }) { return [{ id: 'sheets-publisher', command: 'sheets-publisher', title: 'Google Sheets dataset publisher', terminal: false,
    description: 'Open the original Sheets source, authorization, range plans, extraction, review and recurring publication.',
    fields: [field('workspaceDirectory', 'Publisher workspace', 'path', true), field('create', 'Initialize a new publisher', 'boolean'),
      field('sourceFile', 'Original Sheets source configuration'), field('stateDirectory', 'Target dataset state'),
      field('seller', 'Seller origin', 'text'), field('resource', 'Resource URL', 'text'), ...common] }]; },
  validateSettings(type, settings) {
    need(!settings.create || settings.sourceFile && settings.stateDirectory, 'APPLICATION_PUBLISHER_SOURCE_REQUIRED');
    need(Boolean(settings.seller) === Boolean(settings.resource), 'APPLICATION_BUYER_ENDPOINT_PAIR_REQUIRED');
  },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    const workspace = await path('workspaceDirectory', 'directory', Boolean(settings.create), true);
    args.push('serve'); option('--workspace', settings.workspaceDirectory);
    if (settings.create && !workspace.exists) {
      args.push('--create'); await path('sourceFile', 'file'); await path('stateDirectory', 'directory', true, true);
      option('--source', settings.sourceFile); option('--state', settings.stateDirectory);
    } else {
      const original = await readJSON(join(settings.workspaceDirectory, 'workspace.json'));
      need(typeof original.sourceFile === 'string' && typeof original.targetDirectory === 'string' &&
        (!settings.sourceFile || settings.sourceFile === original.sourceFile) &&
        (!settings.stateDirectory || settings.stateDirectory === original.targetDirectory),
      'APPLICATION_PUBLISHER_BINDING_CHANGED', 'Open this publisher with its original source and target state');
      inputs.push(await inputPath(original.sourceFile, 'file'));
      inputs.push(await inputPath(join(settings.workspaceDirectory, 'workspace.json'), 'file'));
    }
    option('--seller', settings.seller); option('--resource', settings.resource);
    return { args, inputs, createDirectories };
  },
  resourceKey(type, settings, { hash }) { return hash({ family: 'publisher', directory: settings.workspaceDirectory }); },
  matchRequest(request) { return !request.pythonCommand && request.command === "sheets-publisher"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      const match = text.match(new RegExp('"url"\\s*:\\s*"([^"]+)"'));
      return match ? match[1] : null;
    });
  },
};
