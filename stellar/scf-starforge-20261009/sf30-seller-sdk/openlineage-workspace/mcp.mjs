// MIT. Merchant call/summary/close owner over one original native HTTP workspace.
import { tools as nativeTools } from "./catalog.mjs";
import { lineageWorkspaceTools, LINEAGE_MERCHANT_REQUEST_BYTES, LINEAGE_MERCHANT_RESPONSE_BYTES } from "./mcp-tools.mjs";
import { LineageHostClient, lineageHostError, readLineageWorkspaceConfiguration, readLineageHostInput, lineageInputMetadata } from "./mcp-client.mjs";
export { lineageWorkspaceTools, readLineageWorkspaceConfiguration };

const definitions = new Map(lineageWorkspaceTools((name, description, properties, required) => ({
  name, description, properties, required
})).map(value => [value.name, value]));
const nativeActions = new Map(nativeTools.map(value => ["merchant_" + value.name, value.action]));
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value);
function need(value, message, status = 400, code = "OPENLINEAGE_TOOL_INPUT", details) {
  if (!value) throw lineageHostError(message, status, code, details);
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
    if (schema.uniqueItems) need(new Set(value.map(item => JSON.stringify(item))).size === value.length, "Use distinct " + key + " items.");
    value.forEach((item, index) => validate(item, schema.items ?? {}, key + "[" + index + "]"));
  }
}
function completeResponse(value, name, args) {
  const responseBytes = Buffer.byteLength(JSON.stringify(value));
  if (responseBytes <= LINEAGE_MERCHANT_RESPONSE_BYTES) return value;
  const committed = Number.isSafeInteger(value?.revision) && typeof args.operationId === "string" &&
    ["merchant_lineage_source_import", "merchant_lineage_edition_save", "merchant_lineage_review_save", "merchant_lineage_result_attach",
      "merchant_lineage_import_file", "merchant_lineage_attach_file"].includes(name);
  if (committed) {
    return {
      outcome: "CONFIRMED", workspace: args.workspace, workspaceId: value.workspaceId,
      operationId: value.operationId ?? args.operationId, revision: value.revision, replayed: Boolean(value.replayed),
      responseView: { complete: false, responseBytes, reason: "The original saved response exceeds the merchant view capacity." },
      saved: {
        ...(value.source?.id ? { sourceId: value.source.id } : {}),
        ...(value.edition?.id ? { editionId: value.edition.id } : {}),
        ...(value.review?.id ? { reviewId: value.review.id } : {}),
        ...(value.result?.id ? { resultId: value.result.id, objectId: value.result.objectId } : {})
      },
      completeResponse: {
        location: "Original workspace operation journal and complete workspace export",
        export: { tool: "merchant_lineage_workspace_export", arguments: { workspace: args.workspace, includeApplication: true } },
        download: { tool: "merchant_lineage_export_read", instruction: "Use the returned export ID and concatenate every original byte range." },
        operationId: value.operationId ?? args.operationId
      }
    };
  }
  throw lineageHostError(
    "This complete response exceeds the merchant view capacity. Page records with a smaller limit, or retrieve the original object/export with its ID and byte offsets.",
    413, "OPENLINEAGE_VIEW_TOO_LARGE", { recordsTool: "merchant_lineage_records_read", objectTool: "merchant_lineage_object_read", exportTool: "merchant_lineage_export_read" });
}
export class MerchantOpenLineageWorkspaces {
  #config; #clients = new Map(); #tasks = new Set(); #closed = false; #close;
  constructor(config) { this.#config = config.openlineageWorkspaces ?? null; }
  get summary() {
    return { configured: Boolean(this.#config), workspaces: Object.keys(this.#config?.workspaces ?? {}),
      attachedClients: this.#clients.size, activeCalls: this.#tasks.size, closed: this.#closed };
  }
  #entry(alias) {
    need(!this.#closed, "The borrowed lineage provider is closing.", 409, "OPENLINEAGE_PROVIDER_CLOSED");
    const entry = this.#config?.workspaces?.[alias];
    need(entry, "Choose a configured original lineage workspace.", 404, "OPENLINEAGE_WORKSPACE_UNKNOWN");
    return entry;
  }
  #client(alias) {
    const entry = this.#entry(alias);
    if (!this.#clients.has(alias)) this.#clients.set(alias, new LineageHostClient(entry));
    return this.#clients.get(alias);
  }
  #selection(alias) {
    const entry = this.#entry(alias);
    return { workspace: alias, label: entry.label, workspaceId: entry.workspaceId, maxInputBytes: entry.maxInputBytes,
      inputs: Object.entries(entry.inputs).map(([name, input]) => lineageInputMetadata(name, input)),
      client: this.#clients.get(alias)?.metadata ?? { state: "UNATTACHED", workspaceId: entry.workspaceId } };
  }
  async #call(name, args) {
    if (name === "merchant_lineage_workspaces") return { ...this.summary, workspaces: Object.keys(this.#config?.workspaces ?? {}).map(alias => this.#selection(alias)) };
    const alias = args.workspace, entry = this.#entry(alias), client = this.#client(alias);
    if (name === "merchant_lineage_connection") return { workspace: alias, ...await client.connection() };
    if (name === "merchant_lineage_reconnect") return { workspace: alias, ...await client.reconnect(args.expectedInstanceId) };
    if (name === "merchant_lineage_cancel") return { workspace: alias, ...client.cancel(args.operationId) };
    if (name === "merchant_lineage_input") {
      const found = await readLineageHostInput(entry, args.input, args.expectedSha256);
      return { workspace: alias, ...lineageInputMetadata(args.input, found.input), bytes: found.bytes.length };
    }
    if (name === "merchant_lineage_import_file" || name === "merchant_lineage_attach_file") {
      const found = await readLineageHostInput(entry, args.input, args.expectedSha256);
      const operation = { operationId: args.operationId, expectedRevision: args.expectedRevision };
      if (name === "merchant_lineage_import_file") {
        need(found.input.kind === "source", "Select an original source input for import.");
        return client.action("source.import", { ...operation, name: found.input.name, base64: found.bytes.toString("base64"),
          sourceUrl: args.sourceUrl ?? found.input.sourceReference });
      }
      need(found.input.kind === "result", "Select a complete result input for attachment.");
      return client.action("result.attach", { ...operation, name: found.input.name, base64: found.bytes.toString("base64"),
        mediaType: found.input.mediaType, entityKeys: args.entityKeys, editionId: args.editionId,
        sourceReference: args.sourceReference, ...(args.query === undefined ? {} : { query: args.query }) });
    }
    const action = nativeActions.get(name);
    need(action, "Choose a declared original lineage operation.");
    const { workspace, ...nativeArgs } = args;
    if (action === "source.import") need((typeof nativeArgs.text === "string") !== (typeof nativeArgs.base64 === "string"), "Provide exactly one complete text or base64 source.");
    return client.action(action, nativeArgs);
  }
  call(name, args = {}) {
    const definition = definitions.get(name);
    need(!this.#closed, "The borrowed lineage provider is closed.", 409, "OPENLINEAGE_PROVIDER_CLOSED");
    need(definition && plain(args) && Object.keys(args).every(key => Object.hasOwn(definition.properties, key)) &&
      definition.required.every(key => Object.hasOwn(args, key)), "Use the declared original tool fields.");
    for (const [key, value] of Object.entries(args)) validate(value, definition.properties[key], key);
    const captured = structuredClone(args);
    need(Buffer.byteLength(JSON.stringify(captured)) <= LINEAGE_MERCHANT_REQUEST_BYTES,
      "Use a host-pinned input alias for a complete file larger than the tool request capacity.", 413, "OPENLINEAGE_REQUEST_TOO_LARGE");
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
