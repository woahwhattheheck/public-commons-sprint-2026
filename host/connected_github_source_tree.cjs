'use strict';

/*
 * Reuse complete retained source bytes while checking the selected immutable
 * commit's path, blob, length and executable mode through Git tree metadata.
 * readJson stays the caller's existing authenticated/coordinated read route.
 */
const FORMAT = 'commons.github-tree-source-verification/v1';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const git = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const regular = value => value === '100644' || value === '100755';
function fail(code, detail) {
  throw Object.assign(new Error(code), {code, ...(detail || {})});
}
function unicode(value, code, detail) {
  for (const char of value) {
    const point = char.codePointAt(0);
    if (point >= 0xd800 && point <= 0xdfff) fail(code, detail);
  }
  return value;
}
function sourcePath(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/') ||
      /[\x00-\x1f\x7f\\]/.test(value) ||
      value.split('/').some(part => !part || part === '.' || part === '..'))
    fail('GITHUB_TREE_SOURCE_PATH_REQUIRED');
  return unicode(value, 'GITHUB_TREE_SOURCE_PATH_UNICODE_INVALID');
}
function repositoryName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value) ||
      value.split('/').some(part => part === '.' || part === '..'))
    fail('GITHUB_TREE_SOURCE_REPOSITORY_REQUIRED');
  return value;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function createGitHubTreeSourceVerifier({readJson, sourceCodec} = {}) {
  if (typeof readJson !== 'function' || !object(sourceCodec) ||
      ['utf8', 'fromBase64', 'base64', 'gitBlobSha1'].some(name =>
        typeof sourceCodec[name] !== 'function'))
    fail('GITHUB_TREE_SOURCE_BINDINGS_REQUIRED');

  async function verify({repository_full_name, commit_sha, files} = {}) {
    const repository = repositoryName(repository_full_name);
    if (!git(commit_sha) || !Array.isArray(files) || files.length === 0)
      fail('GITHUB_TREE_SOURCE_SELECTION_REQUIRED');

    // Freeze the complete selected values before the first awaited read. The
    // publication's ordinary source receiver owns any prior source admission.
    const selected = [];
    const paths = new Set();
    let sourceBytes = 0;
    for (const file of files) {
      if (!object(file) || typeof file.content !== 'string' || !regular(file.mode))
        fail('GITHUB_TREE_SOURCE_COMPLETE_REGULAR_FILE_REQUIRED');
      const path = sourcePath(file.path);
      if (paths.has(path)) fail('GITHUB_TREE_SOURCE_DUPLICATE_PATH', {path});
      paths.add(path);
      const encoding = file.encoding === undefined ? 'utf-8' : file.encoding;
      let bytes;
      if (encoding === 'utf-8') {
        unicode(file.content, 'GITHUB_TREE_SOURCE_UNICODE_INVALID', {path});
        bytes = sourceCodec.utf8(file.content);
      } else if (encoding === 'base64') {
        bytes = sourceCodec.fromBase64(file.content);
        if (sourceCodec.base64(bytes) !== file.content)
          fail('GITHUB_TREE_SOURCE_CANONICAL_BASE64_REQUIRED', {path});
      } else {
        fail('GITHUB_TREE_SOURCE_ENCODING_UNSUPPORTED', {path});
      }
      if (!(bytes instanceof Uint8Array) || !Number.isSafeInteger(bytes.length))
        fail('GITHUB_TREE_SOURCE_COMPLETE_BYTES_REQUIRED', {path});
      if (!Number.isSafeInteger(sourceBytes + bytes.length))
        fail('GITHUB_TREE_SOURCE_AGGREGATE_SIZE_INVALID');
      sourceBytes += bytes.length;
      const sha = sourceCodec.gitBlobSha1(bytes);
      if (!git(sha)) fail('GITHUB_TREE_SOURCE_BLOB_IDENTITY_REQUIRED', {path});
      if (file.bytes !== undefined &&
          (!Number.isSafeInteger(file.bytes) || file.bytes !== bytes.length))
        fail('GITHUB_TREE_SOURCE_DECLARED_LENGTH_CHANGED', {path});
      if (file.blob_sha !== undefined && file.blob_sha !== sha)
        fail('GITHUB_TREE_SOURCE_DECLARED_BLOB_CHANGED', {path});
      selected.push({path, mode:file.mode, bytes:bytes.length, blob_sha:sha});
    }

    // A file cannot also be an ancestor directory of another selected file.
    for (const file of selected) {
      const parts = file.path.split('/');
      for (let i = 1; i < parts.length; i++)
        if (paths.has(parts.slice(0, i).join('/')))
          fail('GITHUB_TREE_SOURCE_PATH_COLLISION', {path:file.path});
    }

    const root = 'https://api.github.com/repos/' + repository + '/git/';
    const commitUrl = root + 'commits/' + commit_sha;
    // readJson either returns the complete provider JSON, or throws the
    // original provider error. Do not retry, reroute or convert a refusal.
    const commit = await readJson({url:commitUrl});
    if (!object(commit) || commit.sha !== commit_sha || commit.url !== commitUrl ||
        !object(commit.tree) || !git(commit.tree.sha) ||
        commit.tree.url !== root + 'trees/' + commit.tree.sha)
      fail('GITHUB_TREE_SOURCE_COMMIT_CHANGED', {commit_sha});

    const treeSha = commit.tree.sha;
    const treeCache = new Map();
    const observedTrees = [];
    const verified = new Map();

    async function treeAt(sha) {
      if (treeCache.has(sha)) return treeCache.get(sha);
      const url = root + 'trees/' + sha;
      const value = await readJson({url});
      if (!object(value) || value.sha !== sha || value.url !== url ||
          !Array.isArray(value.tree) || typeof value.truncated !== 'boolean')
        fail('GITHUB_TREE_SOURCE_TREE_CHANGED', {tree_sha:sha});
      if (value.truncated)
        fail('GITHUB_TREE_SOURCE_INCOMPLETE', {tree_sha:sha, url});
      const entries = new Map();
      for (const entry of value.tree) {
        if (!object(entry) || typeof entry.path !== 'string' ||
            entry.path.includes('/') || !git(entry.sha))
          fail('GITHUB_TREE_SOURCE_DIRECT_TREE_REQUIRED', {tree_sha:sha});
        // Git tree siblings can have legal names outside our selected portable
        // path contract. Validate a direct Git segment without rejecting an
        // unrelated backslash/control-character name.
        if (!entry.path || entry.path === '.' || entry.path === '..' ||
            entry.path.includes('\0'))
          fail('GITHUB_TREE_SOURCE_DIRECT_TREE_REQUIRED', {tree_sha:sha});
        if (entries.has(entry.path))
          fail('GITHUB_TREE_SOURCE_DUPLICATE_ENTRY', {tree_sha:sha, path:entry.path});
        const valid = entry.type === 'tree' && entry.mode === '040000' ||
          entry.type === 'commit' && entry.mode === '160000' ||
          entry.type === 'blob' && (regular(entry.mode) || entry.mode === '120000') &&
            Number.isSafeInteger(entry.size) && entry.size >= 0;
        if (!valid) fail('GITHUB_TREE_SOURCE_ENTRY_INVALID', {tree_sha:sha, path:entry.path});
        entries.set(entry.path, {
          path:entry.path, mode:entry.mode, type:entry.type,
          sha:entry.sha, ...(entry.size === undefined ? {} : {size:entry.size})
        });
      }
      treeCache.set(sha, entries);
      observedTrees.push({tree_sha:sha, url, entry_count:entries.size});
      return entries;
    }

    async function walk(sha, prefix, selections) {
      const entries = await treeAt(sha);
      const subdirectories = new Map();
      for (const file of selections) {
        const relative = file.path.slice(prefix.length);
        const slash = relative.indexOf('/');
        const name = slash < 0 ? relative : relative.slice(0, slash);
        const entry = entries.get(name);
        if (!entry) fail('GITHUB_TREE_SOURCE_PATH_ABSENT', {path:file.path, tree_sha:sha});
        if (slash < 0) {
          if (entry.type !== 'blob' || entry.mode !== file.mode ||
              entry.sha !== file.blob_sha || entry.size !== file.bytes)
            fail('GITHUB_TREE_SOURCE_POSTIMAGE_CHANGED', {
              path:file.path, expected:clone(file), observed:clone(entry)
            });
          verified.set(file.path, {...file, parent_tree_sha:sha});
        } else {
          if (entry.type !== 'tree' || entry.mode !== '040000')
            fail('GITHUB_TREE_SOURCE_PARENT_NOT_DIRECTORY', {path:file.path});
          let group = subdirectories.get(name);
          if (!group) {
            group = {sha:entry.sha, files:[]};
            subdirectories.set(name, group);
          }
          group.files.push(file);
        }
      }
      // Keep dispatch under the existing caller's read coordinator. One tree
      // serves all selected descendants; unselected subtrees are never read.
      for (const [name, group] of subdirectories)
        await walk(group.sha, prefix + name + '/', group.files);
    }

    await walk(treeSha, '', selected);
    return {
      format:FORMAT, repository_full_name:repository, commit_sha,
      root_tree_sha:treeSha, commit_url:commitUrl,
      verification:'complete-retained-source-to-immutable-tree',
      file_count:selected.length,
      source_bytes:sourceBytes,
      metadata_reads:1 + observedTrees.length,
      trees:observedTrees.map(clone),
      files:selected.map(file => clone(verified.get(file.path)))
    };
  }

  return Object.freeze({verify});
}

module.exports = {FORMAT, createGitHubTreeSourceVerifier};

/*
 * Whole selected-source inventory through captured original direct trees.
 * This shares the existing source verifier's caller-owned readJson binding.
 * It does not dispatch blobs, change accounts, or acquire a runtime.
 */
const SELECTION_FORMAT = 'commons.github-source-selection.v1';
const CAPTURE_FORMAT = 'commons.github-tree-source-capture/v1';

function createGitHubTreeSourceCollector({readJson, sourceCodec} = {}) {
  if (!object(sourceCodec) || typeof sourceCodec.utf8 !== 'function' ||
      typeof sourceCodec.sha1 !== 'function')
    fail('GITHUB_TREE_CAPTURE_CODEC_REQUIRED');
  const maxEntries = 1000000, maxTrees = 100000, maxDepth = 512;
  const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const checkedSha = value => {if (!git(value)) fail('GITHUB_TREE_CAPTURE_SHA_REQUIRED'); return value;};
  const ordinary = mode => mode === '100644' || mode === '100755';

  function request(value) {
    if (!object(value)) fail('GITHUB_TREE_CAPTURE_SELECTION_REQUIRED');
    const repository = repositoryName(value.repository ?? value.repository_full_name);
    const commit = checkedSha(value.commit ?? value.commit_sha);
    if (!Array.isArray(value.paths) || !value.paths.length || value.paths.length > maxEntries)
      fail('GITHUB_TREE_CAPTURE_PATHS_REQUIRED');
    const paths = [...new Set(value.paths.map(value => value === '.' ? '.' : sourcePath(value)))].sort();
    return {repository, commit, paths};
  }
  function commitObject(value, selected) {
    const root = 'https://api.github.com/repos/' + selected.repository + '/';
    if (!object(value) || value.sha !== selected.commit ||
        ![root + 'git/commits/' + selected.commit, root + 'commits/' + selected.commit].includes(value.url))
      fail('GITHUB_TREE_CAPTURE_COMMIT_CHANGED');
    const tree = value.tree ?? value.commit?.tree;
    if (!object(tree) || !git(tree.sha) || tree.url !== root + 'git/trees/' + tree.sha)
      fail('GITHUB_TREE_CAPTURE_COMMIT_TREE_CHANGED');
    return tree.sha;
  }
  function compareBytes(left, right) {
    for (let i = 0; i < Math.min(left.length, right.length); i++)
      if (left[i] !== right[i]) return left[i] - right[i];
    return left.length - right.length;
  }
  function treeObject(value, repository) {
    const root = 'https://api.github.com/repos/' + repository + '/git/trees/';
    if (!object(value) || !git(value.sha) || value.url !== root + value.sha ||
        !Array.isArray(value.tree) || value.tree.length > maxEntries || value.truncated !== false)
      fail('GITHUB_TREE_CAPTURE_COMPLETE_DIRECT_TREE_REQUIRED', {tree_sha:value?.sha});
    const names = new Set(), entries = [];
    for (const row of value.tree) {
      if (!object(row) || typeof row.path !== 'string' || !row.path ||
          row.path.includes('/') || row.path.includes('\0') || row.path === '.' || row.path === '..')
        fail('GITHUB_TREE_CAPTURE_DIRECT_ENTRY_REQUIRED', {tree_sha:value.sha});
      unicode(row.path, 'GITHUB_TREE_CAPTURE_PATH_ENCODING');
      if (names.has(row.path)) fail('GITHUB_TREE_CAPTURE_DUPLICATE_ENTRY', {path:row.path});
      names.add(row.path); checkedSha(row.sha);
      const mode = row.mode === '40000' ? '040000' : row.mode;
      if (!(mode === '040000' && row.type === 'tree' ||
          mode === '160000' && row.type === 'commit' ||
          (ordinary(mode) || mode === '120000') && row.type === 'blob'))
        fail('GITHUB_TREE_CAPTURE_ENTRY_MODE', {path:row.path});
      if (row.type === 'blob' && (!Number.isSafeInteger(row.size) || row.size < 0))
        fail('GITHUB_TREE_CAPTURE_ENTRY_SIZE', {path:row.path});
      const part = sourceCodec.utf8(mode.replace(/^0+/, '') + ' ' + row.path + '\0');
      const sort = sourceCodec.utf8(row.path + (row.type === 'tree' ? '/' : ''));
      if (!(part instanceof Uint8Array) || !(sort instanceof Uint8Array))
        fail('GITHUB_TREE_CAPTURE_CODEC_BYTES');
      const sha = Uint8Array.from(row.sha.match(/../g), pair => parseInt(pair, 16));
      entries.push({row:{path:row.path,mode,type:row.type,sha:row.sha,
        ...(row.type === 'blob' ? {size:row.size} : {})}, part, sort, sha});
    }
    entries.sort((a,b) => compareBytes(a.sort,b.sort));
    const length = entries.reduce((n,row) => n + row.part.length + 20, 0);
    if (!Number.isSafeInteger(length)) fail('GITHUB_TREE_CAPTURE_SIZE');
    const prefix = sourceCodec.utf8('tree ' + length + '\0');
    const bytes = new Uint8Array(prefix.length + length);bytes.set(prefix);
    let offset=prefix.length;
    for (const entry of entries) {bytes.set(entry.part,offset);offset+=entry.part.length;
      bytes.set(entry.sha,offset);offset+=20;}
    if (sourceCodec.sha1(bytes) !== value.sha)
      fail('GITHUB_TREE_CAPTURE_CONTENT_CHANGED', {tree_sha:value.sha});
    return new Map(entries.map(({row}) => [row.path,row]));
  }

  function plan(value) {
    const selected = request(value), root = 'https://api.github.com/repos/' + selected.repository + '/git/';
    const responses = value.tree_responses ?? [];
    if (!Array.isArray(responses) || responses.length > maxTrees)
      fail('GITHUB_TREE_CAPTURE_ARRAY_REQUIRED');
    const cache = new Map(), originals = new Map();
    let capturedEntries = 0;
    for (const response of responses) {
      const rows=treeObject(response, selected.repository);
      capturedEntries += rows.size;
      if(capturedEntries > maxEntries)fail('GITHUB_TREE_CAPTURE_ENTRY_LIMIT');
      if (cache.has(response.sha)) {
        if (!equal([...cache.get(response.sha)], [...rows]))
          fail('GITHUB_TREE_CAPTURE_CONFLICT', {tree_sha:response.sha});
      } else {cache.set(response.sha, rows); originals.set(response.sha, response);}
    }
    const files = new Map(), missing = new Map(), visited = new Set(), used = new Set();
    let rootTree = null, count = 0;
    function want(sha,path) {
      let row=missing.get(sha);if(!row){row={kind:'tree',sha,url:root+'trees/'+sha,paths:[]};missing.set(sha,row);}
      if(!row.paths.includes(path))row.paths.push(path);
    }
    function entry(path,row) {
      sourcePath(path);
      if (!ordinary(row.mode))
        fail('GITHUB_TREE_CAPTURE_SOURCE_MODE', {path,mode:row.mode});
      const item={path,blob_sha:row.sha,mode:row.mode,size:row.size};
      const old=files.get(path);
      if(old&&!equal(old,item))fail('GITHUB_TREE_CAPTURE_FILE_CONFLICT',{path});
      files.set(path,item);
    }
    function walk(sha,prefix,remaining,all,ancestry) {
      if(ancestry.length>maxDepth||ancestry.includes(sha))
        fail('GITHUB_TREE_CAPTURE_DEPTH_OR_CYCLE',{path:prefix});
      const visit=prefix+'\0'+sha+'\0'+(all?'*':remaining.join('\0'));
      if(visited.has(visit))return;visited.add(visit);
      const rows=cache.get(sha);
      if(!rows){want(sha,prefix||'.');return;}
      used.add(sha);
      const groups=new Map();
      function directory(name,row,rest,whole) {
        const path=prefix+name;sourcePath(path);
        let group=groups.get(name);
        if(!group){group={sha:row.sha,remaining:[],all:false};groups.set(name,group);}
        if(whole)group.all=true;else group.remaining.push(rest);
      }
      if(all)for(const [name,row] of rows){
        if(++count>maxEntries)fail('GITHUB_TREE_CAPTURE_ENTRY_LIMIT');
        if(row.type==='tree')directory(name,row,'',true);else entry(prefix+name,row);
      } else for(const wanted of remaining) {
        const slash=wanted.indexOf('/'),name=slash<0?wanted:wanted.slice(0,slash);
        const row=rows.get(name);
        if(!row)fail('GITHUB_TREE_CAPTURE_PATH_ABSENT',{path:prefix+wanted,tree_sha:sha});
        if(slash<0){if(row.type==='tree')directory(name,row,'',true);else entry(prefix+name,row);}
        else {if(row.type!=='tree')fail('GITHUB_TREE_CAPTURE_PARENT_NOT_DIRECTORY',{path:prefix+name});
          directory(name,row,wanted.slice(slash+1),false);}
      }
      for(const [name,group] of groups)
        walk(group.sha,prefix+name+'/',group.remaining,group.all,[...ancestry,sha]);
    }
    let fetches;
    if(value.commit_response===undefined||value.commit_response===null)
      fetches=[{kind:'commit',sha:selected.commit,url:root+'commits/'+selected.commit,paths:[]}];
    else {
      rootTree=commitObject(value.commit_response,selected);
      walk(rootTree,'',selected.paths.filter(path=>path!=='.'),selected.paths.includes('.'),[]);
      fetches=[...missing.values()].map(row=>({...row,paths:row.paths.sort()})).sort((a,b)=>a.sha.localeCompare(b.sha));
    }
    const complete=fetches.length===0;
    if(complete&&files.size===0)fail('GITHUB_TREE_CAPTURE_SELECTION_EMPTY');
    const selection={schema:SELECTION_FORMAT,...selected,commit_response:clone(value.commit_response??null),
      tree_responses:[...used].sort().map(sha=>clone(originals.get(sha)))};
    return {schema:CAPTURE_FORMAT+'.plan',complete,repository:selected.repository,commit:selected.commit,
      root_tree_sha:rootTree,selected_paths:selected.paths,files:[...files.values()].sort((a,b)=>a.path.localeCompare(b.path)),
      fetches,captured_tree_count:cache.size,selected_tree_count:used.size,
      ...(complete?{selection}:{}),provider_requests:0};
  }

  async function collect(value, options={}) {
    const selected=request(value), budget=options.maxReads??64;
    if(!Number.isSafeInteger(budget)||budget<0||budget>10000)fail('GITHUB_TREE_CAPTURE_READ_BUDGET');
    if(typeof readJson!=='function')fail('GITHUB_TREE_CAPTURE_READ_BINDING');
    const state=options.state===undefined?{schema:CAPTURE_FORMAT,request:selected,commit_response:null,
      tree_responses:[],attempts:[],phase:'PENDING',failure:null}:clone(options.state);
    if(state.schema!==CAPTURE_FORMAT||!equal(state.request,selected)||!Array.isArray(state.attempts)||
        !Array.isArray(state.tree_responses))fail('GITHUB_TREE_CAPTURE_RESTORE_REQUEST');
    if(state.failure&&options.retryFailed!==true)
      fail('GITHUB_TREE_CAPTURE_RETRY_REQUIRED',{state});
    if(options.captures!==undefined) {
      if(!object(options.captures)||!Array.isArray(options.captures.tree_responses??[]))
        fail('GITHUB_TREE_CAPTURE_RETAINED_REQUIRED');
      if(options.captures.commit_response!==undefined){
        commitObject(options.captures.commit_response,selected);
        if(state.commit_response&&!equal(state.commit_response,options.captures.commit_response))
          fail('GITHUB_TREE_CAPTURE_COMMIT_CONFLICT');
        state.commit_response=clone(options.captures.commit_response);
      }
      for(const tree of options.captures.tree_responses??[]) {
        treeObject(tree,selected.repository);
        if(!state.tree_responses.some(row=>row.sha===tree.sha))state.tree_responses.push(clone(tree));
      }
    }
    state.failure=null;
    const inspect=()=>plan({...selected,commit_response:state.commit_response,tree_responses:state.tree_responses});
    async function retain(event){if(options.onState)await options.onState(clone(state),event);}
    let reads=0, current=inspect();
    await retain({kind:'capture_opened'});
    while(!current.complete&&reads<budget) {
      if(options.signal?.aborted){state.phase='PAUSED';await retain({kind:'capture_cancelled'});
        return{state,plan:current,complete:false};}
      const next=current.fetches[0],attempt={index:state.attempts.length,request:clone(next),phase:'PENDING'};
      state.attempts.push(attempt);state.phase='READING';
      await retain({kind:'before_tree_read',attempt:attempt.index});
      let response;
      try {
        response=await readJson({url:next.url});
        if(next.kind==='commit'){commitObject(response,selected);state.commit_response=clone(response);}
        else {if(response?.sha!==next.sha)fail('GITHUB_TREE_CAPTURE_TREE_CHANGED');
          treeObject(response,selected.repository);state.tree_responses.push(clone(response));}
        attempt.phase='VERIFIED';attempt.object_sha=next.sha;reads++;
        state.phase='PENDING';current=inspect();
        await retain({kind:'tree_read_complete',attempt:attempt.index});
      } catch(error) {
        attempt.phase='FAILED';if(response!==undefined)attempt.response=clone(response);
        attempt.error={name:String(error.name??'Error'),code:error.code??null,message:String(error.message??error),
          ...(error.status===undefined?{}:{status:error.status}),
          ...(error.response===undefined?{}:{response:clone(error.response)})};
        state.phase='READ_FAILED';state.failure=clone(attempt);
        try{await retain({kind:'tree_read_failed',attempt:attempt.index});}catch(retentionError){
          attempt.retention_error={name:String(retentionError.name),message:String(retentionError.message)};}
        const failure=new Error('Original Git tree acquisition did not complete: '+String(error.message??error));
        failure.code='GITHUB_TREE_CAPTURE_READ_FAILED';failure.state=clone(state);failure.cause=error;throw failure;
      }
    }
    state.phase=current.complete?'COMPLETE':'PAUSED';
    await retain({kind:current.complete?'capture_complete':'read_budget_reached'});
    return{state,plan:current,complete:current.complete,...(current.complete?{selection:current.selection}:{})};
  }
  return Object.freeze({plan,collect});
}
module.exports.createGitHubTreeSourceCollector = createGitHubTreeSourceCollector;
module.exports.SELECTION_FORMAT = SELECTION_FORMAT;
module.exports.CAPTURE_FORMAT = CAPTURE_FORMAT;
