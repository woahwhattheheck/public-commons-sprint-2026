/**
 * Portable, source-bound working selections for the existing Editable GIS desk.
 * The native gis.project.export writer remains the authority for source bytes,
 * complete companions, CRS, native runs and final request validation.
 */
export const WORKING_SCHEMA = "upstate.gis-working-selection/v1";
export const WORK_BYTES = 16 * 1024 * 1024;

function fail(message) { throw new Error(message); }
function utf8Length(value) {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit < 0x80) bytes++;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < value.length &&
      value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
    else bytes += 3;
  }
  return bytes;
}
function record(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(label + " must be an object.");
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) fail(label + " must be a plain JSON object.");
  return value;
}
function jsonValue(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || seen.has(value)) fail("Working selections must contain finite, acyclic JSON values.");
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(value, i)) fail("Working selections cannot contain sparse arrays.");
      jsonValue(value[i], seen);
    }
  } else {
    record(value, "Working value");
    for (const key of Object.keys(value)) jsonValue(value[key], seen);
  }
  seen.delete(value);
}
function clone(value) { jsonValue(value); return JSON.parse(JSON.stringify(value)); }
function identifier(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(label + " must be a nonempty original identifier.");
  return value;
}
function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
function set(object, key, value) {
  Object.defineProperty(object, key, {value, enumerable:true, writable:true, configurable:true});
}
function selectionValue(value) {
  record(value, "GIS selection");
  const result = clone(value);
  if (own(result, "sources") && !Array.isArray(result.sources)) fail("GIS selection sources must be an array.");
  if (result.source_collection_id !== undefined && result.source_collection_id !== null && result.source_collection_id !== "") {
    identifier(result.source_collection_id, "Original source collection");
  }
  for (const row of result.sources || []) {
    record(row, "Selected source");
    identifier(row.source_id, "Original source");
    const cid = row.source_collection_id || result.source_collection_id;
    identifier(cid, "Selected source collection");
  }
  return result;
}
export function pairKey(row) {
  record(row, "Source pair");
  return JSON.stringify([
    identifier(row.source_collection_id, "Original source collection"),
    identifier(row.source_id, "Original source")
  ]);
}
function catalogueIndex(catalogue) {
  record(catalogue, "GIS catalogue");
  if (!Array.isArray(catalogue.sources)) fail("GIS catalogue sources must be an array.");
  const collections = new Map(), entries = new Map();
  for (const original of catalogue.sources) {
    const collection = clone(record(original, "Source collection"));
    const cid = identifier(collection.id, "Original source collection");
    if (collections.has(cid)) fail("The catalogue repeats an original source collection: " + cid);
    if (!Array.isArray(collection.entries)) fail("The source collection has no complete entries array: " + cid);
    collections.set(cid, collection);
    for (const entry of collection.entries) {
      record(entry, "Source catalogue entry");
      const sid = identifier(entry.id, "Original source");
      const key = pairKey({source_collection_id:cid, source_id:sid});
      if (entries.has(key)) fail("The catalogue repeats an original source pair: " + key);
      entries.set(key, {collection, entry});
    }
  }
  return {collections, entries};
}
function compactCollection(collection, id) {
  if (!collection) return {id, title:id};
  const result = clone(collection);
  delete result.entries;
  return result;
}

/**
 * Expand the native legacy whole-collection fallback when the actual collection
 * is available. An unavailable legacy collection remains explicit and unresolved.
 * Never allow an empty new explicit basket to inherit the chooser as a fallback.
 */
export function normalizeSelectionSources(value, catalogue) {
  const selection = selectionValue(value);
  const {collections} = catalogueIndex(catalogue);
  const fallback = selection.source_collection_id || null;
  let rows = selection.sources || [];
  if (!rows.length && fallback) {
    const collection = collections.get(fallback);
    if (!collection) return selection;
    rows = collection.entries.map(entry => ({source_collection_id:fallback, source_id:entry.id}));
  }
  rows = rows.map(original => {
    const row = clone(original);
    if (!row.source_collection_id) set(row, "source_collection_id", fallback);
    pairKey(row);
    return row;
  });
  set(selection, "sources", rows);
  delete selection.source_collection_id;
  return selection;
}

export function reconcileSources(value, catalogue) {
  const selection = normalizeSelectionSources(value, catalogue);
  const {collections, entries} = catalogueIndex(catalogue);
  const selected = [], missing = [], required_context = [], missing_collections = [];
  const pairs = new Set(), groups = new Map();
  if (!(selection.sources || []).length && selection.source_collection_id) {
    missing_collections.push({
      source_collection_id: selection.source_collection_id,
      reason: "The complete original collection is unavailable; its legacy all-source selection is retained."
    });
  }
  for (const original of selection.sources || []) {
    const row = clone(original), key = pairKey(row), found = entries.get(key);
    pairs.add(key);
    const result = {
      selection:row,
      collection:compactCollection(found?.collection || collections.get(row.source_collection_id),row.source_collection_id),
      entry:found ? clone(found.entry) : null,
      available:Boolean(found)
    };
    selected.push(result);
    if (!found) missing.push(result);
    if (found?.entry.gis_context_group) {
      if (!groups.has(row.source_collection_id)) groups.set(row.source_collection_id,new Set());
      groups.get(row.source_collection_id).add(found.entry.gis_context_group);
    }
  }
  // Match the original native request's one-pass, per-collection context expansion.
  for (const [cid, groupIds] of groups) {
    const collection = collections.get(cid);
    for (const entry of collection.entries) {
      const key = pairKey({source_collection_id:cid, source_id:entry.id});
      if (entry.gis_required_context && groupIds.has(entry.gis_context_group) && !pairs.has(key)) {
        required_context.push({
          source_collection_id:cid, source_id:entry.id,
          collection:compactCollection(collection,cid), entry:clone(entry)
        });
        pairs.add(key);
      }
    }
  }
  const spatial = entry => entry && (entry.kind === "vector" || entry.kind === "raster");
  const has_spatial_source = selected.some(row => spatial(row.entry)) ||
    required_context.some(row => spatial(row.entry));
  const has_other_spatial_selection = Boolean(
    selection.native_study || selection.run_revision || selection.delivery_id ||
    (selection.grid_id && selection.include_grid !== false) ||
    selection.baseline_run_id ||
    (Array.isArray(selection.scenario_run_ids) && selection.scenario_run_ids.length) ||
    (Array.isArray(selection.comparison_ids) && selection.comparison_ids.length)
  );
  return {
    selection, selected, missing, missing_collections, required_context,
    has_spatial_source, has_other_spatial_selection,
    can_submit_sources:missing.length === 0 && missing_collections.length === 0 &&
      (has_spatial_source || has_other_spatial_selection)
  };
}

/** Change only one collection; retained rows keep all native per-source fields. */
export function replaceCollectionSources(value, collectionId, selectedIds, catalogue) {
  identifier(collectionId, "Selected collection");
  if (!Array.isArray(selectedIds)) fail("Selected source identifiers must be an array.");
  const ids = selectedIds.map(id => identifier(id, "Selected original source"));
  if (new Set(ids).size !== ids.length) fail("Select each source in this collection once.");
  const selection = normalizeSelectionSources(value,catalogue);
  const {collections, entries} = catalogueIndex(catalogue);
  if (selection.source_collection_id && !(selection.sources || []).length) {
    fail("Reopen the retained whole collection before changing its explicit source selection.");
  }
  const oldRows = selection.sources || [];
  const prior = new Map(oldRows.filter(row => row.source_collection_id === collectionId).map(row => [row.source_id,row]));
  for (const id of ids) {
    if (!prior.has(id) && !entries.has(pairKey({source_collection_id:collectionId,source_id:id}))) {
      fail("The newly selected source is not in the original catalogue: " + id);
    }
  }
  if (!collections.has(collectionId) && !prior.size && ids.length) fail("The selected original collection is unavailable.");
  const wanted = new Set(ids), output = [], retained = new Set();
  let insertion = -1;
  for (const row of oldRows) {
    if (row.source_collection_id !== collectionId) { output.push(clone(row)); continue; }
    if (insertion < 0) insertion = output.length;
    const catalogueEntry = entries.get(pairKey(row))?.entry;
    // Missing originals and native required-context entries have no ordinary
    // checkbox. Only the explicit basket-removal action may discard them.
    if (wanted.has(row.source_id) || !catalogueEntry || catalogueEntry.gis_required_context) {
      output.push(clone(row));
      retained.add(row.source_id);
      insertion = output.length;
    }
  }
  const added = ids.filter(id => !retained.has(id)).map(id =>
    prior.has(id) ? clone(prior.get(id)) : {source_collection_id:collectionId,source_id:id});
  if (insertion < 0) insertion = output.length;
  output.splice(insertion,0,...added);
  set(selection,"sources",output);
  delete selection.source_collection_id;
  return selection;
}

/** Explicit basket removal of all retained layer variants for one original pair. */
export function removeSourcePair(value, collectionId, sourceId, catalogue) {
  const key = pairKey({source_collection_id:collectionId,source_id:sourceId});
  const selection = normalizeSelectionSources(value,catalogue);
  if (selection.source_collection_id && !(selection.sources || []).length) {
    fail("Reopen the retained whole collection before removing a particular source.");
  }
  set(selection,"sources",(selection.sources || []).filter(row => pairKey(row) !== key));
  delete selection.source_collection_id;
  return selection;
}

function descriptionRows(selection, catalogue) {
  const descriptions = new Map();
  for (const row of reconcileSources(selection,catalogue).selected) {
    const key = pairKey(row.selection);
    if (!descriptions.has(key)) descriptions.set(key,{
      source_collection_id:row.selection.source_collection_id,
      source_id:row.selection.source_id,
      collection:clone(row.collection),
      entry:row.entry ? clone(row.entry) : null
    });
  }
  return [...descriptions.values()];
}
export function validateWorking(value, options = {}) {
  const working = clone(record(value,"GIS working selection"));
  if (working.schema !== WORKING_SCHEMA) fail("Choose a complete GIS working-selection file.");
  identifier(working.project_id,"Original project");
  if (options.projectId !== undefined && working.project_id !== options.projectId) {
    fail("This GIS working selection belongs to a different original project.");
  }
  set(working,"selection",selectionValue(working.selection));
  const seen = new Set();
  for (const row of working.selection.sources || []) {
    const resolved = clone(row);
    if (!resolved.source_collection_id) set(resolved,"source_collection_id",working.selection.source_collection_id);
    const key = pairKey(resolved);
    seen.add(key);
  }
  if (working.active_source_collection_id !== null) identifier(working.active_source_collection_id,"Active source collection");
  if (!Array.isArray(working.source_descriptions)) fail("The working file must retain its source descriptions array.");
  const described = new Set();
  for (const row of working.source_descriptions) {
    record(row,"Source description");
    const key = pairKey(row);
    if (described.has(key)) fail("The working file repeats a source description.");
    described.add(key);
    if (!seen.has(key)) fail("A source description is outside the selected original source pairs.");
    record(row.collection,"Retained collection description");
    if (row.collection.id !== row.source_collection_id) fail("Retained collection description identity differs.");
    if (row.entry !== null) {
      record(row.entry,"Retained source description");
      if (row.entry.id !== row.source_id) fail("Retained source description identity differs.");
    }
  }
  if (!Array.isArray(working.import_history)) fail("The working file must retain its import history array.");
  if (utf8Length(JSON.stringify(working,null,2) + "\n") > WORK_BYTES) {
    fail("The complete GIS working file exceeds its 16 MiB capacity. Keep the original file and save a smaller explicit working selection.");
  }
  return working;
}
export function createWorking({projectId, selection, activeSourceCollectionId = null, catalogue, importHistory = [], sourceDescriptions = []}) {
  identifier(projectId,"Original project");
  if (catalogue.project_id !== undefined && catalogue.project_id !== projectId) fail("The GIS catalogue belongs to another original project.");
  const normal = normalizeSelectionSources(selection,catalogue);
  const old = new Map();
  for (const description of sourceDescriptions) {
    record(description,"Retained source description");
    const key = pairKey(description);
    if (old.has(key)) fail("Retained source descriptions repeat an original source pair.");
    old.set(key,clone(description));
  }
  const descriptions = descriptionRows(normal,catalogue).map(row => {
    const prior = old.get(pairKey(row));
    return row.entry ? row : (prior || row);
  });
  return validateWorking({
    schema:WORKING_SCHEMA, project_id:projectId, selection:normal,
    active_source_collection_id:activeSourceCollectionId,
    source_descriptions:descriptions, import_history:clone(importHistory)
  },{projectId});
}
/**
 * Opening a working file explicitly replaces the unsaved choices. Preserve the
 * entire displaced file as a history entry, including unknown source fields.
 * Reopening byte-equivalent parsed state is a no-op; task state stays elsewhere.
 */
export function importWorking(current, incoming, {projectId, at} = {}) {
  const next = validateWorking(incoming,{projectId});
  if (!current) return next;
  const previous = validateWorking(current,{projectId:next.project_id});
  if (stable(previous) === stable(next)) return previous;
  // Reopening the exact same incoming file after its first recorded import is
  // also a no-op: preserve the accumulated original history, not another copy.
  const previousBody = clone(previous), nextBody = clone(next);
  delete previousBody.import_history;
  delete nextBody.import_history;
  const lastImport = previous.import_history.at(-1);
  if (stable(previousBody) === stable(nextBody) &&
      lastImport?.kind === "replaced-working-selection" &&
      stable(previous.import_history.slice(0,-1)) === stable(next.import_history)) return previous;
  if (typeof at !== "string" || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(at) || !Number.isFinite(Date.parse(at))) {
    fail("Retain the actual timezone-qualified time when opening another GIS working file.");
  }
  next.import_history.push({kind:"replaced-working-selection",imported_at:at,previous});
  return validateWorking(next,{projectId:next.project_id});
}
function stable(value) {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(key => JSON.stringify(key)+":"+stable(value[key])).join(",") + "}";
  return JSON.stringify(value);
}
export function serializeWorking(value) {
  return JSON.stringify(validateWorking(value),null,2) + "\n";
}
