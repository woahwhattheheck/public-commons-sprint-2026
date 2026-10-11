// MIT. Typed consumption of original BuyerResult or retained native provider capture.
import { resolve } from 'node:path';
import { readMarketResponse } from './source.mjs';
import { CONTRACT, object, fail, compileMarketPlan, productFor, bindMarketQuery } from './config.mjs';
import { readBundle, publishBundle, jsonBytes, digest, readBytes } from './files.mjs';

export const DELIVERY_SCHEMA = 'stellar-forge.twelvedata-delivery.v1';
const copy = value => JSON.parse(JSON.stringify(value));
const parse = bytes => JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
const quote = value => '"' + String(value).replaceAll('"','""') + '"';

/** There is no price calculation or date conversion in this consumer. */
export class MarketDataDelivery {
  constructor(bytes, provenance, attachments = []) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength>1048576 || !object(provenance) ||
        !object(provenance.query)) fail('MARKET_DELIVERY_INPUT_INVALID');
    this._bytes = Buffer.from(bytes);
    this._provenance = copy(provenance);
    this._parsed = readMarketResponse(provenance.endpoint, provenance.query, this._bytes);
    this._attachments = attachments.map(([name, body]) => [name, Buffer.from(body)]);
  }
  get identity() {
    return digest(jsonBytes({ responseSha256: digest(this._bytes), provenance: this._provenance,
      attachments:this._attachments.map(([name,bytes])=>({name,sha256:digest(bytes)})) }));
  }
  get metadata() {
    return { schema: DELIVERY_SCHEMA, identity: this.identity,
      source: copy(this._provenance), semantics: copy(this._parsed.semantics),
      providerMetadata: copy(this._parsed.metadata), responseBytes: this._bytes.length,
      responseSha256: digest(this._bytes), records: this._parsed.rows.length };
  }
  /** Offset/limit is local paging over exactly the retained response. */
  rows({ offset = 0, limit = 100 } = {}) {
    if (!Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 5000) fail('MARKET_LOCAL_PAGE_INVALID');
    return {
      offset, returned: Math.min(limit, Math.max(0,this._parsed.rows.length-offset)),
      total: this._parsed.rows.length, records: copy(this._parsed.rows.slice(offset,offset+limit)),
      semantics: copy(this._parsed.semantics),
    };
  }
  json() { return copy(this._parsed.value); }
  bytes() { return Buffer.from(this._bytes); }
  async export(directory) {
    const rows = this._parsed.rows;
    const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
    const missing = [], nulls = [];
    const lines = rows.map((row,index) => columns.map(name => {
      if (!Object.hasOwn(row,name)) { missing.push([index,name]); return '""'; }
      const value = row[name];
      if (value === null) { nulls.push([index,name]); return '""'; }
      return quote(typeof value === 'object' ? JSON.stringify(value) : value);
    }).join(','));
    const csv = [columns.map(quote).join(','), ...lines].join('\r\n') + '\r\n';
    const jsonl = rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
    return publishBundle(resolve(directory), DELIVERY_SCHEMA, this.identity, [
      ['response.json', this._bytes],
      ['metadata.json', jsonBytes(this.metadata)],
      ['records.jsonl', jsonl],
      ['records.csv', csv],
      ['csv-semantics.json', jsonBytes({ schema:'stellar-forge.twelvedata-csv.v1',
        columns, nullCells:nulls, absentCells:missing,
        nestedValues:'JSON text; scalar decimal strings are unchanged.',
        authoritativeValues:'response.json and records.jsonl preserve JSON types, nulls and absence.',
        spreadsheetHandling:'Import as text to preserve prices, identifiers and leading zeroes; no formulas are generated.',
      })],
      ...this._attachments,
    ], { source: copy(this._provenance), semantics: copy(this._parsed.semantics), contract: CONTRACT });
  }
  /** A successful original attempt is required; this never creates or retries it. */
  static async fromBuyerResult(result, { endpoint, query, usage } = {}) {
    if (!result || typeof result.raiseForStatus !== 'function' ||
        typeof result.bytes !== 'function' || !object(result.native)) fail('MARKET_ORIGINAL_BUYER_RESULT_REQUIRED');
    result.raiseForStatus();
    const bytes = await result.bytes({limit:1048576});
    if (result.delivery?.sha256 !== digest(bytes)) fail('MARKET_BUYER_RESPONSE_CHANGED');
    const native = jsonBytes(result.record);
    return new MarketDataDelivery(bytes, {
      kind:'ORIGINAL_SF88_BUYER_RESULT', endpoint, query,
      nativeStatus:result.status, httpStatus:result.native.httpStatus,
      nativeResultSha256:digest(native), responseSha256:digest(bytes),
      ...(usage === undefined ? {} : { usage }),
    }, [['original-buyer-result.json',native]]);
  }
  /** Reopen a completed original customer operation; never execute or replace it. */
  static async fromOperation(operation,{plan:raw,productId}) {
    const plan=compileMarketPlan(raw),product=productFor(plan,productId);
    const result=await operation.recover();
    if (!result) fail('MARKET_BUYER_RESULT_UNAVAILABLE','The original operation has no completed recoverable result');
    const configBytes=await readBytes(operation.configPath,65536);
    if (digest(configBytes)!==result.record.configSha256) fail('MARKET_BUYER_REQUEST_CHANGED');
    const config=parse(configBytes),url=new URL(config.operation.url);
    if (config.operation.method!=='GET' || url.pathname!==product.path) fail('MARKET_BUYER_PRODUCT_MISMATCH');
    const query=bindMarketQuery(product,url.searchParams);
    const delivery=await MarketDataDelivery.fromBuyerResult(result,{
      endpoint:product.endpoint,query,usage:plan.usage,
    });
    const planBytes=jsonBytes(plan);
    delivery._attachments.push(['original-merchant-plan.json',planBytes],
      ['original-buyer-request.json',jsonBytes({intentId:operation.intentId,method:'GET',
        url:url.href,planSha256:digest(planBytes),configSha256:digest(configBytes)})]);
    return delivery;
  }
  static async fromCapture(directory) {
    const capture = await readBundle(directory, {schema:'stellar-forge.twelvedata-capture.v1'});
    const report = parse(capture.files.get('capture.json'));
    if (report.state !== 'COMPLETE' || report.observation.status !== 200 ||
        report.observation.bodyOrigin !== 'TWELVE_DATA_NATIVE_JSON') fail('MARKET_CAPTURE_NOT_SUCCESSFUL');
    const request = parse(capture.files.get('request.json'));
    return new MarketDataDelivery(capture.files.get('response.json'), {
      kind:'OPERATOR_PROVIDER_CAPTURE', captureId:request.captureId,
      acquisitionKind:report.observation.acquisitionKind??'ORIGINAL_SF30_TRANSPORT',
      captureManifestSha256:capture.manifestSha256,
      endpoint:report.observation.endpoint, query:report.observation.query,
      providerUrl:report.observation.providerUrl,
      startedAt:report.observation.startedAt, receivedAt:report.observation.finishedAt,
      retainedUntil:report.retainedUntil, usage:request.plan.usage,
      headers:report.headers,
    }, [['original-capture.json',capture.files.get('capture.json')],
      ['original-request.json',capture.files.get('request.json')],
      ...[...capture.files].filter(([name])=>name==='original-http-observation.json')]);
  }
  static async open(directory) {
    const bundle = await readBundle(directory, {schema:DELIVERY_SCHEMA});
    const metadata = parse(bundle.files.get('metadata.json'));
    const delivery = new MarketDataDelivery(bundle.files.get('response.json'),metadata.source,
      [...bundle.files].filter(([name]) => name.startsWith('original-')));
    if (delivery.identity !== bundle.manifest.identity ||
        metadata.responseSha256 !== digest(delivery._bytes)) fail('MARKET_DELIVERY_IDENTITY_CHANGED');
    return delivery;
  }
}
