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
