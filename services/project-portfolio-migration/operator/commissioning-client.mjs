/**
 * Typed-client runtime for the existing Portfolio target desk.
 * Every action uses the original local request journal and selected workspace.
 * A prepared request contains no authentication material and can be retained
 * before submit. Transport failures are reconciled by reading that same request.
 */
export const COMMISSIONING_ACTIONS = Object.freeze([
  "intake", "probe", "adopt_existing", "prepare_adoption_review", "review_adoption",
  "prepare_observed_correction", "review", "continue", "capture_target", "accept",
  "commissioning_handover", "rebind_imported_target", "archive"
]);
const ACTION_SET = new Set(COMMISSIONING_ACTIONS);
const TERMINAL = new Set(["COMPLETE", "FAILED"]);
const REQUEST_SCHEMA = "portfolio.commissioning-client-request.v1";
const HEX = /^[0-9a-f]{64}$/;
const EVIDENCE_CLASSES = new Set(["native_receipt", "original_export", "original_screenshot", "operator_statement"]);

export class PortfolioClientError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PortfolioClientError";
    this.code = code;
    Object.assign(this, details);
  }
}
function fail(code, message, details) { throw new PortfolioClientError(code, message, details); }
function identity(value, label = "saved identity") {
  if (typeof value !== "string" || !HEX.test(value)) fail("CLIENT_ID", "Use the complete original " + label + ".");
  return value;
}
function plain(value, path = "$", ancestors = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object") fail("CLIENT_JSON", "Retain a JSON value at " + path + ".");
  if (ancestors.has(value)) fail("CLIENT_JSON", "A saved request cannot contain a cycle at " + path + ".");
  const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
  if (!array && proto !== Object.prototype && proto !== null)
    fail("CLIENT_JSON", "Use a plain JSON object at " + path + ".");
  ancestors.add(value);
  let result;
  if (array) {
    result = Array.from(value, (item, index) => plain(item, path + "[" + index + "]", ancestors));
  } else {
    result = Object.create(null);
    for (const key of Object.keys(value).sort()) result[key] = plain(value[key], path + "." + key, ancestors);
  }
  ancestors.delete(value);
  return result;
}
function frozen(value) {
  if (value && typeof value === "object") { for (const v of Object.values(value)) frozen(v); Object.freeze(value); }
  return value;
}
function stable(value) { return JSON.stringify(plain(value)); }
function argsObject(value) {
  const copy = plain(value);
  if (!copy || Array.isArray(copy) || typeof copy !== "object") fail("CLIENT_ARGUMENTS", "Use an action arguments object.");
  return copy;
}
function filename(value) {
  if (typeof value !== "string" || !value || value.length > 240 || /[/\\\0\r\n]/.test(value))
    fail("CLIENT_FILENAME", "Use the original document's base filename.");
  return value;
}
function integer(value, fallback, min, max, name) {
  value = value ?? fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail("CLIENT_RANGE", "Select a valid " + name + " between " + min + " and " + max + ".");
  return value;
}
function original(request) {
  if (!request || request.schema !== REQUEST_SCHEMA || !ACTION_SET.has(request.kind))
    fail("CLIENT_REQUEST", "Select a complete prepared commissioning request.");
  identity(request.request_id, "request ID");
  if (typeof request.workspace_id !== "string" || !request.workspace_id)
    fail("CLIENT_WORKSPACE", "Keep the prepared request's original workspace identity.");
  return {schema: REQUEST_SCHEMA, workspace_id: request.workspace_id, request_id: request.request_id,
    kind: request.kind, arguments: argsObject(request.arguments)};
}
function sameRequest(saved, request) {
  if (!saved || saved.id !== request.request_id || saved.kind !== request.kind ||
      stable(saved.arguments) !== stable(request.arguments))
    fail("CLIENT_REQUEST_CHANGED", "The returned saved request has different original input.", {requestId: request.request_id});
  return saved;
}
function abort(signal) {
  if (signal?.aborted) throw signal.reason ?? new PortfolioClientError("CLIENT_ABORTED", "The local wait was stopped.");
}
function pause(milliseconds, signal) {
  abort(signal);
  return new Promise((resolve, reject) => {
    const stop = () => { clearTimeout(timer); signal?.removeEventListener("abort", stop);
      reject(signal.reason ?? new PortfolioClientError("CLIENT_ABORTED", "The local wait was stopped.")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", stop); resolve(); }, milliseconds);
    signal?.addEventListener("abort", stop, {once: true});
    if (signal?.aborted) stop();
  });
}
export function createRequestId() {
  if (!globalThis.crypto?.getRandomValues) fail("CLIENT_CRYPTO", "Use a runtime with Web Crypto or supply the original request ID.");
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, "0")).join("");
}
export function restorePreparedRequest(value) { return frozen(original(value)); }

export class PortfolioCommissioningClient {
  #base; #token; #fetch; #workspaceId;
  constructor({baseUrl, token, fetch: fetchImplementation = globalThis.fetch, workspaceId} = {}) {
    let url;
    try { url = new URL(baseUrl); } catch { fail("CLIENT_ORIGIN", "Use the exact running local operator URL."); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search ||
        url.hash || !["", "/"].includes(url.pathname))
      fail("CLIENT_ORIGIN", "Use the exact operator origin without credentials, a path, query or fragment.");
    if (typeof token !== "string" || !token.trim() || /[\r\n]/.test(token))
      fail("CLIENT_TOKEN", "Use the current private local operator token.");
    if (typeof fetchImplementation !== "function") fail("CLIENT_FETCH", "Supply the runtime's fetch implementation.");
    if (workspaceId !== undefined && (typeof workspaceId !== "string" || !workspaceId))
      fail("CLIENT_WORKSPACE", "Use the original workspace ID.");
    this.#base = url.origin;
    this.#token = token;
    this.#fetch = fetchImplementation;
    this.#workspaceId = workspaceId;
  }
  get baseUrl() { return this.#base; }
  get workspaceId() { return this.#workspaceId; }
  async #response(path, {method = "GET", body, raw, headers = {}, signal, requestId, sourceSelection} = {}) {
    abort(signal);
    let response;
    try {
      response = await this.#fetch(this.#base + path, {method, redirect: "error", credentials: "omit",
        cache: "no-store", signal, headers: {Authorization: "Bearer " + this.#token,
          ...(method === "GET" ? {} : {Origin: this.#base}),
          ...(body === undefined ? {} : {"Content-Type": "application/json"}), ...headers},
        ...(body === undefined ? (raw === undefined ? {} : {body: raw}) : {body: JSON.stringify(body)})});
    } catch (cause) {
      const upload = path === "/api/upload";
      fail(method === "GET" ? "CLIENT_READ_INTERRUPTED" : upload ? "CLIENT_UPLOAD_OUTCOME_UNKNOWN" : "CLIENT_OUTCOME_UNKNOWN",
        method === "GET" ? "The local read was interrupted." : upload ?
          "The upload response was interrupted. Retry the same original file bytes and filename." :
          "The action response was interrupted. Read the original saved request before continuing.",
        {cause, requestId, ...(sourceSelection ? {source: sourceSelection} : {}),
          outcome: method === "GET" ? "read_interrupted" : "unknown"});
    }
    if (!response.ok) {
      let value; try { value = await response.json(); } catch {}
      fail(value?.error?.code || "CLIENT_HTTP", value?.error?.message || "The local operator returned HTTP " + response.status + ".",
        {status: response.status, requestId});
    }
    return response;
  }
  async #json(path, options) {
    const response = await this.#response(path, options);
    try { return await response.json(); } catch (cause) {
      const upload = path === "/api/upload";
      fail(options?.method === "POST" ? upload ? "CLIENT_UPLOAD_OUTCOME_UNKNOWN" : "CLIENT_OUTCOME_UNKNOWN" : "CLIENT_READ_INCOMPLETE",
        upload ? "The upload response ended before complete JSON. Retry the same original file bytes and filename." :
          "The local response ended before complete JSON. Retain the original request.",
        {cause, requestId: options?.requestId, ...(options?.sourceSelection ? {source: options.sourceSelection} : {}),
          outcome: options?.method === "POST" ? "unknown" : "read_interrupted"});
    }
  }
  async connect({workspaceId = this.#workspaceId, signal} = {}) {
    const hello = await this.#json("/api/hello", {signal});
    if (hello?.schema !== "portfolio.operator-hello.v1" || typeof hello.workspace_id !== "string" || !hello.workspace_id)
      fail("CLIENT_HELLO", "The selected endpoint did not return the Portfolio operator identity.");
    if (workspaceId && hello.workspace_id !== workspaceId)
      fail("CLIENT_WORKSPACE_CHANGED", "The running server contains a different workspace.", {
        expectedWorkspaceId: workspaceId, actualWorkspaceId: hello.workspace_id});
    this.#workspaceId = hello.workspace_id;
    return hello;
  }
  prepare(kind, argumentsValue, {requestId} = {}) {
    if (!this.#workspaceId) fail("CLIENT_WORKSPACE", "Connect to the selected workspace before preparing an action.");
    if (!ACTION_SET.has(kind)) fail("CLIENT_ACTION", "Select a supported source or commissioning action.");
    return frozen({schema: REQUEST_SCHEMA, workspace_id: this.#workspaceId,
      request_id: identity(requestId ?? createRequestId(), "request ID"), kind, arguments: argsObject(argumentsValue)});
  }
  prepareIntake(args, options) { return this.prepare("intake", args, options); }
  prepareAdoption(args, options) { return this.prepare("adopt_existing", args, options); }
  prepareAdoptionProposal(args, options) { return this.prepare("prepare_adoption_review", args, options); }
  prepareAdoptionReview(args, options) { return this.prepare("review_adoption", args, options); }
  prepareCorrection(args, options) { return this.prepare("prepare_observed_correction", args, options); }
  prepareCorrectionReview(args, options) { return this.prepare("review", args, options); }
  prepareContinuation(args, options) { return this.prepare("continue", args, options); }
  prepareCapture(args, options) { return this.prepare("capture_target", args, options); }
  prepareAcceptance(args, options) { return this.prepare("accept", args, options); }
  prepareHandover(args, options) { return this.prepare("commissioning_handover", args, options); }
  prepareRebind(args, options) { return this.prepare("rebind_imported_target", args, options); }
  prepareArchive(options) { return this.prepare("archive", {}, options); }
  async submit(prepared, {signal} = {}) {
    const request = original(prepared);
    await this.connect({workspaceId: request.workspace_id, signal});
    const saved = await this.#json("/api/actions", {method: "POST", signal, requestId: request.request_id,
      body: {request_id: request.request_id, kind: request.kind, arguments: request.arguments}});
    return sameRequest(saved, request);
  }
  async status(prepared, {signal} = {}) {
    const request = original(prepared);
    await this.connect({workspaceId: request.workspace_id, signal});
    return sameRequest(await this.getRequest(request.request_id, {signal}), request);
  }
  async resume(prepared, {retryFailed = false, signal} = {}) {
    const request = original(prepared), saved = await this.status(request, {signal});
    if (saved.state === "COMPLETE") return saved;
    if (saved.state === "FAILED" && !retryFailed)
      fail("CLIENT_FAILED_REQUEST", "Review the saved failure before explicitly resuming it.", {requestId: request.request_id, saved});
    const value = await this.#json("/api/requests/" + request.request_id + "/resume",
      {method: "POST", signal, requestId: request.request_id, body: {retry_failed: retryFailed}});
    return sameRequest(value, request);
  }
  async wait(prepared, {signal, pollIntervalMs = 1500, timeoutMs = 120000, onProgress} = {}) {
    const request = original(prepared);
    pollIntervalMs = integer(pollIntervalMs, 1500, 100, 60000, "poll interval");
    timeoutMs = integer(timeoutMs, 120000, 1, 86400000, "wait timeout");
    const controller = new AbortController();
    let timedOut = false, saved;
    const stop = () => controller.abort(signal.reason);
    signal?.addEventListener("abort", stop, {once: true});
    if (signal?.aborted) stop();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      await this.connect({workspaceId: request.workspace_id, signal: controller.signal});
      for (;;) {
        abort(controller.signal);
        saved = sameRequest(await this.getRequest(request.request_id, {signal: controller.signal}), request);
        if (onProgress) await onProgress(saved);
        if (TERMINAL.has(saved.state)) return saved;
        await pause(pollIntervalMs, controller.signal);
      }
    } catch (error) {
      if (timedOut) fail("CLIENT_WAIT_TIMEOUT", "The saved action remains available under its original request ID.",
        {requestId: request.request_id, ...(saved ? {saved} : {})});
      abort(signal);
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
    }
  }
  async getRequest(requestId, {signal} = {}) { return this.#json("/api/requests/" + identity(requestId, "request ID"), {signal}); }
  async getDeployment(deploymentId, {signal} = {}) { return this.#json("/api/deployments/" + identity(deploymentId, "deployment ID"), {signal}); }
  async getObject(sha256, {signal} = {}) { return this.#json("/api/objects/" + identity(sha256, "object SHA-256"), {signal}); }
  async getState({cursor = "", limit = 25, signal} = {}) {
    const query = new URLSearchParams({cursor, limit: String(integer(limit, 25, 1, 100, "page size"))});
    return this.#json("/api/state?" + query, {signal});
  }
  async getEditions({cursor = "", limit = 25, signal} = {}) {
    const query = new URLSearchParams({cursor, limit: String(integer(limit, 25, 1, 250, "source page size"))});
    return this.#json("/api/editions?" + query, {signal});
  }
  async getRequests({cursor = "", limit = 25, signal} = {}) {
    const query = new URLSearchParams({cursor, limit: String(integer(limit, 25, 1, 100, "request page size"))});
    return this.#json("/api/requests?" + query, {signal});
  }
  async *iterateSourceRows(editionId, {family, limit = 50, signal} = {}) {
    let offset = 0;
    for (;;) {
      const page = await this.getEdition(editionId, {family, offset, limit, signal});
      if (page.edition_id !== editionId || page.family !== family || page.offset !== offset || !Array.isArray(page.items))
        fail("CLIENT_SOURCE_PAGE", "The returned row page belongs to another original source selection.");
      for (const row of page.items) yield row;
      if (page.next_offset === null) return;
      if (!Number.isSafeInteger(page.next_offset) || page.next_offset <= offset || page.items.length === 0)
        fail("CLIENT_SOURCE_PAGE", "The original source page did not advance.");
      offset = page.next_offset;
    }
  }
  async getEdition(editionId, {family, offset = 0, limit = 50, signal} = {}) {
    let query = "";
    if (family !== undefined) {
      if (!["tasks", "resources", "assignments", "dependencies", "calendars"].includes(family))
        fail("CLIENT_FAMILY", "Select an original source family.");
      query = "?" + new URLSearchParams({family, offset: String(integer(offset, 0, 0, Number.MAX_SAFE_INTEGER, "row offset")),
        limit: String(integer(limit, 50, 1, 250, "row page size"))});
    }
    return this.#json("/api/editions/" + identity(editionId, "source edition ID") + query, {signal});
  }
  async inspect(deploymentId, {signal} = {}) {
    await this.connect({signal});
    const deployment = await this.getDeployment(deploymentId, {signal});
    if (deployment.commissioning_origin !== "external_import")
      fail("CLIENT_ADOPTION", "Select an existing-plan adoption or its retained correction.");
    const fields = ["import_intake_sha256", "commissioning_inventory_sha256", "commissioning_comparison_sha256",
      "comparison_sha256", "adoption_review_sha256", "rebind_sha256"];
    const objects = Object.create(null);
    const unique = new Map();
    await Promise.all(fields.map(async field => {
      const sha = deployment[field];
      if (!sha) return;
      if (!unique.has(sha)) unique.set(sha, this.getObject(sha, {signal}));
      objects[field] = await unique.get(sha);
    }));
    const source = await this.getEdition(deployment.source_edition_id, {signal});
    const current = await this.getDeployment(deploymentId, {signal});
    if (current.revision !== deployment.revision || fields.some(field => current[field] !== deployment[field]) ||
        current.plan_sha256 !== deployment.plan_sha256)
      fail("CLIENT_REVISION_CHANGED", "The selected adoption changed during the read. Reopen its current revision.",
        {deploymentId, expectedRevision: deployment.revision, actualRevision: current.revision});
    return {schema: "portfolio.commissioning-inspection.v1", workspace_id: this.#workspaceId,
      deployment, source, objects};
  }
  async upload(bytes, {filename: name, signal} = {}) {
    name = filename(name);
    let raw, size;
    if (bytes instanceof Uint8Array) { raw = new Uint8Array(bytes); size = raw.byteLength; }
    else if (bytes instanceof ArrayBuffer) { raw = bytes.slice(0); size = raw.byteLength; }
    else if (typeof Blob !== "undefined" && bytes instanceof Blob) { raw = bytes; size = bytes.size; }
    else fail("CLIENT_UPLOAD", "Provide the complete original file as bytes or a Blob.");
    if (size > 256 * 1024 * 1024) fail("CLIENT_UPLOAD", "The original upload limit is 256 MiB.");
    if (!globalThis.crypto?.subtle) fail("CLIENT_CRYPTO", "Use Web Crypto to verify the original selected upload.");
    const originalBytes = typeof Blob !== "undefined" && raw instanceof Blob ? await raw.arrayBuffer() : raw;
    const expected = Array.from(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", originalBytes)),
      n => n.toString(16).padStart(2, "0")).join("");
    await this.connect({signal});
    const value = await this.#json("/api/upload", {method: "POST", raw, signal,
      sourceSelection: {filename: name, bytes: size, sha256: expected}, headers: {"Content-Type": "application/octet-stream", "X-Source-Name": encodeURIComponent(name)}});
    if (value?.schema !== "portfolio.operator-upload.v1" || value.bytes !== size || value.filename !== name)
      fail("CLIENT_UPLOAD_RESULT", "The upload did not return the complete selected original.");
    identity(value.sha256, "uploaded source SHA-256");
    if (value.sha256 !== expected) fail("CLIENT_UPLOAD_CHANGED", "The saved upload differs from the complete original selected bytes.");
    return value;
  }
  async uploadEvidence(bytes, {class: evidenceClass, title, format, ...options} = {}) {
    if (!EVIDENCE_CLASSES.has(evidenceClass)) fail("CLIENT_EVIDENCE_CLASS", "Select the actual import evidence class.");
    const source = await this.upload(bytes, options);
    return {source, class: evidenceClass, ...(title === undefined ? {} : {title}),
      ...(format === undefined ? {} : {format})};
  }
  async downloadResponse(artifact, {signal} = {}) {
    if (!artifact || typeof artifact !== "object") fail("CLIENT_ARTIFACT", "Select a retained artifact descriptor.");
    const name = filename(artifact.filename), sha = identity(artifact.sha256, "artifact SHA-256");
    await this.connect({signal});
    const path = artifact.kind === "workspace_archive" ?
      "/api/archives/" + identity(artifact.request_id, "archive request ID") :
      "/api/download/" + sha + "?filename=" + encodeURIComponent(name);
    return this.#response(path, {signal});
  }
  async downloadBytes(artifact, options) {
    if (!globalThis.crypto?.subtle) fail("CLIENT_CRYPTO", "Use Web Crypto to verify the complete downloaded artifact.");
    const response = await this.downloadResponse(artifact, options);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const hash = Array.from(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes)),
      n => n.toString(16).padStart(2, "0")).join("");
    if (hash !== artifact.sha256 || (artifact.bytes !== undefined && bytes.byteLength !== artifact.bytes))
      fail("CLIENT_ARTIFACT_CHANGED", "The downloaded artifact differs from its original selected bytes.");
    return bytes;
  }
}
