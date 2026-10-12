// MIT. Huwise source bindings over the original retained facilitator review engine.
import { dirname, join, resolve } from 'node:path';
import { constants } from 'node:fs';
import { lstat, readFile, open, realpath, link, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { readFacilitatorProfiles } from '../../../sf82-seller-pilot/release-facilitator.mjs';
import { readReleaseState, listReleases, inspectRelease } from '../../../sf82-seller-pilot/releases.mjs';
import { openPublisherFacilitators } from '../../socrata/publisher-facilitators.mjs';

export const OPENDATASOFT_FACILITATOR_SOURCE = 'stellar-forge.opendatasoft-facilitator-source.v1';
const HASH = /^[a-f0-9]{64}$/, ID = /^[a-f0-9-]{36}$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message, status = 409) => Object.assign(new Error(message), { code:'ODS_' + code, status });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const encoded = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const exact = (value, fields, required = []) => {
  if (!plain(value) || Object.keys(value).some(key => !fields.includes(key)) || required.some(key => !Object.hasOwn(value,key)))
    throw fail('FACILITATOR_INPUT','Use the declared Huwise facilitator fields.',400);
};
const reviewId = value => {
  if (typeof value !== 'string' || !HASH.test(value)) throw fail('FACILITATOR_REVIEW_REQUIRED','Choose a retained native review.',400);
  return value;
};

/** The containing workbench owns its existing lease and asynchronous operation.
 * The shared component retains every native review. SF82 owns release validation,
 * provider introspection, staging, idempotent recovery, activation and runtime.
 * Reading this facade never initializes a new seller store or starts a seller. */
export async function openOpendatasoftFacilitators({ directory, connectionFile, currentState } = {}) {
  if (typeof directory !== 'string' || directory !== resolve(directory) || typeof currentState !== 'function')
    throw fail('FACILITATOR_CONFIGURATION','Use the original Huwise workbench and its saved state.',400);
  const root = join(directory,'seller-releases');
  const profiles = connectionFile === undefined || connectionFile === null ? null : await readFacilitatorProfiles(connectionFile);
  const retained = await openPublisherFacilitators({ directory, releaseDirectory:root, profiles });
  async function hasStore() {
    try {
      const stat = await lstat(root);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('FACILITATOR_STORE_CHANGED','The original seller store must be an ordinary directory.');
      return true;
    } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  function matches(release, exported) {
    return plain(exported) && HASH.test(exported.manifestSha256 ?? '') &&
      HASH.test(exported.handlerSha256 ?? '') &&
      exported.handlerSha256 === release.handlerEntry?.sha256 &&
      release.routes.some(route => route.url === exported.resource);
  }
  function findExport(release, selected) {
    const state = currentState();
    const entries = (state.exports ?? []).filter(value => matches(release,value));
    if (selected !== undefined && (typeof selected !== 'string' || !ID.test(selected)))
      throw fail('FACILITATOR_EXPORT_REQUIRED','Choose the original Huwise merchant package.',400);
    const found = selected === undefined ? entries : entries.filter(value => value.id === selected);
    if (found.length !== 1) throw fail('FACILITATOR_SOURCE_CHANGED','The retained seller release must match one original Huwise merchant package and its exact handler.');
    return found[0];
  }
  function binding(review, release, exported) {
    const state = currentState();
    return { schema:OPENDATASOFT_FACILITATOR_SOURCE, reviewId:review.id,
      observedAt:review.observedAt,
      workbench:{ catalogOrigin:state.catalogOrigin, createdAt:state.createdAt },
      merchantExportId:exported.id, merchantManifestSha256:exported.manifestSha256,
      handlerSha256:exported.handlerSha256, resource:exported.resource,
      capture:{ catalogOrigin:exported.capture?.catalogOrigin, datasetId:exported.capture?.datasetId,
        datasetUid:exported.capture?.datasetUid, manifestSha256:exported.capture?.manifestSha256,
        rowCount:exported.capture?.rowCount },
      dataset:{ snapshot:exported.dataset?.snapshot, rowCount:exported.dataset?.rowCount },
      sourceRelease:{ id:release.id, digest:release.digest,
        serviceConfigSha256:release.source.serviceConfigSha256 },
      proposedReleaseId:review.proposed.id };
  }
  async function sourceOf(review, selected) {
    const release = await inspectRelease(root,review.source.releaseId);
    if (release.digest !== review.source.releaseDigest ||
        release.source.serviceConfigSha256 !== review.source.source.serviceConfigSha256)
      throw fail('FACILITATOR_SOURCE_CHANGED','The native review and retained seller source differ.');
    return { release, exported:findExport(release,selected) };
  }
  async function inspect(id) {
    const review = await retained.act('publisher.facilitators.inspect',{reviewId:reviewId(id)});
    const {release,exported} = await sourceOf(review);
    let staged = {state:'NOT_STAGED',release:null};
    try {
      const result = await inspectRelease(root,review.proposed.id);
      staged = {state:result.derivedFrom?.reviewId === review.id ? 'STAGED':'CONFLICT',release:result};
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return {review,source:binding(review,release,exported),staged};
  }
  async function status() {
    const value = await retained.state();
    if (!await hasStore()) return {schema:'stellar-forge.opendatasoft-facilitators.v1',...value,
      store:{initialized:false,generation:null,active:null,previous:null,releases:[],errors:[]}};
    const selected = await readReleaseState(root), listed = await listReleases(root);
    const releases = listed.releases.map(release => {
      let merchantExportId = null, sourceError = null;
      try { merchantExportId = findExport(release).id; }
      catch (error) { sourceError = {code:error.code ?? 'ODS_FACILITATOR_SOURCE_CHANGED',message:error.message}; }
      return {...release,merchantExportId,sourceError};
    });
    return {schema:'stellar-forge.opendatasoft-facilitators.v1',...value,
      store:{initialized:true,generation:selected.generation,active:selected.active,previous:selected.previous,
        releases,errors:listed.errors}};
  }
  async function review(input) {
    exact(input,['merchantExportId','provider','releaseId','id','label'],['merchantExportId','provider','releaseId','id']);
    const release = await inspectRelease(root,input.releaseId);
    findExport(release,input.merchantExportId);
    const value = await retained.act('publisher.facilitators.review',{
      provider:input.provider,releaseId:input.releaseId,id:input.id,...(input.label === undefined ? {}:{label:input.label})});
    // Reopen the complete saved original. The source cannot silently become a
    // different merchant edition between the initial choice and its native read.
    return inspect(value.id);
  }
  async function stage(id) {
    const original = await inspect(reviewId(id));
    if (!original.review.compatible) throw fail('FACILITATOR_NOT_COMPATIBLE','Choose a compatible retained native review.');
    const result = await retained.act('publisher.facilitators.stage',{reviewId:id});
    return {...result,source:original.source};
  }
  async function files(id) {
    const selected = await inspect(reviewId(id));
    const original = await retained.readExport(id);
    const source = encoded(selected.source);
    const guide = await readFile(new URL('../FACILITATORS.md',import.meta.url));
    return {review:selected.review,source:selected.source,
      files:[
        {name:'facilitator-review.json',contentType:'application/json',content:original.bytes,sha256:sha256(original.bytes)},
        {name:'facilitator-source.json',contentType:'application/json',content:source,sha256:sha256(source)},
        {name:'FACILITATORS.md',contentType:'text/markdown; charset=utf-8',content:guide,sha256:sha256(guide)}
      ]};
  }
  return {status,history:input => retained.history(input),inspect,review,stage,files};
}

/** Publish a single original review/source/guide file exclusively and atomically.
 * Repeating an acknowledged download adopts only byte-identical original output. */
export async function writeOpendatasoftFacilitatorFile(path, content) {
  path = resolve(path);
  const parent = dirname(path);
  if (await realpath(parent) !== parent || !Buffer.isBuffer(content))
    throw fail('FACILITATOR_OUTPUT','Choose a canonical existing output directory and the complete original bytes.',400);
  const temporary = join(parent,'.huwise-facilitator-' + randomUUID());
  try {
    const handle = await open(temporary,'wx',0o600);
    try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
    try { await link(temporary,path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const retained = await open(path,constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      try {
        const before = await retained.stat({bigint:true});
        if (!before.isFile() || before.size !== BigInt(content.length))
          throw fail('FACILITATOR_OUTPUT_CHANGED','The existing output differs from this original file.');
        const bytes = await retained.readFile(), after = await retained.stat({bigint:true});
        if (!bytes.equals(content) || ['dev','ino','size','mtimeNs','ctimeNs'].some(key => before[key] !== after[key]))
          throw fail('FACILITATOR_OUTPUT_CHANGED','The existing output differs from this original file.');
      } finally { await retained.close(); }
    }
    const folder = await open(parent,'r');
    try { await folder.sync(); } finally { await folder.close(); }
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  return {file:path,bytes:content.length,sha256:sha256(content)};
}
