// MIT. Native receiving data, transient browser inspection and local access.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { resolve, relative, join, sep } from 'node:path';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const NATIVE_ARTIFACT_CONTRACT = 'stellar-forge.native-receiving-artifacts.v2';
const legacyInspections = {
  'stellar-forge.merchant-workflow-native-receiving.v1': new Set([
    'workflow-customer-desktop.png', 'workflow-complete-desktop.png',
    'workflow-complete-mobile.png', 'workflow-reopened.png'
  ]),
  'stellar-forge.merchant-workflow-recipe-native-receiving.v1': new Set([
    'recipe-source-desktop.png', 'recipe-reviewed-desktop.png', 'recipe-interrupted-installation.png',
    'recipe-received-desktop.png', 'recipe-received-mobile.png', 'recipe-reopened-receiver-profile.png'
  ]),
  'stellar-forge.merchant-workflow-series-native-receiving.v1': new Set([
    'series-completed-desktop.png', 'series-completed-mobile.png', 'series-received-reopened.png'
  ])
};

function selectedPath(directory, name) {
  assert.equal(typeof name, 'string'); assert.ok(name && !name.includes('\\'));
  const root = resolve(directory), path = resolve(root, name), inside = relative(root, path);
  assert.ok(inside && inside !== '..' && !inside.startsWith('..' + sep) && !inside.startsWith(sep),
    'Use a file inside the original receiving directory.');
  return path;
}

/** Older completed reports remain byte-identical; their named QA images are optional. */
export function requiredNativeArtifacts(report) {
  assert.ok(Array.isArray(report.artifacts), 'Read the complete original artifact selection.');
  if (report.artifactContract !== undefined)
    assert.equal(report.artifactContract, NATIVE_ARTIFACT_CONTRACT);
  const optional = report.artifactContract === undefined ? legacyInspections[report.schema] : undefined;
  return report.artifacts.filter(file => !optional?.has(file.name));
}

export async function verifyNativeArtifacts(directory, report) {
  const files = requiredNativeArtifacts(report);
  for (const file of files) {
    const bytes = await readFile(selectedPath(directory, file.name));
    assert.equal(bytes.length, file.bytes, 'Complete native file ' + file.name);
    assert.equal(digest(bytes), file.sha256, 'Original native file ' + file.name);
  }
  return files;
}

/** Only active checkpoint objects are upgraded; completed report files are never rewritten. */
export function prepareNativeArtifactReport(report) {
  const files = requiredNativeArtifacts(report), selected = new Set(files.map(file => file.name));
  report.inspections ??= [];
  for (const file of report.artifacts) {
    if (!selected.has(file.name) && !report.inspections.some(value => value.name === file.name))
      report.inspections.push({ ...file, kind: 'browser-inspection', transient: true });
  }
  report.artifacts = files;
  report.artifactContract = NATIVE_ARTIFACT_CONTRACT;
  return report;
}

export async function retainNativeInspection(directory, report, name, bytes) {
  assert.match(name, /^[A-Za-z0-9._-]+\.png$/);
  prepareNativeArtifactReport(report);
  const relativeName = 'native-inspections/' + name, path = selectedPath(directory, relativeName);
  await mkdir(join(directory, 'native-inspections'), { recursive: true, mode: 0o700 });
  await writeFile(path, bytes, { mode: 0o600 });
  const value = { name: relativeName, bytes: bytes.length, sha256: digest(bytes),
    kind: 'browser-inspection', transient: true };
  const index = report.inspections.findIndex(file => file.name === relativeName);
  if (index < 0) report.inspections.push(value); else report.inspections[index] = value;
  return value;
}

/** The real merchant launcher consumes this local credential through MCP_ACCESS_TOKEN. */
export async function nativeReceivingAccessToken(directory) {
  const path = join(resolve(directory), 'native-access-token');
  try {
    const token = (await readFile(path, 'utf8')).trim();
    assert.ok(token.length >= 32 && !/\s/.test(token), 'Use the original private local access credential.');
    return token;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const token = randomBytes(32).toString('hex');
    try { await writeFile(path, token + '\n', { mode: 0o600, flag: 'wx' }); return token; }
    catch (writeError) {
      if (writeError.code !== 'EEXIST') throw writeError;
      return nativeReceivingAccessToken(directory);
    }
  }
}

/** One native delivery selection keeps archive construction on the same artifact contract. */
export async function writeNativeArtifactSelection(directory) {
  directory = resolve(directory);
  const files = new Map(), programmes = [];
  const add = file => {
    selectedPath(directory, file.name);
    if (files.has(file.name)) assert.deepEqual(files.get(file.name), file);
    else files.set(file.name, file);
  };
  for (const stem of ['workflow', 'workflow-recipes', 'workflow-series']) {
    const retained = [];
    for (const name of [stem + '-native-run.json', stem + '-receiving-checkpoint.json']) {
      try {
        const bytes = await readFile(join(directory, name)), report = JSON.parse(bytes);
        assert.equal(report.operationId, 'ASTRA-24EA-MERCHANT-WORKFLOW-20261012');
        assert.equal(report.directory, directory);
        add({ name, bytes: bytes.length, sha256: digest(bytes) });
        retained.push({ name, report });
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const original = retained.find(value => value.name === stem + '-native-run.json') ?? retained[0];
    if (!original) continue;
    const artifacts = await verifyNativeArtifacts(directory, original.report);
    for (const file of artifacts) add(file);
    programmes.push({ name: original.name, result: original.report.result,
      artifactContract: original.report.artifactContract ?? 'legacy-named-inspections',
      requiredArtifacts: artifacts.map(file => file.name) });
  }
  const selection = { schema: 'stellar-forge.native-delivery-artifacts.v1',
    operationId: 'ASTRA-24EA-MERCHANT-WORKFLOW-20261012', directory, programmes,
    files: [...files.values()].sort((left, right) => left.name.localeCompare(right.name)) };
  const path = join(directory, 'native-required-artifacts.json'), temporary = path + '.tmp';
  await writeFile(temporary, JSON.stringify(selection, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, path);
  return selection;
}
