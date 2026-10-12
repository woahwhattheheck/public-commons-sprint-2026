// MIT. Source-owned SFTP workbench provider for the original Applications lifecycle.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../../distribution/runtime-workspace/application-provider.mjs';
import { sftpApplication, prepareSftpApplication, validateSftpApplicationSettings,
  verifySftpApplicationLaunch, sftpApplicationStartup } from './managed-application.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA,
  id: 'sftp',
  order: 1000,
  catalog({ common }) { return [sftpApplication(common)]; },
  prepare(_type, settings, context) { return prepareSftpApplication(settings, context); },
  validateSettings: validateSftpApplicationSettings,
  matchRequest(request) { return !request.pythonCommand && request.command === 'sftp-workspace'; },
  verifyLaunch: verifySftpApplicationLaunch,
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"sftpWorkspace":')) return null;
      return () => sftpApplicationStartup(request, text, directory, context);
    });
  },
};
