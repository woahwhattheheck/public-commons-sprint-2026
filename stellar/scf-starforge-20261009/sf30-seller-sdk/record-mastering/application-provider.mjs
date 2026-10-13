// MIT. Registration with the maintained original Applications lifecycle owner.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../../distribution/runtime-workspace/application-provider.mjs';
import { masteringApplication, prepareMasteringApplication, masteringStartup } from './application.mjs';
import { SCHEMA } from './core.mjs';
export default { schema: APPLICATION_PROVIDER_SCHEMA, id: 'record-mastering', order: 426,
    catalog({ common }) { return [masteringApplication(common)]; },
    prepare(type, settings, context) { return prepareMasteringApplication(settings, context); },
    matchRequest(request) { return !request.pythonCommand && request.command === 'record-mastering'; },
    createObserver(request, directory) { return observeApplicationStartup(request, directory, text => text.startsWith('{') && text.includes('"schema":"' + SCHEMA + '.startup"') ? () => masteringStartup(request, text) : null); }
};
