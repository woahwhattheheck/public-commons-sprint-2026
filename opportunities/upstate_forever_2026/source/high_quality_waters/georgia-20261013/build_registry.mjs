/** Reproduce Georgia's selected legal register from retained indexed PDF text.
 * The line index belongs to the retained extraction, not to the printed rule.
 * spans.json is the explicit reviewed column/paragraph selection; it is data.
 */
const BASE = {jurisdiction:'GA',classification_system:'GA-391-3-6-.03',
  primary_class:null,supplemental_classes:[],special_markers:[],
  previous_class:null,site_specific:null,no_discharge_zone:null,effective_date:null};
const clean = text => text.replace(/Chapter 391-3-6 Rules for Water Quality Control/g,'')
  .replace(/Adopted by GA DNR Board of Natural Resources[^\n]*/g,'')
  .replace(/Approved by US EPA Region IV[^\n]*/g,'').replace(/\s+/g,' ').trim();
const useComponents = {
  'Drinking Water':['Drinking Water'],'Recreation':['Recreation'],
  'Fishing':['Fishing'],'Coastal Fishing':['Coastal Fishing'],
  'Wild and Scenic':['Wild River','Scenic River'],
  'Recreation and Wild and Scenic':['Recreation','Wild River','Scenic River'],
  'Recreation and Drinking Water':['Recreation','Drinking Water']
};
export function buildGeorgiaRegistry(input, specification) {
  if(input.schema!=='upstate.indexed-original-pdf-text/v1' ||
     specification.schema!=='upstate.georgia-rule-selection/v1')throw Error('Unexpected original source schema');
  const lines=new Map(input.lines.map(row=>[row.line,row]));
  if(lines.size!==input.lines.length)throw Error('Duplicate indexed source line');
  const records=[],used=new Set(),covered=new Set();
  for(const span of specification.spans) {
    const selected=[];
    for(let n=span.start;n<=span.end;n++){
      if(!lines.has(n))throw Error('Missing original line '+n);
      selected.push(lines.get(n));
    }
    const source_text=selected.map(row=>row.text).join('\n'),joined=clean(source_text);
    const class_raw=span.class_raw;
    let record;
    if(span.role==='designated-use') {
      if(!Object.hasOwn(useComponents,class_raw))throw Error('Unrecognized original use label');
      if(!joined.startsWith(span.waterbody_name+' ') || !joined.endsWith(class_raw))
        throw Error('Column selection does not match original name and class at '+span.start);
      record={id:'ga-20220831-savannah-designated-use-L'+span.start,...BASE,
        waterbody_name:span.waterbody_name,county_codes:[],class_raw,class_code:class_raw,
        source_class_label:class_raw,class_components:useComponents[class_raw],
        classification_role:span.role,rfp_high_quality_candidate:/Wild|Scenic/.test(class_raw),
        reach_description:joined.slice(span.waterbody_name.length,-class_raw.length).trim(),
        river_basin:'SAVANNAH RIVER BASIN'};
    } else if(span.role==='trout-protection') {
      if(!['Primary','Secondary'].includes(class_raw)||!span.county)throw Error('Missing county trout role');
      const start=joined.match(/^(\d+)\.\s*/);
      if((span.ordinal!==null && (!start||Number(start[1])!==span.ordinal)) ||
         (span.ordinal===null && !joined.startsWith('All streams')))
        throw Error('Original trout ordinal mismatch at '+span.start);
      const description=start?joined.slice(start[0].length):joined;
      // A display label is not a legal reach identity. Automated name matching
      // is disabled for all these conditional county/watershed paragraphs.
      const name=description.split(/\s+watershed\b|\s+upstream\b|\s+downstream\b|\s+-\s+/i)[0].replace(/[.;]\s*$/,'').trim();
      record={id:'ga-20220831-trout-'+span.county.toLowerCase().replace(/\s+/g,'-')+'-'+class_raw.toLowerCase()+'-'+(span.ordinal??'all'),
        ...BASE,waterbody_name:name,
        waterbody_name_derivation:'Display name split from the complete original county rule; reach_description and source_text are authoritative.',
        county_codes:[span.county],class_raw,class_code:class_raw,source_class_label:class_raw,
        class_components:[class_raw==='Primary'?'Primary Trout Waters':'Secondary Trout Streams'],
        classification_role:span.role,rfp_high_quality_candidate:true,
        reach_description:description,original_ordinal:span.ordinal,allow_name_candidate:false};
      covered.add(span.start);
    } else throw Error('Unknown original clause role');
    if(used.has(record.id))throw Error('Duplicate source identity');used.add(record.id);
    records.push({...record,source_pdf_page:selected[0].page,source_printed_page:selected[0].page,
      source_line_start:span.start,source_line_end:span.end,source_text});
  }
  for(const row of input.lines.filter(row=>row.line>=1416&&row.line<=1834))
    if(/^\d+\.\s/.test(clean(row.text))&&!covered.has(row.line))
      throw Error('Unselected original county clause at '+row.line);
  if(records.filter(r=>r.classification_role==='designated-use').length!==30 ||
     records.filter(r=>r.classification_role==='trout-protection').length!==256 ||
     new Set(records.flatMap(r=>r.county_codes)).size!==31)
    throw Error('Original source cohort changed; review source selection');
  return {schema:'upstate.classified-water-registry/v2',edition:specification.edition,
    source_scope:specification.source_scope,interpretation:specification.interpretation,
    source_index:input.source_index,none_declarations:specification.none_declarations,
    policy_references:specification.policy_references,records};
}
