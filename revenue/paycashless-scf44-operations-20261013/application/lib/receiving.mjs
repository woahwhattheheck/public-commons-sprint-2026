// MIT. Complete source, SQLite, native runtime and original evidence receiving.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {
  need, now, hash, jsonBytes, canonical, directory, confined, exists,
  readJSON, writeExact, fileDescriptor, copyDeclared, verifyFile, lease, syncDirectory,
} from './files.mjs';
import {
  completePaycashlessSource, capturePaycashlessSource, verifyPaycashlessRuntime, readPaycashlessRuntimeManifest,
  restorePaycashlessRuntime, publicPaycashlessRuntime,
} from './runtime.mjs';

export const DELIVERY_SCHEMA = 'paycashless.operations-delivery.v1';

async function scanRegular(root, relative = '') {
  const output = [];
  const base = relative ? await confined(root, relative) : root;
  if (!await exists(base)) return output;
  for (const item of await fs.readdir(base, { withFileTypes: true })) {
    const name = relative ? relative + '/' + item.name : item.name;
    const file = await confined(root, name);
    const stat = await fs.lstat(file);
    need(!stat.isSymbolicLink(), 'UNDECLARED_DELIVERY_LINK');
    if (stat.isDirectory()) output.push(...await scanRegular(root, name));
    else {
      need(stat.isFile(), 'UNSUPPORTED_DELIVERY_MEMBER');
      output.push(await fileDescriptor(file, name));
    }
  }
  return output;
}

export async function readPaycashlessDeliveryManifest({ sourceDirectory, expectedManifestSha256 }) {
  const file = await confined(sourceDirectory, 'manifest.json');
  const bytes = await fs.readFile(file);
  const manifestSha256 = hash(bytes);
  if (expectedManifestSha256) need(expectedManifestSha256 === manifestSha256,
    'DELIVERY_MANIFEST_MISMATCH');
  const manifest = JSON.parse(bytes);
  need(manifest.schema === DELIVERY_SCHEMA && ['workspace', 'report'].includes(manifest.kind),
    'DELIVERY_SCHEMA_MISMATCH');
  const { sha256, ...body } = manifest;
  need(hash(Buffer.from(canonical(body))) === sha256, 'DELIVERY_CONTENT_ID_MISMATCH');
  const names = new Set();
  for (const item of manifest.files) {
    need(!names.has(item.path) && item.path !== 'manifest.json', 'DUPLICATE_DELIVERY_MEMBER');
    need(Number.isInteger(item.mode) && item.mode >= 0 && item.mode <= 0o777,
      'INVALID_DELIVERY_MODE');
    names.add(item.path);
    await confined(sourceDirectory, item.path);
  }
  return { manifest, manifestSha256, bytes };
}

export async function inspectPaycashlessDelivery(args) {
  const result = await readPaycashlessDeliveryManifest(args);
  let bytes = 0;
  for (const file of result.manifest.files) {
    await verifyFile(args.sourceDirectory, file, { mode: true });
    bytes += file.bytes;
  }
  const declared = new Map(result.manifest.files.map(file => [file.path, file]));
  const sameMember = (actual, expected) => actual && actual.bytes === expected.bytes &&
    actual.sha256 === expected.sha256 && actual.mode === expected.mode;
  if (result.manifest.kind === 'workspace') {
    need(result.manifest.application && result.manifest.runtime &&
      declared.has('workspace/workspace.sqlite'), 'INCOMPLETE_WORKSPACE_DELIVERY');
    const application = result.manifest.application;
    const manifestFile = declared.get('application/source/source-files.json');
    need(manifestFile?.sha256 === application.manifestSha256,
      'APPLICATION_MANIFEST_MISMATCH');
    const sourceBytes = await fs.readFile(await confined(args.sourceDirectory,
      'application/source/source-files.json'));
    const source = JSON.parse(sourceBytes);
    need(source.schema === 'paycashless.application-source.v1' && Array.isArray(source.files),
      'APPLICATION_SOURCE_MANIFEST_REQUIRED');
    const sourceMembers = [...source.files, {
      path: 'source-files.json', bytes: sourceBytes.length, sha256: hash(sourceBytes),
      mode: manifestFile.mode,
    }];
    const names = new Set();
    for (const file of sourceMembers) {
      need(!names.has(file.path), 'DUPLICATE_SOURCE_MEMBER');
      names.add(file.path);
      need(sameMember(declared.get('application/source/' + file.path), file),
        'APPLICATION_SOURCE_COHORT_MISMATCH');
    }
    need(completePaycashlessSource(source, hash(sourceBytes)) &&
      application.entrypoints?.server === 'server.mjs' &&
      application.entrypoints?.cli === 'cli.mjs' && application.entrypoints?.worker === 'worker.mjs',
      'APPLICATION_ENTRYPOINT_MISMATCH');
    const embedded = new Map((application.files ?? []).map(file => [file.path, file]));
    need(embedded.size === names.size && result.manifest.files.filter(file =>
      file.path.startsWith('application/source/')).length === names.size,
      'APPLICATION_SOURCE_COHORT_MISMATCH');
    for (const file of sourceMembers) need(sameMember(embedded.get(file.path), file),
      'APPLICATION_SOURCE_COHORT_MISMATCH');
    const native = await readPaycashlessRuntimeManifest({
      directory: path.join(args.sourceDirectory, 'runtime/source'),
      expectedManifestSha256: result.manifest.runtime.manifestSha256,
    });
    need(native.manifest.id === result.manifest.runtime.id, 'RUNTIME_ID_MISMATCH');
    for (const file of native.manifest.files) need(sameMember(
      declared.get('runtime/source/' + file.path), file), 'RUNTIME_SOURCE_COHORT_MISMATCH');
    need(result.manifest.files.filter(file => file.path.startsWith('runtime/source/')).length ===
      native.manifest.files.length + 1, 'RUNTIME_SOURCE_COHORT_MISMATCH');
  } else {
    need(!result.manifest.application && !result.manifest.runtime && result.manifest.report,
      'INVALID_SCOPED_REPORT_DELIVERY');
    const report = result.manifest.report;
    const raw = await fs.readFile(await confined(args.sourceDirectory, 'report/report.json'));
    need(canonical(JSON.parse(raw)) === canonical(report), 'REPORT_METADATA_MISMATCH');
    const names = new Set(['report/report.json']);
    for (const file of report.files) {
      need(typeof file.filename === 'string' && path.basename(file.filename) === file.filename &&
        file.filename !== 'report.json', 'INVALID_REPORT_MEMBER');
      const relative = 'report/' + file.filename;
      need(!names.has(relative) && sameMember(declared.get(relative), file),
        'REPORT_MEMBER_MISMATCH');
      names.add(relative);
    }
    need(names.size === declared.size, 'SCOPED_REPORT_HAS_UNDECLARED_CONTENT');
  }
  return {
    sourceDirectory: args.sourceDirectory, directory: args.sourceDirectory,
    manifest: result.manifest, manifestSha256: result.manifestSha256,
    bytes, fileCount: result.manifest.files.length,
  };
}

async function publishPackage({ workspace, requestId, destination, kind, reportId,
  sourceDirectory, runtimeDirectory, expectedManifestSha256 }) {
  need(path.isAbsolute(destination) && destination !== workspace.directory,
    'INDEPENDENT_EXPORT_DESTINATION_REQUIRED');
  const control = path.join(workspace.directory, 'exports', hash(requestId));
  await directory(control);
  const guard = await lease(control, 'export');
  try {
    const intent = {
      requestId, destination, kind, reportId: reportId ?? null,
      sourceDirectory: sourceDirectory ?? null,
      runtimeDirectory: runtimeDirectory ?? null,
      expectedManifestSha256: expectedManifestSha256 ?? null,
    };
    await writeExact(path.join(control, 'intent.json'), jsonBytes(intent));
    const completed = await readJSON(path.join(control, 'result.json'), true);
    if (completed) {
      await inspectPaycashlessDelivery({
        sourceDirectory: completed.directory,
        expectedManifestSha256: completed.manifestSha256,
      });
      await syncDirectory(path.dirname(completed.directory));
      return completed;
    }
    const pinned = path.join(control, 'pinned');
    await directory(pinned);
    let plan = await readJSON(path.join(control, 'plan.json'), true);
    if (!plan) {
      const identity = workspace.describe().workspace;
      const selected = [];
      let application = null;
      let runtime = null;
      let report = null;
      let snapshot = null;
      if (kind === 'workspace') {
        const snapshotPath = path.join(pinned, 'workspace.sqlite');
        if (await exists(snapshotPath)) {
          // A snapshot not yet selected in a plan may be interrupted. Preserve it.
          await fs.rename(snapshotPath, snapshotPath + '.unselected-' + Date.now());
        }
        snapshot = await workspace.snapshot(snapshotPath);
        selected.push({
          origin: pinned, descriptor: { ...snapshot.descriptor, path: 'workspace.sqlite' },
          path: 'workspace/workspace.sqlite',
        });
        for (const file of snapshot.files) {
          selected.push({ origin: workspace.directory, descriptor: file, path: 'workspace/' + file.path });
        }
        for (const file of await scanRegular(workspace.directory, 'attempts')) {
          selected.push({ origin: workspace.directory, descriptor: file, path: 'workspace/' + file.path });
        }
        need(sourceDirectory && runtimeDirectory, 'FULL_SOURCE_AND_RUNTIME_REQUIRED');
        application = await capturePaycashlessSource({
          sourceDirectory, destination: path.join(pinned, 'application'),
        });
        for (const file of application.files) selected.push({
          origin: path.join(pinned, 'application'), descriptor: file,
          path: 'application/source/' + file.path,
        });
        const native = await verifyPaycashlessRuntime({
          directory: runtimeDirectory, expectedManifestSha256,
        });
        const retained = await readPaycashlessRuntimeManifest({
          directory: runtimeDirectory, expectedManifestSha256: native.manifestSha256,
        });
        runtime = publicPaycashlessRuntime(native);
        for (const file of retained.manifest.files) selected.push({
          origin: runtimeDirectory, descriptor: file, path: 'runtime/source/' + file.path,
        });
        const runtimeManifest = await fileDescriptor(path.join(runtimeDirectory, 'manifest.json'), 'manifest.json');
        selected.push({
          origin: runtimeDirectory, descriptor: runtimeManifest,
          path: 'runtime/source/manifest.json',
        });
      } else {
        report = workspace.privateItem('reports', reportId);
        const metadata = jsonBytes(report);
        await writeExact(path.join(pinned, 'report.json'), metadata);
        selected.push({
          origin: pinned, descriptor: await fileDescriptor(path.join(pinned, 'report.json'), 'report.json'),
          path: 'report/report.json',
        });
        for (const member of report.files) {
          selected.push({
            origin: workspace.directory, descriptor: workspace.file(member.id),
            path: 'report/' + member.filename,
          });
        }
      }
      const names = new Set();
      for (const file of selected) {
        need(!names.has(file.path), 'DUPLICATE_EXPORT_MEMBER');
        names.add(file.path);
      }
      const manifestBody = {
        schema: DELIVERY_SCHEMA, id: requestId, kind, createdAt: now(),
        workspaceId: snapshot?.workspaceId ?? identity.id,
        sourceRevision: snapshot?.revision ?? identity.revision,
        sourceHead: snapshot?.head ?? identity.head,
        private: kind === 'workspace', application, runtime, report,
        files: selected.map(item => ({
          path: item.path, bytes: item.descriptor.bytes,
          sha256: item.descriptor.sha256, mode: item.descriptor.mode,
        })).sort((left, right) => left.path.localeCompare(right.path)),
      };
      const manifest = { ...manifestBody, sha256: hash(Buffer.from(canonical(manifestBody))) };
      plan = { intent, selected, manifest };
      await writeExact(path.join(control, 'plan.json'), jsonBytes(plan));
    }
    const stage = destination + '.pending-' + hash(requestId).slice(0, 20);
    await directory(path.dirname(destination));
    const targetLease = await lease(path.dirname(destination), 'export-target-' + hash(destination));
    try {
      const manifestBytes = jsonBytes(plan.manifest);
      const expected = hash(manifestBytes);
      if (await exists(destination)) {
        await inspectPaycashlessDelivery({ sourceDirectory: destination, expectedManifestSha256: expected });
        await syncDirectory(path.dirname(destination));
      } else {
        await directory(stage);
        for (const item of plan.selected) {
          await copyDeclared(item.origin, item.descriptor, stage, item.path);
        }
        await writeExact(path.join(stage, 'manifest.json'), manifestBytes);
        await inspectPaycashlessDelivery({ sourceDirectory: stage, expectedManifestSha256: expected });
        await fs.rename(stage, destination);
        await syncDirectory(path.dirname(destination));
      }
      const result = {
        id: requestId, exportId: requestId, kind, directory: destination,
        manifestSha256: expected, workspaceId: plan.manifest.workspaceId,
        sourceRevision: plan.manifest.sourceRevision, sourceHead: plan.manifest.sourceHead,
        files: plan.manifest.files.length,
        bytes: plan.manifest.files.reduce((total, file) => total + file.bytes, 0),
        reportId: reportId ?? null, createdAt: plan.manifest.createdAt,
      };
      workspace.registerExport(result);
      await writeExact(path.join(control, 'result.json'), jsonBytes(result));
      return result;
    } finally { await targetLease.release(); }
  } finally { await guard.release(); }
}

export async function exportPaycashlessWorkspace(options) {
  return publishPackage({ ...options, kind: 'workspace' });
}

export async function exportPaycashlessReport(options) {
  return publishPackage({ ...options, kind: 'report' });
}


async function verifyReceivedSelection(root, finalDestination, result, selected, intent) {
  need(result.directory === finalDestination && result.requestId === intent.requestId &&
    result.exportId === selected.manifest.id && result.manifestSha256 === selected.manifestSha256 &&
    result.kind === selected.manifest.kind &&
    result.originalPackageDirectory === path.join(finalDestination, 'original-package'),
    'RECEIVING_DESTINATION_CONFLICT');
  await inspectPaycashlessDelivery({sourceDirectory:path.join(root,'original-package'),
    expectedManifestSha256:selected.manifestSha256});
  if(selected.manifest.kind==='workspace'){
    const application=path.join(root,'application/source');
    for(const member of selected.manifest.files.filter(file=>file.path.startsWith('application/source/')))
      await verifyFile(root,member,{mode:true});
    need(result.application?.directory===path.join(finalDestination,'application/source') &&
      result.application.sourceManifestSha256===selected.manifest.application.manifestSha256,
      'RECEIVED_APPLICATION_CHANGED');
    const runtime=await verifyPaycashlessRuntime({directory:path.join(root,'runtime/installed'),
      expectedManifestSha256:selected.manifest.runtime.manifestSha256});
    need(runtime.id===result.runtime?.id &&
      result.runtime.nodeExecutable===path.join(finalDestination,'runtime/installed/bin/node'),
      'RECEIVED_RUNTIME_CHANGED');
    const {openPaycashlessWorkspace}=await import('./workspace.mjs');
    const received=await openPaycashlessWorkspace({directory:path.join(root,'workspace')});
    try{
      const actual=received.describe().workspace,origin=actual.receivedFrom;
      need(actual.id===result.workspace?.id && actual.revision>=result.workspace.revision &&
        origin?.exportId===selected.manifest.id &&
        origin.manifestSha256===selected.manifestSha256 &&
        origin.workspaceId===selected.manifest.workspaceId &&
        origin.revision===selected.manifest.sourceRevision && origin.head===selected.manifest.sourceHead,
        'RECEIVED_WORKSPACE_ORIGIN_CHANGED');
      // Customer revisions, configuration and dispatch decisions remain editable.
      // The immutable received package is the complete original custody anchor.
      if(actual.revision===result.workspace.revision)
        need(actual.head===result.workspace.head,'RECEIVED_WORKSPACE_HEAD_CHANGED');
    }finally{await received.close();}
  }else{
    for(const member of selected.manifest.files)await verifyFile(root,member,{mode:true});
    need(result.report?.id===selected.manifest.report.id,'RECEIVED_REPORT_CHANGED');
  }
  await syncDirectory(root);
  await syncDirectory(path.dirname(root));
  return result;
}

export async function receivePaycashlessDelivery({
  sourceDirectory, destination, requestId, expectedManifestSha256, signal,
}) {
  need(path.isAbsolute(destination) && path.resolve(sourceDirectory) !== path.resolve(destination),
    'INDEPENDENT_RECEIVING_DESTINATION_REQUIRED');
  await directory(path.dirname(destination));
  const guard = await lease(path.dirname(destination), 'receive-' + hash(destination));
  try {
    const selected = await inspectPaycashlessDelivery({ sourceDirectory, expectedManifestSha256 });
    const intent = {
      requestId, exportId: selected.manifest.id,
      manifestSha256: selected.manifestSha256, destination,
    };
    const stage = destination + '.pending-' + hash(requestId).slice(0, 20);
    if (await exists(destination)) {
      const result = await readJSON(path.join(destination, 'receiving.json'));
      need(result.requestId === requestId && result.manifestSha256 === selected.manifestSha256,
        'RECEIVING_DESTINATION_CONFLICT');
      await verifyReceivedSelection(destination,destination,result,selected,intent);
      return { ...result, replayed: true };
    }
    await directory(stage);
    await writeExact(path.join(stage, 'intent.json'), jsonBytes(intent));
    const completedStage = await readJSON(path.join(stage, 'receiving.json'), true);
    if (completedStage) {
      need(completedStage.requestId === requestId &&
        completedStage.manifestSha256 === selected.manifestSha256, 'RECEIVING_DESTINATION_CONFLICT');
      await verifyReceivedSelection(stage,destination,completedStage,selected,intent);
      await fs.rename(stage, destination);
      await syncDirectory(path.dirname(destination));
      return { ...completedStage, replayed: true };
    }
    const sourceCopy = path.join(stage, 'original-package');
    await directory(sourceCopy);
    for (const file of selected.manifest.files) {
      signal?.throwIfAborted();
      await copyDeclared(sourceDirectory, file, sourceCopy);
    }
    const manifest = await readPaycashlessDeliveryManifest({
      sourceDirectory, expectedManifestSha256: selected.manifestSha256,
    });
    await writeExact(path.join(sourceCopy, 'manifest.json'), manifest.bytes);
    let runtime = null;
    let application = null;
    let workspace = null;
    let report = null;
    if (selected.manifest.kind === 'workspace') {
      runtime = await restorePaycashlessRuntime({
        sourceDirectory: path.join(sourceCopy, 'runtime/source'),
        destination: path.join(stage, 'runtime/installed'),
        expectedManifestSha256: selected.manifest.runtime.manifestSha256,
      });
      for (const file of selected.manifest.files.filter(item => item.path.startsWith('application/source/'))) {
        await copyDeclared(sourceCopy, file, stage, file.path);
      }
      const copiedMarker = path.join(stage, 'workspace-copied.json');
      const copied = await readJSON(copiedMarker, true);
      if (copied) {
        need(copied.manifestSha256 === selected.manifestSha256, 'RECEIVING_SOURCE_CHANGED');
      } else {
        for (const file of selected.manifest.files.filter(item => item.path.startsWith('workspace/'))) {
          await copyDeclared(sourceCopy, file, stage, file.path);
        }
        await writeExact(copiedMarker, jsonBytes({ manifestSha256: selected.manifestSha256 }));
      }
      const { openPaycashlessWorkspace } = await import('./workspace.mjs');
      const received = await openPaycashlessWorkspace({ directory: path.join(stage, 'workspace') });
      try {
        const origin = {
          exportId: selected.manifest.id, manifestSha256: selected.manifestSha256,
          workspaceId: selected.manifest.workspaceId,
          revision: selected.manifest.sourceRevision, head: selected.manifest.sourceHead,
        };
        const prepared = received.prepareReceived(origin);
        workspace = { ...prepared, directory: path.join(destination, 'workspace') };
      } finally { await received.close(); }
      application = {
        directory: path.join(destination, 'application/source'),
        server: path.join(destination, 'application/source/server.mjs'),
        cli: path.join(destination, 'application/source/cli.mjs'),
        worker:path.join(destination,'application/source/worker.mjs'),
        sourceManifestSha256: selected.manifest.application.manifestSha256,
      };
      runtime = {
        ...publicPaycashlessRuntime(runtime), directory: path.join(destination, 'runtime/installed'),
        nodeExecutable: path.join(destination, 'runtime/installed/bin/node'),
      };
    } else {
      for (const file of selected.manifest.files) {
        await copyDeclared(sourceCopy, file, stage, file.path);
      }
      report = {
        id: selected.manifest.report.id,
        metadata: path.join(destination, 'report/report.json'),
        files: selected.manifest.report.files.map(file => ({
          filename: file.filename, path: path.join(destination, 'report', file.filename),
        })),
      };
    }
    const result = {
      kind: selected.manifest.kind, directory: destination, requestId,
      exportId: selected.manifest.id, manifestSha256: selected.manifestSha256,
      workspace, application, runtime, report, dispatchEnabled: false,
      originalPackageDirectory: path.join(destination, 'original-package'),
      receivedAt: now(), replayed: false,
    };
    await writeExact(path.join(stage, 'receiving.json'), jsonBytes(result));
    await fs.rename(stage, destination);
    await syncDirectory(path.dirname(destination));
    return result;
  } finally { await guard.release(); }
}
