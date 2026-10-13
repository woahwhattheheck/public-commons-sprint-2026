/**
 * Compose complete application source in a JavaScript runtime.
 * Uses the maintained carrier codec and the original Python receiver formats.
 * Callers provide original complete carriers; this module performs no network,
 * filesystem, supplied-source execution, scientific run or publishing operation.
 */
import {SOURCE_LIMIT_BYTES, fromBase64, utf8Decode, utf8Encode, sha256Bytes, inflateGzip} from "./carrier_codec.mjs";

const ROOT = "opportunities/upstate_forever_2026";
const MAP = "commons.source-map/1";
const KIND = "upstate.complete-application-source/v1";

function canonical(value) {
  const walk = v => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map(k => [k, walk(v[k])]));
    if (typeof v === "number" && !Number.isFinite(v)) throw Error("Source metadata requires finite numbers");
    if (v === undefined) throw Error("Source metadata cannot contain undefined");
    return v;
  };
  return JSON.stringify(walk(value));
}
function digest(value) { return sha256Bytes(utf8Encode(canonical(value))); }
function memberName(name) {
  if (typeof name !== "string") throw Error("Source member requires a path");
  if (name.startsWith(ROOT + "/")) name = name.slice(ROOT.length + 1);
  if (!name || name.startsWith("/") || name.includes("\\") || /[\x00-\x1f\x7f]/.test(name) ||
      name.split("/").some(p => !p || p === "." || p === ".." || p.includes(":")) ||
      name.startsWith("opportunities/")) throw Error("Invalid application source member: " + name);
  return name;
}
function transportJSON(text) {
  // Canvas indentation can contain NBSP. Preserve every character inside strings.
  let clean = "", quoted = false, escaped = false;
  for (const ch of text.replace(/^\uFEFF/, "")) {
    if (quoted) {
      clean += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quoted = false;
    } else {
      if (ch === '"') quoted = true;
      clean += ch === "\u00a0" ? " " : ch;
    }
  }
  return JSON.parse(clean);
}
function alias(entry, names, label) {
  const values = names.filter(n => entry[n] !== undefined && entry[n] !== null).map(n => entry[n]);
  if (values.some(v => v !== values[0])) throw Error("Conflicting " + label + " metadata");
  return values.length ? values[0] : null;
}
function unwrap(input) {
  if (typeof input === "string") return input;
  if (input && typeof input === "object" && input.schema && input.files) return input;
  if (input?.isError) throw Error("Read the successful original source response before composing");
  const structured = input?.structuredContent;
  if (typeof structured?.text_content === "string") return structured.text_content;
  if (typeof structured?.b64_string === "string") return utf8Decode(fromBase64(structured.b64_string));
  if (typeof structured?.content === "string") return structured.content;
  const texts = (input?.content || []).filter(b => b.type === "text").map(b => b.text);
  for (const text of texts) {
    try {
      const value = transportJSON(text);
      if (value.files || value.schema) return value;
      if (typeof value.text_content === "string") return value.text_content;
    } catch {}
  }
  if (texts.length === 1) return texts[0];
  throw Error("Choose one complete source document or its original file response");
}

function predecessorMetadata(entry, path) {
  const retained = entry.predecessor_declarations || [];
  if (!Array.isArray(retained) || retained.some(row => !row || typeof row !== "object" || Array.isArray(row)))
    throw Error("Invalid predecessor declarations: " + path);
  const declarations = [...retained];
  const fields = ["base_sha256", "replaces_sha256", "before_sha256", "before_bytes",
    "before", "base_ref", "base_git_blob", "base"];
  const declared = Object.fromEntries(fields.filter(key => Object.hasOwn(entry, key)).map(key => [key, entry[key]]));
  if (Object.keys(declared).length && !declarations.some(row => canonical(row) === canonical(declared)))
    declarations.push(declared);
  const hashes = [];
  for (const row of declarations) {
    for (const key of ["base_sha256", "replaces_sha256", "before_sha256"])
      if (row[key] !== undefined && row[key] !== null) hashes.push(row[key]);
    for (const key of ["before", "base"])
      if (row[key] && typeof row[key] === "object" && !Array.isArray(row[key]) &&
          row[key].sha256 !== undefined && row[key].sha256 !== null) hashes.push(row[key].sha256);
  }
  if (hashes.some(hash => typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)))
    throw Error("Invalid predecessor identity: " + path);
  if (new Set(hashes).size > 1) throw Error("Conflicting predecessor identities: " + path);
  return {sha256: hashes[0] || null, declarations};
}

function layerFromDocument(document, {label = "source", payloadSha256 = null, payloadBytes = null} = {}) {
  if (!document || typeof document !== "object" || !document.files) throw Error("Source has no file inventory");
  const raw = document.files, declared = document.file_metadata || {};
  if (document.schema === MAP && document.kind === KIND) {
    if (Array.isArray(raw) || !document.file_metadata ||
        canonical(Object.keys(raw).sort()) !== canonical(Object.keys(declared).sort()))
      throw Error("Complete source-map metadata must cover the exact source inventory");
    for (const path of Object.keys(raw)) {
      const row = declared[path];
      if (!row || !Number.isSafeInteger(row.bytes) || !/^[0-9a-f]{64}$/.test(row.sha256))
        throw Error("Complete source-map identity is missing: " + path);
    }
  }
  const entries = Array.isArray(raw) ? raw : Object.entries(raw).map(([path, content]) => {
    if (typeof content === "string") return {...(declared[path] || {}), path, content};
    if (content && typeof content === "object") return {...content, path};
    throw Error("Source file body is missing: " + path);
  });
  if (!entries.length || entries.length > 10000) throw Error("Source inventory size is invalid");
  const files = Object.create(null), metadata = Object.create(null);
  for (const entry of entries) {
    const path = memberName(entry.path);
    const encoded = entry.content_base64;
    let bytes = encoded !== undefined ? fromBase64(encoded) :
      typeof entry.content === "string" ? (entry.encoding === "base64" ? fromBase64(entry.content) : utf8Encode(entry.content)) : null;
    if (!bytes) throw Error("Complete source body is missing: " + path);
    const count = alias(entry, ["bytes", "byte_length"], path);
    const hash = entry.sha256;
    // Canvas can replace source indentation with NBSP. Recover only when both
    // original byte count and SHA256 prove the exact original source body.
    if (encoded === undefined && entry.encoding !== "base64" &&
        typeof entry.content === "string" && entry.content.includes("\u00a0") &&
        Number.isSafeInteger(count) && /^[0-9a-f]{64}$/.test(hash || "") &&
        (bytes.length !== count || sha256Bytes(bytes) !== hash)) {
      const recovered = utf8Encode(entry.content.replaceAll("\u00a0", " "));
      if (recovered.length === count && sha256Bytes(recovered) === hash) bytes = recovered;
    }
    if (count !== null && (!Number.isSafeInteger(count) || count < 0 || count !== bytes.length))
      throw Error("Source byte count differs: " + path);
    const actual = sha256Bytes(bytes);
    if (hash !== undefined && hash !== null && hash !== actual) throw Error("Source SHA256 differs: " + path);
    const content = utf8Decode(bytes);
    if (sha256Bytes(utf8Encode(content)) !== actual) throw Error("Source requires exact UTF-8 text: " + path);
    const mode = entry.mode || null;
    if (mode !== null && !["100644", "100755"].includes(mode)) throw Error("Unsupported source mode: " + path);
    const predecessor = predecessorMetadata(entry, path);
    const item = {bytes: bytes.length, sha256: actual, mode,
      git_blob: alias(entry, ["git_blob", "git_blob_sha", "github_blob_sha"], path),
      origins: Array.isArray(entry.origins) ? [...entry.origins] : []};
    if (predecessor.sha256 !== null) item.base_sha256 = predecessor.sha256;
    if (predecessor.declarations.length) item.predecessor_declarations = predecessor.declarations;
    if (files[path] !== undefined) {
      const prior = metadata[path], left = {...prior}, right = {...item};
      for (const row of [left, right]) { delete row.base_sha256; delete row.predecessor_declarations; }
      if (files[path] !== content || canonical(left) !== canonical(right))
        throw Error("Conflicting duplicate source file: " + path);
      if (prior.base_sha256 && item.base_sha256 && prior.base_sha256 !== item.base_sha256)
        throw Error("Source-bank blocks select different predecessors: " + path);
      if (prior.base_sha256) item.base_sha256 = prior.base_sha256;
      const declarations = [...(prior.predecessor_declarations || [])];
      for (const declared of item.predecessor_declarations || [])
        if (!declarations.some(row => canonical(row) === canonical(declared))) declarations.push(declared);
      if (declarations.length) item.predecessor_declarations = declarations;
    }
    files[path] = content; metadata[path] = item;
  }
  const total = Object.values(metadata).reduce((n, row) => n + row.bytes, 0);
  if (total > SOURCE_LIMIT_BYTES) throw Error("Source exceeds the complete carrier capacity");
  return {document, files, metadata, receipt: {carrier_name: label,
    payload_sha256: payloadSha256 || digest(document),
    payload_bytes: payloadBytes === null ? utf8Encode(canonical(document)).length : payloadBytes,
    original_schema: document.schema || null, source_ref: document.source_ref || document.source_reference || null,
    files: Object.keys(files).length, source_bytes: total}};
}

function readSourceLayer(input, {label = "source", expectedPayloadSha256 = null} = {}) {
  const value = unwrap(input);
  let document, raw;
  if (typeof value !== "string") { document = value; raw = utf8Encode(canonical(value)); }
  else {
    const trimmed = value.trim();
    if (trimmed.startsWith("{")) { document = transportJSON(value); raw = utf8Encode(value); }
    else {
      const blocks = [...value.matchAll(/^[ \t]*~~~json[ \t]*\r?\n([\s\S]*?)^[ \t]*~~~[ \t]*(?:\r?\n|$)/gm), ...value.matchAll(/^[ \t]*```json[ \t]*\r?\n([\s\S]*?)^[ \t]*```[ \t]*(?:\r?\n|$)/gm)];
      const documents = blocks.map(m => transportJSON(m[1]));
      const parts = documents.filter(d => d.schema === "upstate.application-source-part/v1");
      const transport = documents.filter(d => d.schema === "upstate.application-source-transport/v1");
      const plainParts = [...value.matchAll(/^[ \t]*```base64[ \t]*\r?\n([\s\S]*?)^[ \t]*```[ \t]*(?:\r?\n|$)/gm)];
      if (!documents.length && plainParts.length) {
        raw = fromBase64(plainParts.map(m => m[1].replace(/\s/g, "")).join(""));
        document = transportJSON(utf8Decode(raw));
      } else if (transport.length) {
        if (transport.length !== 1 || documents.length !== parts.length + 1)
          throw Error("Choose one complete source transport");
        const header = transport[0];
        if (header.encoding !== "gzip+base64" || header.parts !== parts.length)
          throw Error("Incomplete application source transport");
        parts.sort((a, b) => a.part - b.part);
        parts.forEach((part, i) => {
          if (part.part !== i + 1 || part.parts !== header.parts ||
              part.operation_id !== header.operation_id || typeof part.data_base64 !== "string" ||
              (part.encoding && part.encoding !== header.encoding))
            throw Error("Source transport part identity differs");
        });
        const compressed = fromBase64(parts.map(p => p.data_base64).join(""));
        if (compressed.length !== header.compressed_bytes ||
            sha256Bytes(compressed) !== header.compressed_sha256)
          throw Error("Compressed source transport differs");
        raw = inflateGzip(compressed);
        if (raw.length !== header.decoded_bytes || sha256Bytes(raw) !== header.decoded_sha256)
          throw Error("Decoded source transport differs");
        document = transportJSON(utf8Decode(raw));
        const decoded = layerFromDocument(document, {label});
        if (Object.keys(decoded.files).length !== header.file_count ||
            decoded.receipt.source_bytes !== header.source_bytes)
          throw Error("Source transport inventory differs");
      } else if (parts.length) {
        if (parts.length !== documents.length) throw Error("Application parts cannot mix unrelated JSON documents");
        parts.sort((a, b) => a.part - b.part);
        const first = parts[0], common = ["schema", "edition", "encoding", "parts", "payload_bytes",
          "payload_sha256", "compressed_bytes", "compressed_sha256", "files", "source_bytes"];
        if (first.encoding !== "gzip+base64" || first.parts !== parts.length) throw Error("Incomplete application source carrier");
        parts.forEach((part, i) => {
          if (part.part !== i + 1 || common.some(k => part[k] !== first[k])) throw Error("Application source part identity differs");
        });
        const compressed = fromBase64(parts.map(p => p.data).join(""));
        if (!Number.isSafeInteger(first.payload_bytes) || first.payload_bytes < 0 ||
            !/^[0-9a-f]{64}$/.test(first.payload_sha256))
          throw Error("Application source requires the original complete payload identity");
        if (compressed.length !== first.compressed_bytes ||
            (first.compressed_sha256 !== undefined && sha256Bytes(compressed) !== first.compressed_sha256))
          throw Error("Compressed application source differs");
        raw = inflateGzip(compressed);
        if (raw.length !== first.payload_bytes || sha256Bytes(raw) !== first.payload_sha256)
          throw Error("Decoded application source differs");
        document = transportJSON(utf8Decode(raw));
        if (Object.keys(document.files || {}).length !== first.files) throw Error("Application file count differs");
        const decoded = layerFromDocument(document, {label});
        if (decoded.receipt.source_bytes !== first.source_bytes) throw Error("Application source byte total differs");
      } else {
        const banks = documents.filter(d => d.files);
        if (!banks.length || banks.length !== documents.length) throw Error("Choose a complete supported source bank");
        if (banks.length === 1) { document = banks[0]; raw = utf8Encode(blocks[0][1].trim()); }
        else {
          const identity = d => canonical(Object.fromEntries(Object.entries(d).filter(([k]) => k !== "files")));
          if (banks.some(d => identity(d) !== identity(banks[0]) || !Array.isArray(d.files)))
            throw Error("Source-bank blocks belong to different original cohorts");
          document = {...banks[0], files: banks.flatMap(d => d.files)};
          raw = utf8Encode(canonical(document));
        }
      }
    }
  }
  const hash = sha256Bytes(raw);
  if (expectedPayloadSha256 !== null && hash !== expectedPayloadSha256) throw Error("Selected source payload differs: " + label);
  return layerFromDocument(document, {label, payloadSha256: hash, payloadBytes: raw.length});
}

function composeApplication(layers, {edition, operationId = null} = {}) {
  if (!Array.isArray(layers) || !layers.length || layers[0].document.schema !== MAP ||
      layers[0].document.kind !== KIND) throw Error("Start with the original complete application source map");
  if (typeof edition !== "string" || !edition.trim()) throw Error("Name the cumulative application edition");
  const files = Object.create(null), metadata = Object.create(null), changes = [], externals = new Map(), references = new Map();
  layers.forEach((layer, index) => {
    const origin = layer.receipt.payload_sha256;
    for (const name of Object.keys(layer.files).sort()) {
      const previous = metadata[name], incoming = {...layer.metadata[name]};
      const expected = incoming.base_sha256 || null, declarations = incoming.predecessor_declarations || [];
      delete incoming.base_sha256;
      delete incoming.predecessor_declarations;
      incoming.mode = incoming.mode || previous?.mode || "100644";
      const action = !previous ? "added" : previous.sha256 === incoming.sha256 && previous.mode === incoming.mode ? "identical" : "replaced";
      if ((action === "added" && expected !== null) ||
          (action === "replaced" && expected !== previous.sha256))
        throw Error("Source join differs at layer " + index + ": " + name +
          "; current_sha256=" + (previous?.sha256 || "<absent>") +
          "; incoming_sha256=" + incoming.sha256 +
          "; expected_predecessor_sha256=" + (expected || "<undeclared>") +
          ". Apply the intended source joins to the current member and publish its before_sha256.");
      if (!incoming.git_blob && previous?.sha256 === incoming.sha256) incoming.git_blob = previous.git_blob || null;
      incoming.origins = [...new Set([...(previous?.origins || []), ...(incoming.origins || []), origin])];
      const change = {layer: index, path: name, action, previous_sha256: previous?.sha256 || null, sha256: incoming.sha256};
      if (expected !== null) change.base_sha256 = expected;
      if (declarations.length) change.predecessor_declarations = declarations;
      changes.push(change);
      files[name] = layer.files[name]; metadata[name] = incoming;
    }
    const keepReference = row => {
      if (!row || typeof row !== "object" || typeof row.reference !== "string" || !row.reference)
        throw Error("Original external reference is incomplete");
      references.set(canonical(row), {...row});
    };
    for (const row of layer.document.external_references || []) keepReference(row);
    for (const row of layer.document.external_sources || []) {
      if (row && row.path === undefined && typeof row.reference === "string") {
        keepReference(row); continue;
      }
      const name = memberName(row.path);
      if (!Number.isSafeInteger(row.bytes) || row.bytes < 0 || !/^[0-9a-f]{64}$/.test(row.sha256))
        throw Error("Original external source identity is incomplete: " + name);
      const previous = externals.get(name);
      if (previous && (previous.bytes !== row.bytes || previous.sha256 !== row.sha256))
        throw Error("External source path selects different original bytes: " + name);
      externals.set(name, {...row, path: name});
    }
  });
  for (const [name, row] of externals) if (metadata[name]) {
    if (metadata[name].bytes !== row.bytes || metadata[name].sha256 !== row.sha256)
      throw Error("Embedded source conflicts with original external input: " + name);
    externals.delete(name);
  }
  const orderedFiles = Object.fromEntries(Object.keys(files).sort().map(k => [k, files[k]]));
  const orderedMetadata = Object.fromEntries(Object.keys(metadata).sort().map(k => [k, metadata[k]]));
  for (const name of ["model/workspace.py", "operator/server.py", "operator/web/app.mjs"])
    if (!orderedFiles[name]) throw Error("Complete application is missing " + name);
  const total = Object.values(orderedMetadata).reduce((n, row) => n + row.bytes, 0);
  if (Object.keys(orderedFiles).length > 10000 || total > SOURCE_LIMIT_BYTES) throw Error("Combined application exceeds receiving capacity");
  const externalSources = [...externals.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const externalReferences = [...references.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, row]) => row);
  const assembly = {schema: "upstate.application-assembly/v1", edition, operation_id: operationId,
    layers: layers.map(l => l.receipt), changes,
    members: Object.fromEntries(Object.entries(orderedMetadata).map(([name, row]) => [name, {bytes: row.bytes, sha256: row.sha256, mode: row.mode}])),
    external_sources: externalSources, external_references: externalReferences};
  const base = layers[0].document;
  return {schema: MAP, kind: KIND, edition, repository: base.repository,
    prefix: base.prefix || ROOT, source_ref: "assembly:" + digest(assembly),
    state: "source_stage_complete_application", files: orderedFiles, file_metadata: orderedMetadata,
    assembly, external_sources: externalSources, external_references: externalReferences};
}

function applySourceJoins(current, integration, {label = "original source joins"} = {}) {
  if (!current?.files || !current?.metadata || !integration ||
      integration.schema !== "upstate.operator-integration/v1" ||
      !Array.isArray(integration.edits) || !integration.edits.length ||
      !Array.isArray(integration.allowed_paths))
    throw Error("Choose the current complete source and its original integration plan");
  const allowed = new Set(integration.allowed_paths.map(memberName));
  const files = Object.create(null), predecessors = {}, modes = {}, seen = new Set(), outcomes = [];
  for (const edit of integration.edits) {
    const path = memberName(edit.path);
    if (!allowed.has(path) || !current.files[path] || typeof edit.id !== "string" ||
        !edit.id || seen.has(edit.id) || typeof edit.before !== "string" || !edit.before ||
        typeof edit.after !== "string" || !edit.after || edit.before === edit.after)
      throw Error("Original integration member is incomplete: " + path);
    seen.add(edit.id);
    const body = files[path] ?? current.files[path];
    const beforeCount = body.split(edit.before).length - 1;
    const afterCount = body.split(edit.after).length - 1;
    if (afterCount === 1 && beforeCount <= 1) {
      files[path] = body; outcomes.push({id: edit.id, path, action: "already_applied"});
    } else if (beforeCount === 1 && afterCount === 0) {
      files[path] = body.replace(edit.before, () => edit.after);
      outcomes.push({id: edit.id, path, action: "applied"});
    } else {
      throw Error("Current source join differs: " + edit.id + " in " + path +
                  " (before " + beforeCount + ", after " + afterCount + ")");
    }
    predecessors[path] = current.metadata[path].sha256;
    modes[path] = current.metadata[path].mode || "100644";
  }
  const result = sourceLayer(files, {label, sourceRef: current.receipt.source_ref, predecessors, modes});
  result.document.integration = {schema: integration.schema,
    operation_id: integration.operation_id || null, outcomes};
  result.receipt.integration_sha256 = digest(integration);
  return result;
}

function sourceLayer(files, {label = "authored source", sourceRef = null, predecessors = {}, modes = {}} = {}) {
  const entries = Object.entries(files).map(([path, content]) => {
    const bytes = utf8Encode(content);
    const item = {path, content, bytes: bytes.length, sha256: sha256Bytes(bytes), mode: modes[path] || null};
    if (predecessors[path]) item.base_sha256 = predecessors[path];
    return item;
  });
  return layerFromDocument({schema: "commons.source-bank/v1", source_root: ROOT, source_ref: sourceRef, files: entries}, {label});
}


/** Recoverable literal composition over the current complete source members.
 *
 * file_guards is optional when first authoring a plan. The returned bank always
 * contains exact before/after identities; replay its composition.integration to
 * require that same base or its completed postimage.
 */
function composeSourceJoins(current, integration, {label = "guarded source joins"} = {}) {
  const conflicts = [];
  const fail = (code, detail) => { conflicts.push({code, ...detail}); };
  const identity = body => {
    const bytes = utf8Encode(body);
    return {bytes: bytes.length, sha256: sha256Bytes(bytes)};
  };
  const same = (left, right) => left.bytes === right.bytes && left.sha256 === right.sha256;
  const validIdentity = value => value && Number.isSafeInteger(value.bytes) &&
    value.bytes >= 0 && typeof value.sha256 === "string" && /^[a-f0-9]{64}$/.test(value.sha256);
  const occurrences = (body, span) => {
    let count = 0, offset = 0;
    while ((offset = body.indexOf(span, offset)) !== -1) { count++; offset++; }
    return count;
  };
  const reject = () => {
    const report = {schema: "upstate.source-join-conflicts/v1",
      operation_id: integration?.operation_id || null, label, conflicts};
    const error = Error("Source composition needs a fresh join: " +
      conflicts.map(item => (item.path || "plan") + (item.id ? " [" + item.id + "]" : "") +
        ": " + item.code).join("; "));
    error.code = "SOURCE_JOIN_CONFLICT";
    error.report = report;
    throw error;
  };
  if (!current?.files || !current?.metadata || !integration ||
      integration.schema !== "upstate.operator-integration/v1" ||
      !Array.isArray(integration.edits) || !integration.edits.length ||
      !Array.isArray(integration.allowed_paths)) {
    fail("invalid_integration_plan", {}); reject();
  }
  const allowed = new Set(), groups = new Map(), ids = new Set(), checks = [];
  for (const name of integration.allowed_paths) {
    try {
      const path = memberName(name);
      if (allowed.has(path)) fail("repeated_allowed_path", {path});
      allowed.add(path);
    } catch (error) { fail("invalid_allowed_path", {path: String(name), message: error.message}); }
  }
  for (const edit of integration.edits) {
    try {
      const path = memberName(edit.path);
      if (!allowed.has(path) || typeof current.files[path] !== "string" ||
          typeof edit.id !== "string" || !edit.id || ids.has(edit.id) ||
          typeof edit.before !== "string" || !edit.before ||
          typeof edit.after !== "string" || !edit.after || edit.before === edit.after) {
        fail("invalid_or_repeated_edit", {path, id: edit.id}); continue;
      }
      ids.add(edit.id);
      if (!groups.has(path)) groups.set(path, []);
      groups.get(path).push({...edit, path});
    } catch (error) { fail("invalid_edit_path", {message: error.message}); }
  }
  if (integration.checks !== undefined && !Array.isArray(integration.checks))
    fail("invalid_consumer_checks", {});
  for (const check of Array.isArray(integration.checks) ? integration.checks : []) {
    try {
      const path = memberName(check.path);
      if (!allowed.has(path) || typeof current.files[path] !== "string" ||
          typeof check.id !== "string" || !check.id || ids.has(check.id) ||
          typeof check.text !== "string" || !check.text ||
          !Number.isSafeInteger(check.count) || check.count < 0 ||
          !["before", "after"].includes(check.phase || "after")) {
        fail("invalid_or_repeated_consumer_check", {path, id: check.id}); continue;
      }
      ids.add(check.id); checks.push({...check, path, phase: check.phase || "after"});
      if (!groups.has(path)) groups.set(path, []);
    } catch (error) { fail("invalid_consumer_path", {message: error.message}); }
  }
  const declared = integration.file_guards;
  if (declared !== undefined && (!declared || typeof declared !== "object" || Array.isArray(declared)))
    fail("invalid_file_guards", {});
  if (declared && typeof declared === "object") {
    for (const path of Object.keys(declared)) {
      if (!groups.has(path)) fail("guard_has_no_member", {path});
    }
    for (const path of groups.keys()) {
      const guard = declared[path];
      if (!guard || !validIdentity(guard.before) || !validIdentity(guard.after))
        fail("missing_or_invalid_file_guard", {path});
    }
  }
  if (conflicts.length) reject();

  const output = Object.create(null), baseFiles = [], outcomes = [], verifiedChecks = [];
  const guards = Object.create(null), predecessors = Object.create(null), modes = Object.create(null);
  for (const [path, edits] of groups) {
    const original = current.files[path], actual = identity(original), expected = declared?.[path];
    const metadata = current.metadata[path];
    if (!metadata || metadata.sha256 !== actual.sha256 || metadata.bytes !== actual.bytes) {
      fail("current_member_identity_changed", {path, actual, expected: metadata || null}); continue;
    }
    const completed = expected && same(actual, expected.after);
    if (expected && !completed && !same(actual, expected.before)) {
      fail("base_identity_changed", {path, actual, expected}); continue;
    }
    let body = original, failed = false;
    for (const check of checks.filter(item => item.path === path && item.phase === "before")) {
      if (completed) continue; // A completed replay no longer contains its original preimage.
      const count = occurrences(body, check.text);
      if (count !== check.count) {
        fail("consumer_span_count", {path, id: check.id, phase: check.phase,
          expected_count: check.count, actual_count: count}); failed = true;
      } else verifiedChecks.push({id: check.id, path, phase: check.phase, count});
    }
    if (failed) continue;
    for (const edit of edits) {
      if (completed) {
        outcomes.push({id: edit.id, path, action: "already_applied"}); continue;
      }
      const beforeCount = occurrences(body, edit.before), afterCount = occurrences(body, edit.after);
      const before = identity(body);
      if (afterCount === 1 && beforeCount === occurrences(edit.after, edit.before)) {
        outcomes.push({id: edit.id, path, action: "already_applied", before, after: before});
      } else if (beforeCount === 1 && afterCount === 0) {
        const at = body.indexOf(edit.before);
        body = body.slice(0, at) + edit.after + body.slice(at + edit.before.length);
        outcomes.push({id: edit.id, path, action: "applied", before, after: identity(body)});
      } else {
        fail("literal_span_not_unique", {path, id: edit.id,
          before_count: beforeCount, after_count: afterCount});
        failed = true; break;
      }
    }
    if (failed) continue;
    const after = identity(body);
    if (expected && !same(after, expected.after)) {
      fail("postimage_identity_changed", {path, actual: after, expected: expected.after}); continue;
    }
    for (const check of checks.filter(item => item.path === path && item.phase === "after")) {
      const count = occurrences(body, check.text);
      if (count !== check.count) {
        fail("consumer_span_count", {path, id: check.id, phase: check.phase,
          expected_count: check.count, actual_count: count}); failed = true;
      } else verifiedChecks.push({id: check.id, path, phase: check.phase, count});
    }
    if (failed) continue;
    output[path] = body;
    guards[path] = expected || {before: actual, after};
    modes[path] = metadata.mode || "100644";
    predecessors[path] = actual.sha256;
    baseFiles.push({path, content: original, ...actual, mode: modes[path],
      ...(metadata.git_blob ? {git_blob: metadata.git_blob} : {})});
  }
  if (conflicts.length) reject();
  const boundIntegration = {...integration, file_guards: guards};
  const layer = sourceLayer(output, {label, sourceRef: current.receipt?.source_ref || null,
    predecessors, modes});
  const receipt = {schema: "upstate.source-join-receipt/v1",
    operation_id: integration.operation_id || null,
    integration_sha256: digest(boundIntegration), outcomes, checks: verifiedChecks,
    files: [...groups.keys()].map(path => ({path, ...guards[path]}))};
  const bank = {...layer.document, composition: {
    schema: "upstate.source-composition/v1",
    integration: boundIntegration, base_files: baseFiles, receipt}};
  layer.document = bank;
  layer.receipt.integration_sha256 = receipt.integration_sha256;
  return {layer, bank, receipt};
}


function sourceCompositionBank(results, {label = "complete source joins"} = {}) {
  if (!Array.isArray(results) || !results.length)
    throw Error("Choose completed source compositions");
  const entries = new Map(), steps = [];
  for (const result of results) {
    const bank = result?.bank;
    if (bank?.schema !== "commons.source-bank/v1" ||
        bank.composition?.schema !== "upstate.source-composition/v1")
      throw Error("Choose complete source composition results");
    // Reopen both complete inventories, then reproduce the exact bound join.
    // A valid output alone must never endorse a corrupted recovery preimage.
    const composition = bank.composition, bases = composition.base_files;
    if (!Array.isArray(bases) || !bases.length ||
        !composition.integration?.file_guards || !composition.receipt)
      throw Error("Retain the complete composition inputs, guards and receipt");
    const seen = new Set();
    for (const row of bases) {
      const path = memberName(row.path);
      if (seen.has(path) || typeof row.content !== "string" ||
          !Number.isSafeInteger(row.bytes) || row.bytes < 0 ||
          typeof row.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.sha256) ||
          !["100644", "100755"].includes(row.mode))
        throw Error("Incomplete or repeated recovery input: " + path);
      seen.add(path);
    }
    const base = layerFromDocument({schema: "commons.source-bank/v1",
      source_ref: bank.source_ref || null, files: bases}, {label});
    const layer = layerFromDocument(bank, {label});
    const names = Object.keys(layer.files).sort();
    if (canonical(names) !== canonical(Object.keys(base.files).sort()))
      throw Error("Recovery inputs and composed outputs name different members");
    const replay = composeSourceJoins(base, composition.integration, {label});
    if (canonical(replay.receipt) !== canonical(composition.receipt))
      throw Error("Recovery receipt differs from the retained original join");
    for (const path of names) {
      if (replay.layer.files[path] !== layer.files[path] ||
          replay.layer.metadata[path].mode !== layer.metadata[path].mode ||
          layer.metadata[path].base_sha256 !== base.metadata[path].sha256)
        throw Error("Recovery output differs from its original join: " + path);
    }
    for (const [path, content] of Object.entries(layer.files)) {
      const before = bases.find(row => row.path === path);
      const prior = entries.get(path), meta = layer.metadata[path];
      if (prior && (prior.sha256 !== before.sha256 || prior.mode !== before.mode))
        throw Error("Source composition steps are not consecutive: " + path);
      entries.set(path, {path, content, bytes: meta.bytes, sha256: meta.sha256,
        mode: meta.mode || "100644", base_sha256: prior?.base_sha256 || before.sha256});
    }
    steps.push(bank.composition);
  }
  return {schema: "commons.source-bank/v1", source_root: ROOT,
    files: [...entries.values()], composition: {
      schema: "upstate.source-composition-sequence/v1", steps}};
}

export {canonical, memberName, transportJSON, layerFromDocument, readSourceLayer, composeApplication, sourceLayer, applySourceJoins, composeSourceJoins, sourceCompositionBank};
