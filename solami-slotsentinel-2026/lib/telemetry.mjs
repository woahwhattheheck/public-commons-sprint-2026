// Observational Solana slot telemetry. No provider calls or credentials here.
const isSlot = value => Number.isSafeInteger(value) && value >= 0;
const MAX_HISTORY = 80;

export function classifyHealth(state, now, opts = {}) {
  const staleMs = opts.staleMs ?? 15000;
  const maxLag = opts.maxLag ?? 32;
  const rpcAgeMs = state.lastRpcAt === null ? null : Math.max(0, now - state.lastRpcAt);
  const wsAgeMs = state.lastStreamAt === null ? null : Math.max(0, now - state.lastStreamAt);
  const slotLag = isSlot(state.rpcSlot) && isSlot(state.streamSlot)
    ? Math.max(0, state.rpcSlot - state.streamSlot) : null;
  let status = "healthy";
  if (rpcAgeMs === null || rpcAgeMs > staleMs) status = "rpc-unavailable";
  else if (!state.socketOpen || wsAgeMs === null || wsAgeMs > staleMs) status = "stream-stale";
  else if (slotLag !== null && slotLag > maxLag) status = "stream-behind";
  return {status, rpcAgeMs, wsAgeMs, slotLag, maxLag, staleMs};
}

export class SlotTelemetry {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.state = {
      mode: "live", provider: "Solami", startedAt: new Date(now()).toISOString(),
      rpcSlot: null, streamSlot: null, parentSlot: null, rootSlot: null,
      lastRpcAt: null, lastStreamAt: null, socketOpen: false,
      rpcSamples: 0, streamSamples: 0, observedSlotJumps: 0,
      outOfOrderSamples: 0, reconnects: 0, rpcFailures: 0,
      latestRpcLatencyMs: null, events: []
    };
  }
  event(kind, detail, level = "info") {
    const line = {at: new Date(this.now()).toISOString(), kind, level, detail};
    this.state.events.push(line);
    if (this.state.events.length > MAX_HISTORY) this.state.events.shift();
    return line;
  }
  socketStatus(open) {
    const wasOpen = this.state.socketOpen;
    this.state.socketOpen = Boolean(open);
    if (open && !wasOpen) {
      if (this.state.streamSamples > 0) this.state.reconnects++;
      this.event("stream-connected", "WebSocket connected; requesting slot subscription");
    } else if (!open && wasOpen) {
      this.event("stream-disconnected", "WebSocket dropped; RPC comparison continues", "warning");
    }
  }
  rpcSample(slot, latencyMs) {
    if (!isSlot(slot)) throw new TypeError("getSlot must return a safe nonnegative integer");
    this.state.rpcSlot = slot;
    this.state.lastRpcAt = this.now();
    this.state.rpcSamples++;
    this.state.latestRpcLatencyMs = Math.max(0, Math.floor(latencyMs));
  }
  rpcError() {
    this.state.rpcFailures++;
    this.event("rpc-failure", "JSON-RPC polling failed (endpoint or network)", "warning");
  }
  slotSample(input) {
    const slot = input?.slot;
    if (!isSlot(slot)) return false;
    const previous = this.state.streamSlot;
    if (previous !== null && slot < previous) {
      this.state.outOfOrderSamples++;
      this.event("slot-out-of-order", "Received an older slot notification", "warning");
      return false;
    }
    if (previous !== null && slot > previous + 1) {
      this.state.observedSlotJumps++;
      // Solana skips slots normally. A jump is NOT proof of lost websocket messages.
      this.event("slot-jump", "Slot numbers advanced nonconsecutively; check stream and skipped slots");
    }
    this.state.streamSlot = slot;
    if (isSlot(input.parent)) this.state.parentSlot = input.parent;
    if (isSlot(input.root)) this.state.rootSlot = input.root;
    this.state.lastStreamAt = this.now();
    this.state.streamSamples++;
    return true;
  }
  snapshot() {
    const now = this.now();
    const health = classifyHealth(this.state, now);
    return {
      schema: "solami-slotsentinel/v1", observedAt: new Date(now).toISOString(),
      ...health,
      ...this.state,
      // expose only aggregate telemetry; never include endpoint URLs or API keys
      events: [...this.state.events]
    };
  }
}
