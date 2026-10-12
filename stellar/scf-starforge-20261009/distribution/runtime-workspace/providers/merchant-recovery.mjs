// MIT. merchant-recovery Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { inspectMerchantRuntime } from "../../../sf46-release/runtime-package.mjs";
import { need } from "../storage.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "merchant-recovery", order: 500,
  catalog({ common, field }) { return [{ id: 'merchant-recovery', command: 'merchant-recovery-remote',
    requiredSource: 'stellar/scf-starforge-20261009/sf101-merchant-recovery/workspace/cli.mjs',
    title: 'Merchant recovery', terminal: false,
    description: 'Capture and verify local snapshots, prepare original restored publishers, and use a configured S3 store for off-host transfer and cold restore.',
    fields: [field('hostConfig', 'Original private recovery host configuration', 'path', true),
      field('workspaceDirectory', 'Private recovery workspace directory', 'path', true,
        'An existing directory or one new directory in an existing private parent. Original transfer journals remain at the host-selected paths.'), ...common] }]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    const config = await path('hostConfig', 'file');
    await path('workspaceDirectory', 'directory', true, true);
    const selected = await inspectMerchantRuntime(runtimeDirectory, { load: false });
    const originalModule = join(selected.sourceRoot,
      'stellar/scf-starforge-20261009/sf101-merchant-recovery/workspace/model.mjs');
    inputs.push(await inputPath(originalModule, 'file'));
    const { readRecoveryConfiguration } = await import(pathToFileURL(originalModule).href);
    const original = await readRecoveryConfiguration(settings.hostConfig);
    need(original.sha256 === config.sha256, 'APPLICATION_RECOVERY_CONFIG_CHANGED',
      'Review the original current recovery host configuration');
    const retained = new Set(inputs.map(item => item.path));
    const retain = async (value, kind = 'directory', missing = false) => {
      if (!retained.has(value)) {
        inputs.push(await inputPath(value, kind, missing, true));
        retained.add(value);
      }
    };
    for (const profile of original.host.profiles) {
      if (profile.storeConfig != null) await retain(profile.storeConfig, 'file');
      await retain(profile.operations, 'directory', true);
      for (const root of profile.bundleRoots) await retain(root.directory);
      for (const plan of profile.capturePlans ?? []) await retain(plan.planFile, 'file', true);
      for (const restored of profile.publisherRestores ?? []) {
        await retain(restored.bundleDirectory, 'directory', true);
        await retain(restored.restoreDirectory, 'directory', true);
      }
      await retain(profile.downloadRoot);
      await retain(profile.restoreRoot);
    }
    args.push('workspace', 'serve');
    option('--config', settings.hostConfig); option('--directory', settings.workspaceDirectory);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "merchant-recovery-remote" && request.args?.[0] === 'workspace' && request.args?.[1] === 'serve'; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      try {
        const ready = JSON.parse(text), configIndex = request.args.indexOf('--config'), directoryIndex = request.args.indexOf('--directory');
        if (ready.status === 'MERCHANT_RECOVERY_WORKSPACE_READY' && configIndex >= 0 && directoryIndex >= 0 &&
            ready.configFile === request.args[configIndex + 1] && ready.directory === request.args[directoryIndex + 1] &&
            typeof ready.url === 'string') return ready.url;
      } catch {}
      return null;
    });
  },
};
