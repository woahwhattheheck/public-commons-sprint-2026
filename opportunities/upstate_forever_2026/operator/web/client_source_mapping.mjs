/** Reusable original-column choices for the maintained scientific source intake. */
const fields = ['lucode','load_n','load_p','load_type_n','load_type_p','eff_n','eff_p',
  'crit_len_n','crit_len_p','proportion_subsurface_n','usle_c','usle_p'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (value, message) => { if (!value) throw Error(message); };
const key = /^[0-9a-f]{64}$/;
const canonical = value => Array.isArray(value) ? '['+value.map(canonical).join(',')+']' :
  object(value) ? '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}' : JSON.stringify(value);
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode(canonical(value))))].map(x=>x.toString(16).padStart(2,'0')).join('');

function originalFields(part) {
  need(part?.kind === 'table' && !part.error && Array.isArray(part.fields), 'Choose a readable original table.');
  const seen = new Set();
  return part.fields.map(field => {
    need(object(field) && typeof field.id === 'string' && field.id.length > 0 &&
      typeof field.label === 'string' && !seen.has(field.id), 'The original table column identities are invalid.');
    seen.add(field.id);
    return {id:field.id, label:field.label};
  });
}

export function validateMappingTemplate(value) {
  need(object(value) && value.schema === 'upstate.column-mapping/v1' && key.test(value.id),
    'Choose a complete saved column mapping.');
  need(typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 160,
    'Give this column mapping a name of up to 160 characters.');
  need(typeof value.created_at === 'string' && Number.isFinite(Date.parse(value.created_at)),
    'The saved column mapping date is missing.');
  const source = value.source;
  need(object(source) && key.test(source.inspection_id) && key.test(source.sha256) &&
    typeof source.filename === 'string' && source.filename.length > 0 &&
    typeof source.part_name === 'string' && Number.isSafeInteger(source.file_index) && source.file_index >= 0 &&
    Number.isSafeInteger(source.part_index) && source.part_index >= 0,
    'The saved mapping needs its original file and inspection identity.');
  const columns = originalFields({kind:'table', fields:value.columns});
  const ids = new Set(columns.map(field=>field.id));
  need(object(value.mapping) && Object.keys(value.mapping).length > 0 &&
    Object.entries(value.mapping).every(([name,column])=>fields.includes(name) && typeof column === 'string' && ids.has(column)),
    'A saved parameter choice is missing from its original columns.');
  need(Array.isArray(value.models) && value.models.length > 0 && new Set(value.models).size === value.models.length &&
    value.models.every(model=>['ndr','sdr'].includes(model)), 'The original mapping model selection is invalid.');
  return value;
}

export function validateMappingLibrary(values) {
  need(Array.isArray(values), 'The complete saved column mapping list is missing.');
  const seen = new Set();
  for (const value of values) {
    validateMappingTemplate(value);
    need(!seen.has(value.id), 'A saved column mapping identity is repeated.');
    seen.add(value.id);
  }
  return values;
}

export async function createMappingTemplate({name, choice, part, file, inspection}) {
  need(choice?.role === 'BIOPHYSICAL', 'Choose Native biophysical parameters before saving a column mapping.');
  need(inspection?.action === 'client-source.inspect' && inspection.state === 'complete' &&
    inspection.files?.[choice.file_index] === file && file.inspection?.parts?.[choice.part_index] === part,
    'Open the original completed inspection before saving its column mapping.');
  const body = {
    schema:'upstate.column-mapping/v1', name:String(name).trim(), created_at:new Date().toISOString(),
    source:{inspection_id:inspection.id, sha256:file.original.sha256, filename:file.filename,
      part_name:part.name, file_index:choice.file_index, part_index:choice.part_index},
    columns:originalFields(part), mapping:{...choice.mapping}, models:[...choice.models]
  };
  const value = {...body, id:await digest(body)};
  validateMappingTemplate(value);
  return value;
}

export async function verifyMappingTemplate(value) {
  validateMappingTemplate(value);
  const {id,...body} = value;
  need(await digest(body) === id, 'This saved column mapping differs from its retained identity. Keep its original working file and save a new mapping from the inspected source.');
  return value;
}

/** Match exact original labels, never positional IDs or normalized guesses. */
export function previewMappingTemplate(template, part, required = []) {
  validateMappingTemplate(template);
  const target = originalFields(part), original = template.columns;
  const byLabel = columns => {
    const result = new Map();
    for (const column of columns) {
      if (!result.has(column.label)) result.set(column.label, []);
      result.get(column.label).push(column);
    }
    return result;
  };
  const sourceLabels = byLabel(original), targetLabels = byLabel(target);
  const sourceIds = new Map(original.map(column=>[column.id,column]));
  const mapping = {}, rows = [];
  for (const name of fields.filter(field=>Object.hasOwn(template.mapping,field))) {
    const source = sourceIds.get(template.mapping[name]), matches = targetLabels.get(source.label) || [];
    let status = 'matched';
    if (!source.label.trim()) status = 'blank-original-header';
    else if (sourceLabels.get(source.label).length > 1) status = 'ambiguous-original-header';
    else if (!matches.length) status = 'missing-header';
    else if (matches.length > 1) status = 'ambiguous-current-header';
    if (status === 'matched') mapping[name] = matches[0].id;
    rows.push({parameter:name, original_column:source.id, label:source.label, status,
      current_column:status === 'matched' ? matches[0].id : null, candidates:matches.length});
  }
  return {mapping, rows, matched:Object.keys(mapping).length,
    unresolved:rows.filter(row=>row.status !== 'matched'),
    missing_required:required.filter(name=>!Object.hasOwn(mapping,name))};
}

export function applyMappingTemplate(choice, template, part, required = []) {
  need(choice?.role === 'BIOPHYSICAL', 'Choose Native biophysical parameters before reusing a column mapping.');
  const preview = previewMappingTemplate(template,part,required);
  need(preview.matched > 0, 'No unambiguous original headers match this file. Choose its columns manually.');
  // Replace the complete mapping so omitted/ambiguous columns cannot inherit old choices.
  // All source-specific scientific choices, including units and model scope, stay current.
  return {choice:{...choice, mapping:{...preview.mapping}, confirmed:false}, preview};
}
