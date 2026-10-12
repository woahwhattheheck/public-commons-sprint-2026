import { stringifyJson } from "./json-codec.mjs";
// MIT. Merchant call/summary/close owner over one original native HTTP workspace.
import { tools as nativeTools } from "./catalog.mjs";
import { haystackWorkspaceTools, HAYSTACK_MERCHANT_REQUEST_BYTES, HAYSTACK_MERCHANT_RESPONSE_BYTES } from "./merchant-tools.mjs";
import { HaystackHostClient, haystackHostError, readHaystackWorkspaceConfiguration, readHaystackHostInput, haystackInputMetadata } from "./merchant-client.mjs";
export { haystackWorkspaceTools, readHaystackWorkspaceConfiguration };

const definitions = new Map(haystackWorkspaceTools((name, description, properties, required) => ({
  name, description, properties, required
})).map(value => [value.name, value]));
const nativeActions = new Map(nativeTools.map(value => ["merchant_" + value.name, value.action]));
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value);
function need(value, message, status = 400, code = "HAYSTACK_TOOL_INPUT", details) {
  if (!value) throw haystackHostError(message, status, code, details);
}
function validate(value, schema, key) {
  if (schema.type === "string") need(typeof value === "string" && value.length >= (schema.minLength ?? 0) &&
    value.length <= (schema.maxLength ?? Number.MAX_SAFE_INTEGER) && (!schema.pattern || new RegExp(schema.pattern).test(value)), "Use the declared " + key + ".");
  if (schema.type === "integer") need(Number.isSafeInteger(value) && value >= (schema.minimum ?? Number.MIN_SAFE_INTEGER) &&
    value <= (schema.maximum ?? Number.MAX_SAFE_INTEGER), "Use the supported integer " + key + ".");
  if (schema.type === "number") need(typeof value === "number" && Number.isFinite(value), "Use a finite " + key + ".");
  if (schema.type === "boolean") need(typeof value === "boolean", "Use a boolean " + key + ".");
  if (schema.type === "object") {
    need(plain(value), "Use a complete JSON " + key + " object.");
    if (schema.additionalProperties === false) need(Object.keys(value).every(name => Object.hasOwn(schema.properties ?? {}, name)), "Use the declared " + key + " fields.");
    for (const required of schema.required ?? []) need(Object.hasOwn(value, required), "Supply " + key + "." + required + ".");
    for (const [name, field] of Object.entries(value)) if (schema.properties?.[name]) validate(field, schema.properties[name], key + "." + name);
  }
  if (schema.enum) need(schema.enum.includes(value), "Choose a declared " + key + ".");
  if (schema.type === "array") {
    need(Array.isArray(value) && value.length >= (schema.minItems ?? 0) && value.length <= (schema.maxItems ?? Number.MAX_SAFE_INTEGER), "Use the complete " + key + " list.");
    if (schema.uniqueItems) need(new Set(value.map(item => stringifyJson(item))).size === value.length, "Use distinct " + key + " items.");
    value.forEach((item, index) => validate(item, schema.items ?? {}, key + "[" + index + "]"));
  }
}
function completeResponse(value, name, args) {
  const responseBytes = Buffer.byteLength(stringifyJson(value));
  if (responseBytes <= HAYSTACK_MERCHANT_RESPONSE_BYTES) return value;
  const completed = Number.isSafeInteger(value?.revision) && typeof value?.operationId === "string";
  if (completed) return {
    workspace: args.workspace, workspaceId: value.workspaceId, operationId: value.operationId,
    revision: value.revision, replayed: Boolean(value.replayed), outcome: "CONFIRMED",
    responseView: { complete: false, responseBytes },
    saved: {
      ...(value.source?.id ? { sourceId: value.source.id } : {}),
      ...(value.edition?.id ? { editionId: value.edition.id } : {}),
      ...(value.proposal?.id ? { proposalId: value.proposal.id } : {}),
      ...(value.kind ? { deliveryKind: value.kind, sha256: value.sha256, bytes: value.bytes } : {})
    },
    completeResponse: {
      location: "The original saved workspace operation and complete editable package",
      action: "operation.read", operationId: value.operationId,
      instruction: "Read the saved proposal/source/edition through its exact identity and record pages, or prepare the complete workspace delivery and read every original byte range."
    }
  };
  throw haystackHostError("The selected complete response exceeds the merchant view. Use smaller record pages or original file ranges.",
    413, "HAYSTACK_VIEW_TOO_LARGE", { maximumResponseBytes: HAYSTACK_MERCHANT_RESPONSE_BYTES });
}
export class MerchantHaystackWorkspaces {
  #config; #clients = new Map(); #tasks = new Set(); #closed = false; #close;
  constructor(config) { this.#config = config.haystackWorkspaces ?? null; }
  get summary() {
    return { configured: Boolean(this.#config), workspaces: Object.keys(this.#config?.workspaces ?? {}),
      attachedClients: this.#clients.size, activeCalls: this.#tasks.size, closed: this.#closed };
  }
  #entry(alias) {
    need(!this.#closed, "The borrowed haystack provider is closing.", 409, "HAYSTACK_PROVIDER_CLOSED");
    const entry = this.#config?.workspaces?.[alias];
    need(entry, "Choose a configured original haystack workspace.", 404, "HAYSTACK_WORKSPACE_UNKNOWN");
    return entry;
  }
  #client(alias) {
    const entry = this.#entry(alias);
    if (!this.#clients.has(alias)) this.#clients.set(alias, new HaystackHostClient(entry));
    return this.#clients.get(alias);
  }
  #selection(alias) {
    const entry = this.#entry(alias);
    return { workspace: alias, label: entry.label, workspaceId: entry.workspaceId, maxInputBytes: entry.maxInputBytes,
      inputs: Object.entries(entry.inputs).map(([name, input]) => haystackInputMetadata(name, input)),
      client: this.#clients.get(alias)?.metadata ?? { state: "UNATTACHED", workspaceId: entry.workspaceId } };
  }
  async #call(name, args) {
    if (name === "merchant_haystack_workspaces") return { ...this.summary, workspaces: Object.keys(this.#config?.workspaces ?? {}).map(alias => this.#selection(alias)) };
    const alias = args.workspace, entry = this.#entry(alias), client = this.#client(alias);
    if (name === "merchant_haystack_connection") return { workspace: alias, ...await client.connection() };
    if (name === "merchant_haystack_reconnect") return { workspace: alias, ...await client.reconnect(args.expectedInstanceId) };
    if (name === "merchant_haystack_cancel") return { workspace: alias, ...client.cancel(args.operationId) };
    if (name === "merchant_haystack_input") {
      const found = await readHaystackHostInput(entry, args.input, args.expectedSha256);
      return { workspace: alias, ...haystackInputMetadata(args.input, found.input), bytes: found.bytes.length };
    }
    if (name === "merchant_haystack_import_file") {
      const found = await readHaystackHostInput(entry, args.input, args.expectedSha256);
      return client.action("source.import", {
        operationId: args.operationId, expectedRevision: args.expectedRevision,
        name: found.input.name, base64: found.bytes.toString("base64"), format: "json-v4",
        sourceUrl: args.sourceUrl ?? found.input.sourceReference,
        ...(args.select === undefined ? {} : { select: args.select })
      });
    }
    const action = nativeActions.get(name);
    need(action, "Choose a declared original haystack operation.");
    const { workspace, ...nativeArgs } = args;
    return client.action(action, nativeArgs);
  }
  call(name, args = {}) {
    const definition = definitions.get(name);
    need(!this.#closed, "The borrowed haystack provider is closed.", 409, "HAYSTACK_PROVIDER_CLOSED");
    need(definition && plain(args) && Object.keys(args).every(key => Object.hasOwn(definition.properties, key)) &&
      definition.required.every(key => Object.hasOwn(args, key)), "Use the declared original tool fields.");
    for (const [key, value] of Object.entries(args)) validate(value, definition.properties[key], key);
    const captured = structuredClone(args);
    need(Buffer.byteLength(stringifyJson(captured)) <= HAYSTACK_MERCHANT_REQUEST_BYTES,
      "Use a host-pinned input alias for a complete file larger than the tool request capacity.", 413, "HAYSTACK_REQUEST_TOO_LARGE");
    const task = Promise.resolve().then(() => this.#call(name, captured)).then(value => completeResponse(value, name, captured));
    this.#tasks.add(task); task.finally(() => this.#tasks.delete(task)).catch(() => {});
    return task;
  }
  close() {
    if (!this.#close) {
      this.#closed = true;
      this.#close = (async () => {
        await Promise.all([...this.#clients.values()].map(client => client.close()));
        await Promise.allSettled([...this.#tasks]); this.#clients.clear();
      })();
    }
    return this.#close;
  }
}
