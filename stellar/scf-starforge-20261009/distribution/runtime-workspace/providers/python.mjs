// MIT. python Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { dirname } from "node:path";
import { PYTHON_APPLICATION_CATALOG, pythonApplicationCommand, pythonApplicationResource, preparePythonManagedChild, observePythonApplicationOutput } from "../../python-runtime/application-lifecycle.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "python", order: 110,
  completeCommand: true,
  catalog({ common, field }) { return [...PYTHON_APPLICATION_CATALOG]; },
  prepare(type, settings, context) {
    return pythonApplicationCommand(context.root, type, settings, context);
  },
  resourceKey(type, settings) { return pythonApplicationResource(type, settings); },
  prepareChild(request, directory, originalArgs, environment) {
    return preparePythonManagedChild(dirname(dirname(directory)), request, environment);
  },
  matchRequest(request) { return Boolean(request.pythonCommand); },
  createObserver(request, directory, context) {
    return observePythonApplicationOutput(request, directory, context);
  },
};
