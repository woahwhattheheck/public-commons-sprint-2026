// MIT. Complete OpenAPI procedures sealed by the original merchant workflow engine.
import { WORKFLOW_RECIPE_SCHEMA, sealWorkflowRecipe } from './workflow-recipes.mjs';
import { fail } from './records.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const alias = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const packageName = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const sha = /^[a-f0-9]{64}$/;
export const OPENAPI_MAINTENANCE_TOOLS = Object.freeze([
  'merchant_openapi_operation_policy_review', 'merchant_openapi_operation_policy_package',
  'merchant_openapi_package_inspect', 'merchant_openapi_export'
]);
export const OPENAPI_RECEIVING_TOOLS = Object.freeze([
  'merchant_openapi_receive', 'merchant_openapi_package_inspect', 'merchant_openapi_stage'
]);
function need(value, message) { if (!value) throw fail('OPENAPI_WORKFLOW_INPUT', message, 400); }
function nativeDefinitions(values, names) {
  need(Array.isArray(values), 'Read the complete native definitions from the selected original Console.');
  const selected = new Map(values.map(value => [value.name, value]));
  return new Map(names.map(name => {
    const definition = selected.get(name);
    need(plain(definition) && definition.name === name && plain(definition.inputSchema),
      'The configured original host does not supply ' + name + '.');
    return [name, clone(definition)];
  }));
}
const pointer = key => '/' + key.replace(/~/g, '~0').replace(/\//g, '~1');
const valueType = value => value === null ? 'null' : Array.isArray(value) ? 'array' :
  Number.isSafeInteger(value) ? 'integer' : typeof value;
const input = (key, value, label, description = '') => ({
  pointer: pointer(key), label, description, type: valueType(value), required: true, default: clone(value)
});
const binding = (target, from, pointerValue, stepId) => ({
  target, from, ...(stepId ? { stepId } : {}), pointer: pointerValue
});
function step(definitions, id, name, tool, args, bindings, expect = [], pauseAfter = false) {
  return { id, name, tool, definition: definitions.get(tool), arguments: clone(args), bindings, expect, pauseAfter };
}
/**
 * request is the COMPLETE operator-authored original policy-review request.
 * No price, source mapping, policy, transport or authentication setting is inferred.
 * Large records remain original declared file handles in this request.
 */
export function createOpenApiMaintenanceRecipe({
  definitions, request, package: outputPackage, name = 'OpenAPI policy maintenance',
  description = 'Review the selected original policy and source, publish the reviewed package, and retain its complete customer export.'
} = {}) {
  need(plain(request) && alias.test(request.workspace ?? ''), 'Supply the complete original review request and workspace alias.');
  need(packageName.test(outputPackage ?? ''), 'Choose the new immutable original package name.');
  const originals = nativeDefinitions(definitions, OPENAPI_MAINTENANCE_TOOLS);
  const definition = originals.get(OPENAPI_MAINTENANCE_TOOLS[0]);
  const forbidden = new Set(['offset', 'limit']);
  need(Object.keys(request).every(key => Object.hasOwn(definition.inputSchema.properties, key) && !forbidden.has(key)),
    'Use only the native policy-review authoring fields; the recipe retains its complete review.');
  need(!Object.hasOwn(request, 'packageName'), 'The destination package name is a separate workflow input.');
  const authoring = clone(request);
  const fields = Object.keys(authoring);
  const inputs = fields.map(key => input(key, authoring[key], key === 'workspace' ? 'Original source workspace' : key,
    key.endsWith('File') ? 'Exact host-declared original file handle.' : 'Explicit original policy-review input.'));
  inputs.push(input('packageName', outputPackage, 'New package name', 'One immutable package; exact retries reopen the same publication.'));
  const sourceBindings = fields.map(key => binding(pointer(key), 'inputs', pointer(key)));
  const steps = [
    step(originals, 'review', 'Review the complete operating-policy change', OPENAPI_MAINTENANCE_TOOLS[0],
      authoring, sourceBindings, [{ pointer: '/review/schema', equals: 'stellar-forge.api-operation-policy-review.v1' }], true),
    step(originals, 'package', 'Publish the reviewed original package', OPENAPI_MAINTENANCE_TOOLS[1],
      { ...authoring, name: outputPackage, expectedReviewSha256: '0'.repeat(64) },
      [...sourceBindings, binding('/name', 'inputs', '/packageName'), binding('/expectedReviewSha256', 'step', '/review/sha256', 'review')],
      [{ pointer: '/native/state', oneOf: ['SAVED', 'REOPENED'] }]),
    step(originals, 'inspect', 'Reopen the complete saved package', OPENAPI_MAINTENANCE_TOOLS[2],
      { workspace: authoring.workspace, name: outputPackage },
      [binding('/workspace', 'inputs', '/workspace'), binding('/name', 'step', '/package/name', 'package')],
      [{ pointer: '/native/state', equals: 'PACKAGE_RETAINED' }]),
    step(originals, 'export', 'Retain every original customer package file', OPENAPI_MAINTENANCE_TOOLS[3],
      { workspace: authoring.workspace, name: outputPackage, expectedPackageManifestSha256: '0'.repeat(64) },
      [binding('/workspace', 'inputs', '/workspace'), binding('/name', 'step', '/package/name', 'package'),
       binding('/expectedPackageManifestSha256', 'step', '/native/manifestSha256', 'inspect')],
      [{ pointer: '/state', equals: 'EXPORTED' }])
  ];
  return sealWorkflowRecipe({ schema: WORKFLOW_RECIPE_SCHEMA, name, description, source: null, inputs, steps });
}
/** Receive a complete package through a destination's declared original delivery handle. */
export function createOpenApiReceivingRecipe({
  definitions, workspace, delivery, package: outputPackage, expectedManifestSha256, releaseId,
  name = 'OpenAPI package receiving',
  description = 'Receive the original complete package into this host, reopen its source and compiled identity, and optionally stage its selected release.'
} = {}) {
  need(alias.test(workspace ?? '') && alias.test(delivery ?? '') && packageName.test(outputPackage ?? '') &&
    sha.test(expectedManifestSha256 ?? ''), 'Select the destination workspace, declared delivery handle, package name and complete export manifest SHA256.');
  need(releaseId === undefined || alias.test(releaseId), 'Use the explicit original release ID when staging is selected.');
  const names = OPENAPI_RECEIVING_TOOLS.slice(0, releaseId === undefined ? 2 : 3);
  const originals = nativeDefinitions(definitions, names);
  const args = { workspace, delivery, name: outputPackage, expectedManifestSha256 };
  const inputs = [
    input('workspace', workspace, 'Destination workspace'), input('delivery', delivery, 'Declared package delivery'),
    input('packageName', outputPackage, 'Received package name'),
    input('expectedManifestSha256', expectedManifestSha256, 'Complete source export SHA256')
  ];
  const steps = [
    step(originals, 'receive', 'Receive the complete original package', names[0], args,
      [binding('/workspace', 'inputs', '/workspace'), binding('/delivery', 'inputs', '/delivery'),
       binding('/name', 'inputs', '/packageName'), binding('/expectedManifestSha256', 'inputs', '/expectedManifestSha256')],
      [{ pointer: '/native/state', equals: 'RECEIVED' }]),
    step(originals, 'inspect', 'Reopen every original package member', names[1],
      { workspace, name: outputPackage },
      [binding('/workspace', 'inputs', '/workspace'), binding('/name', 'step', '/native/name', 'receive')],
      [{ pointer: '/native/state', equals: 'PACKAGE_RETAINED' }])
  ];
  if (releaseId !== undefined) {
    inputs.push(input('releaseId', releaseId, 'Original release ID'));
    steps.push(step(originals, 'stage', 'Stage the received original release', names[2],
      { workspace, name: outputPackage, id: releaseId, expectedPackageManifestSha256: '0'.repeat(64) },
      [binding('/workspace', 'inputs', '/workspace'), binding('/name', 'step', '/native/name', 'receive'),
       binding('/id', 'inputs', '/releaseId'), binding('/expectedPackageManifestSha256', 'step', '/native/manifestSha256', 'inspect')],
      [{ pointer: '/native/state', equals: 'STAGED' }]));
  }
  return sealWorkflowRecipe({ schema: WORKFLOW_RECIPE_SCHEMA, name, description, source: null, inputs, steps });
}
