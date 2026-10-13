'use strict';

/*
 * Purpose-built native GitHub App reads for the existing connected Git resource
 * consumers. The original sender, checkpoint, account and CAS writers are used
 * unchanged. Each normalized resource retains the actual source invocations.
 */
const FORMAT = 'commons.connected-github-app-resource/v1';
const clone = value => JSON.parse(JSON.stringify(value));
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const git = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
function fail(code, message, data) {
  throw Object.assign(new Error(message || code), {code, ...(data || {})});
}
function data(raw) {
  if (!object(raw) || !object(raw.structuredContent))
    fail('GITHUB_APP_COMPLETE_NATIVE_RESPONSE_REQUIRED');
  return raw.structuredContent;
}
function status(raw) {
  const d = raw && raw.structuredContent;
  return Number(d && (d.error_data && (d.error_data.status ?? d.error_data.code) || d.status) || 0);
}
function refName(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.endsWith('/') ||
      value.includes('//') || value.includes('..') || value.includes('@{') ||
      /[\x00-\x20\x7f~^:?*\\[\]]/.test(value) || value.split('/').some(p => p.startsWith('.') || p.endsWith('.lock')) ||
      value.endsWith('.')) fail('GITHUB_APP_ORIGINAL_BRANCH_REQUIRED');
  return value;
}
function parseResource(url) {
  const match = /^https:\/\/api\.github\.com\/repos\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(\/[^?#]*)?(\?[^#]*)?$/.exec(url || '');
  if (!match) return null;
  const repository = match[1] + '/' + match[2], tail = match[3] || '', query = match[4] || '';
  if (!tail || tail === '/') return query ? null : {kind:'repository', repository};
  const ref = /^\/git\/ref\/heads\/(.+)$/.exec(tail);
  if (ref) {
    if (query) return null;
    let branch;
    try { branch = decodeURIComponent(ref[1]); } catch { fail('GITHUB_APP_ORIGINAL_BRANCH_REQUIRED'); }
    return {kind:'branch', repository, owner:match[1], repo_name:match[2], branch:refName(branch)};
  }
  const comparison = /^\/compare\/([a-f0-9]{40})\.\.\.([a-f0-9]{40})$/.exec(tail);
  if (comparison) {
    // The account reader requests ancestry metadata using this first-page URL.
    // Preserve its exact request; other pagination/filter semantics stay with
    // the original reader instead of being silently discarded.
    if (query && !['?per_page=1&page=1','?page=1&per_page=1'].includes(query)) return null;
    return {kind:'comparison', repository, base:comparison[1], head:comparison[2],
      ...(query ? {query} : {})};
  }
  const file = /^\/contents\/(.+)$/.exec(tail);
  const pinned = /^\?ref=([a-f0-9]{40})$/.exec(query);
  if (file && pinned) {
    let path;
    try { path = decodeURIComponent(file[1]); } catch { fail('GITHUB_APP_ORIGINAL_SOURCE_PATH_REQUIRED'); }
    if (path.endsWith('/')) return null; // Explicit directory URLs retain their reader.
    return {kind:'file', repository, path:sourcePath(path), ref:pinned[1]};
  }
  const blob = /^\/git\/blobs\/([a-f0-9]{40})$/.exec(tail);
  if (blob && !query) return {kind:'blob', repository, blob_sha:blob[1]};
  return null;
}

const PREFIX = 'mcp__codex_apps__';
const PROVIDER_FAILURE = Symbol('original GitHub provider exception');
const repositoryName = value => typeof value === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
const encodePath = value => value.split('/').map(encodeURIComponent).join('/');
function sourcePath(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.endsWith('/') ||
      /[\x00-\x1f\x7f\\]/.test(value) || value.split('/').some(p => !p || p === '.' || p === '..'))
    fail('GITHUB_APP_ORIGINAL_SOURCE_PATH_REQUIRED');
  return value;
}
function utf8Bytes(value) {
  let bytes = 0;
  for (const c of value) {
    const point = c.codePointAt(0);
    if (point >= 0xd800 && point <= 0xdfff) fail('GITHUB_APP_COMPLETE_UTF8_SOURCE_REQUIRED');
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return bytes;
}
function errorDetails(error) {
  const result = {name:String(error && error.name || 'Error'), message:String(error && error.message || error)};
  for (const key of ['code','status','error_code','error_data','retry_after','retry_after_seconds','stack']) {
    if (error && error[key] !== undefined) {
      try { result[key] = clone(error[key]); } catch { result[key] = String(error[key]); }
    }
  }
  return result;
}
function refusalText(value) {
  const d = object(value && value.structuredContent) ? value.structuredContent : value;
  const parts = [d && d.message, d && d.error, d && d.error_data && d.error_data.message];
  for (const item of value && Array.isArray(value.content) ? value.content : [])
    if (item && item.type === 'text') parts.push(item.text);
  return parts.filter(v => typeof v === 'string').join('\n');
}
function primaryReadQuota(value) {
  const text = refusalText(value);
  // Only the provider's explicit primary API quota. Secondary/abuse throttles,
  // permission errors, callback failures and arbitrary 403s are not rerouted.
  return /API rate limit exceeded for (?:user ID \d+|[0-9a-f:.]+)/i.test(text) &&
    !/secondary rate limit|abuse detection/i.test(text) &&
    (status(value) === 403 || Number(value && value.status) === 403 || /\b403\b/.test(text));
}
function unavailableOriginalRoute(value) {
  return refusalText(value).includes('GitHub Fetch URL contains an invalid repository path.');
}
function originalContent(raw, url) {
  const d = data(raw);
  if (typeof d.content !== 'string' || (d.url !== undefined && d.url !== url))
    fail('GITHUB_APP_COMPLETE_ORIGINAL_RESPONSE_REQUIRED');
  return d.content;
}
function originalJson(raw, url) {
  try { return JSON.parse(originalContent(raw, url)); }
  catch (error) {
    if (error.code) throw error;
    fail('GITHUB_APP_COMPLETE_ORIGINAL_RESPONSE_REQUIRED');
  }
}
function canonicalUrl(selected) {
  const root = 'https://api.github.com/repos/' + selected.repository;
  if (selected.kind === 'repository') return root;
  if (selected.kind === 'branch') return root + '/git/ref/heads/' + encodePath(selected.branch);
  if (selected.kind === 'comparison') return root + '/compare/' + selected.base + '...' + selected.head + (selected.query || '');
  if (selected.kind === 'file') return root + '/contents/' + encodePath(selected.path) + '?ref=' + selected.ref;
  return root + '/git/blobs/' + selected.blob_sha;
}
function originalResourceValue(raw, selected, url) {
  const d = originalJson(raw, url);
  if (selected.kind === 'repository') {
    if (!object(d) || d.full_name !== selected.repository || typeof d.private !== 'boolean' ||
        typeof d.archived !== 'boolean' || !object(d.permissions) ||
        typeof d.permissions.pull !== 'boolean' || typeof d.permissions.push !== 'boolean' ||
        (d.visibility !== undefined && (!['private','public','internal'].includes(d.visibility) ||
          (d.visibility === 'private' && !d.private) || (d.visibility === 'public' && d.private))))
      fail('GITHUB_APP_REPOSITORY_IDENTITY_CHANGED');
  } else if (selected.kind === 'branch') {
    if (!object(d) || d.ref !== 'refs/heads/' + selected.branch ||
        !object(d.object) || d.object.type !== 'commit' || !git(d.object.sha))
      fail('GITHUB_APP_BRANCH_COMMIT_IDENTITY_CHANGED');
  } else if (!object(d) || ![url,canonicalUrl({...selected,query:''})].includes(d.url) ||
      !['ahead','behind','diverged','identical'].includes(d.status) ||
      !object(d.base_commit) || d.base_commit.sha !== selected.base ||
      !git(d.merge_base_commit && d.merge_base_commit.sha)) {
    fail('GITHUB_APP_COMPARISON_IDENTITY_CHANGED');
  }
  return d;
}

function createConnectedGithubAppResources({tools, onNativeResult, fallback,
    preferredRoute = 'native', preferredRoutes = {}, sourceCodec} = {}) {
  if (!tools || (onNativeResult !== undefined && typeof onNativeResult !== 'function') ||
      (fallback !== undefined && typeof fallback !== 'function') || !['native','original'].includes(preferredRoute))
    fail('GITHUB_APP_NATIVE_BINDINGS_REQUIRED');
  // Source acquisition already owns these exact byte/hash implementations.
  // Optional injection keeps this existing one-file metadata/checkpoint reader
  // portable; no new eager module or native runtime dependency is introduced.
  const codecNames = ['utf8','utf8Text','base64','fromBase64','gitBlobSha1'];
  if (sourceCodec !== undefined && (!object(sourceCodec) ||
      codecNames.some(name => typeof sourceCodec[name] !== 'function')))
    fail('GITHUB_APP_SOURCE_CODEC_REQUIRED');
  const codec = sourceCodec === undefined ? null :
    Object.freeze(Object.fromEntries(codecNames.map(name => [name,sourceCodec[name]])));
  const resourceKinds = ['repository','branch','comparison','file','blob'];
  if (!object(preferredRoutes) || Object.entries(preferredRoutes).some(([kind,route]) =>
      !resourceKinds.includes(kind) || !['native','original'].includes(route)))
    fail('GITHUB_APP_RESOURCE_ROUTE_PREFERENCE_REQUIRED');
  // A caller may select a proven route for one resource kind while retaining
  // its existing readers for the others. Own the selection for this handle.
  const configuredRoutes = Object.freeze({...preferredRoutes});
  const originalFetch = fallback === undefined ? tools[PREFIX + 'github_fetch'] : fallback;
  const originalBinding = fallback === undefined ? PREFIX + 'github_fetch' : 'originalResourceFetch';
  const selectedRoutes = new Map();
  const has = name => typeof tools[PREFIX + name] === 'function';
  if (typeof originalFetch !== 'function' && !['github_get_repo','github_fetch_commit','github_compare_commits',
      'github_fetch_file','github_fetch_blob'].some(has)) fail('GITHUB_APP_NATIVE_BINDINGS_REQUIRED');

  // The provider call alone is caught here. An awaited observation failure
  // remains a caller failure and cannot trigger a second provider request.
  async function invoke(binding, input, fn, calls) {
    const invocation = {binding, args:clone(input), invoked_at:new Date().toISOString()};
    let raw, error, threw = false;
    try { raw = await fn(input); }
    catch (observedError) { error = observedError; threw = true; }
    const observed = {...invocation, returned_at:new Date().toISOString(), outcome:threw ? 'THREW' : 'RETURNED',
      ...(threw ? {error:errorDetails(error)} : {raw:clone(raw)})};
    if (calls) calls.push(observed);
    if (onNativeResult) await onNativeResult(clone(observed));
    if (threw) throw {[PROVIDER_FAILURE]:true, error};
    return raw;
  }
  function context(selected, args) {
    const calls = [];
    const preference = configuredRoutes[selected.kind] || preferredRoute;
    let chosen;
    const provenance = () => ({format:FORMAT, original_url:args.url || canonicalUrl(selected),
      resource:clone(selected), preferred_route:preference, selected_route:chosen, native_calls:clone(calls)});
    const finish = raw => {
      const result = clone(raw);
      if (object(result.structuredContent)) result.structuredContent.native_resource = provenance();
      else result.native_resource = provenance();
      return result;
    };
    const call = (name, input) => invoke(PREFIX + name, input, tools[PREFIX + name], calls);
    const original = input => invoke(originalBinding, input, originalFetch, calls);
    const success = value => ({content:[{type:'text',text:'Original GitHub resource received.'}],
      structuredContent:{content:JSON.stringify(value)},isError:false});
    const nativeSource = value => ({content:[{type:'text',text:'Complete original GitHub source received.'}],
      structuredContent:value,isError:false});
    async function choose(routes, originalDirectory = false) {
      const key = selected.kind + ':' + selected.repository;
      let first = selectedRoutes.get(key) || preference;
      if (!routes[first]) first = first === 'native' ? 'original' : 'native';
      if (!routes[first]) fail('GITHUB_APP_RESOURCE_REQUIRES_ORIGINAL_ROUTE');
      const attempt = async name => {
        chosen = name;
        try { return {raw:await routes[name]()}; }
        catch (error) {
          if (!error || !error[PROVIDER_FAILURE]) throw error;
          return {threw:true,error:error.error};
        }
      };
      let result = await attempt(first);
      const refused = result.threw ? result.error : result.raw && result.raw.isError ? result.raw : null;
      const alternate = first === 'native' ? 'original' : 'native';
      const directoryMessage = 'GitHub path points to a directory, not a file: ' +
        selected.repository + '/' + selected.path;
      const directory = originalDirectory && first === 'native' && refused &&
        refusalText(refused).split(/\r?\n/).some(line =>
          line === directoryMessage || line === 'InvalidInputException: ' + directoryMessage);
      if (refused && routes[alternate] && (primaryReadQuota(refused) || directory ||
          (first === 'original' && unavailableOriginalRoute(refused)))) {
        result = await attempt(alternate);
        // A directory retains its original listing reader; it does not select
        // that binding for later regular files in the repository.
        if (!directory && !result.threw && result.raw && !result.raw.isError) selectedRoutes.set(key, alternate);
      }
      if (result.threw) throw result.error;
      return finish(result.raw);
    }
    return {call, original, success, nativeSource, choose};
  }

  async function fetch(args) {
    const selected = parseResource(args && args.url);
    if (!selected) {
      if (typeof originalFetch !== 'function') fail('GITHUB_APP_RESOURCE_REQUIRES_ORIGINAL_ROUTE');
      try { return await invoke(originalBinding, args, originalFetch); }
      catch (error) { if (error && error[PROVIDER_FAILURE]) throw error.error; throw error; }
    }
    if (selected.kind === 'file' || selected.kind === 'blob') return fetchSourceResource(args, selected);
    const ctx = context(selected, args);
    const {call, success} = ctx;
    const failure = raw => raw;
    const needed = selected.kind === 'repository' ? ['github_get_repo'] :
      selected.kind === 'comparison' ? ['github_compare_commits'] :
      ['github_fetch_commit','github_get_repo','github_search_branches'];
    const native = async () => {
    const repo = async () => {
      const raw = await call('github_get_repo', {repository_full_name:selected.repository});
      if (raw.isError) return {error:failure(raw)};
      const d = data(raw);
      if (d.repository_full_name !== selected.repository ||
          !['private','public','internal'].includes(d.visibility) || typeof d.archived !== 'boolean' ||
          !object(d.permissions) || typeof d.permissions.pull !== 'boolean' || typeof d.permissions.push !== 'boolean')
        fail('GITHUB_APP_REPOSITORY_IDENTITY_CHANGED');
      return {value:{...d, full_name:d.repository_full_name, private:d.visibility === 'private'}};
    };

    if (selected.kind === 'repository') {
      const r = await repo();
      return r.error || success(r.value);
    }
    if (selected.kind === 'comparison') {
      const raw = await call('github_compare_commits',
        {repo_full_name:selected.repository, base:selected.base, head:selected.head});
      if (raw.isError) return failure(raw);
      const d = data(raw);
      if (d.repository_full_name !== selected.repository || d.base !== selected.base || d.head !== selected.head ||
          !['ahead','behind','diverged','identical'].includes(d.status) ||
          !object(d.base_commit) || d.base_commit.sha !== selected.base ||
          !git(d.merge_base_commit && d.merge_base_commit.sha))
        fail('GITHUB_APP_COMPARISON_IDENTITY_CHANGED');
      return success(d);
    }

    const exactRef = 'refs/heads/' + selected.branch;
    if (has('github_compare_commits')) {
      const compared = await call('github_compare_commits',
        {repo_full_name:selected.repository, base:exactRef, head:exactRef});
      if (!compared.isError) {
        const d = data(compared), sha = d.base_commit && d.base_commit.sha;
        if (d.repository_full_name !== selected.repository || d.base !== exactRef || d.head !== exactRef ||
            d.status !== 'identical' || d.ahead_by !== 0 || d.behind_by !== 0 || d.total_commits !== 0 ||
            !git(sha) || !object(d.merge_base_commit) || d.merge_base_commit.sha !== sha)
          fail('GITHUB_APP_BRANCH_COMMIT_IDENTITY_CHANGED');
        return success({ref:exactRef, object:{type:'commit', sha}});
      }
      // A missing comparison is not proved branch absence. Continue through
      // the original exact-ref lookup and its complete repository/branch read.
      if (status(compared) !== 404 || data(compared).error_code !== 'NOT_FOUND') return failure(compared);
    }
    const raw = await call('github_fetch_commit', {repo_full_name:selected.repository, commit_sha:exactRef});
    if (!raw.isError) {
      const d = data(raw), commit = d.commit;
      if (!object(commit) || !git(commit.sha) || commit.repository_full_name !== selected.repository)
        fail('GITHUB_APP_BRANCH_COMMIT_IDENTITY_CHANGED');
      return success({ref:exactRef, object:{type:'commit', sha:commit.sha}});
    }
    // A commit lookup uses 422 for a missing ref. Do not turn arbitrary 4xx,
    // rate refusals, permission errors or a partial branch page into absence.
    if (!object(raw.structuredContent)) return failure(raw);
    const rejected = data(raw);
    if (status(raw) !== 422 || rejected.error_code !== 'INVALID_ARGUMENT' ||
        !object(rejected.error_data) || rejected.error_data.message !== 'No commit found for SHA: ' + exactRef)
      return failure(raw);
    const access = await repo();
    if (access.error) return access.error;
    if (access.value.permissions.pull !== true) return failure(raw);
    let cursor, exactFound = false;
    const seen = new Set();
    for (;;) {
      const page = await call('github_search_branches', {owner:selected.owner, repo_name:selected.repo_name,
        query:selected.branch, page_size:100, ...(cursor ? {cursor} : {})});
      if (page.isError) return failure(page);
      const d = data(page);
      if (!Array.isArray(d.branches) || d.branches.some(item => !object(item) || typeof item.branch !== 'string') ||
          !(d.cursor === null || typeof d.cursor === 'string'))
        fail('GITHUB_APP_COMPLETE_BRANCH_PAGE_REQUIRED');
      if (d.branches.some(item => item.branch === selected.branch)) exactFound = true;
      if (d.cursor === null || d.cursor === '') break;
      if (seen.has(d.cursor)) fail('GITHUB_APP_BRANCH_CURSOR_REPEATED');
      seen.add(d.cursor); cursor = d.cursor;
    }
    if (exactFound) return failure(raw);
    return {content:[{type:'text',text:'The requested branch is absent in the complete native branch search.'}],
      structuredContent:{error:'Original GitHub branch not found: ' + exactRef, error_code:'NOT_FOUND',
        error_data:{status:404, normalized_from:'native exact-ref 422 plus terminal branch search',
          repository_full_name:selected.repository, ref:exactRef}}, isError:true};
    };
    const original = async () => {
      const url = canonicalUrl(selected), raw = await ctx.original({url});
      return raw.isError ? raw : success(originalResourceValue(raw, selected, url));
    };
    return ctx.choose({native:needed.every(has) ? native : null,
      original:typeof originalFetch === 'function' ? original : null});
  }


  function sourceIdentity(d, selected, expectedSha) {
    if (d.repository_full_name !== undefined && d.repository_full_name !== selected.repository ||
        selected.kind === 'file' && (d.path !== undefined && d.path !== selected.path ||
          d.ref !== undefined && d.ref !== selected.ref) ||
        d.sha !== undefined && (!git(d.sha) || expectedSha && d.sha !== expectedSha))
      fail('GITHUB_APP_SOURCE_IDENTITY_REQUIRED');
    const sha = expectedSha || d.sha;
    if (!git(sha)) fail('GITHUB_APP_SOURCE_IDENTITY_REQUIRED');
    return sha;
  }
  function completeSourceValue(d, selected, requestedEncoding, expectedSha) {
    const sha = sourceIdentity(d, selected, expectedSha);
    if (typeof d.content !== 'string' || d.truncated === true || d.incomplete === true)
      fail('GITHUB_APP_COMPLETE_NATIVE_RESPONSE_REQUIRED');
    const encoding = d.encoding || 'utf-8';
    if (!['utf-8','utf8','base64'].includes(encoding))
      fail('GITHUB_APP_COMPLETE_UTF8_SOURCE_REQUIRED');
    let content = d.content, size;
    if (codec) {
      const bytes = encoding === 'base64' ? codec.fromBase64(content.replace(/[ \t\r\n]/g,'')) : codec.utf8(content);
      if (codec.gitBlobSha1(bytes) !== sha) fail('GITHUB_APP_COMPLETE_SOURCE_CHANGED');
      size = bytes.length;
      content = requestedEncoding === 'base64' ? codec.base64(bytes) : codec.utf8Text(bytes);
    } else {
      if (encoding === 'base64' || requestedEncoding === 'base64') fail('GITHUB_APP_SOURCE_CODEC_REQUIRED');
      size = utf8Bytes(content);
      if (size === 0 && sha !== 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
        fail('GITHUB_APP_COMPLETE_SOURCE_CHANGED');
    }
    if (d.size !== undefined && (!Number.isSafeInteger(d.size) || d.size !== size))
      fail('GITHUB_APP_COMPLETE_SOURCE_CHANGED');
    return {...d, content, sha, repository_full_name:selected.repository,
      ...(selected.kind === 'file' ? {path:selected.path,ref:selected.ref} : {}),
      encoding:requestedEncoding, size};
  }
  async function nativeBlob(ctx, args, selected, encoding = 'utf-8') {
    const raw = await ctx.call('github_fetch_blob',args);
    if (raw.isError) return raw;
    return ctx.nativeSource(completeSourceValue(data(raw),selected,encoding,selected.blob_sha));
  }
  async function nativeFile(ctx, args, selected) {
    const raw = await ctx.call('github_fetch_file',args);
    if (raw.isError) return raw;
    const d = data(raw), sha = sourceIdentity(d,selected);
    const encoding = args.encoding || 'utf-8';
    const omitted = d.content == null || d.content === '' &&
      sha !== 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391' ||
      d.truncated === true || d.incomplete === true;
    if (!omitted) return ctx.nativeSource(completeSourceValue(d,selected,encoding,sha));
    if (!has('github_fetch_blob')) fail('GITHUB_APP_COMPLETE_SOURCE_REQUIRES_BLOB', selected.path);
    // The file read supplies the exact object at the already pinned path.
    // Complete that same object; never resolve the path against a moving ref.
    const blob = {kind:'blob',repository:selected.repository,blob_sha:sha};
    const received = await nativeBlob(ctx,{repository_full_name:selected.repository,blob_sha:sha},blob,encoding);
    if (received.isError) return received;
    const full = data(received);
    if (d.size !== undefined && d.size !== full.size) fail('GITHUB_APP_COMPLETE_SOURCE_CHANGED');
    return ctx.nativeSource({...d,...full,path:selected.path,ref:selected.ref,
      truncated:false,incomplete:false});
  }
  async function fetchSourceResource(args, selected) {
    const ctx = context(selected,args);
    const name = selected.kind === 'file' ? 'github_fetch_file' : 'github_fetch_blob';
    const native = selected.kind === 'file'
      ? () => nativeFile(ctx,{repository_full_name:selected.repository,path:selected.path,
          ref:selected.ref,encoding:'utf-8'},selected)
      : () => nativeBlob(ctx,{repository_full_name:selected.repository,blob_sha:selected.blob_sha},selected);
    const original = async () => {
      const raw = await ctx.original(args);
      if (raw.isError) return raw;
      const content = originalContent(raw,args.url);
      if (selected.kind === 'blob') return ctx.nativeSource(completeSourceValue(
        {content,encoding:'utf-8'},selected,'utf-8',selected.blob_sha));
      // The actual original URL can select a directory. Retain its complete
      // original listing, or literal file body, with no invented file metadata.
      return raw;
    };
    return ctx.choose({native:has(name) ? native : null,
      original:typeof originalFetch === 'function' ? original : null}, selected.kind === 'file');
  }

  async function observedSource(name, args, selected, originalReader, nativeReader) {
    if (!selected) {
      if (!has(name)) fail('GITHUB_APP_NATIVE_BINDINGS_REQUIRED', name);
      try { return await invoke(PREFIX + name, args, tools[PREFIX + name]); }
      catch (error) { if (error && error[PROVIDER_FAILURE]) throw error.error; throw error; }
    }
    const ctx = context(selected, args);
    return ctx.choose({
      native:has(name) ? () => nativeReader(ctx, selected) : null,
      original:typeof originalFetch === 'function' ? () => originalReader(ctx, selected) : null
    });
  }
  async function fetchFile(args) {
    // Full source uses one immutable commit. The existing source codec also
    // preserves explicit base64 reads; ranges and moving refs keep their call.
    let selected = null;
    if (args && repositoryName(args.repository_full_name) && git(args.ref) &&
        (args.encoding === undefined || args.encoding === 'utf-8' || args.encoding === 'base64' && codec) &&
        args.start_line == null && args.end_line == null) {
      selected = {kind:'file',repository:args.repository_full_name,path:sourcePath(args.path),ref:args.ref};
    }
    return observedSource('github_fetch_file', args, selected, async (ctx, file) => {
      const split = file.path.lastIndexOf('/'), parent = split < 0 ? '' : file.path.slice(0,split);
      const directoryUrl = 'https://api.github.com/repos/' + file.repository + '/contents' +
        (parent ? '/' + encodePath(parent) : '') + '?ref=' + file.ref;
      const directory = await ctx.original({url:directoryUrl});
      if (directory.isError) return directory;
      const entries = originalJson(directory, directoryUrl);
      if (!Array.isArray(entries)) fail('GITHUB_APP_COMPLETE_SOURCE_DIRECTORY_REQUIRED');
      const matches = entries.filter(item => object(item) && item.path === file.path);
      if (matches.length !== 1 || matches[0].type !== 'file' || !git(matches[0].sha) ||
          !Number.isSafeInteger(matches[0].size) || matches[0].size < 0)
        fail('GITHUB_APP_SOURCE_IDENTITY_REQUIRED');
      const url = canonicalUrl(file), raw = await ctx.original({url});
      if (raw.isError) return raw;
      const content = originalContent(raw,url), entry = matches[0];
      if (utf8Bytes(content) !== entry.size) fail('GITHUB_APP_COMPLETE_SOURCE_CHANGED');
      return ctx.nativeSource(completeSourceValue({content,sha:entry.sha,
        encoding:'utf-8',size:entry.size},file,args.encoding || 'utf-8',entry.sha));
    }, (ctx,file) => nativeFile(ctx,args,file));
  }
  async function fetchBlob(args) {
    const selected = args && repositoryName(args.repository_full_name) && git(args.blob_sha) ?
      {kind:'blob',repository:args.repository_full_name,blob_sha:args.blob_sha} : null;
    return observedSource('github_fetch_blob', args, selected, async (ctx, blob) => {
      const url = canonicalUrl(blob), raw = await ctx.original({url});
      if (raw.isError) return raw;
      // The original supported Fetch route returns the decoded whole blob text,
      // including when that text happens to be JSON. Its URL selects the blob.
      const content = originalContent(raw,url);
      return ctx.nativeSource(completeSourceValue({content,encoding:'utf-8'},
        blob,'utf-8',blob.blob_sha));
    }, (ctx,blob) => nativeBlob(ctx,args,blob));
  }

  const routed = Object.create(tools);
  const define = (name, fn) => Object.defineProperty(routed, PREFIX + name,
    {value:fn,enumerable:true,configurable:false,writable:false});
  define('github_fetch', fetch);
  define('github_fetch_file', fetchFile);
  define('github_fetch_blob', fetchBlob);
  for (const name of ['github_get_repo','github_fetch_commit','github_search_branches','github_compare_commits']) {
    if (has(name)) define(name, async args => {
      try { return await invoke(PREFIX + name,args,tools[PREFIX + name]); }
      catch (error) { if (error && error[PROVIDER_FAILURE]) throw error.error; throw error; }
    });
  }
  return Object.freeze({tools:routed,fetch});
}
module.exports = {FORMAT,createConnectedGithubAppResources};
