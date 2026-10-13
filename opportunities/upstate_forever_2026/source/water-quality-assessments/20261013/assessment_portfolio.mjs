/** Original South Carolina assessment portfolios. No acquisition or regulatory reclassification. */
export const VERSION = '2026-10-13.1';
export const SCHEMA = 'upstate.sc-assessment-portfolio/v1';
export const SOURCE_ID = 'sc-assessment-portfolio-20261013';
const eq = (a,b) => JSON.stringify(a)===JSON.stringify(b);
const invariant = (condition,message) => { if(!condition) throw new Error(message); };
const unique = values => [...new Set(values)].sort();
const count = (rows,key) => Object.fromEntries(unique(rows.map(r=>r[key]??'')).map(value=>[value,rows.filter(r=>(r[key]??'')===value).length]));
const ref = r => ({source_id:r.source_id,id:r.id,site:r.site,huc12:r.huc12,source_row:r.source_row,source_page:r.source_page,source_line_start:r.source_line_start??null,source_line_end:r.source_line_end??null});
const key = r => JSON.stringify([r.site,r.use,r.cause_raw]);
const recordKey = r => JSON.stringify([r.source_id,r.id]);
const ecoli = rows => rows.filter(r=>r.cause_raw==='ECOLI');
const pairs = (a,b,match) => a.flatMap(x=>b.filter(y=>match(x,y)).map(y=>({left:ref(x),right:ref(y),left_use:x.use,right_use:y.use,left_cause:x.cause_raw,right_cause:y.cause_raw,left_status:x.use_support,right_status:y.use_support,approval_date:y.approval_date,tmdl_report:y.tmdl_report})));
function portfolio(rows) {
  return {record_count:rows.length,station_count:unique(rows.map(r=>r.site)).length,publisher_huc_count:unique(rows.map(r=>r.huc12)).length,
    original_use_counts:count(rows,'use'),original_cause_counts:count(rows,'cause_raw'),use_support_counts:count(rows,'use_support'),
    ecoli_record_count:ecoli(rows).length,ecoli_station_count:unique(ecoli(rows).map(r=>r.site)).length};
}
function compare(a,b) {
  const ea=ecoli(a),eb=ecoli(b);
  const sites=unique(a.map(r=>r.site)).filter(site=>b.some(r=>r.site===site));
  const exact=pairs(a,b,(x,y)=>key(x)===key(y));
  return {left:portfolio(a),right:portfolio(b),
    shared_station_count:sites.length,
    shared_stations:sites.map(site=>({site,left_records:a.filter(r=>r.site===site).map(ref),right_records:b.filter(r=>r.site===site).map(ref),
      left_causes:unique(a.filter(r=>r.site===site).map(r=>r.cause_raw)),right_causes:unique(b.filter(r=>r.site===site).map(r=>r.cause_raw)),
      left_uses:unique(a.filter(r=>r.site===site).map(r=>r.use)),right_uses:unique(b.filter(r=>r.site===site).map(r=>r.use))})),
    exact_original_site_use_cause_pairs:exact,
    ecoli_exact_site_use_cause_pairs:pairs(ea,eb,(x,y)=>key(x)===key(y)),
    ecoli_same_site_pairs:pairs(ea,eb,(x,y)=>x.site===y.site),
    different_cause_station_pairs:pairs(a,b,(x,y)=>x.site===y.site&&x.cause_raw!==y.cause_raw)};
}
export function analyze(input) {
  const listed=input['inputs/303d-2024-pdf-table-normalized.json'],tmdl=input['inputs/tmdl-attainment-native-20260728.json'];
  const text=input['inputs/303d-2024-publisher-pdf-table-text.json'],domain=input['inputs/domain-huc12s.json'],boundary=input['source-selection-boundary.json'];
  invariant(listed?.schema==='upstate.water-quality-assessments/v1'&&tmdl?.schema===listed.schema,'Expected complete original normalized assessment editions');
  for(const bank of [listed,tmdl]){
    invariant(bank.complete===true&&bank.unparsed_rows.length===0&&bank.row_count===bank.records.length,'Incomplete original assessment bank');
    invariant(new Set(bank.records.map(recordKey)).size===bank.records.length,'Duplicate original source record identity');
    invariant(new Set(bank.records.map(key)).size===bank.records.length,'Duplicate original site/use/cause key: do not collapse records');
    for(const r of bank.records) invariant(r.source_id===bank.source.source_id&&r.source_sha256===bank.source.source_sha256&&r.site&&r.use&&r.cause_raw&&/^\d{12}$/.test(r.huc12)&&Number.isInteger(r.source_page)&&r.source_page>0,'Missing original record identity or publisher geography');
  }
  invariant(listed.source.evidence_kind==='303d_listing'&&listed.source.source_vintage==='2024'&&listed.source.assessment_period==='2018-2022','Wrong original listing edition');
  invariant(tmdl.source.evidence_kind==='tmdl_attainment'&&tmdl.source.status_date==='2026-07-28','Wrong original TMDL status edition');
  invariant(text.schema==='upstate.publisher-pdf-table-text/v1'&&text.rows.length===listed.source_assessment_row_count,'Original PDF table row inventory differs');
  for(const r of listed.records){
    const row=text.rows[r.source_row-1];
    invariant(row&&row.site===r.site&&row.huc12===r.huc12&&row.use===r.use&&row.cause_source_cell===r.cause_source_cell&&row.codes.includes(r.cause_code)&&row.source_page===r.source_page&&row.source_line_start===r.source_line_start&&row.source_line_end===r.source_line_end&&row.source_row_text===r.source_row_text,'Original PDF table reference differs: '+r.id);
  }
  invariant(Array.isArray(domain)&&domain.length===217&&new Set(domain).size===217&&domain.every(x=>/^\d{12}$/.test(x)),'Expected original 217 distinct publisher-HUC identifiers');
  const D=new Set(domain),a=listed.records.filter(r=>D.has(r.huc12)),b=tmdl.records.filter(r=>D.has(r.huc12));
  const all=[...listed.records,...tmdl.records],regional=[...a,...b],stations=new Set(regional.map(r=>r.site));
  const stationRows=all.filter(r=>stations.has(r.site)),outside=stationRows.filter(r=>!D.has(r.huc12));
  invariant(boundary.schema==='upstate.assessment-source-selection/v1','Wrong retained boundary schema');
  invariant(eq(unique(boundary.domain_huc12s),unique(domain))&&eq(unique(boundary.selected_station_ids),[...stations].sort()),'Retained domain/station selection differs');
  invariant(eq(boundary.selected_domain_assessment_ids.map(recordKey).sort(),regional.map(recordKey).sort())&&eq(boundary.matching_station_assessment_ids.map(recordKey).sort(),stationRows.map(recordKey).sort()),'Retained original assessment membership differs');
  invariant(boundary.selected_domain_record_count===regional.length&&boundary.matching_station_record_count===stationRows.length,'Retained boundary counts differ');
  const reportGroups=unique(b.map(r=>r.tmdl_report)).map(report=>{const rows=b.filter(r=>r.tmdl_report===report);return{
    report,approval_dates:unique(rows.map(r=>r.approval_date)),station_count:unique(rows.map(r=>r.site)).length,
    record_count:rows.length,use_support_counts:count(rows,'use_support'),relation_counts:count(rows,'tmdl_relation'),
    cause_counts:count(rows,'cause_raw'),records:rows.map(ref),original_report_marker:report.includes('†')?'†':null};});
  const domainComparison=compare(a,b),stationComparison=compare(stationRows.filter(r=>r.evidence_kind==='303d_listing'),stationRows.filter(r=>r.evidence_kind==='tmdl_attainment'));
  const stateEcoli=compare(ecoli(listed.records),ecoli(tmdl.records));
  return {schema:SCHEMA,edition:VERSION,
    scope:{selection:'Original publisher HUC membership in the retained 217-HUC list; exact selected-station identity shown separately',domain_huc12s:domain,
      geometry_used:false,station_coordinates_used:false,source_geography_overridden:false,regulatory_status_reclassified:false},
    methods:{record_key:['source_id','id'],comparison_key:['site','use','cause_raw'],use_rule:'Exact complete original use field, including any combined-use string; never allocate causes to a use by inference.',
      cause_rule:'Original cause spelling only. E. coli comparison requires ECOLI in both editions. Other statewide cause aliases are not harmonized.',
      station_rule:'Exact original site identifier; no punctuation removal, name matching, nearest station or coordinate substitution.',
      relationship_rule:'InTMDL and WnTMDL retained as separate publisher categories; neither specifies an implemented intervention date.',
      status_rule:'Present support is cause/use-specific. Fully Supported is not a claim about every pollutant, every use or the whole catchment.',
      time_rule:'Listing assessment window, publication vintage, status date and historical TMDL approval dates remain separate. No trend or causal effect is calculated.'},
    source_editions:[listed.source,tmdl.source],
    statewide:{listed:portfolio(listed.records),tmdl:portfolio(tmdl.records),ecoli_comparison:stateEcoli},
    regional:{record_count:regional.length,station_count:stations.size,comparison:domainComparison,tmdl_report_groups:reportGroups,
      tmdl_relation_counts:count(b,'tmdl_relation'),tmdl_use_support_counts:count(b,'use_support'),
      fully_supported_tmdl_records:b.filter(r=>r.use_support==='fully_supported').map(ref)},
    station_identity_sensitivity:{record_count:stationRows.length,station_count:stations.size,comparison:stationComparison,
      additional_outside_publisher_domain_records:outside.map(ref),
      explanation:'Only an exact station-identity alternative. Additional records do not acquire domain geometry, and their original publisher HUCs remain unchanged.'},
    original_record_index:stationRows,
    summary:{original_statewide_records:all.length,regional_records:regional.length,regional_stations:stations.size,
      listed_regional_records:a.length,tmdl_regional_records:b.length,listed_regional_ecoli:ecoli(a).length,tmdl_regional_ecoli:ecoli(b).length,
      regional_shared_stations:domainComparison.shared_station_count,regional_same_key_pairs:domainComparison.exact_original_site_use_cause_pairs.length,
      regional_ecoli_same_site_pairs:domainComparison.ecoli_same_site_pairs.length,regional_cross_cause_pairs:domainComparison.different_cause_station_pairs.length,
      tmdl_not_supported:b.filter(r=>r.use_support==='not_supported').length,tmdl_fully_supported:b.filter(r=>r.use_support==='fully_supported').length,
      original_tmdl_report_groups:reportGroups.length,station_identity_records:stationRows.length,station_identity_additional_records:outside.length,
      statewide_ecoli_same_key_pairs:stateEcoli.ecoli_exact_site_use_cause_pairs.length},
    interpretation:[
      'The two publications describe different assessment portfolios. The selected-domain E. coli counts cannot be interpreted as a change in the number of impaired sites through time.',
      'A shared station identifier does not establish a matched cause or use. Every shared-station cause pair and its original source row remain inspectable.',
      'Approved TMDL coverage, present use support and implementation effectiveness answer different questions. This chapter calculates no intervention benefit or modeled load.',
      'Absence from either source is unobserved in that portfolio; it is never assigned Fully Supported.',
      'The regional selection uses original assessment-publisher HUC identifiers. Station-based alternative membership is reported separately, without altering spatial joins.',
      'The 2026 draft impairment list is not part of this comparison. A July 2026 TMDL status date does not make that table a 2026 impairment-list edition.'
    ]};
}

export const INPUTS = [
  {
    "path": "inputs/303d-2024-pdf-table-normalized.json",
    "bytes": 2674649,
    "sha256": "69e6894001fdcfa0130d8be532a31655eda22486a4044079665e8ee614eb5b0c"
  },
  {
    "path": "inputs/tmdl-attainment-native-20260728.json",
    "bytes": 1260570,
    "sha256": "cceaf00eb0fc4cc85eabb67fbd2a9b5d843bb0cc0c7ab8da54d2108f025c2522"
  },
  {
    "path": "inputs/303d-2024-publisher-pdf-table-text.json",
    "bytes": 688155,
    "sha256": "9be7679b79ca2a8a4d4d21227ad57371b88fd6082e8b29c7efc6d9a18ab0edce"
  },
  {
    "path": "inputs/domain-huc12s.json",
    "bytes": 3257,
    "sha256": "a8e83c835b97440f21077fd09d41dcd48d3b07711f371bb839f9c483ecca314f"
  },
  {
    "path": "source-selection-boundary.json",
    "bytes": 76385,
    "sha256": "7919f53f75718c5d627c93353295000186c16942ccaf81b1953e78aef57dfdae"
  },
  {
    "path": "sources.json",
    "bytes": 2155,
    "sha256": "353b4fac9e1f2cecd694aef14a0e41ab468c75bbe6cd13fb7b7d2ed4ef0dc60f"
  }
];

const jtext=value=>JSON.stringify(value,null,2)+'\n';
const table=(columns,rows,caption)=>({kind:'table',columns,rows,...(caption?{caption}:{})});
const link=(title,path)=>({title,path});
function sourceLocation(r){return 'p. '+r.source_page+', row '+r.source_row+(r.source_line_start?' · lines '+r.source_line_start+'–'+r.source_line_end:'')+' · '+r.id;}
export function chapter(result,inventory){
 const c=result.regional.comparison,a=c.left,b=c.right,s=result.summary;
 const byId=new Map(result.original_record_index.map(r=>[recordKey(r),r]));
 const original=r=>byId.get(recordKey(r));
 const sections=[
 ['What the two South Carolina portfolios answer',[
  'The 2024 impairment list identifies listed causes using the stated 2018–2022 assessment window. The approved-TMDL table records cause-specific use support as of July 28, 2026. These are different administrative portfolios, not two measurements of the same regional cohort.',
  table(['Original source','Selected cause records / stations','E. coli records','Time reference'],[
   ['Published 2024 impairment list',a.record_count+' / '+a.station_count,a.ecoli_record_count,'Assessment window 2018–2022; publication 2024'],
   ['Approved-TMDL use-support table',b.record_count+' / '+b.station_count,b.ecoli_record_count,'Status July 28, 2026; assessment window not supplied in the retained bank']
  ]),
  'The selected-domain E. coli station sets do not overlap. A difference between 21 and 84 therefore does not measure worsening, improvement, delisting success or an intervention effect.',
  'SCDES explains that approved-TMDL coverage can remove a cause from the impairment list even when the water remains impaired. This explains why a listed-cause inventory and a TMDL-support inventory require separate interpretation. The original source links and publication fields are retained below.',
  table(['Matching question','Result'],[
   ['Any cause at the same exact station in both sources',s.regional_shared_stations+' stations'],
   ['Same exact station, complete original use field and cause',s.regional_same_key_pairs+' pairs'],
   ['E. coli at the same exact station, even without requiring an exact use field',s.regional_ecoli_same_site_pairs+' pairs'],
   ['Same-station pairs with different causes',s.regional_cross_cause_pairs+' pairs'],
   ['Combined selected-domain inventory',s.regional_records+' cause records at '+s.regional_stations+' stations']
  ])
 ]],
 ['Present E. coli support within approved TMDL coverage',[
  table(['Original support / relationship','Records'],[
   ['Not Supported — E. coli / recreation',s.tmdl_not_supported],
   ['Fully Supported — E. coli / recreation',s.tmdl_fully_supported],
   ['InTMDL — original approved-TMDL site',result.regional.tmdl_relation_counts.InTMDL||0],
   ['WnTMDL — later-impaired site covered by an approved TMDL',result.regional.tmdl_relation_counts.WnTMDL||0]
  ],'Support and TMDL relationship are separate classifications; the rows in this table are not additive.'),
  'The publisher distinguishes sites included in the original TMDL effort from later-impaired sites covered by it. Neither category supplies an intervention implementation date. Fully Supported applies to the stated use and pollutant; it does not certify every pollutant or the entire catchment.',
  table(['Fully Supported site','Publisher HUC12','Original TMDL / approval date','Original record'],result.regional.fully_supported_tmdl_records.map(r=>{const x=original(r);return[x.site,x.huc12,x.tmdl_report+' · '+x.approval_date,sourceLocation(x)];})),
  'These five records are retained positive status findings. The source does not by itself identify which actions caused their status, when attainment began, or whether a comparable earlier observation exists.'
 ]],
 ['Same station, different listed cause',[
  'Every shared station is shown below. The 2024 original use field can contain more than one use; the producer preserves the complete field and does not infer a cause-to-use allocation. SV-268 contributes three cause pairs, so 19 stations produce 21 different-cause pairs.',
  table(['Station','2024 listed causes / original use','July 2026 E. coli support / relationship','Original pages; publisher HUCs'],c.shared_stations.map(x=>{
   const left=x.left_records.map(original),right=x.right_records.map(original),r=right[0];
   return [x.site,unique(left.map(v=>v.cause_raw+' / '+v.use)).join('; '),r.use_support_raw+' / '+r.tmdl_relation,
    '2024: '+unique(left.map(v=>v.source_page)).join(', ')+', HUC '+unique(left.map(v=>v.huc12)).join(', ')+'; 2026: '+r.source_page+', HUC '+r.huc12];
  })),
  'Station co-occurrence is useful for organizing a review, but these rows are not matched pollutant outcomes. For example, an E. coli status does not resolve a biological, pH, nutrient, metals or turbidity listing at the same station.',
  {kind:'links',items:[link('All 21 source-to-source cause pairs, with original IDs and locators','assessment-portfolio-matches.csv')]}
 ]],
 ['Original listed causes and the 21 E. coli entries',[
  table(['Original 2024 cause code','Publisher-normalized label','Selected cause records'],Object.entries(a.original_cause_counts).map(([cause,n])=>[cause,unique(result.original_record_index.filter(r=>r.evidence_kind==='303d_listing'&&r.cause_raw===cause).map(r=>r.cause_label)).join('; '),n])),
  'These are counts of cause records, not summed river length, catchment area, sample count or distinct water bodies.',
  table(['Listed E. coli site','Publisher HUC12','Original use / county','Original 2024 locator'],result.original_record_index.filter(r=>r.evidence_kind==='303d_listing'&&r.cause_raw==='ECOLI').map(r=>[r.site,r.huc12,r.use+' / '+r.county,sourceLocation(r)]))
 ]],
 ['Approved-TMDL report groups and historical bacteria indicators',[
  'The following groups use the exact original report string, including its dagger marker. Multiple original approval dates are displayed together rather than silently corrected.',
  table(['Original report','Records: not / fully supported','Relationship: original / later-impaired','Original approval date(s)'],result.regional.tmdl_report_groups.map(x=>[
   x.report,(x.use_support_counts.not_supported||0)+' / '+(x.use_support_counts.fully_supported||0),
   (x.relation_counts.InTMDL||0)+' / '+(x.relation_counts.WnTMDL||0),x.approval_dates.join('; ')
  ])),
  'The publisher’s dagger identifies TMDLs originally written for fecal coliform. Its note states that South Carolina changed the freshwater pathogen indicator to E. coli in 2013. Historical fecal-coliform TMDL labels and current E. coli status therefore remain separately recorded; concentrations, targets and reductions are not converted between indicators here.',
  table(['Retained report marker','Selected records'],[
    ['Dagger-marked original report',result.regional.tmdl_report_groups.filter(x=>x.original_report_marker).reduce((n,x)=>n+x.record_count,0)],
    ['No dagger in the retained report string',result.regional.tmdl_report_groups.filter(x=>!x.original_report_marker).reduce((n,x)=>n+x.record_count,0)]
  ])
 ]],
 ['Publisher-HUC membership and exact station identity',[
  'The main chapter uses each record’s original publisher HUC12 against the retained 217-HUC list. A separate exact-station selection includes all records for those same 159 station IDs. It adds one record without changing any source HUC or spatial association.',
  table(['Selection definition','Records','TMDL E. coli records','Shared stations','Exact original station/use/cause pairs'],[
   ['Original publisher-HUC membership',s.regional_records,b.ecoli_record_count,c.shared_station_count,c.exact_original_site_use_cause_pairs.length],
   ['Exact identity of the selected stations',result.station_identity_sensitivity.record_count,result.station_identity_sensitivity.comparison.right.ecoli_record_count,result.station_identity_sensitivity.comparison.shared_station_count,result.station_identity_sensitivity.comparison.exact_original_site_use_cause_pairs.length]
  ]),
  ...result.station_identity_sensitivity.additional_outside_publisher_domain_records.map(r=>{const x=original(r),listed=result.original_record_index.filter(v=>v.site===x.site&&v.evidence_kind==='303d_listing');return table(['Original site','2024 publisher-HUC / cause','2026 publisher-HUC / cause','Interpretation'],[[x.site,listed.map(v=>v.huc12+' / '+v.cause_raw).join('; '),x.huc12+' / '+x.cause_raw,'Exact station identity adds the original TMDL record; no HUC is reassigned.']]);}),
  'This is a selection-scope sensitivity, not a coordinate correction. The chapter does not choose between publisher geography and independently derived station or catchment geometry. Those distinct original bindings remain with the existing spatial products.'
 ]],
 ['Two statewide matched E. coli examples, outside this regional selection',[
  'The full statewide banks contain two exact E. coli station/use/cause matches. They are shown to make the matching method transparent, not added to the regional counts.',
  table(['Station / HUC','2024 → July 2026 status','Original TMDL / approval','Original source pages'],result.statewide.ecoli_comparison.ecoli_exact_site_use_cause_pairs.map(p=>[
   p.left.site+' / '+p.left.huc12,p.left_status+' → '+p.right_status,p.tmdl_report+' / '+p.approval_date,'2024 p. '+p.left.source_page+'; 2026 p. '+p.right.source_page
  ])),
  'Both examples retain Not Supported in the respective sources. The historical approval date does not supply a treatment date, and two records do not establish a regional response rate.'
 ]],
 ['How to use the chapter with monitoring and native annual results',[
  'Use the two portfolios to assemble cause-specific review questions: which original listed causes need attention, which approved-TMDL sites remain unsupported, and which presently supported sites merit continued observation. Keep the source’s original status and date visible.',
  'For a same-site observational comparison, first verify the actual parameter, unit, sampling dates, analytical support and calendar coverage in the measurement sources. Administrative cause status is not a replacement for those observations.',
  'Native annual nutrient or sediment outputs describe their selected model domain, period and units. This chapter supplies administrative receiving-water context; it does not validate modeled annual loads, assign annual E. coli loads or monetize restoration benefits.',
  'A future intervention evaluation needs an explicit implemented action and date, comparable before/after measurements and any chosen reference-site assumptions. None is inferred from a TMDL approval date or absence from the listing.',
  'The July 2026 status table is a published approved-TMDL source. The separate draft 2026 impairment list is excluded from these calculations.'
 ]],
 ['Original sources, full records and repeatable producer',[
  {kind:'links',items:[
   link('Complete chapter data, source keys and all 193 station-selected original records','assessment-portfolio.json'),
   link('Selected records with publisher-HUC and station-identity membership','assessment-portfolio-records.csv'),
   link('All shared-station different-cause pairs and the two separate statewide matches','assessment-portfolio-matches.csv'),
   link('Complete original 2024 normalized statewide bank','inputs/303d-2024-pdf-table-normalized.json'),
   link('Original 2024 PDF-table representation and row locators','inputs/303d-2024-publisher-pdf-table-text.json'),
   link('Complete original July 2026 native TMDL bank','inputs/tmdl-attainment-native-20260728.json'),
   link('Original domain and station selection boundary','source-selection-boundary.json'),
   link('Repeatable producer','assessment_portfolio.mjs'),link('Method and existing report continuation','ASSESSMENT_PORTFOLIO.md')
  ]},
  'The 2024 source SHA identifies the retained publisher-table representation; it is not represented as a PDF binary hash. The July 2026 bank retains its original document hash separately from the normalized file hash. Every input body is checked before generation, and every 2024 cause record is checked against its original table row.'
 ]]
 ];
 return {schema:'upstate.observed-report/v1',edition:SCHEMA,title:'South Carolina listed causes and approved-TMDL support — two source portfolios',sections,
  inputs:inventory,source_links:[
   {title:'SCDES impairment-list and TMDL explanation',uri:'https://www.des.sc.gov/programs/bureau-water/south-carolina-303d-list-impaired-waters-tmdls'},
   {title:'Original published 2024 impairment list',uri:result.source_editions[0].source_uri},
   {title:'Original July 28, 2026 TMDL support table; definitions on page 39',uri:result.source_editions[1].source_uri}],
  assessment_selection:result.scope,assessment_summary:result.summary};
}
function csv(columns,rows){const cell=v=>{const s=v==null?'':typeof v==='object'?JSON.stringify(v):String(v);return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};return [columns,...rows.map(r=>columns.map(k=>r[k]))].map(row=>row.map(cell).join(',')).join('\n')+'\n';}
export function outputs(input,inventory,describe,producerText,guideText){
 const result=analyze(input),recipe=chapter(result,inventory),domain=new Set(result.scope.domain_huc12s);
 const recordRows=result.original_record_index.map(r=>({...r,in_publisher_domain:domain.has(r.huc12),in_selected_station_inventory:true}));
 const matching=[...result.regional.comparison.different_cause_station_pairs.map(p=>({scope:'publisher_huc_domain',match:'same_station_different_cause',...p})),
 ...result.statewide.ecoli_comparison.ecoli_exact_site_use_cause_pairs.map(p=>({scope:'statewide_outside_regional_domain',match:'same_station_use_ecoli',...p}))].map(p=>({
  scope:p.scope,match:p.match,site:p.left.site,left_source_id:p.left.source_id,left_id:p.left.id,left_huc12:p.left.huc12,left_use:p.left_use,left_cause:p.left_cause,left_status:p.left_status,left_page:p.left.source_page,left_row:p.left.source_row,left_line_start:p.left.source_line_start,left_line_end:p.left.source_line_end,
  right_source_id:p.right.source_id,right_id:p.right.id,right_huc12:p.right.huc12,right_use:p.right_use,right_cause:p.right_cause,right_status:p.right_status,right_page:p.right.source_page,right_row:p.right.source_row,tmdl_report:p.tmdl_report,approval_date:p.approval_date}));
 const out={
  'assessment-portfolio.json':jtext({...result,inputs:inventory}),
  'assessment-portfolio-records.csv':csv(['source_id','id','evidence_kind','source_vintage','assessment_period','status_date','site','huc12','in_publisher_domain','in_selected_station_inventory','description','county','use','cause_raw','cause_label','use_support','use_support_raw','tmdl_relation','tmdl_report','approval_date','source_uri','source_sha256','source_page','source_row','source_line_start','source_line_end','source_row_text','raw'],recordRows),
  'assessment-portfolio-matches.csv':csv(['scope','match','site','left_source_id','left_id','left_huc12','left_use','left_cause','left_status','left_page','left_row','left_line_start','left_line_end','right_source_id','right_id','right_huc12','right_use','right_cause','right_status','right_page','right_row','tmdl_report','approval_date'],matching),
  'assessment-portfolio.recipe.json':jtext(recipe)};
 const companions=[...inventory,...Object.entries(out).filter(([path])=>path!=='assessment-portfolio.recipe.json').map(([path,text])=>describe(path,text)),
  describe('assessment_portfolio.mjs',producerText),describe('ASSESSMENT_PORTFOLIO.md',guideText)];
 out['assessment-portfolio.sources.json']=jtext({schema:'upstate.sources/v1',title:recipe.title,captured_at:'2026-10-13',
  notes:['Derived original-record portfolio comparison. Original assessment definitions, geography, publication status and document hashes remain unchanged.'],
  entries:[{id:SOURCE_ID,title:recipe.title,kind:'document',role:'OBSERVED_CONTEXT',uri:recipe.source_links[0].uri,vintage:'Published 2024 listing; TMDL status 2026-07-28',...describe('assessment-portfolio.recipe.json',out['assessment-portfolio.recipe.json']),
   metadata:{report_schema:recipe.schema,analysis_schema:SCHEMA,source_counts:result.summary,source_editions:result.source_editions,scope:result.scope.selection},companions}]});
 return {outputs:out,summary:result.summary};
}

async function main(){
 const fs=await import('node:fs/promises'),path=await import('node:path'),url=await import('node:url'),crypto=await import('node:crypto');
 const here=path.dirname(url.fileURLToPath(import.meta.url)),args=process.argv.slice(2);
 let root=here,output=null,check=false;
 for(let i=0;i<args.length;i++){const name=args[i];if(name==='--root'||name==='--output'){invariant(args[i+1]&&!args[i+1].startsWith('--'),'Expected path after '+name);if(name==='--root')root=path.resolve(args[++i]);else output=path.resolve(args[++i]);}else if(name==='--check')check=true;else throw Error('Unknown argument '+name);}
 output=output||root;
 const describe=(path,content)=>({path,bytes:Buffer.byteLength(content,'utf8'),sha256:crypto.createHash('sha256').update(content,'utf8').digest('hex')});
 const texts={},input={};
 for(const expected of INPUTS){const content=await fs.readFile(path.join(root,expected.path),'utf8');invariant(eq(describe(expected.path,content),expected),'Original input hash differs: '+expected.path);texts[expected.path]=content;input[expected.path]=JSON.parse(content);}
 const producerText=await fs.readFile(url.fileURLToPath(import.meta.url),'utf8'),guideText=await fs.readFile(path.join(here,'ASSESSMENT_PORTFOLIO.md'),'utf8');
 const generated=outputs(input,INPUTS,describe,producerText,guideText);
 if(check){for(const [name,content] of Object.entries(generated.outputs)) invariant(await fs.readFile(path.join(output,name),'utf8')===content,'Generated output differs: '+name);}
 else{await fs.mkdir(output,{recursive:true});for(const [name,content] of Object.entries({...texts,'assessment_portfolio.mjs':producerText,'ASSESSMENT_PORTFOLIO.md':guideText,...generated.outputs})){const target=path.join(output,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,content,'utf8');}}
 process.stdout.write(JSON.stringify({schema:SCHEMA,output,check,summary:generated.summary},null,2)+'\n');
}
// CLI ENTRYPOINT
if(typeof process!=='undefined'&&process.argv[1]){const url=await import('node:url');if(import.meta.url===url.pathToFileURL(process.argv[1]).href)await main();}
