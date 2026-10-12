// MIT. Receivables runs through the original managed Applications lifecycle.
import {resolve} from 'node:path';
import {APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup} from '../../distribution/runtime-workspace/application-provider.mjs';
import {inspectAccountingWorkspaceBinding} from '../workspace/binding.mjs';
import {need} from './core.mjs';

const option = (args, name) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'merchant-receivables', order: 520,
  catalog({common, field}) {
    return [{id: 'merchant-receivables', command: 'receivables', terminal: false,
      requiredSource: 'stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/cli.mjs',
      title: 'Merchant receivables',
      description: 'Issue invoices and credit notes, apply customer payments, import original service quotations, and review dated balances in the existing accounting workspace.',
      fields: [field('directory', 'Initialized private accounting workspace', 'path', true,
        'Reopen the original accounting directory and its existing customer identities.'), ...common]}];
  },
  async prepare(type, settings, context) {
    const prepared = applicationPreparation(settings, context.inputPath);
    await prepared.path('directory', 'directory', false, true);
    const binding = await inspectAccountingWorkspaceBinding(settings.directory);
    prepared.args.push('serve', '--directory', binding.directory, '--expected-workspace-id', binding.workspaceId,
      '--expected-sources-sha256', binding.sourcesSha256);
    return {args: prepared.args, inputs: prepared.inputs, createDirectories: [],
      accountingBinding: binding};
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'receivables' && request.args?.[0] === 'serve';
  },
  async verifyLaunch(request) {
    const directory = option(request.args, '--directory'), binding = await inspectAccountingWorkspaceBinding(directory);
    need(binding.workspaceId === option(request.args, '--expected-workspace-id') &&
      binding.sourcesSha256 === option(request.args, '--expected-sources-sha256'),
      'ACCOUNTING_WORKSPACE_CHANGED', 'Reopen the current accounting application review before launch.', 409);
  },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"stellar-forge.merchant-receivables-startup.v1",')) return null;
      let ready;
      try { ready = JSON.parse(text); } catch { return null; }
      const selectedDirectory = option(request.args, '--directory'), port = Number(option(request.args, '--port') ?? 8448);
      if (!selectedDirectory || ready.directory !== resolve(selectedDirectory) ||
        ready.workspaceId !== option(request.args, '--expected-workspace-id') ||
        ready.sourcesSha256 !== option(request.args, '--expected-sources-sha256')) return null;
      let url;
      try { url = new URL(ready.url); } catch { return null; }
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/receivables/' ||
        url.search || url.hash || (port !== 0 && Number(url.port || 80) !== port)) return null;
      return {url: url.href, workspaceId: ready.workspaceId,
        original: {directory: ready.directory, sourcesSha256: ready.sourcesSha256},
        links: [{label: 'Customers and statements', url: new URL('/customer-statements/', url).href}]};
    });
  },
};
