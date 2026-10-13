const TERMINAL_STATES = new Set(["succeeded", "failed", "interrupted"]);

/** A transport or desk error retaining the server's status and structured detail. */
export class TaskDeskError extends Error {
  constructor(message, { code = "TASK_DESK_ERROR", status = 0, details, nativeResult, requestId, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "TaskDeskError";
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
    if (nativeResult !== undefined) this.nativeResult = nativeResult;
    if (requestId !== undefined) this.requestId = requestId;
  }

  toJSON() {
    return { name: this.name, message: this.message, code: this.code,
      status: this.status, ...(this.details === undefined ? {} : { details: this.details }),
      ...(this.nativeResult === undefined ? {} : { nativeResult: this.nativeResult }),
      ...(this.requestId === undefined ? {} : { requestId: this.requestId }) };
  }
}

function segment(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(name + " must be a non-empty string");
  }
  return encodeURIComponent(value);
}

function abortReason(signal) {
  return signal.reason ?? new DOMException("The request was aborted", "AbortError");
}

function pause(milliseconds, signal) {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, milliseconds);
    function finish() {
      signal.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(abortReason(signal));
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

/**
 * Client for a running loopback InboxTask desk.
 * Mutations are sent exactly once. Waiting polls retained GET metadata only.
 */
export class TaskDeskClient {
  #fetch;
  #headers;
  #csrfToken;
  #sendOrigin;

  constructor(baseUrl, { fetchImpl = globalThis.fetch, headers, csrfToken } = {}) {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new TypeError("The task desk URL must use HTTP or HTTPS");
    }
    if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required");
    this.baseUrl = url.origin;
    this.#fetch = fetchImpl.bind(globalThis);
    this.#headers = new Headers(headers);
    this.#csrfToken = csrfToken;
    this.#sendOrigin = typeof process !== "undefined" && Boolean(process.versions?.node);
  }

  /** Refresh status before another mutation after replacing a server session. */
  clearSession() {
    this.#csrfToken = undefined;
  }

  async #token(signal) {
    if (typeof this.#csrfToken === "string" && this.#csrfToken.length > 0) return this.#csrfToken;
    // An aborted caller must not cancel another caller's status request.
    const status = await this.getStatus({ signal });
    if (typeof status?.csrfToken !== "string" || status.csrfToken.length === 0) {
      throw new TaskDeskError("The desk status did not contain a session token", {
        code: "TASK_DESK_TOKEN_MISSING", status: 200,
      });
    }
    return status.csrfToken;
  }

  async #decode(response, mode) {
    if (response.status === 204) return undefined;
    const text = await response.text();
    if (text === "" && mode === "auto") return text;
    const isJson = /(?:application|text)\/(?:[^;]+\+)?json\b/i.test(response.headers.get("content-type") ?? "");
    if (mode === "auto" && !isJson) return text;
    try {
      return JSON.parse(text);
    } catch (cause) {
      throw new TaskDeskError("The desk returned an invalid JSON response", {
        code: "TASK_DESK_INVALID_RESPONSE", status: response.status,
        details: { contentType: response.headers.get("content-type"), body: text.slice(0, 4096) }, cause,
      });
    }
  }

  async #request(path, { method = "GET", body, signal, mode = "json" } = {}) {
    const headers = new Headers(this.#headers);
    headers.set("Accept", mode === "raw" ? "*/*" : "application/json, text/html;q=0.9, text/plain;q=0.8");
    const encodedBody = body === undefined ? undefined : JSON.stringify(body);
    // Capture the submitted identity before fetching a session token or sending bytes.
    const suppliedRequestId = body?.requestId;
    const requestId = typeof suppliedRequestId === "string" ? suppliedRequestId : undefined;
    let response;
    try {
      if (method === "POST") {
        headers.set("X-Task-Desk-Token", await this.#token(signal));
        headers.set("Content-Type", "application/json");
        // Browsers supply Origin; Node fetch requires the desk origin explicitly.
        if (this.#sendOrigin) headers.set("Origin", this.baseUrl);
      }
      response = await this.#fetch(new URL(path, this.baseUrl + "/"), {
        method, headers, signal, credentials: "same-origin",
        ...(encodedBody === undefined ? {} : { body: encodedBody }),
      });
      if (!response.ok) {
        const text = await response.text();
        let payload;
        try { payload = JSON.parse(text); } catch { payload = undefined; }
        const error = payload?.error;
        const hasDetails = error !== null && typeof error === "object"
          && Object.prototype.hasOwnProperty.call(error, "details");
        throw new TaskDeskError(
          typeof error?.message === "string" ? error.message : "Task desk HTTP " + response.status,
          { status: response.status,
            code: typeof error?.code === "string" ? error.code : "TASK_DESK_HTTP_ERROR",
            nativeResult: error?.nativeResult, requestId,
            details: hasDetails ? error.details
              : payload === undefined ? { body: text.slice(0, 4096) } : payload },
        );
      }
      return mode === "raw" ? response : await this.#decode(response, mode);
    } catch (cause) {
      if (cause instanceof TaskDeskError) {
        if (requestId !== undefined) cause.requestId = requestId;
        throw cause;
      }
      if (signal?.aborted && requestId === undefined) throw abortReason(signal);
      const aborted = signal?.aborted === true;
      throw new TaskDeskError(
        aborted ? "The command request stopped; reopen its original retained operation"
          : response ? "The desk response ended before it could be read"
            : "The desk request did not return a response",
        { code: aborted ? "TASK_DESK_REQUEST_ABORTED" : "TASK_DESK_TRANSPORT_ERROR",
          status: response?.status ?? 0, requestId,
          details: { method, path, ...(requestId === undefined ? {} : { requestId }) },
          cause: aborted ? abortReason(signal) : cause },
      );
    }
  }

  #taskPath(taskId) {
    return "/api/tasks/" + segment(taskId, "taskId");
  }

  async getStatus(options) {
    const status = await this.#request("/api/status", { signal: options?.signal });
    if (typeof status?.csrfToken === "string" && status.csrfToken.length > 0) {
      this.#csrfToken = status.csrfToken;
    }
    return status;
  }

  listJobs(options) {
    return this.#request("/api/jobs", { signal: options?.signal });
  }

  #rpcPath(intentId, { commerceDirectory, readId, responseSha256 } = {}, download = false) {
    let path = "/api/jobs/" + segment(intentId, "intentId") + "/rpc-results";
    const query = new URLSearchParams();
    if (commerceDirectory !== undefined) {
      segment(commerceDirectory, "commerceDirectory");
      query.set("commerceDirectory", commerceDirectory);
    }
    if (readId !== undefined) {
      path += "/" + segment(readId, "readId") + (download ? "/download" : "");
      segment(responseSha256, "responseSha256");
      query.set("responseSha256", responseSha256);
    }
    return path + (query.size ? "?" + query : "");
  }

  /** Read retained editions through the original authenticated commerce reader. */
  listRpcResponses(intentId, { commerceDirectory, signal } = {}) {
    return this.#request(this.#rpcPath(intentId, { commerceDirectory }), { signal });
  }

  /** Inspect and verify one exact saved read; its original attempt remains in job. */
  getRpcResponse(intentId, selection, options) {
    segment(selection?.readId, "readId");
    return this.#request(this.#rpcPath(intentId, selection), { signal: options?.signal });
  }

  /** Complete original response bytes as a streamed Response. */
  downloadRpcResponse(intentId, selection, options) {
    segment(selection?.readId, "readId");
    return this.#request(this.#rpcPath(intentId, selection, true), { signal: options?.signal, mode: "raw" });
  }

  listTasks(options) {
    return this.#request("/api/tasks", { signal: options?.signal });
  }

  previewTask(input, options) {
    return this.#request("/api/tasks/preview", { signal: options?.signal, method: "POST", body: input });
  }

  createTask(input, options) {
    segment(input?.expectedPreviewSha256, "expectedPreviewSha256");
    return this.#request("/api/tasks", { signal: options?.signal, method: "POST", body: input });
  }

  getTask(taskId, options) {
    return this.#request(this.#taskPath(taskId), { signal: options?.signal });
  }

  reviewTask(taskId, input, options) {
    segment(input?.intentId, "intentId");
    return this.#request(this.#taskPath(taskId) + "/review", { signal: options?.signal, method: "POST", body: input });
  }

  executeTask(taskId, input, options) {
    segment(input?.intentId, "intentId");
    segment(input?.reviewId, "reviewId");
    segment(input?.requestId, "requestId");
    return this.#request(this.#taskPath(taskId) + "/execute", { signal: options?.signal, method: "POST", body: input });
  }

  recoverTask(taskId, input, options) {
    segment(input?.intentId, "intentId");
    segment(input?.requestId, "requestId");
    return this.#request(this.#taskPath(taskId) + "/recover", { signal: options?.signal, method: "POST", body: input });
  }

  receiveTask(taskId, input, options) {
    segment(input?.requestId, "requestId");
    return this.#request(this.#taskPath(taskId) + "/receive", { signal: options?.signal, method: "POST", body: input });
  }

  getOperation(operationId, options) {
    return this.#request("/api/operations/" + segment(operationId, "operationId"), { signal: options?.signal });
  }

  listOperations({ taskId, signal } = {}) {
    if (taskId !== undefined) segment(taskId, "taskId");
    const query = taskId === undefined ? "" : "?" + new URLSearchParams({ taskId });
    return this.#request("/api/operations" + query, { signal });
  }

  compareTask(taskId, previousId, options) {
    segment(previousId, "previousId");
    const query = new URLSearchParams({ previousId });
    return this.#request(this.#taskPath(taskId) + "/compare?" + query, { signal: options?.signal });
  }

  getPacket(taskId, options) {
    return this.#request(this.#taskPath(taskId) + "/packet", { signal: options?.signal });
  }

  getPacketReview(taskId, options) {
    return this.#request(this.#taskPath(taskId) + "/packet/review", { signal: options?.signal, mode: "auto" });
  }

  /** Stream the selected intent's complete received response bytes. */
  downloadIntentResponse(taskId, intentId, options) {
    segment(intentId, "intentId");
    const query = new URLSearchParams({ intentId });
    return this.#request(this.#taskPath(taskId) + "/packet/download?" + query, { signal: options?.signal, mode: "raw" });
  }

  /** Stream the complete received packet as application/x-tar. */
  downloadPacketArchive(taskId, options) {
    return this.#request(this.#taskPath(taskId) + "/packet/archive", { signal: options?.signal, mode: "raw" });
  }

  /** Read the original complete packet's exact delivery selection. */
  inspectCustomerTask(taskId, options) {
    return this.#request(this.#taskPath(taskId) + "/customer-deliveries/inspect-task", { signal: options?.signal });
  }
  listCustomerDeliveries(taskId, options) {
    return this.#request(this.#taskPath(taskId) + "/customer-deliveries", { signal: options?.signal });
  }
  previewCustomerDelivery(taskId, input, options) {
    return this.#request(this.#taskPath(taskId) + "/customer-deliveries/preview", {
      method: "POST", body: input, signal: options?.signal,
    });
  }
  /** Send the same reviewed native request once; retain it for explicit same-ID continuation. */
  prepareCustomerDelivery(taskId, input, options) {
    const deliveryId = input?.request?.id;
    segment(deliveryId, "deliveryId");
    segment(input?.expectedPreviewSha256, "expectedPreviewSha256");
    return this.#request(this.#taskPath(taskId) + "/customer-deliveries/prepare", {
      method: "POST", body: { ...input, requestId: deliveryId }, signal: options?.signal,
    });
  }
  getCustomerDelivery(taskId, deliveryId, options) {
    return this.#request(this.#taskPath(taskId) + "/customer-deliveries/named/" + segment(deliveryId, "deliveryId"),
      { signal: options?.signal });
  }
  /** Complete verified native package stream; consuming or aborting it does not change preparation. */
  downloadCustomerDelivery(taskId, deliveryId, options) {
    return this.#request(this.#taskPath(taskId) + "/customer-deliveries/named/" + segment(deliveryId, "deliveryId") + "/download",
      { signal: options?.signal, mode: "raw" });
  }
  createCustomerSourceManifest(input, options) {
    return this.#request("/api/customer-delivery/source-manifest", { method: "POST", body: input, signal: options?.signal });
  }

  /** Poll retained metadata. Cancellation or timeout affects this wait only. */
  async waitForOperation(operationId, { signal, pollIntervalMs = 1000, timeoutMs = 0 } = {}) {
    segment(operationId, "operationId");
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
      throw new TypeError("pollIntervalMs must be a positive finite number");
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new TypeError("timeoutMs must be a non-negative finite number");
    }
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(abortReason(signal));
    if (signal?.aborted) forwardAbort();
    else signal?.addEventListener("abort", forwardAbort, { once: true });
    let timedOut = false;
    const timer = timeoutMs > 0 ? setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("Waiting for the operation timed out", "TimeoutError"));
    }, timeoutMs) : undefined;
    let lastOperation;
    try {
      for (;;) {
        if (controller.signal.aborted) throw abortReason(controller.signal);
        const reply = await this.getOperation(operationId, { signal: controller.signal });
        const operation = reply?.operation;
        if (!operation || typeof operation.state !== "string") {
          throw new TaskDeskError("The desk did not return a retained operation", {
            code: "TASK_DESK_INVALID_OPERATION", status: 200, details: { operationId },
          });
        }
        lastOperation = operation;
        if (TERMINAL_STATES.has(operation.state)) return operation;
        await pause(pollIntervalMs, controller.signal);
      }
    } catch (error) {
      if (timedOut) {
        throw new TaskDeskError("Waiting timed out; the retained operation is still available", {
          code: "TASK_DESK_WAIT_TIMEOUT", status: 0,
          details: { operationId, operation: lastOperation }, cause: error,
        });
      }
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", forwardAbort);
    }
  }
}
