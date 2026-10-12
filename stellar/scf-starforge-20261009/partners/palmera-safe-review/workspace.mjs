// MIT. One original SF88 intent, one Tenderly result, and the existing analysis store.
import { join } from 'node:path';
import { absolute, need, digest, jsonBytes, parseJson, readBytes, readJson, exists
} from '../../sf88-operator-buyer-cli/node/store.mjs';
import { TenderlyCustomer } from '../tenderly-stellar-pilot/customer/client.mjs';
import { normalizeSelection } from '../tenderly-stellar-pilot/customer/selection.mjs';
import { equalExpected } from '../tenderly-stellar-pilot/customer/contract.mjs';
import { compareCaptures, saveReview } from '../../sf88-operator-buyer-cli/tenderly-analysis/library.mjs';
import { openSelection, receiveSelection, exactWrite, describeSelection } from './transaction.mjs';
import { openPreparedPurchase } from './preparation.mjs';
import { exportHandover } from './handover.mjs';

const BINDING='safe-review.json';
const SCHEMA='stellar-forge.safe-simulation-buyer.v1';
export const REVIEW_SCHEMA='stellar-forge.safe-simulation-purchase-review.v1';
async function merchantSelection(value) {
  need(value!==undefined,'SAFE_ORIGINAL_MERCHANT_SELECTION_REQUIRED');
  return normalizeSelection(typeof value==='string'?await readJson(absolute(value)):value);
}
async function nativeInput(operation) {
  const bytes=await readBytes(operation.original.configPath),config=parseJson(bytes);
  need(config.operation?.intentId===operation.intentId&&config.operation.method==='POST'&&
    typeof config.operation.bodyFile==='string','SAFE_ORIGINAL_BUYER_POST_REQUIRED');
  const body=await readBytes(absolute(config.operation.bodyFile),1048576);
  return {config,configSha256:digest(bytes),body,bodySha256:digest(body)};
}
/** The original customer owns runtime, operator settings, attempt state and payment. */
export class SafeSimulationBuyer {
  constructor({analysisWorkspace,...options}) {
    this.customer=new TenderlyCustomer(options);
    this.analysisWorkspace=analysisWorkspace===undefined?undefined:absolute(analysisWorkspace);
  }
  operation(intentId) { return new SafeSimulationOperation(this,this.customer.operation(intentId)); }
  async fromPrepared(directory,options={}) {
    const prepared=await openPreparedPurchase(directory);
    return this.fromConfig(prepared.configFile,{...options,selectionDirectory:prepared.selectionDirectory,
      merchantSelection:prepared.merchantSelection});
  }
  async fromConfig(input,{selectionDirectory,merchantSelection:merchantInput,operatorProfile,
    signal,requestTimeoutMs,responseFile}={}) {
    const selected=await openSelection(selectionDirectory),merchant=await merchantSelection(merchantInput);
    const config=typeof input==='string'?parseJson(await readBytes(absolute(input))):parseJson(jsonBytes(input));
    need(merchant.networkId===selected.expected.networkId&&config.operation?.url===merchant.resource&&
      config.operation?.method==='POST'&&typeof config.operation.bodyFile==='string',
      'SAFE_SELECTED_MERCHANT_MISMATCH');
    const inputBody=await readBytes(absolute(config.operation.bodyFile),1048576);
    need(inputBody.equals(selected.bytes['simulation.json']),'SAFE_EXACT_SELECTED_REQUEST_REQUIRED');
    const operation=await this.customer.fromConfig(config,{operatorProfile,signal,requestTimeoutMs,responseFile,
      body:selected.bytes['simulation.json'],expected:selected.expected,networkId:selected.expected.networkId,
      selection:merchant});
    return this._attach(operation,selected,merchant);
  }
  /** Finish an interrupted binding on the existing prepared intent; creates no purchase. */
  async attach(intentId,{selectionDirectory,merchantSelection:merchantInput}={}) {
    const selected=await openSelection(selectionDirectory),merchant=await merchantSelection(merchantInput);
    const existing=this.customer.operation(intentId),native=await nativeInput(existing);
    need(native.body.equals(selected.bytes['simulation.json'])&&merchant.networkId===selected.expected.networkId&&
      native.config.operation.url===merchant.resource,'SAFE_EXACT_SELECTED_REQUEST_REQUIRED');
    const operation=await this.customer.attach(intentId,{expected:selected.expected,
      networkId:selected.expected.networkId,selection:merchant});
    return this._attach(operation,selected,merchant);
  }
  async _attach(operation,selected,merchant) {
    const native=await nativeInput(operation);
    need(native.body.equals(selected.bytes['simulation.json'])&&native.config.operation.url===merchant.resource&&
      selected.expected.networkId===merchant.networkId,'SAFE_NATIVE_BINDING_MISMATCH');
    const retained=await receiveSelection(selected.directory,join(operation.directory,'safe-selection'));
    const binding={schema:SCHEMA,intentId:operation.intentId,selectionId:retained.id,
      configSha256:native.configSha256,bodySha256:native.bodySha256,merchant};
    await exactWrite(join(operation.directory,BINDING),jsonBytes(binding));
    return new SafeSimulationOperation(this,operation);
  }
  async *list() {
    for await(const operation of this.customer.list())
      if(await exists(join(operation.directory,BINDING)))
        yield new SafeSimulationOperation(this,operation);
  }
  async compare(beforeIntentId,afterIntentId,{title='',notes='',workspace=this.analysisWorkspace}={}) {
    workspace=absolute(workspace);
    const before=this.operation(beforeIntentId),after=this.operation(afterIntentId);
    const a=await before.selection(),b=await after.selection();
    need(a.record.identity.address.toLowerCase()===b.record.identity.address.toLowerCase()&&
      a.expected.networkId===b.expected.networkId,'SAFE_COMPARISON_IDENTITY_MISMATCH');
    const beforeResult=await before.recover(),afterResult=await after.recover();
    need(beforeResult&&afterResult,'SAFE_COMPLETE_RESULTS_REQUIRED');
    const first=await beforeResult.analyze({workspace}),second=await afterResult.analyze({workspace});
    const comparison=await compareCaptures(workspace,first.record.id,second.record.id);
    const saved=await saveReview(workspace,{beforeId:first.record.id,afterId:second.record.id,title,notes});
    return {schema:'stellar-forge.safe-simulation-comparison.v1',
      before:{intentId:beforeIntentId,selection:describeSelection(a),captureId:first.record.id},
      after:{intentId:afterIntentId,selection:describeSelection(b),captureId:second.record.id},
      comparison:comparison.comparison,review:saved};
  }
}
export class SafeSimulationOperation {
  constructor(client,original) {
    this.client=client;this.original=original;this.intentId=original.intentId;this.directory=original.directory;
  }
  async _binding() {
    const binding=await readJson(join(this.directory,BINDING));
    const selected=await openSelection(join(this.directory,'safe-selection'));
    const native=await nativeInput(this.original),merchant=await merchantSelection(binding.merchant);
    need(binding.schema===SCHEMA&&binding.intentId===this.intentId&&binding.selectionId===selected.id&&
      binding.configSha256===native.configSha256&&binding.bodySha256===native.bodySha256&&
      native.body.equals(selected.bytes['simulation.json'])&&merchant.networkId===selected.expected.networkId&&
      merchant.resource===native.config.operation.url,'SAFE_NATIVE_REQUEST_CHANGED');
    return {binding,selected,native};
  }
  async selection() { return (await this._binding()).selected; }
  async review() {
    const {binding,selected}=await this._binding(),original=await this.original.review();
    need(original.configSha256===binding.configSha256&&original.bodySha256===binding.bodySha256&&
      equalExpected(original.tenderly,selected.expected),'SAFE_NATIVE_REVIEW_MISMATCH');
    return {schema:REVIEW_SCHEMA,intentId:this.intentId,selectionId:selected.id,
      configSha256:binding.configSha256,bodySha256:binding.bodySha256,
      safe:describeSelection(selected),merchant:binding.merchant,original};
  }
  async execute({review,signal}={}) {
    const {binding,selected}=await this._binding();
    need(review?.schema===REVIEW_SCHEMA&&review.intentId===this.intentId&&review.selectionId===selected.id&&
      review.configSha256===binding.configSha256&&review.bodySha256===binding.bodySha256,
      'SAFE_MATCHING_PURCHASE_REVIEW_REQUIRED');
    return new SafeSimulationResult(this,await this.original.execute({review:review.original,signal}));
  }
  async recover() {
    await this._binding();
    const result=await this.original.recover();
    return result===null?null:new SafeSimulationResult(this,result);
  }
  async inspect() {
    const {binding,selected}=await this._binding();
    return {...await this.original.inspect(),safe:describeSelection(selected),merchant:binding.merchant};
  }
}
export class SafeSimulationResult {
  constructor(operation,original) { this.operation=operation;this.original=original; }
  get intentId() { return this.operation.intentId; }
  get native() { return this.original.native; }
  get record() { return this.original.record; }
  get delivery() { return this.original.delivery; }
  async json() { await this.operation._binding();return this.original.json(); }
  async summary() {
    const selected=await this.operation.selection();
    return {intentId:this.intentId,selection:describeSelection(selected),
      simulation:await this.original.summary(),nativeStatus:this.original.status,delivery:this.delivery};
  }
  async analyze({workspace=this.operation.client.analysisWorkspace,label}={}) {
    const selected=await this.operation.selection();
    return this.original.analyze({workspace:absolute(workspace),label:label??selected.record.label});
  }
  async export(directory,{workspace=this.operation.client.analysisWorkspace,signal}={}) {
    return exportHandover(this,{directory,workspace:absolute(workspace),signal});
  }
}
