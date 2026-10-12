/*
 * Complete pending requests and unsaved operator reviews for QWC Publication Review.
 * Records remain on this browser's origin. The server's workspace/archive is the
 * durable customer handover; this store preserves work during browser refreshes.
 * IndexedDB transaction completion, not request success, acknowledges a save.
 * API reference: https://www.w3.org/TR/IndexedDB/
 */
const DATABASE = "qwc-publication-review-browser-v1";
const VERSION = 1;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_REQUEST_BYTES = 52 * 1024 * 1024;
const DECISIONS = new Set(["accepted", "correction_required", "not_applicable"]);

function error(code, message, cause) {
  const value = new Error(message);
  value.code = code;
  if (cause) value.cause = cause;
  return value;
}

function need(condition, code, message) {
  if (!condition) throw error(code, message);
}

function id(value, label) {
  need(typeof value === "string" && IDENTIFIER.test(value), "BROWSER_RECORD_ID",
    label + " must be the original short identifier.");
  return value;
}

function canonical(value, seen = new Set(), depth = 0) {
  need(depth <= 100, "BROWSER_INPUT_DEPTH", "The selected request is nested too deeply.");
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    need(Number.isFinite(value), "BROWSER_INPUT_NUMBER", "Request numbers must be finite.");
    return JSON.stringify(value);
  }
  need(value && typeof value === "object" && !seen.has(value),
    "BROWSER_INPUT_TYPE", "Retain a complete JSON request without cycles or omitted values.");
  need(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null, "BROWSER_INPUT_TYPE",
    "The selected request must contain only JSON objects and arrays.");
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    const items = [];
    for (let index = 0; index < value.length; index++) {
      need(Object.hasOwn(value, index), "BROWSER_INPUT_TYPE", "Request arrays cannot contain omitted values.");
      items.push(canonical(value[index], seen, depth + 1));
    }
    result = "[" + items.join(",") + "]";
  } else {
    result = "{" + Object.keys(value).sort().map(key =>
      JSON.stringify(key) + ":" + canonical(value[key], seen, depth + 1)).join(",") + "}";
  }
  seen.delete(value);
  return result;
}

async function requestIdentity(payload) {
  const operationId = id(payload?.operation_id, "operation_id");
  need(typeof payload.action === "string" && payload.action.length > 0,
    "BROWSER_ACTION", "Retain the original operator action.");
  const json = canonical(payload);
  const raw = new TextEncoder().encode(json);
  need(raw.byteLength <= MAX_REQUEST_BYTES, "BROWSER_REQUEST_SIZE",
    "The complete operator request exceeds 52 MiB.");
  need(globalThis.crypto?.subtle, "BROWSER_CRYPTO",
    "Open the original local operator to retain this request.");
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", raw));
  return {operationId, json, bytes: raw.byteLength,
    sha256: Array.from(hash, value => value.toString(16).padStart(2, "0")).join("")};
}

function draftValue(value) {
  need(value && typeof value === "object" && DECISIONS.has(value.decision),
    "BROWSER_DRAFT", "Select an operator review decision.");
  need(typeof value.note === "string" && value.note.length <= 8000,
    "BROWSER_DRAFT", "The review note must contain at most 8,000 characters.");
  need(Number.isSafeInteger(value.base_revision) && value.base_revision >= 0,
    "BROWSER_DRAFT_REVISION", "Keep the workspace revision on which this draft was started.");
  return {decision: value.decision, note: value.note, base_revision: value.base_revision};
}

function equalDraft(left, right) {
  return left.decision === right.decision && left.note === right.note &&
    left.base_revision === right.base_revision;
}

/**
 * Open this exact original or received workspace's browser records.
 *
 * receivingArchiveSha is "original" or overview.receiving_context.archive_sha256.
 * Call putPending BEFORE sending /api/actions and await its committed result.
 * A repeated operation_id must carry identical complete JSON input.
 *
 * putDraft keeps the original base_revision while notes are edited. listDrafts
 * returns an object keyed by capture_id. Keep an in-memory copy while rendering.
 * After a successful review save, use removeDraft(captureId, submittedDraft):
 * this preserves a newer edit typed while that save was in flight.
 * removeDraft(captureId) is reserved for the operator's explicit Discard action.
 * After a server revision conflict, explicitly review the current state and call
 * rebaseDraft(captureId, currentRevision, unchangedDraft) to keep the note.
 */
export async function openReviewStore(workspaceId, receivingArchiveSha = "original") {
  id(workspaceId, "workspace_id");
  need(receivingArchiveSha === "original" ||
    typeof receivingArchiveSha === "string" && SHA256.test(receivingArchiveSha),
    "BROWSER_RECEIVING_CONTEXT", "Select the original receiving archive identity.");
  need(globalThis.indexedDB, "BROWSER_STORAGE_UNAVAILABLE",
    "This browser cannot retain publication files. Open the local operator in a browser with IndexedDB enabled.");

  const scope = JSON.stringify([workspaceId, receivingArchiveSha]);
  let closed = false;
  const db = await new Promise((resolve, reject) => {
    let settled = false;
    const fail = cause => {
      if (settled) return;
      settled = true;
      reject(error("BROWSER_STORAGE_OPEN", "The browser could not open the saved review work.", cause));
    };
    let request;
    try { request = indexedDB.open(DATABASE, VERSION); }
    catch (cause) { fail(cause); return; }
    request.onupgradeneeded = () => {
      try {
        for (const name of ["pending", "drafts"]) {
          if (!request.result.objectStoreNames.contains(name)) {
            const store = request.result.createObjectStore(name, {keyPath: "key"});
            store.createIndex("scope", "scope", {unique: false});
          }
        }
      } catch (cause) {
        request.transaction.abort();
        fail(cause);
      }
    };
    request.onerror = () => fail(request.error);
    request.onblocked = () => fail(error("BROWSER_STORAGE_UPGRADE",
      "Close an older publication-review tab, then reopen this operator."));
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      settled = true;
      resolve(request.result);
    };
  });
  db.onversionchange = () => { closed = true; db.close(); };
  db.onclose = () => { closed = true; };

  const key = recordId => JSON.stringify([scope, recordId]);

  function transact(name, mode, setup) {
    return new Promise((resolve, reject) => {
      if (closed) {
        reject(error("BROWSER_STORAGE_CLOSED", "Reload the operator to reopen the saved review work."));
        return;
      }
      let tx, value, failure;
      try {
        tx = mode === "readwrite"
          ? db.transaction(name, mode, {durability: "strict"})
          : db.transaction(name, mode);
      } catch (cause) {
        reject(error("BROWSER_STORAGE_TRANSACTION", "The browser could not open this saved-work transaction.", cause));
        return;
      }
      const stop = cause => {
        failure = cause;
        try { tx.abort(); } catch {}
      };
      const read = (request, callback) => {
        request.onsuccess = () => {
          try { callback(request.result); } catch (cause) { stop(cause); }
        };
      };
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => {
        const cause = failure || tx.error;
        reject(typeof cause?.code === "string" ? cause : error("BROWSER_STORAGE_SAVE",
          cause?.name === "QuotaExceededError"
            ? "The browser has insufficient space for this complete request. Keep the selected files and free browser storage before retrying the same action."
            : "The browser did not commit this saved work. Your selected request has not been replaced.",
          cause));
      };
      try { setup(tx.objectStore(name), result => { value = result; }, read); }
      catch (cause) { stop(cause); }
    });
  }

  const api = {
    workspaceId,
    receivingArchiveSha,
    migrationError: null,

    async putPending(payload) {
      const identity = await requestIdentity(payload);
      return transact("pending", "readwrite", (store, done, read) => {
        read(store.get(key(identity.operationId)), old => {
          if (old) {
            need(old.sha256 === identity.sha256 && old.payload_json === identity.json,
              "OPERATION_INPUT_CHANGED",
              "This retained operation ID already selects a different complete request.");
            done({operation_id: old.operation_id, sha256: old.sha256, bytes: old.bytes,
              created_at: old.created_at, reused: true});
            return;
          }
          const record = {key: key(identity.operationId), scope,
            operation_id: identity.operationId, sha256: identity.sha256,
            bytes: identity.bytes, payload_json: identity.json,
            created_at: new Date().toISOString()};
          store.add(record);
          done({operation_id: record.operation_id, sha256: record.sha256,
            bytes: record.bytes, created_at: record.created_at, reused: false});
        });
      });
    },

    async listPending() {
      const rows = await transact("pending", "readonly", (store, done, read) =>
        read(store.index("scope").getAll(scope), done));
      const values = Object.create(null);
      for (const row of rows) {
        const payload = JSON.parse(row.payload_json);
        const identity = await requestIdentity(payload);
        need(identity.operationId === row.operation_id && identity.sha256 === row.sha256 &&
          identity.bytes === row.bytes, "BROWSER_PENDING_CHANGED",
          "A retained browser request differs from its original complete input.");
        values[row.operation_id] = payload;
      }
      return values;
    },

    removePending(operationId) {
      id(operationId, "operation_id");
      return transact("pending", "readwrite", (store, done) => {
        store.delete(key(operationId));
        done({operation_id: operationId, removed: true});
      });
    },

    putDraft(captureId, input) {
      id(captureId, "capture_id");
      const draft = draftValue(input);
      return transact("drafts", "readwrite", (store, done, read) => {
        read(store.get(key(captureId)), old => {
          need(!old || old.draft.base_revision === draft.base_revision,
            "BROWSER_DRAFT_REVISION",
            "This unfinished note belongs to an earlier workspace revision. Keep or explicitly discard it before starting a new review.");
          const record = {key: key(captureId), scope, capture_id: captureId, draft,
            edit_revision: (old?.edit_revision || 0) + 1,
            created_at: old?.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString()};
          store.put(record);
          done({...draft, edit_revision: record.edit_revision, updated_at: record.updated_at});
        });
      });
    },

    async listDrafts() {
      const rows = await transact("drafts", "readonly", (store, done, read) =>
        read(store.index("scope").getAll(scope), done));
      const values = Object.create(null);
      for (const row of rows) values[row.capture_id] =
        {...row.draft, edit_revision: row.edit_revision, updated_at: row.updated_at};
      return values;
    },

    rebaseDraft(captureId, newBaseRevision, reviewedDraft) {
      id(captureId, "capture_id");
      const expected = draftValue(reviewedDraft);
      need(Number.isSafeInteger(newBaseRevision) && newBaseRevision >= 0,
        "BROWSER_DRAFT_REVISION", "Select the current workspace revision after reviewing its state.");
      return transact("drafts", "readwrite", (store, done, read) => {
        read(store.get(key(captureId)), old => {
          need(old && equalDraft(old.draft, expected), "BROWSER_DRAFT_CHANGED",
            "The unfinished note changed. Reopen that note before updating its review revision.");
          const draft = {...old.draft, base_revision: newBaseRevision};
          const record = {...old, draft, edit_revision: old.edit_revision + 1,
            updated_at: new Date().toISOString()};
          store.put(record);
          done({...draft, edit_revision: record.edit_revision, updated_at: record.updated_at});
        });
      });
    },

    removeDraft(captureId, submittedDraft) {
      id(captureId, "capture_id");
      const expected = submittedDraft === undefined ? undefined : draftValue(submittedDraft);
      return transact("drafts", "readwrite", (store, done, read) => {
        read(store.get(key(captureId)), old => {
          if (old && expected && !equalDraft(old.draft, expected)) {
            done({capture_id: captureId, removed: false, reason: "newer_edit",
              draft: {...old.draft, edit_revision: old.edit_revision, updated_at: old.updated_at}});
            return;
          }
          store.delete(key(captureId));
          done({capture_id: captureId, removed: true});
        });
      });
    },

    close() { closed = true; db.close(); }
  };

  // The previous UI used one small localStorage object for full request bodies.
  // Migrate only the original workspace's exact records. An imported archive
  // receives its own namespace and cannot replay an original browser request.
  if (receivingArchiveSha === "original") {
    const legacyKey = "qwc-publication-review.pending." + workspaceId;
    let storage, original;
    try {
      storage = globalThis.localStorage;
      original = storage?.getItem(legacyKey);
      if (original) {
        const pending = JSON.parse(original);
        need(pending && typeof pending === "object" && !Array.isArray(pending),
          "BROWSER_LEGACY_PENDING", "The earlier pending requests need their original JSON object.");
        for (const [operationId, payload] of Object.entries(pending)) {
          need(payload?.operation_id === operationId, "BROWSER_LEGACY_PENDING",
            "An earlier pending request has a different original operation ID.");
          await api.putPending(payload);
        }
        // Another old tab may have appended a request during migration.
        if (storage.getItem(legacyKey) === original) storage.removeItem(legacyKey);
      }
    } catch (cause) {
      api.migrationError = {code: cause.code || "BROWSER_LEGACY_PENDING",
        message: "Earlier pending requests remain in their original browser storage: " + cause.message};
    }
  }
  return api;
}
