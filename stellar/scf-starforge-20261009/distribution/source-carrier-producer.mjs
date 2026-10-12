// MIT. Complete Git source carriers through the existing connected-tool adapters.
// The maintained Git receiver and distribution builder own source receiving and packaging.
import { createHash } from 'node:crypto';

const json = value => JSON.stringify(value, null, 2) + '\n';
const info = text => ({ bytes: Buffer.byteLength(text, 'utf8'),
  sha256: createHash('sha256').update(text, 'utf8').digest('hex') });
const need = (condition, message, code = 'SOURCE_CARRIER_INVALID') => {
  if (!condition) throw Object.assign(new Error(message), { code });
};
const oid = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
const copy = value => structuredClone(value);
const gitTextBlob = text => createHash('sha1').update('blob ' + Buffer.byteLength(text, 'utf8') + '\0').update(text, 'utf8').digest('hex');
export const SOURCE_CARRIER_LIMITS = Object.freeze({
  fileBytes: 2 * 1024 * 1024, sourceBytes: 128 * 1024 * 1024,
  metadataBytes: 8 * 1024 * 1024, archiveBytes: 5 * 1024 * 1024,
});
export const sourceCarrierTextInfo = info;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pageIdentity = value => typeof value === 'string' &&
  /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(value);
const canonicalPage = value => String(value).replaceAll('-', '').toLowerCase();
function safeBranch(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.\/-]{0,220}$/.test(value) &&
    !value.includes('..') && !value.includes('//') && !value.includes('@{') &&
    !value.endsWith('/') && !value.endsWith('.') &&
    value.split('/').every(part => part && !part.startsWith('.') && !part.endsWith('.lock'));
}
function safeSourcePath(value) {
  return typeof value === 'string' && value && !value.startsWith('/') &&
    !/[\\\x00-\x1f\x7f]/.test(value) &&
    value.split('/').every(part => part && part !== '.' && part !== '..' && part.toLowerCase() !== '.git');
}
export function createSourceCarrierState(plan, { operationId, pageId, hashText = info } = {}) {
  assertSourceCarrierPlan(plan, { hashText });
  need(operationId === undefined || (typeof operationId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/.test(operationId)),
    'Use the original stable operation identity.');
  need(pageId === undefined || pageIdentity(pageId), 'Use the original destination page identity.');
  return { schema: 'stellar-forge.git-source-carrier-state.v1', source: copy(plan.source),
    ...(operationId ? { operationId } : {}), ...(pageId ? { pageId } : {}),
    authorities: {}, parts: [], operations: {} };
}

export function unwrapCarrierResult(result) {
  need(result && result.isError !== true, 'The original tool returned an error; retain its complete result.');
  if (result.structuredContent) {
    need(!result.structuredContent.error && !result.structuredContent.error_code,
      'The original provider returned an error; retain its complete result.');
    const value = result.structuredContent;
    if (value.sha || value.branch || value.file_upload_id || value.text || value.page_id || value.async_task) return value;
    if (typeof value.content === 'string') {
      try {
        const parsed = JSON.parse(value.content);
        need(!parsed.error && !parsed.error_code, 'The original provider returned an error; retain its complete result.');
        return parsed;
      } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    }
  }
  for (const item of result.content ?? []) {
    if (item.type !== 'text') continue;
    try {
      const value = JSON.parse(item.text);
      need(!value.error && !value.code && !value.error_code, 'The original provider returned an error.');
      return value;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  throw new Error('The original provider result has no recognized receipt.');
}

/** Preserve both exact Git API JSON strings; no round-trip rewriting of authority bytes. */
export function prepareSourceCarrier({ repository, commitJson, treeJson, branchPrefix, filenamePrefix,
  maxSourceBytes = 4_000_000, attributeFiles = {}, hashText = info }) {
  need(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository), 'Use the original repository identity.');
  need(Number.isSafeInteger(maxSourceBytes) && maxSourceBytes >= 1 && maxSourceBytes <= 4_000_000,
    'Choose a source part bound between 1 and 4,000,000 bytes.');
  need(typeof commitJson === 'string' && typeof treeJson === 'string' &&
    hashText(commitJson).bytes <= SOURCE_CARRIER_LIMITS.metadataBytes &&
    hashText(treeJson).bytes <= SOURCE_CARRIER_LIMITS.metadataBytes, 'Use bounded complete original authority responses.');
  const commit = JSON.parse(commitJson), tree = JSON.parse(treeJson);
  need(oid(commit.sha) && oid(tree.sha) && commit.tree?.sha === tree.sha && tree.truncated === false,
    'Use complete original commit and recursive-tree responses.');
  need(Array.isArray(tree.tree) && tree.tree.every(row => row.type === 'tree' ||
    (row.type === 'blob' && ['100644', '100755'].includes(row.mode))), 'Preserve original regular files and modes.');
  const files = tree.tree.filter(row => row.type === 'blob');
  need(files.length && files.every(row => typeof row.path === 'string' && row.path &&
    !row.path.startsWith('/') && !row.path.includes('\\') &&
    row.path.split('/').every(part => part && part !== '.' && part !== '..') &&
    safeSourcePath(row.path) && row.path !== 'SOURCE-PART.json' && !row.path.startsWith('SOURCE-PART.json/') &&
    oid(row.sha) && Number.isSafeInteger(row.size) && row.size >= 0 &&
    row.size <= Math.min(maxSourceBytes, SOURCE_CARRIER_LIMITS.fileBytes)),
  'Use the complete original bounded file inventory.');
  need(new Set(files.map(row => row.path)).size === files.length, 'Original source paths must be unique.');
  need(safeBranch(branchPrefix + '01') && typeof filenamePrefix === 'string' &&
    /^[A-Za-z0-9_.-]{1,120}$/.test(filenamePrefix), 'Use the retained source-only naming inputs.');
  const source = { repository, commit: commit.sha, tree: tree.sha, fileCount: files.length,
    sourceBytes: files.reduce((n, row) => n + row.size, 0) };
  need(source.sourceBytes <= SOURCE_CARRIER_LIMITS.sourceBytes, 'Source exceeds the maintained receiver capacity.');
  const archiveAttributes = [];
  for (const row of files.filter(row => row.path.split('/').at(-1) === '.gitattributes')) {
    const content = attributeFiles[row.path];
    need(typeof content === 'string' && hashText(content).bytes === row.size,
      'Receive the original archive-attribute file before preparing carriers: ' + row.path);
    const gitBlob = gitTextBlob(content);
    need(gitBlob === row.sha, 'Archive-attribute bytes differ from the original Git blob: ' + row.path);
    const active = content.split(/\r?\n/).filter(line => !/^\s*(?:#|$)/.test(line));
    need(!active.some(line => /(?:^|\s)[!\-]?(?:export-ignore|export-subst)(?:[=\s]|$)/.test(line)),
      'This source declares archive filtering/substitution. Receive it through the existing direct Git/object route so original bytes remain exact.');
    archiveAttributes.push({ path: row.path, gitBlob, content });
  }
  const authorities = [
    { path: 'SOURCE-COMMIT.json', kind: 'github-git-commit-response', ...hashText(commitJson) },
    { path: 'SOURCE-TREE.json', kind: 'github-recursive-git-tree-response', ...hashText(treeJson) },
  ];
  const batches = []; let batch = [], bytes = 0;
  for (const row of files) {
    if (batch.length && bytes + row.size > maxSourceBytes) { batches.push(batch); batch = []; bytes = 0; }
    batch.push(row); bytes += row.size;
  }
  if (batch.length) batches.push(batch);
  const total = batches.length + 1;
  const parts = [[], ...batches].map((rows, index) => {
    const part = index + 1, kind = index ? 'source-files' : 'git-authority';
    const manifest = { schema: 'stellar-forge.git-source-part.v1', source, part, parts: total, kind,
      members: rows.map(row => ({ path: row.path, mode: row.mode, gitBlob: row.sha, bytes: row.size })),
      ...(index ? {} : { authorities }) };
    const manifestText = json(manifest);
    return { part, kind, branch: branchPrefix + String(part).padStart(2, '0'),
      filename: filenamePrefix + '_Part_' + String(part).padStart(2, '0') + '_of_' + total + '.zip',
      manifest, manifestText, manifestInfo: hashText(manifestText) };
  });
  const plan = { schema: 'stellar-forge.git-source-carrier-plan.v1', source, maxSourceBytes,
    branchPrefix, filenamePrefix, authorities, parts,
    ...(archiveAttributes.length ? { archiveAttributes } : {}) };
  assertSourceCarrierPlan(plan, { hashText });
  return plan;
}

/**
 * Factor of the exact original publish sequence. tools is the existing connected
 * tool adapter; persist durably retains the same state after each transition.
 * Existing returned identities are adopted. A lost mutation response needs original
 * provider reconciliation before its pending stage can be continued.
 */
export async function publishSourceCarrier({ plan, state, authorityText, tools, persist, pageId = state?.pageId,
  hashText = info }) {
  assertSourceCarrierPlan(plan, { hashText });
  assertSourceCarrierState(plan, state);
  need(typeof persist === 'function' && tools && typeof tools === 'object', 'Use the original tool adapter and durable state writer.');
  if (pageId && state.pageId) need(canonicalPage(pageId) === canonicalPage(state.pageId),
    'Resume the original destination page.');
  if (state.parts.length === plan.parts.length && state.parts.every(part => part.notionReference)) {
    finalizeSourceCarrierIndex(plan, state, { hashText });
    return state;
  }
  need(pageIdentity(pageId), 'Bind the authorized existing destination page before publication.');
  const repositoryRead = unwrapCarrierResult(await tools.mcp__codex_apps__github_fetch({
    url: 'https://api.github.com/repos/' + plan.source.repository }));
  need(repositoryRead.private === false && typeof repositoryRead.full_name === 'string' &&
    repositoryRead.full_name.toLowerCase() === plan.source.repository.toLowerCase(),
    'This public-source carrier route requires the actual original repository to be public.');
  const destinationRead = unwrapCarrierResult(await tools.mcp__codex_apps__notion_fetch({ id: pageId }));
  need(typeof destinationRead.text === 'string', 'Read the authorized original destination page before uploading source.');
  if (!state.pageId) { state.pageId = pageId; await persist(copy(state)); }
  if (!state.destination) {
    state.destination = { pageId, originalReferences: stableReferences(destinationRead.text) };
    await persist(copy(state));
  }
  need(canonicalPage(state.destination.pageId) === canonicalPage(pageId), 'Original destination binding differs.');
  for (const original of plan.parts) {
    const saved = state.parts.find(part => part.part === original.part);
    if (saved?.notionReference || state.pageOperation?.parts?.includes(original.part)) continue;
    need(!state.destination.originalReferences.some(ref => referenceName(ref) === original.filename),
      'The destination already contains this filename. Retain the original transfer state or use unique source names: ' + original.filename);
  }
  state.authorities ??= {};
  state.parts ??= [];
  state.operations ??= {};
  const repository_full_name = plan.source.repository;
  const call = (key, name, args) => callSourceCarrierTool({ state, tools, persist, hashText }, key, name, args);
  for (const authority of plan.authorities) {
    if (oid(state.authorities[authority.path]?.gitBlob)) continue;
    const content = authorityText?.[authority.path];
    need(typeof content === 'string' && hashText(content).bytes === authority.bytes &&
      hashText(content).sha256 === authority.sha256, 'Receive the exact original authority bytes: ' + authority.path);
    const result = await call('authority:' + authority.path, 'mcp__codex_apps__github_create_blob',
      { repository_full_name, content, encoding: 'utf-8' });
    need(oid(result.sha) && result.sha === gitTextBlob(content), 'Original Git authority creation returned a different blob identity.');
    state.authorities[authority.path] = { gitBlob: result.sha };
    await persist(copy(state));
  }
  for (const original of plan.parts) {
    let current = state.parts.find(part => part.part === original.part);
    if (!current) { current = { part: original.part }; state.parts.push(current); await persist(copy(state)); }
    if (!current.manifestGitBlob) {
      const result = await call('manifest:' + original.part, 'mcp__codex_apps__github_create_blob',
        { repository_full_name, content: original.manifestText, encoding: 'utf-8' });
      need(oid(result.sha) && result.sha === gitTextBlob(original.manifestText), 'Original manifest creation returned a different blob identity.');
      current.manifestGitBlob = result.sha; await persist(copy(state));
    }
    if (!current.carrierTree) {
      const tree_elements = original.manifest.members.map(row =>
        ({ path: row.path, mode: row.mode, type: 'blob', sha: row.gitBlob }));
      for (const row of original.manifest.authorities ?? [])
        tree_elements.push({ path: row.path, mode: '100644', type: 'blob', sha: state.authorities[row.path].gitBlob });
      tree_elements.push({ path: 'SOURCE-PART.json', mode: '100644', type: 'blob', sha: current.manifestGitBlob });
      const result = await call('tree:' + original.part, 'mcp__codex_apps__github_create_tree',
        { repository_full_name, tree_elements });
      need(oid(result.sha), 'Original carrier creation returned no tree identity.');
      current.carrierTree = result.sha; await persist(copy(state));
    }
    if (!current.carrierCommit) {
      const result = await call('commit:' + original.part, 'mcp__codex_apps__github_create_commit',
        { repository_full_name, parent_sha: plan.source.commit, tree_sha: current.carrierTree,
          message: 'Retain original source transfer part ' + original.part + ' of ' + plan.parts.length });
      need(oid(result.sha), 'Original carrier creation returned no commit identity.');
      current.carrierCommit = result.sha; await persist(copy(state));
    }
    if (!current.branchReceipt) {
      const observed = await tools.mcp__codex_apps__github_fetch({
        url: 'https://api.github.com/repos/' + repository_full_name + '/git/ref/heads/' +
          original.branch.split('/').map(encodeURIComponent).join('/') });
      if (!missingGitReference(observed)) {
        const ref = unwrapCarrierResult(observed);
        need(ref.ref === 'refs/heads/' + original.branch && ref.object?.sha === current.carrierCommit,
          'Preserve the existing source branch; it points to a different commit: ' + original.branch);
        current.branchReceipt = { branch: original.branch, observedRef: ref };
        if (state.operations['branch:' + original.part])
          state.operations['branch:' + original.part].reconciliation = { kind: 'original-git-ref', response: observed };
        await persist(copy(state));
      } else {
        const result = await call('branch:' + original.part, 'mcp__codex_apps__github_create_branch',
          { repository_full_name, branch_name: original.branch, sha: current.carrierCommit });
        need(result.branch === original.branch, 'Original carrier branch differs.');
        current.branchReceipt = result; await persist(copy(state));
      }
    }
    if (!current.attachment && !current.notionReference) {
      const result = await call('attachment:' + original.part, 'mcp__codex_apps__notion_notion_create_attachment',
        { source_url: 'https://codeload.github.com/' + repository_full_name + '/zip/' + current.carrierCommit,
          filename: original.filename, content_type: 'application/zip' });
      need(result.status === 'uploaded' && result.filename === original.filename &&
        Number.isSafeInteger(result.content_length) && result.content_length > 0 &&
        result.content_length <= 5 * 1024 * 1024 && typeof result.markdown_source === 'string',
      'Retain the complete original archive upload receipt.');
      current.attachment = result; await persist(copy(state));
    }
  }
  return state;
}

/** Attach once through the original Notion page, then adopt actual stable file references. */
export async function attachSourceCarrier({ plan, state, pageId = state?.pageId, tools, persist, hashText = info }) {
  assertSourceCarrierPlan(plan, { hashText });
  assertSourceCarrierState(plan, state);
  need(pageIdentity(pageId) && state.pageId && canonicalPage(pageId) === canonicalPage(state.pageId),
    'Attach to the same original authorized destination page.');
  if (state.parts.length === plan.parts.length && state.parts.every(part => part.notionReference))
    return finalizeSourceCarrierIndex(plan, state, { hashText });
  if (state.pageOperation?.status === 'RETURNED') unwrapCarrierResult(state.pageOperation.result);
  const fetched = await tools.mcp__codex_apps__notion_fetch({ id: pageId });
  const page = unwrapCarrierResult(fetched);
  need(typeof page.text === 'string', 'Read the original destination page before source attachment.');
  function adoptReferences(text) {
    const refs = stableReferences(text);
    const missing = [];
    for (const original of plan.parts) {
      const saved = state.parts.find(row => row.part === original.part);
      need(saved, 'Finish the original source part upload before attachment.');
      const exact = refs.filter(ref => referenceName(ref) === original.filename);
      need(exact.length <= 1, 'Reconcile ambiguous original file references: ' + original.filename);
      if (saved.notionReference) {
        need(!exact.length || exact[0] === saved.notionReference, 'The original attached file identity changed.');
      } else if (exact.length) {
        const selected = state.pageOperation?.parts ?? [];
        need(selected.includes(original.part) && !(state.destination?.originalReferences ?? []).includes(exact[0]),
          'Reconcile the original page write before adopting a same-name file: ' + original.filename);
        saved.notionReference = exact[0];
      }
      else missing.push(original);
    }
    return missing;
  }
  let missing = adoptReferences(page.text);
  await persist(copy(state));
  if (state.pageOperation) {
    const selected = state.pageOperation.parts ?? plan.parts.map(part => part.part);
    if (selected.every(number => state.parts.find(part => part.part === number)?.notionReference)) {
      state.pageHistory ??= [];
      state.pageHistory.push({ ...state.pageOperation, status: 'READBACK_ADOPTED' });
      delete state.pageOperation;
      await persist(copy(state));
    } else {
      throw Object.assign(new Error('Continue the original page operation/task and adopt its page readback.'),
        { code: 'SOURCE_CARRIER_PAGE_PENDING', operation: copy(state.pageOperation) });
    }
  }
  if (!missing.length) return finalizeSourceCarrierIndex(plan, state, { hashText });
  for (const original of missing) {
    const saved = state.parts.find(part => part.part === original.part);
    need(saved?.attachment?.status === 'uploaded',
      'Use the original uploaded file receipt, or reconcile that same upload.');
  }
  const content = '## Complete source transfer ' + plan.source.commit + '\n\nRepository: ' +
    plan.source.repository + '\n\nOriginal tree: ' + plan.source.tree + '\n\n' +
    missing.map(part => '<file src="' + state.parts.find(row => row.part === part.part).attachment.markdown_source +
      '">' + part.filename + '</file>').join('\n\n');
  state.pageOperation = { pageId, status: 'DISPATCHING', parts: missing.map(part => part.part), content,
    contentSha256: hashText(content).sha256 };
  await persist(copy(state));
  let result;
  try {
    result = await tools.mcp__codex_apps__notion_notion_update_page({ page_id: pageId,
      command: 'insert_content', position: { type: 'end' }, content, allow_async: false });
  } catch (error) {
    state.pageOperation.status = 'UNCERTAIN';
    state.pageOperation.error = String(error);
    await persist(copy(state));
    throw error;
  }
  state.pageOperation = { ...state.pageOperation, status: 'RETURNED', result };
  await persist(copy(state));
  const returned = unwrapCarrierResult(result);
  if (returned.async_task) {
    throw Object.assign(new Error('Wait for the original Notion task, then resume this same page readback.'),
      { code: 'SOURCE_CARRIER_PAGE_PENDING', operation: copy(state.pageOperation) });
  }
  need(returned.page_id === pageId || canonicalPage(returned.page_id) === canonicalPage(pageId),
    'Original page update returned a different destination.');
  const readback = unwrapCarrierResult(await tools.mcp__codex_apps__notion_fetch({ id: pageId }));
  missing = adoptReferences(readback.text ?? '');
  await persist(copy(state));
  need(!missing.length, 'Receive every actual stable file reference from the original page.',
    'SOURCE_CARRIER_PAGE_PENDING');
  state.pageHistory ??= [];
  state.pageHistory.push({ ...state.pageOperation, status: 'READBACK_ADOPTED' });
  delete state.pageOperation;
  await persist(copy(state));
  return finalizeSourceCarrierIndex(plan, state, { hashText });
}

export function finalizeSourceCarrierIndex(plan, state, { hashText = info } = {}) {
  assertSourceCarrierPlan(plan, { hashText });
  assertSourceCarrierState(plan, state);
  const source = plan.source;
  const parts = plan.parts.map(original => {
    const saved = state.parts.find(part => part.part === original.part);
    need(saved && oid(saved.carrierCommit) && oid(saved.carrierTree) && oid(saved.manifestGitBlob) &&
      typeof saved.notionReference === 'string' && saved.notionReference.startsWith('notion-file-block://'),
    'Adopt complete original Git and attached-file identities.');
    const bytes = saved.attachment?.content_length ?? saved.archiveBytes;
    need(Number.isSafeInteger(bytes) && bytes > 0, 'Use the original uploaded archive byte length.');
    return { part: original.part, kind: original.kind, path: original.filename, archiveBytes: bytes,
      sourceUrl: 'https://codeload.github.com/' + source.repository + '/zip/' + saved.carrierCommit,
      carrierCommit: saved.carrierCommit, carrierTree: saved.carrierTree, manifestGitBlob: saved.manifestGitBlob,
      manifestSha256: original.manifestInfo.sha256, manifestBytes: original.manifestInfo.bytes,
      sourceFiles: original.manifest.members.length,
      sourceBytes: original.manifest.members.reduce((n, row) => n + row.bytes, 0),
      notionReference: saved.notionReference };
  });
  return { schema: 'stellar-forge.git-source-transfer.v1', source, parts };
}


export function assertSourceCarrierPlan(plan, { hashText = info } = {}) {
  need(plain(plan) && plan.schema === 'stellar-forge.git-source-carrier-plan.v1' && plain(plan.source),
    'Use a complete original source-carrier plan.');
  const source = plan.source;
  need(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source.repository) && oid(source.commit) && oid(source.tree) &&
    Number.isSafeInteger(source.fileCount) && source.fileCount > 0 &&
    Number.isSafeInteger(source.sourceBytes) && source.sourceBytes >= 0 &&
    source.sourceBytes <= SOURCE_CARRIER_LIMITS.sourceBytes, 'Original source identity or capacity differs.');
  need(safeBranch(plan.branchPrefix + '01') && typeof plan.filenamePrefix === 'string' &&
    /^[A-Za-z0-9_.-]{1,120}$/.test(plan.filenamePrefix), 'Original carrier naming inputs differ.');
  need(Number.isSafeInteger(plan.maxSourceBytes) && plan.maxSourceBytes >= 1 && plan.maxSourceBytes <= 4_000_000 &&
    Array.isArray(plan.parts) && plan.parts.length >= 2 && Array.isArray(plan.authorities) &&
    plan.authorities.length === 2, 'Original source-carrier structure differs.');
  const expectedAuthorities = ['SOURCE-COMMIT.json', 'SOURCE-TREE.json'];
  for (let i = 0; i < 2; i++) {
    const value = plan.authorities[i];
    need(value.path === expectedAuthorities[i] && value.kind === ['github-git-commit-response', 'github-recursive-git-tree-response'][i] &&
      Number.isSafeInteger(value.bytes) && value.bytes > 0 &&
      value.bytes <= SOURCE_CARRIER_LIMITS.metadataBytes && /^[a-f0-9]{64}$/.test(value.sha256),
      'Original authority identity differs.');
  }
  const paths = new Set(), filenames = new Set(), branches = new Set();
  let count = 0, total = 0;
  for (let i = 0; i < plan.parts.length; i++) {
    const part = plan.parts[i], manifest = part.manifest;
    need(part.part === i + 1 && part.kind === (i ? 'source-files' : 'git-authority') &&
      safeBranch(part.branch) && part.branch === plan.branchPrefix + String(part.part).padStart(2, '0') && !branches.has(part.branch) &&
      part.filename === plan.filenamePrefix + '_Part_' + String(part.part).padStart(2, '0') + '_of_' + plan.parts.length + '.zip' &&
      /^[A-Za-z0-9_.-]+\.zip$/.test(part.filename) && !filenames.has(part.filename),
      'Use the original ordered carrier names.');
    branches.add(part.branch); filenames.add(part.filename);
    need(plain(manifest) && manifest.schema === 'stellar-forge.git-source-part.v1' &&
      equal(manifest.source, source) && manifest.part === part.part && manifest.parts === plan.parts.length &&
      manifest.kind === part.kind && Array.isArray(manifest.members) &&
      (i ? manifest.members.length > 0 && !manifest.authorities :
        manifest.members.length === 0 && equal(manifest.authorities, plan.authorities)),
      'Source-part manifest differs from the original plan.');
    need(part.manifestText === json(manifest) && equal(part.manifestInfo, hashText(part.manifestText)),
      'Preserve the exact original source-part manifest bytes.');
    let bytes = 0;
    for (const row of manifest.members) {
      need(safeSourcePath(row.path) && row.path !== 'SOURCE-PART.json' && !row.path.startsWith('SOURCE-PART.json/') &&
        !paths.has(row.path) && ['100644', '100755'].includes(row.mode) && oid(row.gitBlob) &&
        Number.isSafeInteger(row.bytes) && row.bytes >= 0 && row.bytes <= SOURCE_CARRIER_LIMITS.fileBytes,
        'Retain each original bounded source file exactly once.');
      paths.add(row.path); bytes += row.bytes; count++;
    }
    need(bytes <= plan.maxSourceBytes, 'Original source part exceeds its retained bound.');
    total += bytes;
  }
  need(count === source.fileCount && total === source.sourceBytes, 'Complete original source totals differ.');
  const attributes = plan.parts.flatMap(part => part.manifest.members)
    .filter(row => row.path.split('/').at(-1) === '.gitattributes');
  need((plan.archiveAttributes?.length ?? 0) === attributes.length, 'Retain the complete archive-attribute review.');
  for (const row of attributes) {
    const item = plan.archiveAttributes.find(value => value.path === row.path);
    need(item && item.gitBlob === row.gitBlob && typeof item.content === 'string' &&
      hashText(item.content).bytes === row.bytes && gitTextBlob(item.content) === row.gitBlob,
      'Original archive-attribute source differs.');
    need(!item.content.split(/\r?\n/).filter(line => !/^\s*(?:#|$)/.test(line))
      .some(line => /(?:^|\s)[!\-]?(?:export-ignore|export-subst)(?:[=\s]|$)/.test(line)),
      'Use the direct Git/object source route for archive filtering/substitution.');
  }
  return plan;
}

export function assertSourceCarrierState(plan, state) {
  need(plain(state) && state.schema === 'stellar-forge.git-source-carrier-state.v1' &&
    equal(state.source, plan.source) && plain(state.authorities) && Array.isArray(state.parts) &&
    plain(state.operations), 'Resume the original source-carrier state.');
  if (state.pageId) need(pageIdentity(state.pageId), 'Original destination identity differs.');
  if (state.destination) need(pageIdentity(state.destination.pageId) &&
    canonicalPage(state.destination.pageId) === canonicalPage(state.pageId) &&
    Array.isArray(state.destination.originalReferences) && state.destination.originalReferences.every(value =>
      typeof value === 'string' && value.startsWith('notion-file-block://')), 'Original destination read differs.');
  for (const [path, value] of Object.entries(state.authorities))
    need(plan.authorities.some(row => row.path === path) && plain(value) && oid(value.gitBlob), 'Original authority receipt differs.');
  if (state.pageOperation) need(pageIdentity(state.pageOperation.pageId) &&
    canonicalPage(state.pageOperation.pageId) === canonicalPage(state.pageId) &&
    Array.isArray(state.pageOperation.parts) && state.pageOperation.parts.length > 0 &&
    new Set(state.pageOperation.parts).size === state.pageOperation.parts.length &&
    state.pageOperation.parts.every(number => plan.parts.some(part => part.part === number)) &&
    ['DISPATCHING', 'RETURNED', 'UNCERTAIN'].includes(state.pageOperation.status), 'Original page operation differs.');
  const seen = new Set();
  for (const part of state.parts) {
    const original = plan.parts.find(row => row.part === part.part);
    need(original && !seen.has(part.part), 'Original carrier part state is ambiguous.');
    seen.add(part.part);
    for (const name of ['manifestGitBlob', 'carrierTree', 'carrierCommit'])
      if (part[name] !== undefined) need(oid(part[name]), 'Original Git receipt identity differs.');
    if (part.branchReceipt) need(part.branchReceipt.branch === original.branch, 'Original source branch changed.');
    if (part.attachment) need(part.attachment.status === 'uploaded' &&
      part.attachment.filename === original.filename && Number.isSafeInteger(part.attachment.content_length) &&
      part.attachment.content_length > 0 && part.attachment.content_length <= SOURCE_CARRIER_LIMITS.archiveBytes &&
      typeof part.attachment.markdown_source === 'string' &&
      /^file-upload:\/\/[a-f0-9-]+$/i.test(part.attachment.markdown_source), 'Original attached archive receipt differs.');
    if (part.notionReference) {
      let url; try { url = new URL(part.notionReference); } catch {}
      need(url?.protocol === 'notion-file-block:' && url.searchParams.get('name') === original.filename,
        'Retain the actual original stable file reference.');
    }
  }
  return state;
}

/** Adopt the actual result of the SAME dispatched provider call, without a new write. */
export async function adoptSourceCarrierOutcome({ plan, state, key, result, persist, hashText = info }) {
  assertSourceCarrierPlan(plan, { hashText }); assertSourceCarrierState(plan, state);
  const original = state.operations[key];
  need(original && typeof original.name === 'string' && /^[a-f0-9]{64}$/.test(original.argumentSha256),
    'Select an existing dispatched provider operation.');
  if (original.status === 'RETURNED') {
    need(equal(original.result, result), 'The already returned provider result differs.');
    return state;
  }
  need(['DISPATCHING', 'UNCERTAIN'].includes(original.status) && plain(result),
    'Adopt the complete actual result from the original provider journal.');
  state.operations[key] = { ...original, status: 'RETURNED', result: copy(result), adopted: true };
  delete state.operations[key].error;
  await persist(copy(state));
  return state;
}

function stableReferences(text) {
  return [...new Set([...String(text).matchAll(/<file src="(notion-file-block:\/\/[^"]+)"/g)].map(match => match[1]))];
}
function referenceName(ref) {
  try { return new URL(ref).searchParams.get('name'); } catch { return null; }
}
function missingGitReference(result) {
  const value = result?.structuredContent;
  return result?.isError === true && value?.error_code === 'NOT_FOUND' &&
    (value.error_data?.status === '404' || /GitHub API error 404:/.test(value.error ?? ''));
}
/** Preserve the original text response rather than serializing a normalized provider object. */
export function sourceCarrierGitText(result) {
  need(result && result.isError !== true && !result.structuredContent?.error,
    'Retain the actual original Git response or failure.');
  const content = result.structuredContent?.content;
  need(typeof content === 'string', 'The existing Git adapter must retain the complete UTF-8 response text.',
    'SOURCE_CARRIER_AUTHORITY_TEXT_REQUIRED');
  return content;
}
/** Read only the exact public source authorities and any original archive-attribute blobs. */
export async function receiveSourceCarrierAuthorities({ repository, commit, tools }) {
  need(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) && oid(commit),
    'Select one exact original public repository and commit.');
  const prefix = 'https://api.github.com/repos/' + repository;
  const sourceRead = await tools.mcp__codex_apps__github_fetch({ url: prefix });
  const source = unwrapCarrierResult(sourceRead);
  need(source.private === false && source.full_name?.toLowerCase() === repository.toLowerCase(),
    'This carrier route receives source from the actual original public repository.');
  const commitResult = await tools.mcp__codex_apps__github_fetch({ url: prefix + '/git/commits/' + commit });
  const commitJson = sourceCarrierGitText(commitResult), original = JSON.parse(commitJson);
  need(original.sha === commit && oid(original.tree?.sha), 'The returned original commit differs.');
  const treeResult = await tools.mcp__codex_apps__github_fetch({ url: prefix + '/git/trees/' + original.tree.sha + '?recursive=1' });
  const treeJson = sourceCarrierGitText(treeResult), tree = JSON.parse(treeJson);
  need(tree.sha === original.tree.sha && tree.truncated === false && Array.isArray(tree.tree),
    'Receive the complete original recursive source tree.');
  const attributeFiles = Object.create(null);
  for (const row of tree.tree.filter(row => row.type === 'blob' && row.path?.split('/').at(-1) === '.gitattributes')) {
    need(oid(row.sha) && Number.isSafeInteger(row.size) && row.size <= SOURCE_CARRIER_LIMITS.fileBytes,
      'Use bounded original archive-attribute files.');
    const response = await tools.mcp__codex_apps__github_fetch({ url: prefix + '/git/blobs/' + row.sha });
    Object.defineProperty(attributeFiles, row.path, { value: sourceCarrierGitText(response), enumerable: true });
  }
  return { commitJson, treeJson, attributeFiles, sourceRead };
}

async function callSourceCarrierTool({ state, tools, persist, hashText }, key, name, args) {
  const argumentSha256 = hashText(json(args)).sha256;
  const prior = state.operations[key];
  if (prior) {
    need(prior.name === name && prior.argumentSha256 === argumentSha256, 'Retained operation input changed: ' + key);
    need(prior.status === 'RETURNED', 'Reconcile the original pending provider operation: ' + key,
      'SOURCE_CARRIER_OUTCOME_REQUIRED');
    return unwrapCarrierResult(prior.result);
  }
  need(typeof tools?.[name] === 'function', 'The existing tool adapter is missing ' + name);
  state.operations[key] = { name, argumentSha256, status: 'DISPATCHING' };
  await persist(copy(state));
  let result;
  try { result = await tools[name](args); }
  catch (error) {
    state.operations[key].status = 'UNCERTAIN';
    state.operations[key].error = String(error);
    await persist(copy(state)); throw error;
  }
  state.operations[key] = { name, argumentSha256, status: 'RETURNED', result };
  await persist(copy(state));
  return unwrapCarrierResult(result);
}

/** Retain the complete receiving index on the SAME page after every source archive is attached. */
export async function publishSourceCarrierIndex({ plan, state, tools, persist, hashText = info }) {
  const index = finalizeSourceCarrierIndex(plan, state, { hashText });
  const content = json(index), descriptor = hashText(content);
  need(descriptor.bytes <= 200 * 1024, 'The complete index exceeds this adapter text-upload limit; use the original full-file attachment route.');
  const filename = plan.filenamePrefix + '_TRANSFER.json', pageId = state.pageId;
  need(pageIdentity(pageId), 'Use the original source destination page.');
  let current = state.indexPublication;
  if (current) need(current.filename === filename && current.bytes === descriptor.bytes &&
    current.sha256 === descriptor.sha256 && canonicalPage(current.pageId) === canonicalPage(pageId),
    'The retained receiving-index publication differs.');
  if (current?.notionReference) {
    need(referenceName(current.notionReference) === filename, 'The retained index file identity differs.');
    return index;
  }
  const originalPage = unwrapCarrierResult(await tools.mcp__codex_apps__notion_fetch({ id: pageId }));
  need(typeof originalPage.text === 'string', 'Read the original destination before index attachment.');
  const named = text => stableReferences(text).filter(ref => referenceName(ref) === filename);
  const observed = named(originalPage.text);
  need(observed.length <= 1, 'Reconcile ambiguous receiving-index file references.');
  if (!current) {
    need(!observed.length, 'The destination already contains this index filename. Adopt its original publication state.');
    current = state.indexPublication = { filename, pageId, ...descriptor,
      originalReferences: stableReferences(originalPage.text) };
    await persist(copy(state));
  }
  const pageKey = 'index:page';
  const pageCall = state.operations[pageKey];
  if (pageCall?.status === 'RETURNED') unwrapCarrierResult(pageCall.result);
  if (observed.length) {
    need(pageCall && !current.originalReferences.includes(observed[0]),
      'Reconcile the original index page write before adopting a same-name file.');
    current.notionReference = observed[0];
    state.operations[pageKey].reconciliation = { kind: 'original-page-file', response: originalPage };
    await persist(copy(state)); return index;
  }
  if (pageCall) throw Object.assign(new Error('Continue the original index page operation, then adopt its actual page readback.'),
    { code: 'SOURCE_CARRIER_PAGE_PENDING', operation: copy(pageCall) });
  const call = (key, name, args) => callSourceCarrierTool({ state, tools, persist, hashText }, key, name, args);
  if (!current.attachment) {
    const uploaded = await call('index:attachment', 'mcp__codex_apps__notion_notion_create_attachment',
      { content, filename, content_type: 'application/json' });
    need(uploaded.status === 'uploaded' && uploaded.filename === filename &&
      uploaded.content_length === descriptor.bytes && /^file-upload:\/\/[a-f0-9-]+$/i.test(uploaded.markdown_source ?? ''),
      'Retain the complete original receiving-index upload receipt.');
    current.attachment = uploaded; await persist(copy(state));
  }
  const pageContent = '### Complete source receiving index\n\n' +
    '<file src="' + current.attachment.markdown_source + '">' + filename + '</file>';
  const returned = await call(pageKey, 'mcp__codex_apps__notion_notion_update_page', {
    page_id: pageId, command: 'insert_content', position: { type: 'end' }, content: pageContent, allow_async: false });
  if (returned.async_task) throw Object.assign(new Error('Wait for the original index page task, then resume its readback.'),
    { code: 'SOURCE_CARRIER_PAGE_PENDING', operation: copy(state.operations[pageKey]) });
  need(canonicalPage(returned.page_id) === canonicalPage(pageId), 'The original index page update returned a different destination.');
  const readback = unwrapCarrierResult(await tools.mcp__codex_apps__notion_fetch({ id: pageId }));
  const references = named(readback.text ?? '');
  need(references.length === 1 && !current.originalReferences.includes(references[0]),
    'Receive the actual original stable index-file reference.', 'SOURCE_CARRIER_PAGE_PENDING');
  current.notionReference = references[0]; await persist(copy(state));
  return index;
}
