// MIT. Retained Publisher reviews over the original SF82 facilitator lifecycle.
import {constants} from 'node:fs';
import {open, mkdir, realpath, lstat, readdir, link, unlink} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {
  FACILITATOR_REVIEW_SCHEMA, normalizeFacilitatorProfiles,
  reviewReleaseFacilitator, stageReleaseFacilitator
} from '../../sf82-seller-pilot/release-facilitator.mjs';

const HASH = /^[a-f0-9]{64}$/;
const MAX_BYTES = 2 * 1024 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message, status = 409) => Object.assign(new Error(message), {code, status});
const ordered = value => Array.isArray(value) ? value.map(ordered) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
const exact = (value, fields) => {
  if (!object(value) || Object.keys(value).some(key => !fields.includes(key)))
    throw fail('PUBLISHER_FACILITATOR_INPUT', 'Use the declared provider-review fields.', 400);
};
function identifier(value) {
  if (typeof value !== 'string' || !HASH.test(value))
    throw fail('PUBLISHER_FACILITATOR_REVIEW', 'Choose a retained facilitator review ID.', 400);
  return value;
}
async function syncDirectory(directory) {
  const file = await open(directory, 'r');
  try { await file.sync(); } finally { await file.close(); }
}
function checked(value, id) {
  if (!object(value)) throw fail('PUBLISHER_FACILITATOR_REVIEW_CHANGED', 'The retained review is not an object.');
  const {id: saved, ...content} = value;
  if (saved !== id || content.schema !== FACILITATOR_REVIEW_SCHEMA || hash(content) !== saved ||
      typeof content.compatible !== 'boolean')
    throw fail('PUBLISHER_FACILITATOR_REVIEW_CHANGED', 'The retained original facilitator review changed.');
  return value;
}

/** The enclosing Publisher already owns its draft lease and serial action queue.
 * Profiles are supplied by the host. Browser and MCP payloads select their aliases.
 * Reviews retain the original SF82 identity; staging, replay and startup checks
 * remain in SF82. This module never activates or starts a seller. */
export async function openPublisherFacilitators({directory, releaseDirectory, profiles} = {}) {
  if (typeof directory !== 'string' || directory === '/' || resolve(directory) !== directory ||
      await realpath(directory) !== directory ||
      typeof releaseDirectory !== 'string' || resolve(releaseDirectory) !== releaseDirectory)
    throw fail('PUBLISHER_FACILITATOR_DIRECTORY', 'Use the original canonical Publisher and release directories.', 400);
  const selected = profiles === undefined || profiles === null ? null : normalizeFacilitatorProfiles(profiles);
  const reviewDirectory = join(directory, 'facilitator-reviews');
  async function exists() {
    try {
      const info = await lstat(reviewDirectory);
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(reviewDirectory) !== reviewDirectory)
        throw fail('PUBLISHER_FACILITATOR_DIRECTORY', 'The retained review directory must be an ordinary private directory.');
      return true;
    } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  async function read(id) {
    identifier(id);
    if (!await exists()) throw fail('PUBLISHER_FACILITATOR_REVIEW_MISSING', 'This Publisher has no retained facilitator reviews.', 404);
    const file = await open(join(reviewDirectory, id + '.json'), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let data;
    try {
      const before = await file.stat({bigint:true});
      if (!before.isFile() || before.size > BigInt(MAX_BYTES))
        throw fail('PUBLISHER_FACILITATOR_REVIEW_CHANGED', 'The retained review exceeds its original file limit.');
      data = await file.readFile();
      const after = await file.stat({bigint:true});
      if (BigInt(data.length) !== before.size || before.size !== after.size || before.mtimeNs !== after.mtimeNs)
        throw fail('PUBLISHER_FACILITATOR_REVIEW_CHANGED', 'The retained review changed while it was being read.');
    } finally { await file.close(); }
    const value = checked(JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(data)), id);
    return {value, bytes:data};
  }
  async function save(review) {
    checked(review, identifier(review.id));
    const data = Buffer.from(JSON.stringify(review) + '\n');
    if (data.length > MAX_BYTES)
      throw fail('PUBLISHER_FACILITATOR_REVIEW_SIZE', 'The full native review exceeds its retained file limit.', 413);
    if (!await exists()) {
      await mkdir(reviewDirectory, {mode:0o700});
      await syncDirectory(directory);
    }
    const destination = join(reviewDirectory, review.id + '.json');
    const temporary = join(reviewDirectory, '.pending-' + randomUUID());
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
      try { await link(temporary, destination); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (!(await read(review.id)).bytes.equals(data))
          throw fail('PUBLISHER_FACILITATOR_REVIEW_CHANGED', 'An existing review has different original bytes.');
      }
      await syncDirectory(reviewDirectory);
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    return review;
  }
  async function history(input = {}) {
    exact(input, ['after', 'limit']);
    const after = input.after === undefined || input.after === null ? null : identifier(input.after);
    const limit = input.limit ?? 25;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw fail('PUBLISHER_FACILITATOR_PAGE', 'Choose a review page size from 1 to 100.', 400);
    const ids = await exists() ? (await readdir(reviewDirectory, {withFileTypes:true}))
      .filter(item => item.isFile() && /^[a-f0-9]{64}\.json$/.test(item.name))
      .map(item => item.name.slice(0, -5)).sort() : [];
    const remaining = after === null ? ids : ids.filter(id => id > after);
    const page = remaining.slice(0, limit);
    const items = await Promise.all(page.map(async id => {
      const {value} = await read(id);
      return {id, observedAt:value.observedAt, compatible:value.compatible,
        releaseId:value.source.releaseId, proposedReleaseId:value.proposed.id,
        label:value.proposed.label, provider:value.proposed.provider,
        generation:value.generation, nativeSdk:value.nativeSdk,
        supportedSha256:value.supportedSha256, error:value.error};
    }));
    return {items, total:ids.length, nextCursor:remaining.length > page.length ? page.at(-1) : null};
  }
  async function state() {
    return {configured:selected !== null,
      providers:Object.entries(selected?.providers ?? {}).map(([alias, value]) => ({alias, ...value})),
      reviews:await history()};
  }
  async function act(action, input = {}) {
    if (action === 'publisher.facilitators.history') return history(input);
    if (action === 'publisher.facilitators.inspect') {
      exact(input, ['reviewId']); return (await read(input.reviewId)).value;
    }
    if (action === 'publisher.facilitators.review') {
      exact(input, ['provider', 'releaseId', 'id', 'label']);
      if (!selected) throw fail('FACILITATOR_NOT_CONFIGURED', 'Open this Publisher with the host facilitator profiles.');
      const review = await reviewReleaseFacilitator(releaseDirectory, {profiles:selected, ...input});
      return save(review);
    }
    if (action === 'publisher.facilitators.stage') {
      exact(input, ['reviewId']);
      if (!selected) throw fail('FACILITATOR_NOT_CONFIGURED', 'Open this Publisher with the host facilitator profiles.');
      const {value:review} = await read(input.reviewId);
      return stageReleaseFacilitator(releaseDirectory, {profiles:selected, review});
    }
    throw fail('PUBLISHER_FACILITATOR_ACTION', 'Choose an original Publisher facilitator action.', 400);
  }
  async function readExport(id) {
    const {bytes} = await read(id);
    return {bytes, filename:'facilitator-review-' + id + '.json', contentType:'application/json'};
  }
  return {state, act, history, readExport};
}
