/** Original source explorer handoff; all source text stays byte-for-byte intact. */
export function createSourceReview({bank, config, receptorId, kind = 'utility',
  filters = {scope:'utility', state:'', search:''}, focusedHuc12 = null, discussion}) {
  const prefix = config.source_prefix;
  const original = name => {
    const value = bank.files[prefix + name];
    if (typeof value !== 'string') throw new Error('Original source member is missing: ' + name);
    return value;
  };
  const profile = JSON.parse(original('utility-focus-profile.json'));
  const area = JSON.parse(original('utility-topology-results.json')).areas.find(row => row.id === receptorId);
  if (!area || !profile.receptors.some(row => row.id === receptorId)) throw new Error('Choose the original utility.');
  const domain = new Set(JSON.parse(original('domain-huc12s.json')));
  const records = JSON.parse(original('usgs-wbd-savannah-original-topology-20261013.json')).features.map(row => row.attributes);
  if (!['utility','domain'].includes(filters.scope) || !['','SC','NC','GA'].includes(filters.state) ||
      typeof filters.search !== 'string' || filters.search.length > 1000) throw new Error('Retain the source view filters.');
  const utility = area.members.map(row => row.huc12).sort();
  const eligible = new Set(filters.scope === 'domain' ? [...domain] : utility);
  const needle = filters.search.trim().toLowerCase();
  const visible = records.filter(row => eligible.has(row.huc12) &&
    (!filters.state || row.states.split(',').map(value => value.trim()).includes(filters.state)) &&
    (!needle || [row.huc12,row.name,row.tohuc].join(' ').toLowerCase().includes(needle))).map(row => row.huc12).sort();
  let huc12s;
  if (kind === 'utility') huc12s = utility;
  else if (kind === 'visible') huc12s = visible;
  else if (kind === 'focused' && visible.includes(focusedHuc12)) huc12s = [focusedHuc12];
  else throw new Error('Choose the full utility, visible watersheds or the focused watershed.');
  if (!huc12s.length) throw new Error('No original watersheds match this selection. Clear the filters or choose the full utility.');
  const fields = ['project','reviewer','geography','sourceareas','modelchoices','alternatives','receiving','firstresult'];
  if (!discussion || fields.some(key => typeof discussion[key] !== 'string' || discussion[key].length > 20000))
    throw new Error('Discussion fields must be text of at most 20000 characters.');
  return {
    schema:'upstate.watershed-source-review/v1',
    source_bank_sha256:config.source_bank_sha256,
    selection:{kind,receptor_id:receptorId,huc12s,focused_huc12:focusedHuc12,
      filters:{scope:filters.scope,state:filters.state,search:filters.search}},
    discussion:Object.fromEntries(fields.map(key => [key,discussion[key]])),
    sources:Object.fromEntries(['utility-focus-profile.json',
      'usgs-wbd-savannah-original-topology-20261013.json','domain-huc12s.json'].map(name => [name,original(name)]))
  };
}

/** Reopen a review without replacing its original source text or geographic identity. */
export function reopenSourceReview({text, bank, config}) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > 256 * 1024)
    throw new Error('Choose the downloaded source review JSON, up to 256 KiB.');
  const review = JSON.parse(text);
  if (!review || review.schema !== 'upstate.watershed-source-review/v1' ||
      !/^[0-9a-f]{64}$/.test(review.source_bank_sha256 || ''))
    throw new Error('Choose an original watershed source review.');
  const selection = review.selection;
  if (!selection || !['utility','visible','focused'].includes(selection.kind) || !Array.isArray(selection.huc12s) || !selection.huc12s.length ||
      selection.huc12s.some(id => typeof id !== 'string' || !/^\d{12}$/.test(id)) ||
      new Set(selection.huc12s).size !== selection.huc12s.length)
    throw new Error('The review must retain distinct original HUC12 identifiers.');
  const names = ['utility-focus-profile.json',
    'usgs-wbd-savannah-original-topology-20261013.json','domain-huc12s.json'];
  if (!review.sources || names.some(name => typeof review.sources[name] !== 'string'))
    throw new Error('The review is missing its original profile, topology or domain text.');
  const fields = ['project','reviewer','geography','sourceareas','modelchoices','alternatives','receiving','firstresult'];
  if (!review.discussion || fields.some(key => typeof review.discussion[key] !== 'string' ||
      review.discussion[key].length > 20000))
    throw new Error('Retain the eight original discussion text fields.');
  const changed = names.filter(name => review.sources[name] !== bank.files[config.source_prefix + name]);
  const differentBank = review.source_bank_sha256 !== config.source_bank_sha256;
  if (changed.length || differentBank) {
    // Keep a different original edition readable without silently combining it
    // with the current explorer's derived area, paths or summary report.
    const original = JSON.parse(review.sources['usgs-wbd-savannah-original-topology-20261013.json']);
    const records = new Map((original.features || []).map(feature => {
      const row = feature.attributes;
      if (!row || !/^\d{12}$/.test(row.huc12)) throw new Error('An original topology record has no HUC12 identity.');
      return [row.huc12,row];
    }));
    const rows = selection.huc12s.map(id => {
      if (!records.has(id)) throw new Error('Selected HUC12 ' + id + ' is absent from the retained original topology.');
      return records.get(id);
    });
    return {status:'retained_edition', review, text, rows, changed_members:changed,
      source_bank_changed:differentBank,
      message:'Opened the retained source edition. ' +
        (changed.length ? 'Different original members: ' + changed.join(', ') + '. ' : '') +
        (differentBank ? 'The source-bank identity differs from this explorer. ' : '') +
        'Its original selection and discussion are shown below. Open its matching retained explorer to amend that edition, or return to the current source view for a new review.'};
  }
  const expected = createSourceReview({bank,config,receptorId:selection.receptor_id,
    kind:selection.kind,filters:selection.filters,focusedHuc12:selection.focused_huc12,
    discussion:review.discussion});
  if (selection.huc12s.slice().sort().join('|') !== expected.selection.huc12s.join('|'))
    throw new Error('The review membership differs from its original utility, filters or focused watershed.');
  if (selection.focused_huc12 !== null && (typeof selection.focused_huc12 !== 'string' ||
      !/^\d{12}$/.test(selection.focused_huc12)))
    throw new Error('Retain the original focused HUC12 or an empty focus.');
  return {status:'current_edition',review:expected,text,changed_members:[],source_bank_changed:false,
    message:'Reopened ' + expected.selection.huc12s.length +
      ' original watersheds and their discussion. Amend the fields, then download a new review.'};
}
