#!/usr/bin/env node
/** Receive complete customer Workshares through the original SF47 Operations CLI. */
import {readFileSync, writeFileSync, openSync, closeSync, fsyncSync, linkSync, unlinkSync,
  existsSync, readdirSync, mkdirSync, lstatSync, fstatSync, realpathSync, constants} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {createHash, randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {bindingTemplate, prepareInstallation, renderWorkorder} from "./prepare-core.mjs";
import {profileCatalog, readProfile} from "./profiles.mjs";
import {PROGRAMME_FIELDS, PROGRAMME_SCHEMA, composeCustomerProgramme,
  programmeFiles, validateProgrammeSave} from "./customer-programme-core.mjs";

const schema = "stellar-forge.installation-workshare-receiving.v1";
const usage = "node receive.mjs --operations-cli /absolute/workspace/cli.py --workspace /absolute/original-workspace --case operation-ID --plan plan-ID --inputs PAIR_RECEIVING.json --source-root /absolute/original-files --out /absolute/private-output --receiving-workspace /absolute/receiving-workspace --actor ACTUAL_OPERATOR [--receiving-actor ACTUAL_RECEIVER] [--python python3]";
const fail = message => { throw new Error(message); };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = value => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const canonical = value => JSON.stringify(Array.isArray(value) ? value.map(ordered) : ordered(value));
function ordered(value) {
  return Array.isArray(value) ? value.map(ordered) : record(value) ?
    Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
}
const same = (a, b) => canonical(a) === canonical(b);
function parse(argv) {
  const result = {};
  const names = ["operations-cli", "workspace", "case", "plan", "inputs", "source-root", "out",
    "receiving-workspace", "actor", "receiving-actor", "python"];
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    if (!names.includes(key) || !argv[i + 1] || result[key] !== undefined) fail(usage);
    result[key] = argv[i + 1];
  }
  if (names.slice(0, 9).some(key => !result[key])) fail(usage);
  for (const key of ["operations-cli", "workspace", "source-root", "out", "receiving-workspace"])
    if (!result[key].startsWith("/")) fail("Use an absolute " + key + " path.");
  if (resolve(result.workspace) === resolve(result["receiving-workspace"]))
    fail("Select the receiving engineer's distinct workspace for native complete-case import.");
  result.python ??= "python3";
  result["receiving-actor"] ??= result.actor;
  return result;
}
function regular(path, maximum = 8 * 1024 * 1024) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maximum) fail("Use the complete regular source file: " + path);
    const raw = readFileSync(fd), after = fstatSync(fd);
    if (raw.length > maximum || ["dev", "ino", "size", "mtimeMs", "ctimeMs"].some(key => stat[key] !== after[key]))
      fail("The original source changed while being read: " + path);
    return raw;
  } finally { closeSync(fd); }
}
function syncDirectory(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function syncRetained(path, bytes) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > 128 * 1024 * 1024 ||
        !readFileSync(fd).equals(bytes))
      fail("The retained operation file differs: " + path);
    const after = fstatSync(fd), named = lstatSync(path);
    if (["dev", "ino", "size", "mtimeMs", "ctimeMs"].some(key => before[key] !== after[key]) ||
        named.dev !== after.dev || named.ino !== after.ino)
      fail("The retained operation file changed while being read: " + path);
    fsyncSync(fd);
  } finally { closeSync(fd); }
}
function retain(path, bytes) {
  if (existsSync(path)) {
    syncRetained(path, bytes);
    syncDirectory(dirname(path));
  } else {
    const temporary = path + "." + randomUUID() + ".tmp";
    const fd = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(fd, bytes); fsyncSync(fd);
      try { linkSync(temporary, path); }
      catch (error) {
        if (error.code !== "EEXIST") throw error;
        syncRetained(path, bytes);
      }
      syncDirectory(dirname(path));
    } finally {
      closeSync(fd);
      unlinkSync(temporary);
      syncDirectory(dirname(path));
    }
  }
  return {path, bytes: bytes.length, sha256: hash(bytes)};
}
function privateDirectory(path) {
  mkdirSync(path, {recursive: true, mode: 0o700});
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) || realpathSync(path) !== path)
    fail("Use a private 0700 output directory without symbolic-link ancestors: " + path);
  // Complete the same parent flushes when an earlier mkdir attempt was interrupted.
  for (let current = path; ; current = dirname(current)) {
    syncDirectory(current);
    if (dirname(current) === current) break;
  }
}
function native(args, workspace = options.workspace) {
  const command = [options["operations-cli"], "operations", "--workspace", workspace, ...args];
  const result = spawnSync(options.python, command, {
    encoding: "utf8", maxBuffer: 128 * 1024 * 1024, env: process.env,
    cwd: dirname(options["operations-cli"])
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error("Original Operations " + args[0] + " failed: " +
      (result.stdout || result.stderr || "process ended without a result").trim().slice(0, 16000));
    error.nativeConflict = /OPERATIONS_CONFLICT|INSTALLATION_PREVIEW_CONFLICT|INSTALLATION_CONFLICT/.test(result.stdout + result.stderr);
    throw error;
  }
  let value;
  try { value = JSON.parse(result.stdout); }
  catch { fail("Original Operations did not return complete JSON for " + args[0] + "."); }
  if (!record(value)) fail("Original Operations returned an unexpected result for " + args[0] + ".");
  return value;
}
function current(workspace = options.workspace, caseId = options.case) {
  const value = native(["show", "--case", caseId], workspace);
  if (value.program?.id !== caseId || !Number.isInteger(value.program.version) ||
      !Array.isArray(value.sources) || !Array.isArray(value.installations))
    fail("The original Operations case shape changed; retain its full native source.");
  if (workspace === options.workspace && value.program.planId !== options.plan)
    fail("The selected case is pinned to a different original plan.");
  return value;
}
function retryCurrent(action) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try { return action(current()); }
    catch (error) { if (!error.nativeConflict || attempt === 3) throw error; }
  }
}
function operationId(kind, value) {
  return input.requestPrefix + "-" + kind + "-" + hash(Buffer.from(canonical(value))).slice(0, 24);
}
function readInputs() {
  const retainedInput = join(options.out, "receiving-source-input.json");
  const bytes = regular(existsSync(resolve(options.inputs)) ? resolve(options.inputs) : retainedInput);
  if (existsSync(retainedInput)) retain(retainedInput, bytes);
  const value = JSON.parse(bytes.toString("utf8"));
  if (value.schema !== schema || !/^[A-Za-z0-9_-]{1,70}$/.test(value.requestPrefix || "") ||
      !Array.isArray(value.customers) || !value.customers.length || value.customers.length > 20)
    fail("Use a complete receiving input with a stable requestPrefix and customer list.");
  const cases = new Set();
  const profileIds = new Set(profileCatalog().map(profile => profile.id));
  for (const customer of value.customers) {
    if (!record(customer) || !profileIds.has(customer.profile) ||
        typeof customer.workshareCaseId !== "string" || !customer.workshareCaseId ||
        cases.has(customer.workshareCaseId) || !/^[a-f0-9]{64}$/.test(customer.planSha256 || "") ||
        !Array.isArray(customer.files) || !customer.files.length)
      fail("Each selected original Workshare needs one unique case, profile, plan and complete files.");
    cases.add(customer.workshareCaseId);
    let commissioning = 0, packets = 0;
    for (const file of customer.files) {
      if (!record(file) || !["commissioning", "packet", "source"].includes(file.role) ||
          !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(file.filename || "") ||
          !/^[a-f0-9]{64}$/.test(file.sha256 || "") ||
          typeof file.sourceUrl !== "string" || !file.sourceUrl ||
          typeof file.observedAt !== "string" || !Number.isFinite(Date.parse(file.observedAt)))
        fail("Use original file names, complete-file hashes and source observations.");
      file.mediaType ??= "application/json";
      if (typeof file.mediaType !== "string" || file.mediaType.length > 200 ||
          !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(file.mediaType) ||
          (file.role !== "source" && file.mediaType !== "application/json"))
        fail("Keep the original source media type; commissioning and packet files use application/json.");
      commissioning += file.role === "commissioning" ? 1 : 0;
      packets += file.role === "packet" ? 1 : 0;
      const path = join(options["source-root"], file.filename);
      const retainedDirectory = join(options.out, "original-inputs", file.sha256);
      const raw = regular(existsSync(path) ? path : join(retainedDirectory, file.filename));
      if (hash(raw) !== file.sha256 || (file.bytes !== undefined &&
          (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes !== raw.length)))
        fail("Original customer source differs: " + file.filename);
      privateDirectory(retainedDirectory);
      file.path = retain(join(retainedDirectory, file.filename), raw).path;
    }
    if (commissioning !== 1 || packets > 1) fail("Select one commissioning source and at most one complete matching packet.");
    if (customer.bindings !== undefined && !record(customer.bindings)) fail("Customer bindings must be a complete JSON object.");
  }
  retain(retainedInput, bytes);
  return {value, bytes};
}
function receiveFile(file) {
  return retryCurrent(state => {
    const existing = state.sources.filter(row => row.sha256 === file.sha256 &&
      row.mediaType === file.mediaType);
    if (existing.length) return existing.sort((a, b) => a.id.localeCompare(b.id))[0];
    const version = state.program.version;
    const requestId = operationId("source", {caseId: options.case, version, sha256: file.sha256, filename: file.filename,
      ...(file.mediaType === "application/json" ? {} : {mediaType: file.mediaType})});
    const result = native(["attach", "--case", options.case, "--expected-version", String(version),
      "--actor", options.actor, "--request-id", requestId, "--file", file.path,
      "--kind", "work", "--media-type", file.mediaType, "--source-url", file.sourceUrl,
      "--observed-at", file.observedAt, "--note", "Receive the complete original customer Workshare source: " + file.filename]);
    nativeMutations.push(result);
    const source = current().sources.find(row => row.id === result.recordId && row.sha256 === file.sha256);
    if (!source) fail("The original attached source was not returned by the current case.");
    return source;
  });
}
function existingInstallation(state, caseId) {
  const matches = state.installations.map(row => native(["installation-show", "--case", options.case,
    "--installation", row.id, "--revision", String(row.revision)]))
    .filter(row => row.preview?.document?.workshare?.caseId === caseId);
  if (matches.length > 1) fail("Select the original customer Installation in the existing desk; multiple saved identities have this Workshare.");
  return matches[0] || null;
}
const editable = ["task", "source", "payment", "receiving"];
function appliedBindings(base, supplied, sourceIds) {
  if (!record(supplied)) fail("Use an object for customer bindings.");
  const allowed = ["merchantDeploymentId", "buyerDeploymentIds", ...editable];
  if (Object.keys(supplied).some(key => !allowed.includes(key))) fail("Bindings edit only customer task, source, payment, receiving and selected deployments.");
  const result = structuredClone(base);
  for (const key of allowed) {
    if (supplied[key] === undefined) continue;
    if (editable.includes(key)) {
      if (!record(supplied[key])) fail("Use an object for " + key + " bindings.");
      result[key] = {...result[key], ...supplied[key]};
    } else result[key] = structuredClone(supplied[key]);
  }
  result.source.sourceIds = [...new Set([...(result.source.sourceIds || []), ...sourceIds])];
  result.receiving.sourceIds = [...new Set([...(result.receiving.sourceIds || []), ...sourceIds])];
  return result;
}

function programmeInputs(customer, attached) {
  if (customer.programme === undefined) return null;
  const selected = customer.programme;
  const names = ["schema", "calendarFile", "selectionFile", "taskBudgetFile", "nativeChangeFile"];
  if (!record(selected) || selected.schema !== PROGRAMME_SCHEMA ||
      Object.keys(selected).some(key => !names.includes(key)) || typeof selected.calendarFile !== "string")
    fail("Use the complete original customer programme file selection.");
  const result = {};
  for (const [key, name] of [["calendarFile", "calendarInput"], ["selectionFile", "selection"],
      ["taskBudgetFile", "taskBudget"], ["nativeChangeFile", "nativeChange"]]) {
    if (selected[key] === undefined) continue;
    const matches = attached.filter(file => file.filename === selected[key] && file.mediaType === "application/json");
    if (matches.length !== 1) fail("Select the complete " + key + " among this customer's retained original files.");
    const raw = regular(matches[0].path);
    if (hash(raw) !== matches[0].sha256) fail("The selected original programme file changed.");
    result[name] = JSON.parse(raw.toString("utf8"));
    if (!record(result[name])) fail("Retain the complete original " + key + " JSON object.");
  }
  return result;
}
function nativeCustomerSeed(customer, attached, state, before) {
  const commissioning = attached.find(file => file.role === "commissioning");
  const packet = attached.find(file => file.role === "packet");
  const argv = ["installation-workshare-seed", "--case", options.case, "--expected-version", String(state.program.version),
    "--source", commissioning.source.id, "--expected-source-sha256", commissioning.sha256,
    "--workshare-case", customer.workshareCaseId, "--expected-revision", String(before?.revision || 0)];
  if (packet) argv.push("--packet-source", packet.source.id, "--expected-packet-sha256", packet.sha256);
  if (before) argv.push("--installation", before.id);
  const seed = native(argv);
  if (seed.workshare?.planSha256 !== customer.planSha256 ||
      seed.document?.workshare?.caseId !== customer.workshareCaseId)
    fail("The native seed selected a different original commercial plan.");
  return seed;
}
function programmeDirectory(customer) {
  const root = join(options.out, "customer-programmes");
  const earlier = join(root, customer.profile);
  const retainedSeed = join(earlier, "original-native-seed.json");
  if (existsSync(retainedSeed)) {
    const seed = JSON.parse(regular(retainedSeed).toString("utf8"));
    if (seed.source?.caseId === options.case && seed.source?.planId === options.plan &&
        seed.workshare?.caseId === customer.workshareCaseId &&
        seed.workshare?.planSha256 === customer.planSha256)
      return earlier;
  }
  // Two customers can select the same installed profile in this original operation.
  // The complete case identity selects a private programme directory; an earlier
  // accepted per-profile seed continues in its own retained location.
  const identity = hash(Buffer.from(canonical({workshareCaseId: customer.workshareCaseId,
    planSha256: customer.planSha256}), "utf8"));
  return join(root, customer.profile + "-" + identity);
}
function prepareProgramme(customer, attached) {
  const selected = programmeInputs(customer, attached);
  if (!selected) return null;
  const profile = readProfile(customer.profile).value;
  const directory = programmeDirectory(customer);
  privateDirectory(directory);
  const retainedSeed = join(directory, "original-native-seed.json");
  let seed;
  if (existsSync(retainedSeed)) seed = JSON.parse(regular(retainedSeed).toString("utf8"));
  else {
    seed = retryCurrent(state => nativeCustomerSeed(customer, attached, state,
      existingInstallation(state, customer.workshareCaseId)));
    retain(retainedSeed, json(seed));
  }
  if (seed.source?.caseId !== options.case || seed.source?.planId !== options.plan ||
      seed.workshare?.caseId !== customer.workshareCaseId || seed.workshare?.planSha256 !== customer.planSha256)
    fail("The retained customer programme seed belongs to another original operation.");
  const linkedSources = attached.map(file => file.source.id);
  const document = seed.installationId ?
    appliedBindings(seed.document, customer.bindings || {}, linkedSources) :
    prepareInstallation(seed, profile,
      appliedBindings(bindingTemplate(seed, profile), customer.bindings || {}, linkedSources)).document;
  const original = attached.find(file => file.role === "commissioning");
  const commissioning = JSON.parse(regular(original.path).toString("utf8"));
  const value = composeCustomerProgramme({seed, document, profile, commissioning, ...selected});
  const outputs = [];
  for (const [name, content] of programmeFiles(value)) {
    const bytes = Buffer.from(content, "utf8");
    if (bytes.length > 8 * 1024 * 1024) fail("Retain the complete programme source within the native 8 MiB attachment size.");
    const filename = customer.profile + "-" + name;
    const mediaType = name.endsWith(".json") ? "application/json" :
      name.endsWith(".html") ? "text/html" : name.endsWith(".csv") ? "text/csv" : "text/markdown";
    outputs.push({...retain(join(directory, filename), bytes), filename, mediaType,
      role: "source", sourceUrl: original.sourceUrl, observedAt: original.observedAt});
  }
  return {selected, value, outputs, commissioning, directory};
}
function programmeResult(programme, attached, original, acceptedSave) {
  if (!programme) return null;
  return {
    schema: PROGRAMME_SCHEMA + ".receiving",
    ...(acceptedSave === undefined ? {} : {acceptedSave}),
    commercial: {currency: programme.value.commercial.commercial.currency,
      amount: programme.value.commercial.commercial.amount,
      priceStatus: programme.value.commercial.commercial.price_status,
      milestones: programme.value.commercial.commercial.milestones,
      businessDays: programme.value.commercial.schedule.business_days,
      effortHours: programme.value.commercial.totalEffortHours,
      phaseCount: programme.value.commercial.phaseCount},
    calendar: {startDate: programme.value.calendar.startDate,
      endDateInclusive: programme.value.calendar.endDateInclusive,
      customerTasks: programme.value.customerRows.length,
      completeCalendar: programme.value.calendar.summary},
    taskBudget: programme.value.taskBudget,
    sourceFiles: attached.filter(file => programme.outputs.some(output => output.sha256 === file.sha256 &&
      output.filename === file.filename)).map(file => ({id: file.source.id, filename: file.filename,
        bytes: file.bytes, sha256: file.sha256, mediaType: file.mediaType, path: file.path})),
    nativeProgramme: Object.fromEntries(PROGRAMME_FIELDS.filter(key => Object.hasOwn(original.preview.document, key))
      .map(key => [key, original.preview.document[key]])),
    nativeCalendarReport: original.preview.report?.useCalendar || null,
    nativeCommissioningReport: original.preview.report?.commissioning || null
  };
}

function acceptedProgrammeSave(customer, before, seed, programme) {
  const change = programme?.selected.nativeChange;
  if (!before || !change || change.installationId !== null || change.expectedRevision !== 0)
    return undefined;
  // The original native writer retains its first edition and matching case event
  // even when this receiver never received the successful save response.
  const opened = native(["installation-show", "--case", options.case, "--installation", before.id,
    "--revision", "1"]);
  const {current: observation, ...edition} = opened;
  const sourceVersion = edition.preview?.source?.version;
  if (!Number.isSafeInteger(sourceVersion) || sourceVersion < 1 ||
      !Number.isSafeInteger(edition.version) || edition.version !== sourceVersion + 1)
    fail("The original first Installation edition has no retained source version.");
  const history = native(["history", "--case", options.case, "--after", String(sourceVersion), "--limit", "1"]);
  if (!Array.isArray(history.events) || history.events.length !== 1 ||
      history.events[0].version !== edition.version)
    fail("Reopen the complete original first-save event before continuing the customer programme.");
  const requestId = operationId("installation", {caseId: options.case, version: sourceVersion,
    installationId: null, expectedRevision: 0, previewSha256: edition.preview.previewSha256});
  const event = history.events[0];
  // Another operator's first save does not authorize this request's identity.
  // The unchanged exact-current-document path can still review such a draft.
  if (event.requestId !== requestId) return undefined;
  const accepted = {schema: "stellar-forge.installation-programme-save.v1",
    requestId, actor: options.actor, edition, event};
  validateProgrammeSave({seed, change, acceptedSave: accepted});
  retain(join(programme.directory, "accepted-first-save.json"), json(accepted));
  return accepted;
}


const attemptSchema = "stellar-forge.installation-receiving-attempt.v1";
function customerIdentity(customer) {
  return {workspace: options.workspace, caseId: options.case, planId: options.plan,
    requestPrefix: input.requestPrefix, actor: options.actor, profile: customer.profile,
    workshareCaseId: customer.workshareCaseId, planSha256: customer.planSha256,
    customerSha256: hash(Buffer.from(canonical(customer)))};
}
function saveArguments(customer, document, preview) {
  const version = preview.source.version;
  const requestId = operationId("installation", {caseId: options.case, version,
    installationId: preview.installationId, expectedRevision: preview.expectedRevision,
    previewSha256: preview.previewSha256});
  const args = ["installation-save", "--case", options.case, "--expected-version", String(version),
    "--document", document.path, "--expected-revision", String(preview.expectedRevision),
    "--expected-preview-sha256", preview.previewSha256, "--actor", options.actor,
    "--request-id", requestId, "--note",
    "Receive the complete original customer Workshare and operating preparation: " + customer.workshareCaseId];
  if (preview.installationId) args.push("--installation", preview.installationId);
  return {requestId, args};
}
function attemptDirectory(customer) {
  const directory = join(options.out, "installation-attempts",
    hash(Buffer.from(canonical(customerIdentity(customer)))));
  privateDirectory(directory);
  return directory;
}
function selectedFile(file) {
  if (!record(file) || typeof file.path !== "string" || dirname(file.path) !== options.out)
    fail("Keep the original receiver document and workorder in its private output directory.");
  const raw = regular(file.path);
  if (raw.length !== file.bytes || hash(raw) !== file.sha256)
    fail("The retained original Installation input changed: " + file.path);
  return raw;
}
function checkAttempt(customer, attempt) {
  if (attempt?.schema !== attemptSchema || !same(attempt.identity, customerIdentity(customer)) ||
      !record(attempt.preview) || !record(attempt.preview.document) ||
      !Array.isArray(attempt.pendingSelections))
    fail("Keep the original customer save request and complete retained preview.");
  const preview = attempt.preview;
  if (preview.source?.caseId !== options.case || preview.source?.planId !== options.plan ||
      preview.document.workshare?.caseId !== customer.workshareCaseId ||
      preview.document.workshare?.planSha256 !== customer.planSha256 ||
      !Number.isSafeInteger(preview.source.version) || preview.source.version < 1 ||
      !Number.isSafeInteger(preview.expectedRevision) || preview.expectedRevision < 0 ||
      !/^[a-f0-9]{64}$/.test(preview.previewSha256 || ""))
    fail("The saved attempt belongs to another original Installation or source.");
  selectedFile(attempt.document); selectedFile(attempt.workorder);
  const selected = saveArguments(customer, attempt.document, preview);
  if (attempt.requestId !== selected.requestId || !same(attempt.args, selected.args))
    fail("The retained Installation request arguments changed.");
}
function retainedResult(customer, attached, programme, selection) {
  const opened = native(["installation-show", "--case", options.case,
    "--installation", selection.installation.id, "--revision", String(selection.installation.revision)]);
  if (opened.sha256 !== selection.installation.sha256 ||
      opened.preview?.previewSha256 !== selection.previewSha256 ||
      opened.preview.document.workshare?.caseId !== customer.workshareCaseId ||
      opened.preview.document.workshare?.planSha256 !== customer.planSha256)
    fail("The retained original Installation edition differs from the accepted selection.");
  selectedFile(selection.document); selectedFile(selection.workorder);
  return {profile: customer.profile, workshareCaseId: customer.workshareCaseId,
    installation: selection.installation, document: selection.document, workorder: selection.workorder,
    original: opened, pendingSelections: selection.pendingSelections,
    programme: programmeResult(programme, attached, opened, selection.acceptedSave)};
}
function acceptAttempt(customer, attached, programme, directory, path, attempt) {
  checkAttempt(customer, attempt);
  const receiptPath = path.replace(/\.json$/, ".receipt.json");
  let saved;
  if (existsSync(receiptPath)) saved = JSON.parse(regular(receiptPath).toString("utf8"));
  else {
    if (attempt.legacyEvent) {
      const event = attempt.legacyEvent;
      if (event.requestId !== attempt.requestId || event.version !== attempt.preview.source.version + 1 ||
          current().program.version < event.version)
        fail("Keep the original committed history before recovering an older receiver request.");
    }
    saved = native(attempt.args);
    retain(receiptPath, json(saved));
  }
  if (saved.id !== options.case || saved.action !== "installation.save" || saved.kind !== "installation" ||
      typeof saved.recordId !== "string" || saved.revision !== attempt.preview.expectedRevision + 1 ||
      saved.version !== attempt.preview.source.version + 1 ||
      !/^[a-f0-9]{64}$/.test(saved.sha256 || "") ||
      (attempt.preview.installationId !== null && saved.recordId !== attempt.preview.installationId) ||
      (attempt.legacyEvent && (saved.recordId !== attempt.legacyEvent.recordId ||
        saved.sha256 !== attempt.legacyEvent.after?.sha256)))
    fail("The native original request returned a different Installation receipt.");
  const selection = {schema: attemptSchema + ".selected", identity: attempt.identity,
    installation: {id: saved.recordId, revision: saved.revision, sha256: saved.sha256},
    previewSha256: attempt.preview.previewSha256, document: attempt.document,
    workorder: attempt.workorder, pendingSelections: attempt.pendingSelections,
    requestId: attempt.requestId,
    ...(attempt.acceptedSave === undefined ? {} : {acceptedSave: attempt.acceptedSave})};
  const result = retainedResult(customer, attached, programme, selection);
  if (!same(result.original.preview.document, attempt.preview.document))
    fail("The saved native Installation differs from its complete reviewed document.");
  nativeMutations.push(saved);
  retain(join(directory, "selected.json"), json(selection));
  return result;
}
function replayAttempt(customer, attached, programme, directory, path, attempt) {
  const rejected = path.replace(/\.json$/, ".rejected.json");
  if (existsSync(rejected)) {
    const old = JSON.parse(regular(rejected).toString("utf8"));
    if (old.requestId !== attempt.requestId || old.attemptSha256 !== hash(json(attempt)))
      fail("Keep the original definitive Installation conflict record.");
    return null;
  }
  try { return acceptAttempt(customer, attached, programme, directory, path, attempt); }
  catch (error) {
    // Only the original native compare-and-save refusal permits a fresh merge.
    // Unknown responses and request fingerprint conflicts retain this same attempt.
    if (!error.nativeConflict || attempt.legacyEvent) throw error;
    retain(rejected, json({requestId: attempt.requestId, attemptSha256: hash(json(attempt)),
      code: "NATIVE_COMPARISON_CONFLICT", message: error.message}));
    return null;
  }
}
function pendingSelections(prepared, preview) {
  const pending = new Map(prepared.selections.map(item => [item.field, item]));
  for (const finding of preview.report?.findings || [])
    if (finding.kind !== "ACCEPTANCE") pending.set(finding.field, {field: finding.field, purpose: finding.message});
  return [...pending.values()];
}
function legacyAttempt(customer, profile) {
  const candidates = [];
  for (const name of readdirSync(options.out)) {
    if (!name.startsWith(customer.profile + "-v") || !name.endsWith("-seed.json")) continue;
    const seed = JSON.parse(regular(join(options.out, name)).toString("utf8"));
    if (seed.source?.caseId !== options.case || seed.source?.planId !== options.plan ||
        seed.workshare?.caseId !== customer.workshareCaseId || seed.workshare?.planSha256 !== customer.planSha256) continue;
    const tag = name.slice(0, -"-seed.json".length);
    const documentPath = join(options.out, tag + "-installation.json");
    const workorderPath = join(options.out, tag + "-WORKORDER.md");
    if (!existsSync(documentPath) || !existsSync(workorderPath)) continue;
    const raw = regular(documentPath), work = regular(workorderPath);
    if (tag !== customer.profile + "-v" + seed.source.version + "-" + hash(raw).slice(0, 16))
      fail("The earlier receiver's original document tag changed.");
    candidates.push({seed, document: {path: documentPath, bytes: raw.length, sha256: hash(raw)},
      workorder: {path: workorderPath, bytes: work.length, sha256: hash(work)},
      bindings: JSON.parse(regular(join(options.out, tag + "-bindings.json")).toString("utf8"))});
  }
  if (!candidates.length) return null;
  const matches = [];
  let after = Math.min(...candidates.map(row => row.seed.source.version)), ceiling = null;
  while (true) {
    const page = native(["history", "--case", options.case, "--after", String(after), "--limit", "200"]);
    if (!Array.isArray(page.events) || !Number.isSafeInteger(page.currentVersion))
      fail("Read the complete original Operations history before receiver recovery.");
    ceiling ??= page.currentVersion;
    for (const event of page.events) {
      if (event.version > ceiling || event.action !== "installation.save" || event.kind !== "installation" ||
          event.actor !== options.actor ||
          event.note !== "Receive the complete original customer Workshare and operating preparation: " + customer.workshareCaseId) continue;
      for (const candidate of candidates.filter(row => row.seed.source.version + 1 === event.version)) {
        const {seed, document, workorder, bindings} = candidate;
        const opened = native(["installation-show", "--case", options.case,
          "--installation", event.recordId, "--revision", String(event.after?.revision)]);
        const preview = opened.preview;
        if (!same(preview?.source, seed.source) || preview.installationId !== seed.installationId ||
            preview.expectedRevision !== seed.expectedRevision || opened.sha256 !== event.after?.sha256 ||
            opened.id !== event.recordId || opened.version !== event.version ||
            preview.document.workshare?.caseId !== customer.workshareCaseId ||
            preview.document.workshare?.planSha256 !== customer.planSha256) continue;
        const request = saveArguments(customer, document, preview);
        if (request.requestId !== event.requestId) continue;
        const prepared = seed.installationId ? {selections: []} : prepareInstallation(seed, profile, bindings);
        matches.push({schema: attemptSchema, identity: customerIdentity(customer), ...request,
          preview, document, workorder, pendingSelections: pendingSelections(prepared, preview), legacyEvent: event});
      }
    }
    if (page.nextAfter === null || page.nextAfter >= ceiling) break;
    if (!Number.isSafeInteger(page.nextAfter) || page.nextAfter <= after)
      fail("The original history cursor did not advance.");
    after = page.nextAfter;
  }
  if (matches.length > 1) fail("Multiple earlier receiver saves match this original customer; keep their selected receipts and resolve the original output before continuing.");
  return matches[0] || null;
}
function recoverCustomer(customer, attached, programme, profile, directory) {
  const selectedPath = join(directory, "selected.json");
  if (existsSync(selectedPath)) {
    const selected = JSON.parse(regular(selectedPath).toString("utf8"));
    if (selected.schema !== attemptSchema + ".selected" ||
        !same(selected.identity, customerIdentity(customer)))
      fail("Keep the selected original receiving customer and input identity.");
    return retainedResult(customer, attached, programme, selected);
  }
  const paths = readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name))
    .map(name => join(directory, name));
  const attempts = paths.map(path => ({path, attempt: JSON.parse(regular(path).toString("utf8"))}))
    .sort((a, b) => a.attempt.preview.source.version - b.attempt.preview.source.version);
  for (const {path, attempt} of attempts) {
    checkAttempt(customer, attempt);
    const result = replayAttempt(customer, attached, programme, directory, path, attempt);
    if (result) return result;
  }
  if (!attempts.length) {
    const attempt = legacyAttempt(customer, profile);
    if (attempt) {
      const path = join(directory, hash(Buffer.from(attempt.requestId)) + ".json");
      retain(path, json(attempt));
      return acceptAttempt(customer, attached, programme, directory, path, attempt);
    }
  }
  return null;
}

function receiveCustomer(customer, attached, programme) {
  const profile = readProfile(customer.profile).value;
  const directory = attemptDirectory(customer);
  const recovered = recoverCustomer(customer, attached, programme, profile, directory);
  if (recovered) return recovered;
  return retryCurrent(state => {
    const before = existingInstallation(state, customer.workshareCaseId);
    const version = state.program.version;
    const seed = nativeCustomerSeed(customer, attached, state, before);
    const linkedSources = attached.map(file => file.source.id);
    let prepared, bindings;
    if (before) {
      const document = appliedBindings(seed.document, customer.bindings || {}, linkedSources);
      prepared = {schema: "stellar-forge.installation-workorder-preparation.v1", profile: profile.id,
        source: seed.source, workshareCaseId: customer.workshareCaseId, document,
        selections: [], implementation: profile.steps, inputs: profile.inputs, sourceFiles: profile.sourceFiles};
      bindings = customer.bindings || {};
    } else {
      bindings = appliedBindings(bindingTemplate(seed, profile), customer.bindings || {}, linkedSources);
      prepared = prepareInstallation(seed, profile, bindings);
    }
    const acceptedSave = acceptedProgrammeSave(customer, before, seed, programme);
    if (programme) prepared.document = composeCustomerProgramme({seed, document: prepared.document, profile,
      commissioning: programme.commissioning, ...programme.selected, acceptedSave}).document;
    const tag = customer.profile + "-v" + version + "-" + hash(json(prepared.document)).slice(0, 16);
    retain(join(options.out, tag + "-seed.json"), json(seed));
    retain(join(options.out, tag + "-bindings.json"), json(bindings));
    const document = retain(join(options.out, tag + "-installation.json"), json(prepared.document));
    const previewArgs = ["installation-preview", "--case", options.case, "--expected-version", String(version),
      "--document", document.path, "--expected-revision", String(before?.revision || 0)];
    if (before) previewArgs.push("--installation", before.id);
    const preview = native(previewArgs);
    prepared.document = preview.document;
    prepared.selections = pendingSelections(prepared, preview);
    const workorder = retain(join(options.out, tag + "-WORKORDER.md"), Buffer.from(renderWorkorder(prepared)));
    if (before && same(before.preview.document, preview.document)) {
      const selection = {schema: attemptSchema + ".selected", identity: customerIdentity(customer),
        installation: {id: before.id, revision: before.revision, sha256: before.sha256},
        previewSha256: before.preview.previewSha256, document, workorder,
        pendingSelections: prepared.selections, requestId: null,
        ...(acceptedSave === undefined ? {} : {acceptedSave})};
      retain(join(directory, "selected.json"), json(selection));
      return retainedResult(customer, attached, programme, selection);
    }
    if (typeof preview.previewSha256 !== "string") fail("Retain the complete native Installation preview.");
    const attempt = {schema: attemptSchema, identity: customerIdentity(customer),
      ...saveArguments(customer, document, preview), preview, document, workorder,
      pendingSelections: prepared.selections,
      ...(acceptedSave === undefined ? {} : {acceptedSave})};
    const path = join(directory, hash(Buffer.from(attempt.requestId)) + ".json");
    retain(path, json(attempt));
    // This exact request is durable before the original native writer can accept it.
    const result = replayAttempt(customer, attached, programme, directory, path, attempt);
    if (!result) throw Object.assign(new Error("The original Installation comparison changed; reopen the current case."), {nativeConflict: true});
    return result;
  });
}
let options, input;
const nativeMutations = [];
function finishReceiving(intent) {
  if (intent.schema !== schema || intent.original.caseId !== options.case ||
      intent.original.planId !== options.plan || !Array.isArray(intent.installations) ||
      !/^Complete_Customer_Installations-[a-f0-9]{24}\.zip$/.test(intent.exportName))
    fail("Retain the original complete receiving checkpoint.");
  const exportPath = join(options.out, intent.exportName);
  const selected = intent.installations[intent.installations.length - 1].installation;
  let archive;
  if (existsSync(exportPath)) {
    const raw = regular(exportPath, 128 * 1024 * 1024);
    archive = {path: exportPath, bytes: raw.length, sha256: hash(raw)};
  } else {
    archive = native(["installation-export", "--case", options.case, "--installation", selected.id,
      "--revision", String(selected.revision), "--output", exportPath]).output;
  }
  if (!archive?.sha256) fail("Retain the complete native case export.");
  const receiveId = operationId("import", {sha256: archive.sha256, workspace: options["receiving-workspace"]});
  const imported = native(["import", "--file", exportPath, "--name", input.receivingName || "Received customer installations",
    "--actor", options["receiving-actor"], "--request-id", receiveId], options["receiving-workspace"]);
  nativeMutations.push(imported);
  if (typeof imported.id !== "string") fail("The original import did not return its receiving case identity.");
  const received = current(options["receiving-workspace"], imported.id);
  for (const row of intent.installations) {
    const saved = native(["installation-show", "--case", imported.id, "--installation", row.installation.id,
      "--revision", String(row.installation.revision)], options["receiving-workspace"]);
    if (saved.sha256 !== row.installation.sha256 || saved.preview.document.workshare.caseId !== row.workshareCaseId)
      fail("The imported original customer Installation differs from its saved edition.");
    if (row.programme) {
      const selectedProgramme = Object.fromEntries(PROGRAMME_FIELDS.filter(key => Object.hasOwn(saved.preview.document, key))
        .map(key => [key, saved.preview.document[key]]));
      if (!same(row.programme.nativeProgramme, selectedProgramme) ||
          !same(row.programme.nativeCalendarReport, saved.preview.report?.useCalendar || null) ||
          !same(row.programme.nativeCommissioningReport, saved.preview.report?.commissioning || null))
        fail("The received original customer programme differs from its saved native report.");
      for (const file of row.programme.sourceFiles) {
        const actual = received.sources.find(source => source.id === file.id);
        if (!actual || actual.sha256 !== file.sha256 || actual.bytes !== file.bytes || actual.mediaType !== file.mediaType)
          fail("The complete received customer programme source differs: " + file.filename);
      }
    }
  }
  const path = join(options.out, "RECEIVED.json");
  let completion;
  if (existsSync(path)) {
    completion = JSON.parse(regular(path).toString("utf8"));
    if (completion.archive?.sha256 !== archive.sha256 || completion.receiving?.caseId !== imported.id ||
        !same(completion.installations, intent.installations))
      fail("The completed receiving checkpoint describes a different original operation.");
  } else {
    completion = {schema, original: {...intent.original, completedVersion: imported.version},
      receiving: {workspace: options["receiving-workspace"], caseId: received.program.id,
        planId: received.program.planId, importedVersion: imported.version, actor: options["receiving-actor"]},
      archive, installations: intent.installations, nativeMutations};
    retain(path, json(completion));
  }
  const raw = regular(path);
  console.log(JSON.stringify({...completion, currentReceivingVersion: received.program.version,
    output: {path, bytes: raw.length, sha256: hash(raw)}}, null, 2));
}
try {
  options = parse(process.argv.slice(2));
  options.out = resolve(options.out);
  privateDirectory(options.out);
  const loaded = readInputs(); input = loaded.value;
  const request = {schema, options, inputsSha256: hash(loaded.bytes)};
  retain(join(options.out, "receiving-input.json"), json(request));
  const checkpoint = join(options.out, "receiving-export.json");
  if (existsSync(checkpoint)) {
    finishReceiving(JSON.parse(regular(checkpoint).toString("utf8")));
  } else {
    const original = current();
    const results = [];
    for (const customer of input.customers) {
      const attached = customer.files.map(file => ({...file, source: receiveFile(file)}));
      const programme = prepareProgramme(customer, attached);
      if (programme) attached.push(...programme.outputs.map(file => ({...file, source: receiveFile(file)})));
      results.push(receiveCustomer(customer, attached, programme));
    }
    const final = current();
    const installations = results.map(row => ({
      profile: row.profile, workshareCaseId: row.workshareCaseId, installation: row.installation,
      document: row.document, workorder: row.workorder, pendingSelections: row.pendingSelections,
      ...(row.programme ? {programme: row.programme} : {})
    }));
    const exportName = "Complete_Customer_Installations-" +
      hash(json({installations, version: final.program.version})).slice(0, 24) + ".zip";
    const intent = {schema, original: {workspace: options.workspace, caseId: options.case,
        planId: options.plan, startedVersion: original.program.version, selectedVersion: final.program.version},
      exportName, installations};
    retain(checkpoint, json(intent));
    finishReceiving(intent);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
