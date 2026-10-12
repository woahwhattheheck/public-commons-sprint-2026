// MIT. Compose original merchant setup with one host-selected laboratory customer connection.
import { resolve, join } from 'node:path';
import { readMerchantConfig } from './config.mjs';
import { line, writePrivate } from './host-files.mjs';
import { wqxReadPrivate, wqxDecode } from './wqx-workspace-connection.mjs';
import { readPaidJobWorkspaceConfiguration } from './paid-jobs.mjs';
import { initializePaidJobWorkspaceMerchant } from './paid-jobs-setup.mjs';
import { readLabWorkspaceConfiguration } from './lab-edd-connection.mjs';

export async function initializeLabWorkspaceMerchant({
  directory, connection, merchantConnection, name = 'Laboratory EDD operator'
} = {}) {
  if (![directory, connection, merchantConnection].every(value => typeof value === 'string' && value.length > 0))
    throw Object.assign(new Error('Select the new MCP directory and the two existing private customer and merchant connection files.'),
      { code: 'LAB_CONFIGURATION' });
  const labWorkspaceConnection = resolve(connection), paid = resolve(merchantConnection);
  const paidJobWorkspaces = await readPaidJobWorkspaceConfiguration(paid);
  const selected = await readLabWorkspaceConfiguration(labWorkspaceConnection, { paidJobWorkspaces });
  const base = await initializePaidJobWorkspaceMerchant({ directory, connection: paid, name: line(name) });
  const original = wqxDecode(await wqxReadPrivate(base.configuration, 1048576));
  const configuration = join(resolve(directory), 'laboratory-mcp.json');
  await writePrivate(configuration, { ...original, labWorkspaceConnection });
  await readMerchantConfig(configuration);
  return { ...base, configuration, labWorkspacesConfigured: true,
    ownership: 'ORIGINAL_SF88_CUSTOMER_AND_PAID_JOB_MERCHANT',
    workspaces: Object.entries(selected.workspaces).map(([workspace, value]) => ({
      workspace, label: value.label, merchant: value.merchant, origin: value.origin, functionId: value.functionId,
    })) };
}
