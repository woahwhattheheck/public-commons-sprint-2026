// MIT. Direct single-merchant delivery through the original SF82/SF98 owner.
import { createReleaseDeliveryConsole }
  from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-delivery-console.mjs';
const methods = Object.freeze({
  merchant_delivery_status: 'status', merchant_delivery_control: 'control',
  merchant_delivery_events: 'events', merchant_delivery_handoff: 'handoff',
  merchant_delivery_transfers: 'transfers', merchant_delivery_transfer: 'transfer',
  merchant_delivery_manifest: 'transferManifest', merchant_delivery_file: 'file',
  merchant_delivery_file_release: 'releaseFile',
});
const failure = code => Object.assign(new Error(code), { code });
export class MerchantDelivery {
  #desk;
  constructor(config, options = {}) {
    this.#desk = createReleaseDeliveryConsole(config.releaseStore, {
      environment: options.environment ?? process.env,
    });
  }
  get summary() { return this.#desk.summary; }
  call(name, args = {}) {
    if (name === 'merchant_delivery_stop') {
      if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length)
        throw failure('RELEASE_DELIVERY_PARAMETERS');
      return this.#desk.control({ action: 'stop', input: {} });
    }
    const method = methods[name];
    if (!method) throw failure('RELEASE_DELIVERY_TOOL_UNKNOWN');
    return this.#desk[method](args);
  }
  cancelDeliveryOperations() {
    const stopped = this.#desk.close();
    stopped.catch(() => {});
    return stopped;
  }
  close() { return this.#desk.close(); }
}
