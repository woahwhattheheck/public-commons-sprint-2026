# Existing Applications console integration

The paid-job customer is an original application entry in the maintained runtime-workspace catalog. It uses that catalog’s existing runtime adoption, reviewed inputs, managed command, terminal, lifecycle and URL observer.

The full customer command is already registered as job-workspace. Its entry is sf88-operator-buyer-cli/job-workspace/cli.mjs. The typed package entry remains ./buyer/job-workspace; checkout is model.checkout on that existing API.

This handoff was prepared against Applications PR1345 source 5e5c4023b73c767675d0608ee1f90c70333eed27: applications.mjs blob4400b1e6d35ee911d71c7943cf36d528b50806e7 and application-command.mjs blob0914ca7c5f5c93f7c12ca1e68832edb4b9eb99d7. Its original owner composes these additions with the current Object Buyer, GoldRush, research and Python entries.

## Catalog and reviewed inputs

Add one entry to the existing APPLICATION_CATALOG:

~~~js
{
  id: 'job-checkout',
  command: 'job-workspace',
  requiredSource: 'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/checkout/controller.mjs',
  title: 'Paid application jobs',
  terminal: true,
  description: 'Review and purchase a prepared application job, follow execution, retrieve the verified result and use the original resource library.',
  fields: [
    field('stateDirectory', 'Private job customer directory', 'path', true),
    field('operatorWorkspace', 'Original initialized operator workspace'),
    field('operatorProfile', 'Original private Node buyer profile'),
    field('terminalPython', 'Terminal Python executable', 'path', false,
      'Defaults to /usr/bin/python3; the existing managed PTY owns the application process.'),
    ...common,
  ],
},
~~~

In normalizeSettings, require exactly one original operator source for this application:

~~~js
if (type.id === 'job-checkout')
  need(Boolean(settings.operatorWorkspace) !== Boolean(settings.operatorProfile),
    'APPLICATION_JOB_OPERATOR_SELECTION_REQUIRED',
    'Choose the existing original operator workspace or Node buyer profile');
~~~

The state directory is private and may be newly created inside an existing private parent through the maintained createDirectories mechanism. Keep its original resourceKey behavior, which already uses settings.stateDirectory.

Pin the selected operator directory and its original workspace.json/operator.json, or the selected private profile file. Profile bytes must be a regular private file owned by the account running the application. Credentials stay in the original signer/environment; applicationEnvironment remains the source of the selected private environment file.

The original native runtime is derived from the selected, inspected merchant runtime, never from a customer-provided command argument. applicationCommand currently receives type/settings. Pass its selected runtime directory as a third argument, then add this branch:

~~~js
} else if (type.id === 'job-checkout') {
  const state = await path('stateDirectory', 'directory', true, true);
  if (!state.exists) createDirectories.push(state.path);
  if (settings.operatorWorkspace) {
    await path('operatorWorkspace', 'directory', false, true);
    for (const name of ['workspace.json', 'operator.json'])
      inputs.push(await inputPath(join(settings.operatorWorkspace, name), 'file'));
  } else {
    await path('operatorProfile', 'file');
    const profile = await lstat(settings.operatorProfile);
    need(!(profile.mode & 0o077) &&
      (process.getuid === undefined || profile.uid === process.getuid()),
      'APPLICATION_JOB_PRIVATE_PROFILE_REQUIRED');
  }
  const original = await inspectMerchantRuntime(selectedRuntimeDirectory, { load: false });
  const native = join(original.sourceRoot,
    'stellar/scf-starforge-20261009/sf88-operator-buyer-cli');
  inputs.push(await inputPath(join(native, 'cli.mjs'), 'file'));
  inputs.push(await inputPath(join(native, 'job-workspace', 'launch.mjs'), 'file'));
  args.push('serve');
  option('--state', settings.stateDirectory);
  option('--operator-workspace', settings.operatorWorkspace);
  option('--operator-profile', settings.operatorProfile);
  option('--runtime', native);
}
~~~

Supply selectedRuntimeDirectory at the four existing applicationCommand call sites:

| Existing operation | Original selected directory |
| --- | --- |
| reviewApplication | runtime.directory from its preceding inspectMerchantRuntime |
| saveApplication | reviewed.runtime.directory |
| reviewApplicationStart | saved.runtime.directory |
| prepareApplicationStart | saved.runtime.directory |

All existing command/source/input hashes and managed-run bindings continue to apply. The original common terminalPython, port and environment handling runs after this branch.

The resulting original command is:

~~~text
starforge job-workspace serve --state ABS_PRIVATE_CUSTOMER --operator-workspace ABS_ORIGINAL_OPERATOR --runtime ABS_SELECTED_SOURCE_SF88 --port PORT
~~~

The profile variant replaces --operator-workspace with --operator-profile. The customer server owns one lease and one active native checkout. The original managed PTY owns process-group stop and same-run recovery. The private checkout host initializes the shared original browser approval broker and displays the native payment decision in its Checkout view; standalone commands retain terminal approval.

## Ready output and original private launch

Serve writes its private startup file before printing one JSON line. The file is always:

~~~text
ABS_PRIVATE_CUSTOMER/job-workspace-launch.json
~~~

Its schema is stellar-forge.sf88.job-workspace-launch.v1 and its fields are:

| Field | Binding |
| --- | --- |
| state | LISTENING while this server is open; CLOSED after its close completes |
| directory | Exact private customer directory |
| runtimeDirectory | Exact selected original SF88 source directory |
| operatorSelection | Selected original workspace/profile path and runtime |
| pid | Actual customer Node process |
| instanceId | Unique UUID for this server instance |
| privateLaunch | Original private startup file |
| url | Original /jobs/ view, including its private fragment |
| checkoutUrl | Original /jobs/checkout/ view on the same private host |
| libraryUrl | Original resource-library view on that host |
| collectionsUrl | Original collections view on that host |

The customer exports readJobWorkspaceLaunch from its existing typed entry and from job-workspace/launch.mjs. The Applications observer can use the original helper after matching the announcement schema and the reviewed command’s --state and --runtime:

~~~js
const ready = await readJobWorkspaceLaunch({
  directory: selectedState,
  runtimeDirectory: selectedNativeRuntime,
  ...(selectedOperatorWorkspace ? { operatorWorkspace: selectedOperatorWorkspace } : {}),
  ...(selectedOperatorProfile ? { operatorProfile: selectedOperatorProfile } : {}),
  pid: originalCustomerPid,
});
~~~

The helper verifies the private customer directory, source binding, selected operator when supplied, active launch state, PID when supplied, and the four exact loopback/token routes. The original terminal runner can supply its actual customer child PID. The announcement’s instanceId and privateLaunch must match the returned private file.

Select ready.checkoutUrl for this catalog entry and save it through the existing application-url.json mechanism with source original-command-stdout. Read the private record before advertising the link; the announcement by itself is only a candidate.

The exact observer branch fits inside the current line function before its common candidate parser. It can chain its asynchronous read onto the existing saving promise. The selected paths come from the already reviewed request.args, whose hash is checked by managed-command. The maintained command URL observer retains ownership of the original application ID, operation ID and error lifecycle.

## Customer reopen and shutdown

A new launch opens the same state directory and its original checkout/buyer/library records. Existing checkouts retain their originally selected runtime and operator source. An installed upgrade supplies the new source for future imports while older operations continue to reference their retained source.

Native creation, offline review and purchase execution receive the existing AbortSignal. Shutdown drains input preparation, revokes the selected pending browser review, waits for the original child and accepted-result intake, closes the shared approval broker, then closes the library and releases the customer lease. An interrupted original attempt remains recoverable through the same checkout, even when its response arrives after a client disconnect.

The Applications runtime/source checks and the customer’s saved input and permanent attempt are complementary. Keep the original operation identity when reopening or recovering this application.
