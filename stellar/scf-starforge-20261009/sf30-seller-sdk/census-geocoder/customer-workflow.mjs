// MIT. Retained customer intake runs under the original geocoder workspace writer.
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { bytes, digest, identity, readPrivate, readJson, privateDirectory, syncDirectory, fault, stamp } from '../postgres/publisher/files.mjs';
import { only, MAX_INPUT_BYTES, inputAddresses } from './source.mjs';
import { writeExact } from './edition.mjs';
import { CUSTOMER_SOURCE_SCHEMA, CUSTOMER_MAPPING_SCHEMA, CUSTOMER_BINDING_SCHEMA,
  customerSource, compileCustomer, customerPreview, verifyCustomerBinding } from './customer-intake.mjs';

const lists = ['customerSources', 'customerMappings', 'customerBindings', 'customerBatchOperations'];
export function initializeCustomerState(state) {
  for (const name of lists) {
    state[name] ??= [];
    if (!Array.isArray(state[name])) throw fault('GEOCODER_WORKSPACE_INVALID');
  }
}
export function createCustomerWorkflow({ directory, state, save, key, selectBatch, batchInputs, createBatch }) {
  const root = join(directory, 'customer');
  const folder = (kind, id) => join(root, kind, key(id));
  const choose = (list, id) => {
    const found = state[list].find(value => value.id === key(id));
    if (!found) throw fault('GEOCODER_CUSTOMER_NOT_FOUND', 'Select a retained customer source or mapping.', 404);
    return found;
  };
  const sourceDeclaration = item => ({ schema: CUSTOMER_SOURCE_SCHEMA, id: item.id, createdAt: item.createdAt,
    label: item.label, header: item.header, inputSha256: item.inputSha256, inputBytes: item.inputBytes,
    rowCount: item.rowCount, columns: item.columns });
  async function readSource(id) {
    const item = choose('customerSources', id), path = folder('sources', id);
    if (item.state !== 'COMPLETE') throw fault('GEOCODER_CUSTOMER_SOURCE_INCOMPLETE', 'Retain the same original file again to finish its existing source operation.');
    const original = await readPrivate(join(path, 'input.csv'), MAX_INPUT_BYTES);
    const declaration = await readJson(join(path, 'source.json'), 1024 * 1024), parsed = customerSource(original, { header: item.header });
    if (identity(declaration) !== identity(sourceDeclaration(item)) || parsed.inputSha256 !== item.inputSha256 ||
        parsed.inputBytes !== item.inputBytes || parsed.rowCount !== item.rowCount || identity(parsed.columns) !== identity(item.columns))
      throw fault('GEOCODER_CUSTOMER_SOURCE_CHANGED');
    return { item, parsed, declaration };
  }
  async function source(input) {
    only(input, ['label', 'inputText', 'header']);
    if (typeof input.label !== 'string' || !input.label.trim() || input.label.length > 128 || /[\x00-\x1f\x7f]/.test(input.label))
      throw fault('GEOCODER_CUSTOMER_LABEL', 'Enter a customer file label of 1–128 characters.');
    if (typeof input.inputText !== 'string') throw fault('GEOCODER_INPUT_CSV');
    const original = Buffer.from(input.inputText, 'utf8'), parsed = customerSource(original, { header: input.header ?? true });
    const operation = identity({ label: input.label, header: parsed.header, sourceSha256: parsed.inputSha256 });
    let item = state.customerSources.find(value => value.operation === operation);
    if (!item) {
      item = { id: randomUUID(), operation, createdAt: stamp(), label: input.label, state: 'PREPARING',
        header: parsed.header, inputSha256: parsed.inputSha256, inputBytes: parsed.inputBytes,
        rowCount: parsed.rowCount, columns: parsed.columns };
      state.customerSources.push(item); await save();
    }
    if (item.state === 'COMPLETE') { await readSource(item.id); return structuredClone(item); }
    const path = folder('sources', item.id); await privateDirectory(path, true);
    await writeExact(join(path, 'input.csv'), original); await writeExact(join(path, 'source.json'), bytes(sourceDeclaration(item)));
    await syncDirectory(path); item.state = 'COMPLETE'; await save();
    return structuredClone(item);
  }
  async function readMapping(id, { ready = false } = {}) {
    const item = choose('customerMappings', id);
    if (!['READY', 'REVIEW_REQUIRED'].includes(item.state)) throw fault('GEOCODER_CUSTOMER_MAPPING_INCOMPLETE', 'Save the same mapping again to finish its existing operation.');
    const mapping = await readJson(join(folder('mappings', id), 'mapping.json'), 2 * 1024 * 1024);
    const source = await readSource(item.sourceId), compiled = compileCustomer(source.parsed, mapping.plan);
    if (mapping.schema !== CUSTOMER_MAPPING_SCHEMA || mapping.id !== item.id || mapping.sourceId !== item.sourceId ||
        mapping.sourceSha256 !== source.parsed.inputSha256 || mapping.sourceHeader !== source.parsed.header ||
        digest(bytes(mapping)) !== item.mappingSha256 || mapping.reviewSha256 !== item.reviewSha256 ||
        compiled.reviewSha256 !== item.reviewSha256 || identity(compiled.summary) !== identity(item.summary) ||
        identity(mapping.summary) !== identity(item.summary))
      throw fault('GEOCODER_CUSTOMER_MAPPING_CHANGED');
    if (ready && (!compiled.summary.ready || item.state !== 'READY'))
      throw fault('GEOCODER_CUSTOMER_REVIEW_REQUIRED', 'Correct or explicitly exclude every invalid address before creating or binding a batch.');
    return { item, source, mapping, compiled };
  }
  async function preview(input) {
    only(input, ['sourceId', 'plan', 'offset', 'limit', 'filter']);
    const original = await readSource(input.sourceId), compiled = compileCustomer(original.parsed, input.plan);
    return { sourceId: original.item.id, ...customerPreview(compiled, input) };
  }
  async function mapping(input) {
    only(input, ['sourceId', 'plan', 'expectedReviewSha256']);
    const source = await readSource(input.sourceId), compiled = compileCustomer(source.parsed, input.plan);
    if (compiled.reviewSha256 !== input.expectedReviewSha256)
      throw fault('GEOCODER_CUSTOMER_REVIEW_CHANGED', 'Preview the current file, mapping and row decisions before saving.');
    const operation = identity({ sourceId: source.item.id, reviewSha256: compiled.reviewSha256 });
    let item = state.customerMappings.find(value => value.operation === operation);
    if (!item) {
      item = { id: randomUUID(), operation, createdAt: stamp(), sourceId: source.item.id,
        sourceSha256: source.parsed.inputSha256, state: 'PREPARING', reviewSha256: compiled.reviewSha256,
        summary: compiled.summary, mappingSha256: null };
      state.customerMappings.push(item); await save();
    }
    const declaration = { schema: CUSTOMER_MAPPING_SCHEMA, id: item.id, createdAt: item.createdAt,
      sourceId: item.sourceId, sourceSha256: item.sourceSha256, sourceHeader: source.parsed.header,
      reviewSha256: item.reviewSha256, summary: item.summary, plan: compiled.plan };
    const path = folder('mappings', item.id); await privateDirectory(path, true);
    await writeExact(join(path, 'mapping.json'), bytes(declaration));
    if (compiled.submitted) await writeExact(join(path, 'submitted.csv'), compiled.submitted);
    await syncDirectory(path);
    item.mappingSha256 = digest(bytes(declaration)); item.state = compiled.summary.ready ? 'READY' : 'REVIEW_REQUIRED'; await save();
    return structuredClone(item);
  }
  async function inspect(input) {
    only(input, ['mappingId', 'sourceId', 'offset', 'limit', 'filter']);
    if (input.mappingId) {
      if (input.sourceId !== undefined) throw fault('GEOCODER_CUSTOMER_SELECTION');
      const saved = await readMapping(input.mappingId);
      return { mapping: structuredClone(saved.item), source: structuredClone(saved.source.item),
        plan: { idMode: saved.compiled.plan.idMode, columns: saved.compiled.plan.columns, outputPrefix: saved.compiled.plan.outputPrefix,
          correctionCount: saved.compiled.plan.corrections.length, exclusionCount: saved.compiled.plan.exclusions.length },
        ...customerPreview(saved.compiled, input) };
    }
    const original = await readSource(input.sourceId);
    return { source: structuredClone(original.item) };
  }
  const verifyReview = (saved, input) => {
    if (input.expectedReviewSha256 !== saved.item.reviewSha256) throw fault('GEOCODER_CUSTOMER_REVIEW_CHANGED');
  };
  async function bindMapping(saved, batch) {
    const inputs = await batchInputs(batch);
    if (identity(inputAddresses(inputs.submitted).records) !== saved.compiled.addressRecordsSha256)
      throw fault('GEOCODER_CUSTOMER_BATCH_MISMATCH', 'The mapped address records must equal every retained submitted record, in the same order.');
    let item = state.customerBindings.find(value => value.mappingId === saved.item.id && value.batchId === batch.id);
    if (!item) {
      item = { id: randomUUID(), mappingId: saved.item.id, batchId: batch.id, state: 'PREPARING', createdAt: stamp() };
      state.customerBindings.push(item); await save();
    }
    const binding = { schema: CUSTOMER_BINDING_SCHEMA, id: item.id, createdAt: item.createdAt,
      mappingId: saved.item.id, sourceId: saved.item.sourceId, sourceSha256: saved.item.sourceSha256,
      mappingSha256: saved.item.mappingSha256, batchId: batch.id, submittedSha256: batch.input.submittedSha256,
      addressRecordsSha256: saved.compiled.addressRecordsSha256 };
    const path = folder('bindings', item.id); await privateDirectory(path, true);
    await writeExact(join(path, 'binding.json'), bytes(binding)); await syncDirectory(path);
    item.bindingSha256 = digest(bytes(binding)); item.state = 'COMPLETE'; await save();
    return structuredClone(item);
  }
  async function bind(input) {
    only(input, ['mappingId', 'batchId', 'expectedReviewSha256']);
    const saved = await readMapping(input.mappingId, { ready: true }); verifyReview(saved, input);
    return bindMapping(saved, selectBatch(input.batchId));
  }
  async function batch(input) {
    only(input, ['mappingId', 'expectedReviewSha256', 'label', 'discoveryId', 'vintagesId', 'benchmark', 'vintage', 'returnType']);
    const saved = await readMapping(input.mappingId, { ready: true }); verifyReview(saved, input);
    const operation = identity(input);
    let retained = state.customerBatchOperations.find(value => value.operation === operation);
    if (!retained) {
      retained = { id: randomUUID(), operation, mappingId: saved.item.id, batchId: randomUUID(), createdAt: stamp(), state: 'PREPARING' };
      state.customerBatchOperations.push(retained); await save();
    }
    const { mappingId, expectedReviewSha256, ...selection } = input;
    const original = await createBatch({ ...selection, inputText: saved.compiled.submitted.toString('utf8'), header: false },
      { id: retained.batchId, createdAt: retained.createdAt });
    const binding = await bindMapping(saved, original);
    retained.state = 'COMPLETE'; retained.bindingId = binding.id; await save();
    return { batch: original, mapping: structuredClone(saved.item), binding };
  }
  async function forEdition(mappingId, batch) {
    const saved = await readMapping(mappingId, { ready: true });
    const item = state.customerBindings.find(value => value.mappingId === mappingId && value.batchId === batch.id && value.state === 'COMPLETE');
    if (!item) throw fault('GEOCODER_CUSTOMER_BINDING_REQUIRED', 'Bind this saved mapping to the review’s exact batch before building a customer edition.');
    const binding = await readJson(join(folder('bindings', item.id), 'binding.json'), 65536);
    if (binding.id !== item.id || binding.mappingId !== item.mappingId || binding.batchId !== item.batchId ||
        digest(bytes(binding)) !== item.bindingSha256) throw fault('GEOCODER_CUSTOMER_BINDING_CHANGED');
    const inputs = await batchInputs(batch), bundle = { source: saved.source.parsed, mapping: saved.mapping, binding };
    verifyCustomerBinding(bundle, batch, inputs.submitted); return bundle;
  }
  async function download(kind, id) {
    if (kind === 'customer-input') {
      const saved = await readSource(id);
      return { bytes: saved.parsed.original, filename: 'customer-' + id + '.csv', contentType: 'text/csv; charset=utf-8' };
    }
    const saved = await readMapping(id);
    if (kind === 'customer-mapping') return { bytes: bytes(saved.mapping), filename: 'customer-mapping-' + id + '.json', contentType: 'application/json' };
    if (kind !== 'customer-submitted' || !saved.compiled.submitted) throw fault('GEOCODER_CUSTOMER_REVIEW_REQUIRED');
    return { bytes: saved.compiled.submitted, filename: 'customer-addresses-' + id + '.csv', contentType: 'text/csv; charset=utf-8' };
  }
  const actions = { source, preview, mapping, inspect, batch, bind };
  return { forEdition, download, async act(action, input) {
    const execute = actions[action];
    if (!Object.hasOwn(actions, action)) throw fault('GEOCODER_ACTION_UNKNOWN');
    return execute(input);
  } };
}
