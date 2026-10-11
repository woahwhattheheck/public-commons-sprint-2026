// MIT. Weather products on original SF88 preparation, review, execution and recovery.
import { join, resolve } from 'node:path';
import { prepareReview } from '../../sf88-operator-buyer-cli/prepare.mjs';
import { privateDirectory, readBytes, readJson, writeBytes, writeJson, jsonBytes, exists } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { verifyWeatherCatalog, readWeatherProduct } from './merchant.mjs';
import { digest } from './source.mjs';
import { id, need, object } from './config.mjs';

export const PURCHASE_SCHEMA = 'stellar-forge.tomorrow-purchase.v1';
const same = (a, b) => digest(jsonBytes(a)) === digest(jsonBytes(b));

/** A binding to original operations, not a second purchase journal. */
export class WeatherPurchase {
  constructor({ buyer, workspace, directory }) {
    need(buyer && typeof buyer.fromConfig === 'function' && typeof buyer.operation === 'function', 'WEATHER_ORIGINAL_BUYER_REQUIRED');
    this.buyer = buyer; this.workspace = workspace; this.directory = resolve(directory);
  }
  static async prepare({ buyer, workspace, directory, product, catalogBytes, purchaseId, acceptIndices, operatorProfile } = {}) {
    id(purchaseId);
    const verified = verifyWeatherCatalog(product, catalogBytes);
    need(object(acceptIndices), 'WEATHER_EXPLICIT_ACCEPT_INDICES_REQUIRED');
    const edition = verified.product.payload.handover.payload.editions[0], view = await workspace.view();
    need(view.plan.usage.mode === 'licensed-service' && view.plan.usage.exportRaw &&
      view.plan.usage.licenseReference === edition.usage.licenseReference, 'WEATHER_IMPORT_LICENSE_CONFIGURATION_REQUIRED');
    need(Date.now() < Date.parse(edition.rawExpiresAt), 'WEATHER_RETENTION_EXPIRED');
    const items = verified.rows.map(row => {
      const acceptIndex = acceptIndices[row.kind];
      need(Number.isSafeInteger(acceptIndex) && acceptIndex >= 0, 'WEATHER_EXPLICIT_ACCEPT_INDICES_REQUIRED');
      const intentId = id(purchaseId + '-' + row.kind);
      // Prepare every draft before creating state. Original code validates the selected terms.
      prepareReview(catalogBytes, { rowIndex: row.rowIndex, acceptIndex, intentId,
        url: row.url, method: 'GET', responseOut: join(resolve(directory), intentId + '.bin') });
      return { ...row, acceptIndex, intentId };
    });
    const binding = { schema: PURCHASE_SCHEMA, purchaseId, workspaceId: view.workspaceId, editionId: edition.id,
      productSha256: verified.product.sha256, catalogSha256: digest(catalogBytes), items };
    directory = await privateDirectory(resolve(directory));
    const bindingPath = join(directory, 'purchase.json');
    if (await exists(bindingPath)) need(same(await readJson(bindingPath, 1048576), binding), 'WEATHER_PURCHASE_BINDING_CHANGED');
    else {
      // Exact public inputs survive a stop before any original operation is prepared.
      for (const [name, bytes] of [['weather-product.json', jsonBytes(verified.product)], ['catalog.json', catalogBytes]]) {
        const path = join(directory, name);
        if (await exists(path)) need(digest(await readBytes(path, 16777216)) === digest(bytes), 'WEATHER_PURCHASE_BINDING_CHANGED');
        else await writeBytes(path, bytes, { exclusive: true });
      }
      await writeJson(bindingPath, binding, { exclusive: true });
    }
    await workspace.importHandover(verified.product.payload.handover);
    const purchase = new WeatherPurchase({ buyer, workspace, directory });
    await purchase.continuePreparation({ operatorProfile });
    return purchase;
  }
  static async open(options) {
    const purchase = new WeatherPurchase(options); await purchase._inputs(); return purchase;
  }
  async _inputs() {
    const binding = await readJson(join(this.directory, 'purchase.json'), 1048576);
    need(binding.schema === PURCHASE_SCHEMA, 'WEATHER_PURCHASE_INVALID');
    const product = readWeatherProduct(await readBytes(join(this.directory, 'weather-product.json'), 16777216));
    const catalogBytes = await readBytes(join(this.directory, 'catalog.json'), 1048576);
    const verified = verifyWeatherCatalog(product, catalogBytes), view = await this.workspace.view();
    need(product.sha256 === binding.productSha256 && digest(catalogBytes) === binding.catalogSha256 &&
      view.workspaceId === binding.workspaceId && Array.isArray(binding.items) && binding.items.length === verified.rows.length,
      'WEATHER_PURCHASE_BINDING_CHANGED');
    for (const row of verified.rows) {
      const item = binding.items.find(value => value.kind === row.kind);
      need(item && same(Object.fromEntries(Object.keys(row).map(key => [key, item[key]])), row) &&
        item.intentId === binding.purchaseId + '-' + row.kind &&
        Number.isSafeInteger(item.acceptIndex) && item.acceptIndex >= 0, 'WEATHER_PURCHASE_BINDING_CHANGED');
    }
    return { binding, product, catalogBytes };
  }
  async _original(item, inputs) {
    const operation = this.buyer.operation(item.intentId);
    const configBytes = await readBytes(operation.configPath, 65536);
    const config = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(configBytes));
    const prepared = prepareReview(inputs.catalogBytes, { rowIndex: item.rowIndex, acceptIndex: item.acceptIndex,
      intentId: item.intentId, url: item.url, method: 'GET', responseOut: join(this.directory, item.intentId + '.bin') });
    need(same(config.operation, prepared.draft.operation) && same(config.preparedFrom, prepared.draft.preparedFrom) &&
      config.responseFile?.expectedSha256 === item.sha256 && config.responseFile?.expectedBytes === item.bytes &&
      config.responseFile?.expectedContentType === item.contentType, 'WEATHER_ORIGINAL_REQUEST_CHANGED');
    return operation;
  }
  async continuePreparation({ operatorProfile } = {}) {
    const inputs = await this._inputs();
    for (const item of inputs.binding.items) {
      const operation = this.buyer.operation(item.intentId);
      if (!await exists(operation.configPath)) {
        const prepared = prepareReview(inputs.catalogBytes, { rowIndex: item.rowIndex, acceptIndex: item.acceptIndex,
          intentId: item.intentId, url: item.url, method: 'GET', responseOut: join(this.directory, item.intentId + '.bin') });
        await this.buyer.fromConfig(prepared.draft, { operatorProfile });
      }
      await this._original(item, inputs);
    }
    return { purchaseId: inputs.binding.purchaseId, prepared: inputs.binding.items.map(item => ({ kind: item.kind, intentId: item.intentId })) };
  }
  /** Original handles remain available for SDK-native recovery and account inspection. */
  async original() {
    const inputs = await this._inputs(), operations = {};
    for (const item of inputs.binding.items) operations[item.kind] = await this._original(item, inputs);
    return operations;
  }
  async review() {
    const inputs = await this._inputs(), reviews = {};
    for (const item of inputs.binding.items) reviews[item.kind] = await (await this._original(item, inputs)).review();
    const review = { purchaseId: inputs.binding.purchaseId, productSha256: inputs.product.sha256,
      catalogSha256: inputs.binding.catalogSha256, editionId: inputs.binding.editionId,
      resources: inputs.binding.items, originalReviews: reviews };
    return { ...review, reviewSha256: digest(jsonBytes(review)) };
  }
  async _adopt(item, result, inputs) {
    return this.workspace.adoptBuyerResult(item.editionId, item.kind, result,
      { intentId: item.intentId, productSha256: inputs.product.sha256 });
  }
  async execute({ review, signal } = {}) {
    const inputs = await this._inputs();
    need(object(review), 'WEATHER_PURCHASE_REVIEW_REQUIRED');
    const { reviewSha256, ...reviewed } = review;
    need(reviewSha256 === digest(jsonBytes(reviewed)) && review.productSha256 === inputs.product.sha256 &&
      review.purchaseId === inputs.binding.purchaseId && review.catalogSha256 === inputs.binding.catalogSha256 &&
      same(review.resources, inputs.binding.items), 'WEATHER_PURCHASE_REVIEW_CHANGED');
    const edition = inputs.product.payload.handover.payload.editions[0];
    need(Date.now() < Date.parse(edition.rawExpiresAt), 'WEATHER_RETENTION_EXPIRED');
    const deliveries = [];
    for (const item of inputs.binding.items) {
      need(!signal?.aborted, 'WEATHER_PURCHASE_CANCELLED');
      const operation = await this._original(item, inputs);
      // Original recovery is read-only and never retries an uncertain purchase.
      const saved = await operation.recover();
      const result = saved ?? await operation.execute({ review: review.originalReviews[item.kind], signal });
      deliveries.push(await this._adopt(item, result, inputs));
    }
    return { purchaseId: inputs.binding.purchaseId, deliveries, edition: await this.workspace.editionView(inputs.binding.editionId) };
  }
  async recover() {
    const inputs = await this._inputs(), deliveries = [], pending = [];
    for (const item of inputs.binding.items) {
      const operation = await this._original(item, inputs), result = await operation.recover();
      if (result) deliveries.push(await this._adopt(item, result, inputs));
      else pending.push({ kind: item.kind, intentId: item.intentId });
    }
    return { purchaseId: inputs.binding.purchaseId, deliveries, pending,
      edition: await this.workspace.editionView(inputs.binding.editionId) };
  }
  async export({ includeRaw = true } = {}) {
    const inputs = await this._inputs();
    const handover = await this.workspace.handover({ editionIds: [inputs.binding.editionId], includeRaw });
    return { purchaseId: inputs.binding.purchaseId, productSha256: inputs.product.sha256, handover };
  }
}
