// MIT. Independent product source declarations for the existing grant composer.
export const GRANT_PRODUCT_REGISTRATION_SCHEMA = 'stellar-forge.grant-product-registration.v1';
const need = (value, message) => { if (!value) throw new Error(message); };
const copy = value => JSON.parse(JSON.stringify(value));
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,119}$/.test(value);
const quote = value => value.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
const byteKeys = ['git_blob', 'sha256', 'bytes'];
const definitionKeys = ['path', 'bytes', 'sha256', 'git_blob'];

function productSections(markdown) {
  const lines = String(markdown).replaceAll('\r\n', '\n').split('\n');
  const outline = [];
  let offset = 0, fence = null;
  for (const line of lines) {
    const marker = line.match(/^ {0,3}(\x60{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
    } else if (marker) {
      fence = { character: marker[1][0], length: marker[1].length };
    } else {
      const match = line.match(/^ {0,3}(#{1,2})[ \t]+(.+?)\s*$/);
      if (match) outline.push({ heading: match[1] + ' ' + match[2], offset });
    }
    offset += line.length + 1;
  }
  const source = lines.join('\n'), result = new Map();
  for (let at = 0; at < outline.length; at++) {
    const heading = outline[at].heading;
    const values = result.get(heading) || [];
    values.push(source.slice(outline[at].offset, outline[at + 1]?.offset));
    result.set(heading, values);
  }
  return result;
}

function validatePath(value, allowEmpty) {
  return typeof value === 'string' && (allowEmpty || value.length > 0) &&
    !/[\s\\?#<>"\x00-\x1f]/.test(value) && !value.startsWith('/') &&
    !value.split('/').some(part => part === '.' || part === '..' || (!part && value !== ''));
}

/** Validate the whole set before any source records are changed. */
export function validateGrantProductRegistrations(registrations) {
  need(Array.isArray(registrations), 'Pass product registrations as a complete array.');
  const products = new Set(), sources = new Set();
  return registrations.map(original => {
    need(original && typeof original === 'object' && !Array.isArray(original), 'Use a product registration object.');
    const item = copy(original);
    need(item.schema === GRANT_PRODUCT_REGISTRATION_SCHEMA && id(item.id), 'Use the product registration schema and a stable product ID.');
    need(!products.has(item.id), 'Select one registration for product ' + item.id + '.');
    products.add(item.id);
    need(typeof item.heading === 'string' && /^## [^\r\n]+$/.test(item.heading), 'Name the complete existing H2 chapter for product ' + item.id + '.');
    need(Array.isArray(item.sources) && item.sources.length > 0, 'Declare the complete original sources for product ' + item.id + '.');
    for (const spec of item.sources) {
      need(spec && typeof spec === 'object' && !Array.isArray(spec) && id(spec.id), 'Use a stable source ID in product ' + item.id + '.');
      need(!sources.has(spec.id), 'Assign each declared source ID to one product: ' + spec.id);
      sources.add(spec.id);
      need(typeof spec.label === 'string' && spec.label.trim() && !/[\r\n]/.test(spec.label), 'Provide a source label for ' + spec.id + '.');
      need(typeof spec.repository === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(spec.repository), 'Provide the original owner/repository for ' + spec.id + '.');
      spec.kind = spec.kind || 'blob';
      need(['blob', 'tree'].includes(spec.kind) && validatePath(spec.path, spec.kind === 'tree'), 'Provide the original Git file or tree path for ' + spec.id + '.');
      need(spec.commit === undefined || sha(spec.commit), 'Select a full immutable commit for ' + spec.id + '.');
      need(spec.required === undefined || typeof spec.required === 'boolean', 'Use a boolean required field for ' + spec.id + '.');
      need(spec.editions === undefined || Array.isArray(spec.editions), 'Keep measured source editions as an array for ' + spec.id + '.');
      need(spec.kind === 'blob' || !(spec.editions || []).length, 'Measured file editions belong to a blob source: ' + spec.id);
      const commits = new Set();
      for (const edition of spec.editions || []) {
        need(edition && typeof edition === 'object' && sha(edition.commit) && !commits.has(edition.commit), 'Keep one measured identity per original source edition: ' + spec.id);
        commits.add(edition.commit);
        need(edition.git_blob === undefined || sha(edition.git_blob), 'Use a full Git blob for ' + spec.id + '.');
        need(edition.sha256 === undefined || sha256(edition.sha256), 'Use a complete SHA-256 for ' + spec.id + '.');
        need(edition.bytes === undefined || (Number.isSafeInteger(edition.bytes) && edition.bytes >= 0), 'Use the complete byte length for ' + spec.id + '.');
        need(byteKeys.some(key => Object.hasOwn(edition, key)), 'A measured source edition needs its original file identity: ' + spec.id);
      }
    }
    if (item.definition !== undefined) {
      const selected = item.definition;
      need(selected && definitionKeys.every(key => Object.hasOwn(selected, key)) &&
        typeof selected.path === 'string' && selected.path.length > 0 && !selected.path.startsWith('/') &&
        !/[\\\x00-\x1f]/.test(selected.path) && !selected.path.split('/').includes('..') &&
        Number.isSafeInteger(selected.bytes) && selected.bytes >= 0 &&
        sha256(selected.sha256) && sha(selected.git_blob), 'Bind the complete received registration file for ' + item.id + '.');
      item.definition = Object.fromEntries(definitionKeys.map(key => [key, selected[key]]));
    }
    return item;
  });
}

function selectedSource(text, spec) {
  const root = 'https://github.com/' + spec.repository + '/' + spec.kind + '/';
  const path = spec.path ? '/' + spec.path : '';
  const pattern = new RegExp(quote(root) + '([a-f0-9]{40})' + quote(path) +
    '(?:#[^\\s<>)\\]]+)?(?=$|[\\s<>)\\]])', 'g');
  const matches = [...text.matchAll(pattern)].filter(match => !spec.commit || match[1] === spec.commit);
  const commits = [...new Set(matches.map(match => match[1]))];
  need(commits.length <= 1, 'Select one current source edition for ' + spec.id + '; use a separate ID for a historical edition.');
  if (!commits.length) return null;
  return { repository: spec.repository, commit: commits[0], path: spec.path,
    url: root + commits[0] + path,
    source_kind: spec.kind === 'tree' ? 'source-tree' : 'source-file' };
}

function sameSource(left, right) {
  return left && right && left.repository === right.repository && left.commit === right.commit &&
    left.path === right.path && (left.source_kind || 'source-file') === (right.source_kind || 'source-file');
}

/**
 * Add independently owned product declarations to the original source index.
 * The current manuscript selects each edition. Public projection stays with the
 * existing composer, after complete source identities have been received.
 */
export function receiveGrantProductSources(index, markdown, registrations = []) {
  need(index?.schema === 'stellar-forge.grant-reviewer-source-index.v1' && Array.isArray(index.sources), 'Use the complete original reviewer source index.');
  need(typeof markdown === 'string', 'Pass the complete selected manuscript or companion.');
  const products = validateGrantProductRegistrations(registrations);
  if (!products.length) return index;
  const sources = index.sources.map(source => copy(source));
  const original = index.narrative_source?.composition?.product_source_registrations || [];
  need(Array.isArray(original), 'Retain product source registrations as an array.');
  const received = original.map(item => copy(item)), sections = productSections(markdown);
  for (const product of products) {
    const matches = sections.get(product.heading) || [];
    need(matches.length <= 1, 'Keep one complete registered product chapter: ' + product.heading);
    if (!matches.length) continue;
    const section = matches[0];
    const selectedIds = [];
    for (const spec of product.sources) {
      const positions = [];
      for (let at = 0; at < sources.length; at++) if (sources[at].id === spec.id) positions.push(at);
      need(positions.length <= 1, 'Keep one original source record for ' + spec.id + '.');
      const at = positions.length ? positions[0] : -1;
      const previous = at < 0 ? null : sources[at];
      let selected = selectedSource(section, spec);
      // The established public projection omits private URLs but retains their
      // exact repository, commit and path. Reuse only that actual projection.
      if (!selected && previous?.access === 'authenticated-source' && previous.url === undefined &&
          previous.repository === spec.repository && previous.path === spec.path &&
          sha(previous.commit) && (!spec.commit || spec.commit === previous.commit) &&
          (!previous.source_kind || previous.source_kind === (spec.kind === 'tree' ? 'source-tree' : 'source-file'))) {
        selected = { repository: previous.repository, commit: previous.commit, path: previous.path,
          source_kind: spec.kind === 'tree' ? 'source-tree' : 'source-file' };
      }
      if (!selected) {
        need(spec.required === false, 'Receive the original immutable source link for ' + spec.id + ' in ' + product.heading + '.');
        continue;
      }
      if (previous) {
        need(!previous.source_registration || previous.source_registration === product.id, 'Retain the original product registration for source ' + spec.id + '.');
        need(previous.source_registration === product.id ||
          (previous.repository === spec.repository && previous.path === spec.path),
          'This source ID already belongs to another original repository or path: ' + spec.id);
      }
      const next = { ...(previous || {}), ...selected, id: spec.id,
        kind: previous?.kind || 'published-source', label: previous?.label || spec.label,
        source_registration: product.id };
      const witness = next.product_byte_identity;
      if (witness && !sameSource(witness, selected)) {
        for (const key of byteKeys) if (next[key] === witness[key]) delete next[key];
        delete next.product_byte_identity;
      }
      if (previous && !sameSource(previous, selected)) {
        for (const key of byteKeys) delete next[key];
        delete next.product_byte_identity;
      }
      if (selected.url) {
        delete next.access;
        delete next.reader_url;
      }
      const edition = (spec.editions || []).find(item => item.commit === selected.commit);
      if (edition) {
        for (const key of byteKeys) if (Object.hasOwn(edition, key)) {
          next[key] = edition[key];
        }
        next.product_byte_identity = { repository: selected.repository, commit: selected.commit, path: selected.path,
          ...Object.fromEntries(byteKeys.filter(key => Object.hasOwn(edition, key)).map(key => [key, edition[key]])) };
      }
      if (at < 0) sources.push(next); else sources[at] = next;
      selectedIds.push(spec.id);
    }
    const record = { id: product.id, heading: product.heading, source_ids: selectedIds,
      ...(product.definition ? { definition: product.definition } : {}) };
    const existing = received.filter(item => item.id === product.id);
    need(existing.length <= 1, 'Keep one received declaration for product ' + product.id + '.');
    if (existing.length) received[received.indexOf(existing[0])] = { ...existing[0], ...record };
    else received.push(record);
  }
  index.sources = sources;
  if (received.length) index.narrative_source = { ...index.narrative_source, composition: {
    ...index.narrative_source?.composition,
    product_source_registrations: received.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  } };
  return index;
}

/** The author's chapter chooser uses the same outline as source receiving. */
export function grantProductChapters(markdown) {
  need(typeof markdown === 'string', 'Pass the complete original companion.');
  return [...productSections(markdown)].flatMap(([heading, sections]) =>
    heading.startsWith('## ') ? sections.map((text, occurrence) => ({
      heading, markdown: text, occurrence, occurrences: sections.length,
    })) : []);
}
