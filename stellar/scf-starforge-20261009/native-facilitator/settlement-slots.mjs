// MIT. One in-flight native settlement per configured source account.
import { AsyncLocalStorage } from 'node:async_hooks';
import { FacilitatorError } from './config.mjs';

/** The caller supplies validated distinct public accounts, never signing keys. */
export function createSettlementSlots(addresses, capacity) {
  const accounts = [...addresses], held = new Map(), context = new AsyncLocalStorage();
  let next = 0;
  const hasCapacity = () => held.size < capacity;
  const acquire = () => {
    if (!hasCapacity()) throw new FacilitatorError('FACILITATOR_BUSY',503);
    for (let offset = 0; offset < accounts.length; offset++) {
      const index = (next + offset) % accounts.length, address = accounts[index];
      if (held.has(address)) continue;
      const slot = Object.freeze({address,startedAt:new Date().toISOString()});
      held.set(address,slot); next = (index + 1) % accounts.length;
      return slot;
    }
    throw new FacilitatorError('FACILITATOR_BUSY',503);
  };
  const selectSigner = available => {
    const slot = context.getStore();
    if (!slot || held.get(slot.address) !== slot || !available.includes(slot.address))
      throw new FacilitatorError('SETTLEMENT_SIGNER_CONTEXT_REQUIRED',503);
    return slot.address;
  };
  const run = (slot, operation) => {
    if (!slot || held.get(slot.address) !== slot)
      throw new FacilitatorError('SETTLEMENT_SLOT_REQUIRED',503);
    // The native SDK selects its account after awaited verification. Keep the
    // assignment on this async call, not in a shared last-selected variable.
    return context.run(slot,operation);
  };
  const release = slot => {
    if (slot && held.get(slot.address) === slot) held.delete(slot.address);
  };
  const status = () => accounts.map(address => {
    const slot = held.get(address);
    return {address,state:slot ? 'IN_FLIGHT' : 'AVAILABLE',startedAt:slot?.startedAt ?? null};
  });
  return Object.freeze({hasCapacity,acquire,selectSigner,run,release,status,
    close:() => { if (held.size === 0) context.disable(); }});
}
