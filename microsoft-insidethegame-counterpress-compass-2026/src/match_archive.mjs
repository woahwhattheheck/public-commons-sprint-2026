// Durable original synthetic matches and coach reviews for the native player.
import {createHash, randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat, mkdir, open, readdir, rename, unlink} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {validateFixture} from './engine.mjs';
import {normalizeRetainedInsights} from './retained_insight.mjs';
import {parseCount, parseView} from './live_sessions.mjs';
import {parseScenario, parseSeed, SCENARIOS} from './scenarios.mjs';

export const MATCH_PACKAGE_FORMAT = 'counterpress.match.v1';
export const MAX_PACKAGE_BYTES = 512 * 1024;
export const MAX_REVIEW_BYTES = 96 * 1024;
const STORED_FORMAT = 'counterpress.saved-match.v1';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const ID = new RegExp('^[0-9a-f]{16}-' + UUID + '$');
const fail = (status, message) => Object.assign(new Error(message), {status});
const object = (value, name) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(400, name + ' must be an object');
  return value;
};
function text(value, limit, name, fallback = '') {
  const result = value === undefined ? fallback : value;
  if (typeof result !== 'string' || result.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result))
    throw fail(400, name + ' is invalid or too long');
  return result;
}
function choice(value, values, fallback, name) {
  const result = value === undefined ? fallback : value;
  if (!values.includes(result)) throw fail(400, 'Unknown ' + name);
  return result;
}
export function archiveOwner(libraryKey) {
  if (typeof libraryKey !== 'string' || !/^[0-9a-f]{64}$/.test(libraryKey))
    throw fail(400, 'A browser library key is required');
  return createHash('sha256').update(libraryKey).digest('hex');
}
function validId(id) {
  if (typeof id !== 'string' || !ID.test(id)) throw fail(404, 'Saved match not found');
  return id;
}
function matchData(raw) {
  object(raw, 'Match');
  const scenario = parseScenario(raw.scenario), seed = parseSeed(raw.seed);
  validateFixture(raw.events);
  if (!raw.events.length) throw fail(400, 'A saved match needs at least one event');
  // Keep original event values and order; unknown uploaded properties never
  // become part of the runtime or portable package.
  const events = raw.events.map(({id, second, type, team, player, zone}) =>
    ({id, second, type, team, player, zone}));
  return {scenario, seed, data: 'synthetic', events};
}
function reviewData(raw, match) {
  object(raw, 'Review');
  const cursor = parseCount(raw.cursor ?? 0, match.events.length);
  const view = parseView(raw.view ?? {});
  const title = text(raw.title, 100, 'Title', SCENARIOS[match.scenario].label + ' · ' + match.seed).trim();
  if (!title) throw fail(400, 'Give the saved match a title');
  const notes = text(raw.notes, 6000, 'Match notes');
  const selectedMomentId = raw.selectedMomentId ?? null;
  if (selectedMomentId !== null && !match.events.slice(0, cursor).some(event => event.id === selectedMomentId && event.type === 'loss'))
    throw fail(400, 'Selected moment is not in the observed match');
  const filters = object(raw.filters ?? {}, 'Review filters');
  const normalizedFilters = {
    outcome: choice(filters.outcome, ['all', 'success', 'expired', 'interrupted'], 'all', 'outcome filter'),
    period: choice(filters.period, ['all', 'first', 'second'], 'all', 'match half'),
    feedTeam: choice(filters.feedTeam, ['both', 'focus', 'rival'], 'both', 'feed team'),
    feedType: choice(filters.feedType, ['all', 'loss', 'pressure', 'regain', 'pass', 'shot', 'clock'], 'all', 'event type'),
  };
  const source = raw.bookmarks ?? [];
  if (!Array.isArray(source) || source.length > 64) throw fail(400, 'A review supports up to 64 saved moments');
  const seen = new Set();
  const bookmarks = source.map(item => {
    object(item, 'Saved moment');
    const count = parseCount(item.count, match.events.length);
    if (!count || match.events[count - 1].id !== item.eventId || seen.has(item.eventId))
      throw fail(400, 'Saved moment must identify one unique original event');
    seen.add(item.eventId);
    return {eventId: item.eventId, count, label: text(item.label, 100, 'Moment title', item.eventId),
      note: text(item.note, 1000, 'Moment note')};
  }).sort((a, b) => a.count - b.count);
  return {title, notes, cursor, view, selectedMomentId, filters: normalizedFilters, bookmarks,
    insights: normalizeRetainedInsights(raw.insights, match)};
}
function storedData(raw) {
  object(raw, 'Saved match');
  if (raw.format !== STORED_FORMAT || !ID.test(raw.id) || !/^[0-9a-f]{64}$/.test(raw.owner) ||
      !raw.id.startsWith(raw.owner.slice(0, 16) + '-') || !Number.isSafeInteger(raw.revision) || raw.revision < 1 ||
      !Number.isFinite(Date.parse(raw.createdAt)) || !Number.isFinite(Date.parse(raw.updatedAt)))
    throw fail(500, 'Saved match metadata is invalid');
  const match = matchData(raw.match);
  return {format: STORED_FORMAT, id: raw.id, owner: raw.owner, revision: raw.revision,
    createdAt: raw.createdAt, updatedAt: raw.updatedAt, match, review: reviewData(raw.review, match)};
}
function summary(document) {
  return {id: document.id, revision: document.revision, title: document.review.title,
    createdAt: document.createdAt, updatedAt: document.updatedAt,
    scenario: document.match.scenario, seed: document.match.seed,
    total: document.match.events.length, cursor: document.review.cursor,
    view: document.review.view, savedMoments: document.review.bookmarks.length, data: 'synthetic'};
}
function present(document, libraryKey) {
  const canEdit = typeof libraryKey === 'string' && /^[0-9a-f]{64}$/.test(libraryKey) && archiveOwner(libraryKey) === document.owner;
  return {...summary(document), canEdit, review: document.review};
}

export async function createMatchArchiveStore({directory, maxArchives = 256, maxPerOwner = 64} = {}) {
  if (typeof directory !== 'string' || !directory.trim()) throw new TypeError('Archive directory required');
  directory = resolve(directory);
  if (!Number.isInteger(maxArchives) || maxArchives < 1 || !Number.isInteger(maxPerOwner) || maxPerOwner < 1)
    throw new TypeError('Invalid saved-match capacity');
  await mkdir(directory, {recursive: true, mode: 0o700});
  const directoryInfo = await lstat(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.mode & 0o077) throw fail(503, 'Saved-match directory must be private (0700)');
  const filenames = new Set((await readdir(directory)).filter(name => name.endsWith('.json') && ID.test(name.slice(0, -5))).map(name => name.slice(0, -5)));
  const summaries = new Map();
  let writeTail = Promise.resolve();
  const path = id => join(directory, validId(id) + '.json');
  const orderedWrite = operation => {
    const next = writeTail.then(operation);
    writeTail = next.catch(() => {});
    return next;
  };
  async function syncDirectory() {
    const handle = await open(directory, constants.O_RDONLY);
    try { await handle.sync(); } finally { await handle.close(); }
  }
  async function read(id) {
    let handle;
    try {
      handle = await open(path(id), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1 || info.mode & 0o077 || info.size > MAX_PACKAGE_BYTES)
        throw fail(500, 'Saved match file is invalid');
      const document = storedData(JSON.parse(await handle.readFile('utf8')));
      if (document.id !== id) throw fail(500, 'Saved match file does not match its link');
      summaries.set(id, summary(document));
      return document;
    } catch (error) {
      if (error.code === 'ENOENT') throw fail(404, 'Saved match not found');
      if (error.status) throw error;
      throw fail(500, 'Saved match could not be read');
    } finally { if (handle) await handle.close(); }
  }
  async function write(document) {
    const body = JSON.stringify(document) + '\n';
    if (Buffer.byteLength(body) > MAX_PACKAGE_BYTES) throw fail(413, 'Saved match exceeds 512KB');
    const temporary = join(directory, '.' + randomUUID() + '.tmp');
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(body);
      await handle.sync();
      await handle.close(); handle = null;
      await rename(temporary, path(document.id));
      await syncDirectory();
      filenames.add(document.id);
      summaries.set(document.id, summary(document));
    } finally {
      if (handle) await handle.close();
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  async function create(match, review, libraryKey) {
    const owner = archiveOwner(libraryKey);
    return orderedWrite(async () => {
      if (filenames.size >= maxArchives) throw fail(507, 'The saved-match store is full');
      if ([...filenames].filter(id => id.startsWith(owner.slice(0, 16) + '-')).length >= maxPerOwner)
        throw fail(409, 'Your saved-match collection is full; export and remove an older match');
      const at = new Date().toISOString();
      const document = {format: STORED_FORMAT, id: owner.slice(0, 16) + '-' + randomUUID(), owner,
        revision: 1, createdAt: at, updatedAt: at, match, review};
      await write(document);
      return present(document, libraryKey);
    });
  }
  return {
    limits: {matchesPerBrowser: maxPerOwner, savedMoments: 64, packageBytes: MAX_PACKAGE_BYTES},
    async list(libraryKey) {
      const prefix = archiveOwner(libraryKey).slice(0, 16) + '-';
      const matches = [];
      for (const id of filenames) {
        if (!id.startsWith(prefix)) continue;
        const item = summaries.get(id) ?? summary(await read(id));
        matches.push(item);
      }
      return matches.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    },
    async saveSession(session, review, libraryKey) {
      const match = matchData(session);
      return create(match, reviewData(review ?? {}, match), libraryKey);
    },
    async importPackage(raw, libraryKey) {
      object(raw, 'Match package');
      if (raw.format !== MATCH_PACKAGE_FORMAT || raw.match?.data !== 'synthetic')
        throw fail(400, 'Choose a Counterpress synthetic match package');
      const match = matchData(raw.match);
      return create(match, reviewData(raw.review ?? {}, match), libraryKey);
    },
    async get(id, libraryKey) { return present(await read(id), libraryKey); },
    async open(id, libraryKey) {
      const document = await read(id);
      return {archive: present(document, libraryKey), match: document.match};
    },
    async exportPackage(id) {
      const document = await read(id);
      return {format: MATCH_PACKAGE_FORMAT, match: document.match, review: document.review};
    },
    async update(id, revision, review, libraryKey) {
      const owner = archiveOwner(libraryKey);
      return orderedWrite(async () => {
        const document = await read(id);
        if (document.owner !== owner) throw fail(403, 'Save a copy to edit this shared match');
        if (revision !== document.revision) throw fail(409, 'This review changed in another tab; reload it or save a copy');
        document.review = reviewData(review, document.match);
        document.revision++;
        document.updatedAt = new Date().toISOString();
        await write(document);
        return present(document, libraryKey);
      });
    },
    async remove(id, revision, libraryKey) {
      const owner = archiveOwner(libraryKey);
      return orderedWrite(async () => {
        const document = await read(id);
        if (document.owner !== owner) throw fail(403, 'Only the saving browser can remove this match');
        if (revision !== document.revision) throw fail(409, 'This review changed in another tab; reload before removing it');
        await unlink(path(id));
        await syncDirectory();
        filenames.delete(id); summaries.delete(id);
      });
    },
  };
}
