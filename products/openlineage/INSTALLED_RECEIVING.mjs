#!/usr/bin/env node
// MIT. Receive the original Quality workspace through the maintained product installation.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

const LEGACY_OPERATION = "OPENLINEAGE-INSTALLED-QUALITY-E496-20261012";
const UPGRADE_OPERATION = "OPENLINEAGE-INSTALLED-QUALITY-UPGRADE-SDK12-20261012";
const ORIGINAL = "OPENLINEAGE-DATASET-QUALITY-9EEA-20261012";
const SCHEMA = "commons.openlineage.installed-quality-input.v1";
const UPGRADE_SCHEMA = "commons.openlineage.installed-quality-upgrade-input.v1";
const D = "stellar/scf-starforge-20261009/distribution/";
const F = "stellar/scf-starforge-20261009/sf46-release/";
const P = "stellar/scf-starforge-20261009/sf30-seller-sdk/openlineage-workspace/";
const HERE = dirname(fileURLToPath(import.meta.url));
const json = value => JSON.stringify(value, null, 2) + "\n";
const sha = value => createHash("sha256").update(value).digest("hex");
const git = value => createHash("sha1").update("blob " + value.length + "\0").update(value).digest("hex");
const load = (root, path) => import(pathToFileURL(join(root, path)).href);
const clone = value => JSON.parse(JSON.stringify(value));
function need(value, message) { if (!value) throw new Error(message); }
async function exists(path) { try { await fs.lstat(path); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } }
async function readJson(path) { return JSON.parse(await fs.readFile(path, "utf8")); }
async function atomic(path, value) {
  const temporary = path + ".pending-" + randomUUID();
  const file = await fs.open(temporary, "wx", 0o600);
  try { await file.writeFile(json(value)); await file.sync(); } finally { await file.close(); }
  try { await fs.rename(temporary, path); } finally { await fs.unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
}
async function exact(path, bytes) {
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try { await fs.writeFile(path, bytes, { flag: "wx", mode: 0o600 }); }
  catch (error) { if (error.code !== "EEXIST") throw error; assert.ok((await fs.readFile(path)).equals(Buffer.from(bytes)), "Keep original complete bytes at " + path); }
}
async function child(executable, args, options = {}) {
  return new Promise((accept, reject) => {
    let owned;
    try { owned = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"], ...options }); }
    catch (error) { reject(error); return; }
    let stdout = "", stderr = "", count = 0, closed = false, failure, stopping = false, escalation;
    const cleanupErrors = [];
    const stop = () => {
      if (closed || stopping || owned.pid === undefined) return;
      stopping = true;
      escalation = setTimeout(() => {
        if (!closed) try { owned.kill("SIGKILL"); }
        catch (error) { cleanupErrors.push({ action: "SIGKILL", message: error.message, code: error.code }); }
      }, 5000);
      escalation.unref?.();
      try { owned.kill("SIGTERM"); }
      catch (error) { cleanupErrors.push({ action: "SIGTERM", message: error.message, code: error.code }); }
    };
    const fail = error => {
      if (closed) return;
      failure ??= error;
      stop();
    };
    const append = (kind, bytes) => {
      if (closed || failure) return; // Keep flowing and discard later output after the first failure.
      count += bytes.length;
      if (count > 16 * 1024 * 1024) {
        fail(new Error("The original installed child exceeded its output capacity")); return;
      }
      if (kind === "stdout") stdout += bytes.toString("utf8"); else stderr += bytes.toString("utf8");
    };
    owned.stdout?.on("data", value => append("stdout", value));
    owned.stderr?.on("data", value => append("stderr", value));
    owned.stdout?.on("error", fail);
    owned.stderr?.on("error", fail);
    owned.on("error", fail);
    owned.once("close", (code, signal) => {
      if (closed) return;
      closed = true;
      if (escalation !== undefined) clearTimeout(escalation);
      if (code !== 0) failure ??= new Error("Original installed child failed: " + executable);
      if (failure) {
        failure.child = { args: [...args], code, signal, stdout, stderr, outputBytes: count,
          terminationRequested: stopping, cleanupErrors };
        reject(failure);
      } else accept({ stdout, stderr, code });
    });
  });
}
async function until(read, check, label, milliseconds = 60000) {
  const end = Date.now() + milliseconds; let value;
  while (Date.now() < end) {
    value = await read(); if (check(value)) return value;
    if (["FAILED", "UNAVAILABLE"].includes(value?.phase)) throw Object.assign(new Error(label + " failed"), { observed: value });
    await new Promise(done => setTimeout(done, 150));
  }
  throw Object.assign(new Error(label + " timed out"), { observed: value });
}
async function archiveDelivery(python, delivery, operation) {
  const archive = join(delivery, "openlineage-installed-quality.zip");
  const code = [
    "import hashlib,json,os,pathlib,sys,zipfile",
    "root=pathlib.Path(sys.argv[1]);target=root/'openlineage-installed-quality.zip';temporary=root/'openlineage-installed-quality.zip.pending'",
    "members=[]",
    "with zipfile.ZipFile(temporary,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as output:",
    " for current,dirs,files in os.walk(root,followlinks=False):",
    "  current=pathlib.Path(current);dirs[:]=sorted(d for d in dirs if not (current/d).is_symlink())",
    "  for name in sorted(files):",
    "   path=current/name",
    "   if path in (target,temporary) or path.is_symlink():continue",
    "   body=path.read_bytes();relative=path.relative_to(root).as_posix();output.writestr(relative,body)",
    "   members.append({'path':relative,'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest()})",
    " output.writestr('delivery-manifest.json',json.dumps({'operationId':sys.argv[2],'files':members},indent=2)+'\\n')",
    "os.replace(temporary,target)",
    "print(json.dumps({'path':str(target),'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'files':len(members)}))"
  ].join("\n");
  const result = JSON.parse((await child(python, ["-c", code, delivery, operation])).stdout);
  assert.equal(result.path, archive); assert.equal(sha(await fs.readFile(archive)), result.sha256);
  return result;
}

export async function receiveInstalledQuality(inputPath) {
  const configPath = resolve(inputPath), configBytes = await fs.readFile(configPath), config = JSON.parse(configBytes);
  const upgrade = config.schema === UPGRADE_SCHEMA;
  assert.ok(upgrade || config.schema === SCHEMA, "Select the original installed operation or its explicit source upgrade.");
  const OPERATION = upgrade ? UPGRADE_OPERATION : LEGACY_OPERATION;
  assert.equal(config.operationId, OPERATION);
  need(Boolean(config.sourceBuild) !== Boolean(config.selectedPackage), "Choose one complete source build or one existing selected package.");
  need(config.originalQuality?.resultFile && config.originalQuality?.workspaceFile && /^[a-f0-9]{64}$/.test(config.originalQuality.sha256 ?? ""),
    "Select the original complete Quality result, exported workspace and its exact SHA-256.");
  need(typeof config.directory === "string" && config.directory && config.browser?.modulePath, "Choose an owned installation directory and the installed browser module.");
  const directory = resolve(config.directory), delivery = join(directory, "delivery"), journalPath = join(directory, "installed-receiving.json");
  const packageFile = resolve(config.originalQuality.workspaceFile), originalResultFile = resolve(config.originalQuality.resultFile);
  const originalBytes = await fs.readFile(packageFile), originalResultBytes = await fs.readFile(originalResultFile), originalResult = JSON.parse(originalResultBytes);
  assert.equal(sha(originalBytes), config.originalQuality.sha256);
  assert.equal(originalResult.operationId, ORIGINAL); assert.equal(originalResult.status, "COMPLETE");
  assert.equal(originalResult.browser.status, "COMPLETE");
  assert.equal(originalResult.browser.delivery.exportId, config.originalQuality.sha256);
  const pin = config.sourceBuild?.commit ?? config.selectedPackage.sourceCommit;
  need(/^[a-f0-9]{40}$/.test(pin ?? ""), "Select the actual published complete product commit.");
  const snapshot = upgrade ? config.originalQuality.sourceSnapshot : null;
  if (upgrade) {
    need(snapshot?.directory && snapshot?.repository, "An upgrade requires the original complete version 5 source snapshot.");
    need(Boolean(snapshot.commit) !== Boolean(snapshot.packetBlob), "Bind the original source to one published commit or complete source-packet Git blob.");
    need(/^[a-f0-9]{40}$/.test(snapshot.commit ?? snapshot.packetBlob ?? ""), "Keep the exact original published Git identity.");
    if (snapshot.packetBlob) need(snapshot.packetFile && Array.isArray(snapshot.overrides ?? []), "Select the complete original packet and any explicit published source corrections.");
  }
  const binding = { operationId: OPERATION, directory, sourceCommit: pin, originalOperation: ORIGINAL,
    originalWorkspaceSha256: sha(originalBytes), originalResultSha256: sha(originalResultBytes),
    ...(upgrade ? { originalSource: { directory: resolve(snapshot.directory), repository: resolve(snapshot.repository),
      ...(snapshot.commit ? { commit: snapshot.commit } : { packetBlob: snapshot.packetBlob, packetFile: resolve(snapshot.packetFile),
        packetSha256: sha(await fs.readFile(resolve(snapshot.packetFile))), overrides: snapshot.overrides ?? [] }) },
      originalApplicationVersion: 5, applicationVersion: 7 } : {}),
    sourceBuild: config.sourceBuild ? { directory: resolve(config.sourceBuild.directory), repository: resolve(config.sourceBuild.repository) } : null,
    selectedPackage: config.selectedPackage ? { directory: resolve(config.selectedPackage.directory), archive: resolve(config.selectedPackage.archive), sha256: config.selectedPackage.sha256 } : null };
  const lockSourceRoot = config.sourceBuild ? resolve(config.sourceBuild.directory) : join(resolve(config.selectedPackage.directory), "source");
  const { withPrivateLock } = await load(lockSourceRoot, "stellar/scf-starforge-20261009/sf30-seller-sdk/routescan/quota.mjs");
  const guide = join(HERE, "INSTALLED_RECEIVING.md");
  const guideBytes = await fs.readFile(guide);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  return withPrivateLock(directory, "installed-quality.lock", async () => {
  let state;
  if (await exists(journalPath)) { state = await readJson(journalPath); assert.deepEqual(state.binding, binding, "Continue the same installed customer receiving operation."); }
  else {
    need((await fs.readdir(directory)).every(name => name === "installed-quality.lock"), "Start in a new owned directory or reopen its original installed receiving journal.");
    state = { schema: "commons.openlineage.installed-quality-result.v1", operationId: OPERATION, binding, status: "STARTED",
      startedAt: new Date().toISOString(), phases: {}, intents: {}, runs: [], artifacts: [] };
    await atomic(journalPath, state);
  }
  const save = () => atomic(journalPath, state);
  const note = async (phase, details = {}) => {
    state.phase = phase; state.updatedAt = new Date().toISOString(); await save();
    process.stdout.write("OPENLINEAGE_INSTALLED_PROGRESS=" + JSON.stringify({ operationId: OPERATION, phase, ...details }) + "\n");
  };
  if (state.status === "COMPLETE") {
    assert.equal(sha(await fs.readFile(state.archive.path)), state.archive.sha256);
    return state;
  }
  await fs.mkdir(delivery, { recursive: true, mode: 0o700 });
  const step = async (name, execute) => {
    if (Object.hasOwn(state.phases, name)) return state.phases[name];
    await note(name); const result = await execute(); state.phases[name] = result; await save(); return result;
  };
  const intent = async (name, prepare, execute) => {
    if (!Object.hasOwn(state.intents, name)) { state.intents[name] = await prepare(); await save(); }
    return execute(state.intents[name]);
  };
  let selected;
  if (config.sourceBuild) {
    const sourceRoot = resolve(config.sourceBuild.directory);
    selected = await step("selected-source-package", async () => {
      const { buildDistribution } = await load(sourceRoot, D + "build.mjs");
      const output = join(directory, "source-build"), packageDirectory = join(directory, "selected-package");
      const result = await buildDistribution({ repository: resolve(config.sourceBuild.repository), ref: pin,
        selection: "openlineage-operations", output, offline: true, resume: await exists(join(output, "build.json")),
        python: config.pythonExecutable ?? "python3",
        onProgress: event => process.stdout.write("OPENLINEAGE_SELECTED_BUILD=" + JSON.stringify(event) + "\n") });
      assert.equal(result.sourceCommit, pin); assert.equal(result.sourceSelection.id, "openlineage-operations");
      if (!await exists(packageDirectory)) await child(config.pythonExecutable ?? "python3", [
        join(sourceRoot, D + "runtime-unpack.py"), "--archive", result.archive, "--sha256", result.sha256, "--out", packageDirectory
      ]);
      return { directory: packageDirectory, archive: result.archive, sha256: result.sha256, sourceCommit: pin, build: result };
    });
  } else selected = { ...config.selectedPackage, directory: resolve(config.selectedPackage.directory), archive: resolve(config.selectedPackage.archive) };
  assert.equal(sha(await fs.readFile(selected.archive)), selected.sha256);
  const packageRoot = selected.directory, sourceRoot = join(packageRoot, "source");
  const { inspectMerchantPackage, prepareMerchantPackage } = await load(sourceRoot, F + "merchant-package.mjs");
  const packageInfo = await inspectMerchantPackage(packageRoot);
  assert.equal(packageInfo.sourceCommit, pin); assert.equal(packageInfo.sourceSelection.id, "openlineage-operations");
  assert.equal(packageInfo.sourceRepository, "https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace");
  const store = await load(sourceRoot, P + "store.mjs"), { canonical } = await load(sourceRoot, P + "model.mjs");
  const original = store.verifyBundle(originalBytes);
  assert.equal(JSON.parse(originalBytes).applicationVersion, 5, "Retain the actual original version 5 export.");
  assert.equal(store.APPLICATION_VERSION, upgrade ? 7 : 5); assert.equal(store.APPLICATION_FILES.length, upgrade ? 81 : 76);
  assert.equal(original.application.size, 76); assert.equal(original.state.workspaceId, originalResult.workspaceId);
  assert.equal(original.state.revision, originalResult.revision);
  assert.equal(original.state.workspaceId, originalResult.core.workspaceId);
  const sourceRows = new Map(JSON.parse(await fs.readFile(join(packageRoot, "manifest.json"), "utf8")).files.map(row => [row.path, row]));
  const selectedApplication = new Map();
  for (const name of store.APPLICATION_FILES) {
    const body = await fs.readFile(join(sourceRoot, P, name));
    assert.equal(sourceRows.get(P + name)?.gitBlob, git(body), "The selected application matches its complete package manifest: " + name);
    selectedApplication.set(name, body);
  }
  let originalSourceRows;
  if (upgrade) {
    const originalStore = await load(resolve(snapshot.directory), "store.mjs");
    assert.equal(originalStore.APPLICATION_VERSION, 5); assert.equal(originalStore.APPLICATION_FILES.length, 76);
    const verified = originalStore.verifyBundle(originalBytes);
    assert.equal(canonical(verified.state), canonical(original.state), "Both source editions validate the unchanged original customer state.");
    assert.deepEqual([...verified.application.keys()].sort(), [...original.application.keys()].sort());
    if (snapshot.commit) {
      const tree = await child("git", ["-C", resolve(snapshot.repository), "ls-tree", "-r", "--full-tree", snapshot.commit, "--", P]);
      originalSourceRows = new Map(tree.stdout.trim().split("\n").filter(Boolean).map(row => {
        const match = /^(\d+) blob ([a-f0-9]{40})\t(.+)$/.exec(row);
        need(match && match[1] === "100644", "The original source tree must contain complete regular application files.");
        return [match[3], match[2]];
      }));
    } else {
      const packetBytes = await fs.readFile(resolve(snapshot.packetFile));
      assert.equal(git(packetBytes), snapshot.packetBlob, "Retain the actual complete published original source packet.");
      const publishedPacket = await child("git", ["-C", resolve(snapshot.repository), "cat-file", "blob", snapshot.packetBlob]);
      assert.ok(packetBytes.equals(Buffer.from(publishedPacket.stdout)), "The complete original packet matches its retained published Git object.");
      const packet = JSON.parse(packetBytes);
      assert.equal(packet.schema, "commons.openlineage.native-source-base64.v1"); assert.equal(packet.operation, ORIGINAL);
      assert.equal(packet.applicationVersion, 5); assert.equal(packet.applicationFiles, 76); assert.equal(packet.sourceFiles, 77);
      assert.equal(packet.sourceDirectory + "/", P); assert.equal(packet.files.length, 77);
      const members = new Map();
      for (const member of packet.files) {
        need(typeof member.path === "string" && !member.path.includes("/") && !members.has(member.path), "The original packet retains complete unique source members.");
        const body = Buffer.from(member.contentBase64, "base64");
        assert.equal(body.length, member.bytes); assert.equal(sha(body), member.sha256);
        members.set(member.path, git(body));
      }
      const corrections = new Set();
      for (const correction of snapshot.overrides ?? []) {
        need(originalStore.APPLICATION_FILES.includes(correction.path) && !corrections.has(correction.path) && /^[a-f0-9]{40}$/.test(correction.gitBlob ?? ""),
          "A source correction must explicitly select one original application file and its complete published Git blob.");
        const body = await fs.readFile(join(resolve(snapshot.directory), correction.path));
        assert.equal(git(body), correction.gitBlob);
        const published = await child("git", ["-C", resolve(snapshot.repository), "cat-file", "blob", correction.gitBlob]);
        assert.equal(git(Buffer.from(published.stdout)), correction.gitBlob, "The source correction exists as its complete original Git object.");
        corrections.add(correction.path); members.set(correction.path, correction.gitBlob);
      }
      originalSourceRows = new Map([...members].map(([name, identity]) => [P + name, identity]));
    }
  }
  for (const [name, body] of original.application) {
    const installed = await fs.readFile(upgrade ? join(resolve(snapshot.directory), name) : join(sourceRoot, P, name));
    assert.ok(installed.equals(body), "The installed selection retains the original Quality source: " + name);
    assert.equal(upgrade ? originalSourceRows.get(P + name) : sourceRows.get(P + name)?.gitBlob, git(installed),
      "The original source matches its published Git snapshot: " + name);
  }
  const unchanged = verified => {
    assert.equal(canonical(verified.state), canonical(original.state), "Preserve the complete original state, definitions, decisions and operation history.");
    assert.deepEqual([...verified.objects.keys()].sort(), [...original.objects.keys()].sort(), "Preserve the exact original object closure.");
    for (const [id, body] of original.objects) assert.ok(body.equals(verified.objects.get(id)), "Retain complete original object bytes: " + id);
  };
  const selectedSource = verified => {
    assert.equal(verified.application.size, selectedApplication.size);
    for (const [name, body] of selectedApplication) assert.ok(body.equals(verified.application.get(name)), "Receive complete selected application bytes: " + name);
  };
  state.source = { commit: pin, sourceSelection: packageInfo.sourceSelection, sourceManifestSha256: packageInfo.sourceManifestSha256,
    applicationVersion: store.APPLICATION_VERSION, portableFiles: store.APPLICATION_FILES.length,
    ...(upgrade ? { originalSource: binding.originalSource, originalApplicationVersion: 5, originalPortableFiles: 76,
      originalSourceSha256: sha(canonical([...original.application].map(([path, body]) => ({ path, bytes: body.length, sha256: sha(body) })))) } : {}),
    originalWorkspaceSha256: sha(originalBytes), workspaceId: original.state.workspaceId,
    revision: original.state.revision, qualitySha256: sha(canonical(original.state.quality)) };
  await save();
    let runtimeModel, merchantSession, browserContext, applicationId, active = false;
    let runtimeDirectory = state.runtimeDirectory ?? join(directory, "runtime");
    const applicationsDirectory = join(directory, "applications");
    const receivedDirectory = join(directory, "customer-workspace"), originalReceivedDirectory = upgrade ? join(directory, "original-customer-workspace") : receivedDirectory;
    const operatorTokenFile = join(directory, "operator-token");
    const reportDirectory = join(delivery, "reports"), screens = join(delivery, "screens");
    await fs.mkdir(reportDirectory, { recursive: true, mode: 0o700 }); await fs.mkdir(screens, { recursive: true, mode: 0o700 });
    if (!await exists(operatorTokenFile)) await exact(operatorTokenFile, randomBytes(32).toString("hex") + "\n");
    const operatorToken = (await fs.readFile(operatorTokenFile, "utf8")).trim();
    need(operatorToken.length >= 24, "Keep the original private operator token.");
    const applicationState = async () => (await runtimeModel.applicationsState({ historyLimit: 20 })).applications.find(value => value.id === applicationId);
    const stop = async () => {
      const current = await applicationState();
      if (!current?.current?.active) { active = false; return current; }
      await runtimeModel.applicationsStop({ applicationId, operationId: current.current.id });
      const stopped = await until(applicationState, value => value && !value.current?.active &&
        ["STOPPED", "CANCELLED", "SUCCEEDED"].includes(value.phase), "Installed application stop");
      active = false; return stopped;
    };
    const start = async label => {
      let current = await applicationState();
      if (current?.current?.active && current.phase !== "RUNNING") {
        current = await until(applicationState, value => value?.phase === "RUNNING" || !value?.current?.active, "Retained installed application startup");
      }
      if (current?.phase === "RUNNING" && current.current?.url) { active = true; return current; }
      const review = await runtimeModel.applicationsStartReview({ applicationId });
      const request = { applicationId, requestId: randomUUID(), reviewId: review.id };
      state.runs.push({ label, request, requestedAt: new Date().toISOString() }); await save();
      await runtimeModel.applicationsStart(request); active = true;
      current = await until(applicationState, value => value?.phase === "RUNNING" && value.current?.url, "Installed OpenLineage startup");
      assert.equal(current.current.url.operationId, request.requestId); assert.equal(current.current.url.command, "openlineage");
      state.runs.at(-1).startup = current.current.url; await save(); return current;
    };
    const remember = async path => {
      const bytes = await fs.readFile(path), item = { path: path.slice(delivery.length + 1), bytes: bytes.length, sha256: sha(bytes) };
      const at = state.artifacts.findIndex(row => row.path === item.path);
      if (at < 0) state.artifacts.push(item); else state.artifacts[at] = item;
      await save(); return item;
    };
    try {
      await step("receive-original-customer-workspace", async () => {
        if (await exists(originalReceivedDirectory)) assert.equal((await readJson(join(originalReceivedDirectory, "received.json"))).packageSha256, sha(originalBytes));
        else await store.receiveBundle(originalBytes, originalReceivedDirectory);
        const read = await new store.LineageWorkspace(originalReceivedDirectory).read();
        assert.equal(canonical(read), canonical(original.state));
        for (const [name, body] of original.application) assert.ok(body.equals(await fs.readFile(join(originalReceivedDirectory, "application", name))), "Retain the original received source: " + name);
        return { directory: originalReceivedDirectory, workspaceId: read.workspaceId, revision: read.revision, applicationVersion: 5, applicationFiles: 76 };
      });
      if (upgrade) await step("upgrade-original-application-source", async () => {
        const record = await new store.LineageWorkspace(originalReceivedDirectory).exportBundle({ includeApplication: true });
        const bytes = await fs.readFile(join(originalReceivedDirectory, "exports", record.id + ".json"));
        assert.equal(sha(bytes), record.id); assert.equal(JSON.parse(bytes).applicationVersion, 7);
        const upgraded = store.verifyBundle(bytes); unchanged(upgraded); selectedSource(upgraded);
        const path = join(delivery, "upgraded-quality-workspace.json"); await exact(path, bytes); await remember(path);
        if (await exists(receivedDirectory)) assert.equal((await readJson(join(receivedDirectory, "received.json"))).packageSha256, record.id);
        else await store.receiveBundle(bytes, receivedDirectory);
        assert.equal(canonical(await new store.LineageWorkspace(receivedDirectory).read()), canonical(original.state));
        for (const [name, body] of selectedApplication) assert.ok(body.equals(await fs.readFile(join(receivedDirectory, "application", name))), "The upgraded installation carries its selected source: " + name);
        return { from: { version: 5, applicationFiles: 76, packageSha256: sha(originalBytes), source: binding.originalSource },
          to: { version: 7, applicationFiles: 81, packageSha256: record.id, sourceCommit: pin },
          path, workspaceId: original.state.workspaceId, revision: original.state.revision,
          stateSha256: sha(canonical(original.state)), objectIds: [...original.objects.keys()].sort(), operations: original.state.operations.map(row => row.id) };
      });
      const release = await step("install-original-sf46-release", async () => {
        const preparedDirectory = join(directory, "prepared-release");
        let prepared;
        if (await exists(preparedDirectory)) {
          const { verifyRelease } = await load(sourceRoot, F + "release-core.mjs");
          const retained = await verifyRelease(preparedDirectory);
          assert.equal(retained.manifest.source.commit, pin);
          assert.equal(retained.manifest.origin.sourceManifest.sha256, packageInfo.sourceManifestSha256);
          prepared = { release: retained.root, digest: retained.manifest.digest };
        } else prepared = await prepareMerchantPackage({ packageDirectory: packageRoot, output: preparedDirectory,
          expectedManifest: packageInfo.sourceManifestSha256 });
        const product = await load(sourceRoot, F + "product.mjs");
        const installed = await product.install(prepared.release, join(directory, "home"), { expected: prepared.digest, activate: true });
        const status = await product.status(installed.home); assert.equal(status.sourceCommit, pin);
        const help = await child(process.execPath, [join(installed.home, "forge.mjs"), "run", "openlineage", "--home", installed.home, "--", "--help"]);
        assert.match(help.stdout, /quality overview/);
        return { home: installed.home, releaseDirectory: status.releaseDirectory, sourceCommit: status.sourceCommit,
          activeReleaseId: status.activeReleaseId, digest: status.digest };
      });
      await step("installed-quality-command-and-reports", async () => {
        const command = args => child(process.execPath, [join(release.home, "forge.mjs"), "run", "openlineage", "--home", release.home, "--", ...args]);
        const overview = JSON.parse((await command(["quality", "overview", "--workspace", receivedDirectory])).stdout);
        assert.equal(overview.workspaceId, original.state.workspaceId);
        assert.equal(overview.revision, original.state.revision);
        const evaluationId = originalResult.browser.evaluationId;
        need(overview.evaluations.some(row => row.id === evaluationId), "The installed command must retain the original browser evaluation.");
        for (const format of ["json", "csv", "html"]) {
          const path = join(reportDirectory, "installed-quality." + format);
          if (!await exists(path)) await command(["quality", "report", "--workspace", receivedDirectory,
            "--evaluation-id", evaluationId, "--format", format, "--out", path]);
          const expected = await new store.LineageWorkspace(receivedDirectory).dispatch("quality.report.read", { evaluationId, format });
          assert.equal(await fs.readFile(path, "utf8"), expected.text); await remember(path);
        }
        return { workspaceId: overview.workspaceId, revision: overview.revision, evaluationId, counts: overview.counts };
      });
      const runtime = await load(sourceRoot, D + "runtime-install.mjs");
      const runtimeState = await step("prepare-offline-operator-runtime", async () => {
        let prepared;
        if (await exists(join(runtimeDirectory, "runtime-install.json"))) {
          const plan = await readJson(join(runtimeDirectory, "runtime-install.json"));
          const profile = await readJson(join(runtimeDirectory, "runtime-profile.json"));
          assert.equal(plan.archiveSha256, selected.sha256); assert.equal(plan.source.sourceCommit, pin);
          assert.equal(profile.dependencies.length, 0);
          const inspected = await runtime.inspectRuntimeInstall({ directory: runtimeDirectory, source: true });
          assert.equal(inspected.installationId, plan.installationId);
          prepared = { installationId: plan.installationId, profileId: plan.profileId,
            sourceRoot: plan.sourceRoot, dependencies: profile.dependencies };
        } else if (await exists(runtimeDirectory)) {
          const previous = runtimeDirectory;
          runtimeDirectory = join(directory, "runtime-recovered-" + randomUUID());
          state.runtimeDirectory = runtimeDirectory;
          state.runtimeRecoveries = [...(state.runtimeRecoveries ?? []), { from: previous, directory: runtimeDirectory, startedAt: new Date().toISOString() }];
          await save();
          if (await exists(join(previous, "preparation.json"))) prepared = await runtime.recoverRuntime({
            from: previous, directory: runtimeDirectory, install: false, python: config.pythonExecutable ?? "python3" });
          else prepared = await runtime.prepareRuntimeInstall({ directory: runtimeDirectory, archive: selected.archive,
            sha256: selected.sha256, native: false, features: [], operator: true, python: config.pythonExecutable ?? "python3" });
        } else {
          state.runtimeDirectory = runtimeDirectory; await save();
          prepared = await runtime.prepareRuntimeInstall({ directory: runtimeDirectory, archive: selected.archive,
            sha256: selected.sha256, native: false, features: [], operator: true, python: config.pythonExecutable ?? "python3" });
        }
        assert.equal(prepared.dependencies.length, 0);
        const installed = await runtime.installRuntime({ directory: runtimeDirectory, offline: true, cache: join(directory, "npm-cache") });
        assert.equal(installed.status, "READY"); assert.equal(installed.ready, true);
        const inspected = await runtime.inspectRuntimeInstall({ directory: runtimeDirectory, load: true, source: true });
        assert.equal(inspected.ready, true); assert.equal(inspected.sourceVerified, true);
        return { installationId: prepared.installationId, profileId: prepared.profileId, sourceRoot: prepared.sourceRoot,
          ready: true, dependencies: 0, offline: true };
      });
      const runtimeSource = runtimeState.sourceRoot;
      const { readApplicationProviders } = await load(runtimeSource, D + "runtime-workspace/application-providers.mjs");
      const providers = await readApplicationProviders({ sourceRoot: runtimeSource });
      need(providers.catalog.some(row => row.id === "openlineage-workspace"), "The installed selection must expose its original Application.");
      const { adoptMerchantRuntime } = await load(runtimeSource, F + "runtime-package.mjs");
      const managed = await step("adopt-original-managed-runtime", () => adoptMerchantRuntime({ directory: runtimeDirectory, home: join(directory, "managed-home"), activate: true }));
      const { createRuntimeWorkspace, openRuntimeWorkspace } = await load(runtimeSource, D + "runtime-workspace/model.mjs");
      if (!await exists(applicationsDirectory)) await createRuntimeWorkspace({ directory: applicationsDirectory });
      runtimeModel = await openRuntimeWorkspace({ directory: applicationsDirectory });
      const attached = await step("attach-runtime", () => runtimeModel.attach({ directory: runtimeDirectory, label: "OpenLineage installed Quality" }));
      const home = await step("attach-managed-home", () => runtimeModel.openManagedHome({ directory: managed.home, label: "OpenLineage source-selected product" }));
      const saved = await step("save-original-application", () => intent("save-application", async () => {
        const review = await runtimeModel.applicationsReview({ runtimeId: attached.runtimeId, homeId: home.homeId,
          kind: "openlineage-workspace", label: "Original dataset Quality customer", settings: {
            workspaceDirectory: receivedDirectory, tokenFile: operatorTokenFile, port: 0 } });
        return { requestId: randomUUID(), reviewId: review.id, applicationId: null };
      }, request => runtimeModel.applicationsSave(request)));
      assert.equal(saved.connectionError, null); applicationId = saved.applicationId;
      let running = await start("installed-customer-review"), url = running.current.url.url;
      const startup = running.current.url.original;
      assert.equal(startup.workspaceId, original.state.workspaceId);
      const { QualityClient } = await load(runtimeSource, P + "quality-client.mjs");
      let client = new QualityClient(url, { token: operatorToken, expectedWorkspaceId: original.state.workspaceId, instanceId: startup.instanceId });
      const quality = await client.qualityOverview();
      assert.equal(quality.revision, original.state.revision); assert.deepEqual(quality.rules, original.state.quality.rules);
      assert.deepEqual(quality.evaluations, original.state.quality.evaluations); assert.deepEqual(quality.dispositions, original.state.quality.dispositions);
      const browserModule = await import(pathToFileURL(resolve(config.browser.modulePath)).href);
      const chromium = browserModule.chromium ?? browserModule.default?.chromium;
      need(chromium?.launchPersistentContext, "Use the host's existing Chromium module.");
      const errors = [], datasetKey = originalResult.core.datasetKey, evaluationId = originalResult.browser.evaluationId;
      const openBrowser = async (address, profile) => {
        const context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1440, height: 1000 },
          ...(config.browser.executablePath ? { executablePath: resolve(config.browser.executablePath) } : {}), args: config.browser.args ?? [] });
        browserContext = context;
        try {
          await context.addInitScript(({ token }) => {
            try { sessionStorage.setItem("openlineage-access:" + location.origin + location.pathname, token); } catch {}
          }, { token: operatorToken });
          const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
          await page.goto(address, { waitUntil: "domcontentloaded" });
          await page.locator("#connection-state").filter({ hasText: "Connected" }).waitFor({ timeout: 45000 });
          await page.locator("#quality-nav").click();
          await page.getByRole("combobox", { name: "Quality dataset", exact: true }).selectOption(datasetKey);
          await page.locator(".quality-desk[aria-busy='false']").waitFor({ timeout: 45000 });
          return { context, page };
        } catch (error) {
          try { await context.close(); browserContext = null; }
          catch (cleanup) { error.browserCleanup = { message: cleanup.message, stack: cleanup.stack }; }
          throw error;
        }
      };
      const capture = async (page, name) => {
        await page.locator(".quality-desk[aria-busy='false']").waitFor({ timeout: 45000 });
        const layout = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth }));
        need(layout.documentWidth <= layout.width + 1, "The installed Quality desk must fit its selected viewport.");
        const path = join(screens, name + ".png"); await page.screenshot({ path, fullPage: true }); await remember(path); return layout;
      };
      if (!state.phases["installed-desktop-and-phone"]) {
        await note("installed-desktop-and-phone");
        const opened = await openBrowser(url, join(directory, "browser-profile")); browserContext = opened.context;
        for (const tab of ["Observations", "Rules", "Evaluation", "Decisions"]) {
          await opened.page.getByRole("tab", { name: tab, exact: true }).click();
          if (["Evaluation", "Decisions"].includes(tab)) await opened.page.getByRole("combobox", { name: "Saved quality evaluation", exact: true }).selectOption(evaluationId);
          await capture(opened.page, "installed-desktop-" + tab.toLowerCase());
        }
        await opened.page.setViewportSize({ width: 390, height: 844 });
        await capture(opened.page, "installed-phone-decisions");
        await opened.page.getByRole("tab", { name: "Evaluation", exact: true }).click();
        await opened.page.getByRole("combobox", { name: "Saved quality evaluation", exact: true }).selectOption(evaluationId);
        await capture(opened.page, "installed-phone-evaluation");
        await browserContext.close(); browserContext = null;
        assert.deepEqual(errors, []); state.phases["installed-desktop-and-phone"] = { desktop: [1440, 1000], phone: [390, 844], evaluationId }; await save();
      }
      await note("installed-merchant-quality");
      const connectionFile = join(directory, "merchant-host.json");
      await exact(connectionFile, Buffer.from(json({ schema: "stellar-forge.openlineage-workspace-host.v1", workspaces: { customer: {
        label: "Original Quality customer", connectionFile: join(receivedDirectory, "connection.json"),
        workspaceId: original.state.workspaceId, tokenFile: operatorTokenFile, timeoutMs: 30000, inputs: {}
      } } })));
      const { initializeLineageMerchantWorkspace } = await load(runtimeSource, P + "mcp-setup.mjs");
      const merchant = await initializeLineageMerchantWorkspace({ directory: join(directory, "merchant"), connection: connectionFile,
        name: "OpenLineage installed Quality receiving" });
      const { startMerchantMcp } = await load(runtimeSource, "stellar-forge/mcp-merchant-operator/serve.mjs");
      const merchantToken = randomBytes(32).toString("hex");
      merchantSession = await startMerchantMcp({ configPath: merchant.configuration, port: 0,
        environment: { ...process.env, MCP_ACCESS_TOKEN: merchantToken }, consoleDirectory: join(directory, "merchant-console") });
      const rpc = async (method, params) => {
        const response = await fetch(merchantSession.url, { method: "POST", headers: { authorization: "Bearer " + merchantToken,
          "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25" },
          body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, ...(params === undefined ? {} : { params }) }) });
        assert.equal(response.status, 200); const value = await response.json();
        need(!value.error && !value.result?.isError, "The installed merchant request must complete: " + method);
        return value.result;
      };
      const call = async (name, args = {}) => {
        const value = await rpc("tools/call", { name, arguments: { workspace: "customer", ...args } });
        return value.structuredContent?.result ?? value.structuredContent;
      };
      const initialized = await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {},
        clientInfo: { name: "OpenLineage installed customer receiving", version: "1" } });
      assert.equal(initialized.protocolVersion, "2025-11-25");
      const { qualityTools } = await load(runtimeSource, P + "quality-catalog.mjs");
      const listed = await rpc("tools/list"), names = new Set(listed.tools.map(row => row.name));
      for (const tool of qualityTools) need(names.has("merchant_" + tool.name), "The original merchant catalog must include " + tool.name);
      const merchantQuality = await call("merchant_lineage_quality_overview");
      assert.equal(merchantQuality.workspaceId, original.state.workspaceId); assert.equal(merchantQuality.revision, original.state.revision);
      for (const format of ["json", "csv", "html"]) {
        const reported = await call("merchant_lineage_quality_report_read", { evaluationId, format });
        assert.equal(reported.text, await fs.readFile(join(reportDirectory, "installed-quality." + format), "utf8"));
      }
      state.phases["installed-merchant-quality"] = { protocolVersion: initialized.protocolVersion,
        tools: qualityTools.map(row => "merchant_" + row.name), workspaceId: original.state.workspaceId, revision: merchantQuality.revision }; await save();
      const firstInstance = startup.instanceId; await stop(); running = await start("installed-customer-reopen");
      const restarted = running.current.url.original; assert.notEqual(restarted.instanceId, firstInstance);
      assert.equal(restarted.workspaceId, original.state.workspaceId);
      const selectedConnection = await call("merchant_lineage_connection");
      need(selectedConnection.reconnectRequired, "The retained merchant client must observe the restarted instance.");
      await call("merchant_lineage_reconnect", { expectedInstanceId: selectedConnection.selected.instanceId });
      assert.equal((await call("merchant_lineage_quality_overview")).workspaceId, original.state.workspaceId);
      client = new QualityClient(running.current.url.url, { token: operatorToken, expectedWorkspaceId: original.state.workspaceId, instanceId: restarted.instanceId });
      await step("installed-complete-workspace-export", async () => {
        const record = await client.exportWorkspace({ includeApplication: true }), path = join(delivery, "installed-quality-workspace.json");
        await client.downloadExport(record.id, path);
        const received = store.verifyBundle(await fs.readFile(path));
        assert.equal(received.state.workspaceId, original.state.workspaceId); assert.equal(received.state.revision, original.state.revision);
        unchanged(received); selectedSource(received);
        await remember(path); return { id: record.id, bytes: record.bytes, path, workspaceId: received.state.workspaceId };
      });
      const exported = state.phases["installed-complete-workspace-export"], editable = join(delivery, "editable-workspace");
      if (!await exists(editable)) await store.receiveBundle(await fs.readFile(exported.path), editable);
      else assert.equal((await readJson(join(editable, "received.json"))).packageSha256, exported.id);
      const editableState = await new store.LineageWorkspace(editable).read(); assert.equal(canonical(editableState), canonical(original.state));
      const { startServer } = await load(join(editable, "application"), "server.mjs");
      const finalHost = await startServer({ directory: editable, token: operatorToken, port: 0, expectedWorkspaceId: original.state.workspaceId });
      try {
        const opened = await openBrowser(finalHost.url, join(directory, "received-browser-profile")); browserContext = opened.context;
        await opened.page.getByRole("tab", { name: "Evaluation", exact: true }).click();
        await opened.page.getByRole("combobox", { name: "Saved quality evaluation", exact: true }).selectOption(evaluationId);
        await capture(opened.page, "received-desktop-evaluation");
        await opened.page.setViewportSize({ width: 390, height: 844 });
        await opened.page.getByRole("tab", { name: "Decisions", exact: true }).click();
        await opened.page.getByRole("combobox", { name: "Saved quality evaluation", exact: true }).selectOption(evaluationId);
        await capture(opened.page, "received-phone-decisions");
        await browserContext.close(); browserContext = null;
      } finally { await finalHost.close(); }
      assert.deepEqual(errors, []);
      await merchantSession.close(); merchantSession = null; await stop();
      const finalApplication = await applicationState();
      state.application = { applicationId, sourceCommit: finalApplication.release.sourceCommit, workspaceId: original.state.workspaceId,
        totalRuns: finalApplication.totalRuns, phase: finalApplication.phase, explicitReconnect: true };
      assert.equal(state.application.sourceCommit, pin);
      state.workspaceId = original.state.workspaceId; state.revision = original.state.revision;
      state.originalOperationIds = original.state.operations.map(row => row.id);
      if (state.error) { state.recoveredErrors = [...(state.recoveredErrors ?? []), state.error]; delete state.error; }
      await exact(join(delivery, "original-quality-workspace.json"), originalBytes);
      await exact(join(delivery, "original-quality-native-result.json"), originalResultBytes);
      if (upgrade) {
        for (const [name, body] of original.application) await exact(join(delivery, "original-source", name), body);
        if (snapshot.packetBlob) await exact(join(delivery, "original-quality-source-packet.json"), await fs.readFile(resolve(snapshot.packetFile)));
        await exact(join(delivery, "original-source-selection.json"), Buffer.from(json({
          ...(snapshot.commit ? { commit: snapshot.commit } : { packetBlob: snapshot.packetBlob, overrides: snapshot.overrides ?? [] }),
          applicationVersion: 5, applicationFiles: 76,
          files: [...original.application].map(([path, body]) => ({ path, bytes: body.length, sha256: sha(body), gitBlob: git(body) }))
        })));
      }
      await exact(join(delivery, "source-package.tgz"), await fs.readFile(selected.archive));
      await exact(join(delivery, "runtime-unpack.py"), await fs.readFile(join(sourceRoot, D + "runtime-unpack.py")));
      await exact(join(delivery, "INSTALLED_RECEIVING.mjs"), await fs.readFile(fileURLToPath(import.meta.url)));
      await exact(join(delivery, "INSTALLED_RECEIVING.md"), guideBytes);
      const opening = "# OpenLineage installed Quality customer delivery\n\n" +
        "Source commit: " + pin + "\n\n" +
        "Workspace: " + original.state.workspaceId + " · revision " + original.state.revision + "\n\n" +
        (upgrade ? "The current selected application is in editable-workspace/. Its complete workspace state, original source events, rule editions, evaluations, decisions and operation history remain unchanged from the version 5 customer. The original 76 application files are retained in original-source/ and original-quality-workspace.json.\n\n" :
          "The original source, rule editions, evaluations, decisions and operation history are retained in editable-workspace/.\n\n") +
        "Open the delivered application with Node 22 or newer:\n\n" +
        "~~~sh\nnode editable-workspace/application/cli.mjs serve --workspace editable-workspace --port 0\n~~~\n\n" +
        "Use the returned local URL. Open Quality, choose the original dataset and saved evaluation " + evaluationId + ", and inspect the same reports and decisions.\n\n" +
        "The selected product archive is source-package.tgz, SHA-256 " + selected.sha256 + ". Install it through the existing Starforge Runtime workspace, or unpack with the retained original helper:\n\n" +
        "~~~sh\npython3 runtime-unpack.py --archive source-package.tgz --sha256 " + selected.sha256 + " --out selected-package\n~~~\n\n" +
        "The original installer is selected-package/source/" + D + "runtime-install-cli.mjs. Prepare an operator profile with no additional feature flags, install offline, inspect with --load --source, then open OpenLineage operations in Applications and select the received workspace.\n\n" +
        "reports/ contains the complete installed HTML, JSON and CSV reports. screens/ contains the actual installed and independently received desktop/390-pixel views. original-quality-native-result.json binds this continuation to the original completed Quality operation.\n";
      await exact(join(delivery, "START_HERE.md"), Buffer.from(opening));
      state.status = "OPERATED"; state.completedAt = new Date().toISOString(); await save();
      await atomic(join(delivery, "installed-quality-result.json"), { ...state, archive: undefined });
      state.archive = await archiveDelivery(config.pythonExecutable ?? "python3", delivery, OPERATION);
      state.status = "COMPLETE"; state.phase = "COMPLETE_INSTALLED_CUSTOMER_DELIVERY"; await save();
      return state;
    } catch (error) {
      state.status = "INTERRUPTED"; state.error = { at: new Date().toISOString(), message: error.message, stack: error.stack,
        ...(error.child ? { child: error.child } : {}), ...(error.observed ? { observed: error.observed } : {}),
        ...(error.browserCleanup ? { browserCleanup: error.browserCleanup } : {}) };
      await save().catch(() => {}); throw error;
    } finally {
      await browserContext?.close().catch(() => {});
      await merchantSession?.close().catch(() => {});
      if (runtimeModel && applicationId && active) await stop().catch(() => {});
      await runtimeModel?.close();
    }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  receiveInstalledQuality(process.argv[2] ?? (() => { throw new Error("Supply the original installed Quality input JSON."); })())
    .then(result => process.stdout.write(json(result)))
    .catch(error => { process.stderr.write(error.stack + "\n"); process.exitCode = 1; });
}
