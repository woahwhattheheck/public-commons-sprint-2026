// MIT. Original OECD analyst Applications launch and reopening.
import { join } from 'node:path';
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { readJSON, need } from '../storage.mjs';
export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'oecd', order: 436,
  catalog({ common, field }) {
    return [{ id: 'oecd', command: 'oecd', title: 'OECD analyst and customer workspace', terminal: false,
      description: 'Open original OECD captures, compare country series, save analyst reports and publish native customer editions.',
      fields: [field('workspaceDirectory', 'OECD project', 'path', true),
        field('create', 'Initialize a new project', 'boolean'),
        field('pythonExecutable', 'Python executable', 'text'),
        field('providerUsernameEnv', 'Existing provider username environment name', 'text'),
        field('providerPasswordEnv', 'Existing provider password environment name', 'text'), ...common] }];
  },
  validateSettings(type, settings) {
    need(Boolean(settings.providerUsernameEnv) === Boolean(settings.providerPasswordEnv), 'APPLICATION_OECD_PROVIDER_PAIR');
    for (const key of ['providerUsernameEnv', 'providerPasswordEnv']) {
      need(!settings[key] || /^[A-Za-z_][A-Za-z0-9_]*$/.test(settings[key]), 'APPLICATION_OECD_ENVIRONMENT_NAME');
    }
  },
  async prepare(type, settings, context) {
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, context.inputPath);
    const workspace = await path('workspaceDirectory', 'directory', Boolean(settings.create), true);
    let retained = null;
    if (workspace.exists) {
      try { retained = await readJSON(join(settings.workspaceDirectory, 'oecd-project.json')); }
      catch (error) { if (error.code !== 'ENOENT' || !settings.create) throw error; }
    }
    args.push('serve'); option('--project', settings.workspaceDirectory);
    if (!retained && settings.create) args.push('--create');
    else {
      const original = retained ?? await readJSON(join(settings.workspaceDirectory, 'oecd-project.json'));
      need(original.schema === 'stellar-forge.oecd-workspace.v1' && /^[0-9a-f]{32}$/.test(original.id),
        'APPLICATION_OECD_PROJECT_IDENTITY');
      inputs.push(await context.inputPath(join(settings.workspaceDirectory, 'oecd-project.json'), 'file'));
      inputs.push(await context.inputPath(join(settings.workspaceDirectory, 'catalog'), 'directory', false, true));
    }
    option('--python', settings.pythonExecutable);
    option('--provider-username-env', settings.providerUsernameEnv);
    option('--provider-password-env', settings.providerPasswordEnv);
    return { args, inputs, createDirectories };
  },
  resourceKey(type, settings, { hash }) { return hash({ family: 'oecd', directory: settings.workspaceDirectory }); },
  matchRequest(request) { return !request.pythonCommand && request.command === 'oecd'; },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text => {
      const match = text.match(/"event"\s*:\s*"oecd-ready"[\s\S]*?"url"\s*:\s*"([^"]+)"/);
      return match?.[1] ?? null;
    });
  },
};
