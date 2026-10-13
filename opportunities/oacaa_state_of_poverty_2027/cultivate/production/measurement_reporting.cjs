'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const SCHEMA = 'tjl.publication.report-dataset.v1';
function lineMap(text) {
  const rows = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = /^L(\d+)@P[^:]+:\s?(.*)$/.exec(line);
    if (!m) continue;
    const n = Number(m[1]);
    if (rows.has(n) && rows.get(n) !== m[2]) throw Error('Conflicting original reader line '+n);
    rows.set(n,m[2]);
  }
  return rows;
}
function numbers(text) { return (text.match(/-?\d[\d,]*(?:\.\d+)?/g)||[]).map(s=>s.replace(/,/g,'')); }
function exactValues(lines,n,count) {
  if (!lines.has(n)) throw Error('Missing source line '+n);
  const v=numbers(lines.get(n)).slice(-count);
  if(v.length!==count)throw Error('Incomplete source row '+n);
  return v;
}
function col(key,label,kind='text',role='value',unit='',definition='') {
  return {key,label,kind,role,unit,period:'See row measurement period',definition};
}
function dataset(id,title,description,dataPeriod,geography,source,columns,rows,methodology) {
  const keys=columns.map(c=>c.key);
  for(const r of rows) {
    if(keys.some(k=>typeof r.values[k]!=='string'))throw Error('Incomplete row '+r.id);
    if(Object.keys(r.values).some(k=>!keys.includes(k)))throw Error('Unknown source column '+r.id);
  }
  if(new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('Duplicate source row');
  return {schema:SCHEMA,id,title,description,publicationPeriod:'2026 working production',dataPeriod,geography,methodology,source,columns,rows};
}
function source(meta,locator,note='') {
  return {title:meta.title,url:meta.url,locator,publisher:meta.publisher||'U.S. Census Bureau',retrievedAt:meta.retrievedAt,note,rights:meta.rights||'U.S. government public-domain statistical publication'};
}
function thresholdDataset(input) {
  const p=input.sources.cps2024, lines=lineMap(p.text);
  const spec=[['one-under65','One person, under age 65','1','Under 65',1787,1],['one-65plus','One person, age 65 or older','1','65 or older',1788,1],['two-under65','Two people, householder under age 65','2','Under 65',1790,2],['two-65plus','Two people, householder age 65 or older','2','65 or older',1791,2],['three','Three people','3','All ages',1792,3],['four','Four people','4','All ages',1793,4],['five','Five people','5','All ages',1794,5],['six','Six people','6','All ages',1795,6],['seven','Seven people','7','All ages',1796,7],['eight','Eight people','8','All ages',1797,8],['nineplus','Nine people or more','9 or more','All ages',1798,9]];
  const columns=[col('family','Family unit','text','label'),col('family_size','Family size','text','denominator'),col('householder_age','Age condition','text','note'),col('period','Income year','text','period'),...Array.from({length:9},(_,i)=>col('children_'+i,i===0?'No related children':i===8?'8 or more children':i+' '+(i===1?'child':'children'),'integer','value','USD per year','Related children under age 18; blank means this cell is not applicable.'))];
  let cells=0;
  const rows=spec.map(([id,label,size,age,n,count])=>{
    const vals=exactValues(lines,n,count);cells+=vals.length;
    const values={family:label,family_size:size,householder_age:age,period:'2024'};
    for(let i=0;i<9;i++)values['children_'+i]=vals[i]||'';
    return{id,values,locator:'Appendix A, printed p.17 / physical p.23; reader line '+n,note:'Nominal annual dollars; statistical threshold, distinct from HHS programme guidelines.'};
  });
  if(cells!==48||rows.find(r=>r.id==='four').values.children_2!=='31812')throw Error('Incomplete or wrong threshold edition');
  return dataset('us-official-poverty-thresholds-2024','Official poverty thresholds, 2024','Complete 48-cell Census grid, arranged by family size, householder age and related children under 18.','Calendar year 2024','United States; thresholds do not vary geographically',source(p,'Appendix A, printed p.17 / physical p.23'),columns,rows,'Each nonblank amount is transcribed automatically from its retained official PDF reader line. Income is compared with the exact applicable cell, not a weighted-average threshold. Blank cells are not zero. Family definitions and the statistical universe are retained in the measurement comparison.');
}
function guidelines(input) {
  const p=input.sources.hhs2024,raw=p.text;
  const sourceLines=new Map([...raw.matchAll(/^L(\d+):\s?(.*)$/gm)].map(m=>[Number(m[1]),m[2]]));
  const groups=[['contiguous','48 contiguous states and District of Columbia',102,'5380'],['alaska','Alaska',118,'6730'],['hawaii','Hawaii',135,'6190']];
  const rows=[];
  for(const [id,label,start,extra]of groups)for(let n=1;n<=8;n++){
    const line=sourceLines.get(start+n-1);if(!line)throw Error('Missing HHS row');
    const vals=numbers(line);if(vals.length!==2||vals[0]!==String(n))throw Error('Wrong HHS row');
    rows.push({id:id+'-'+n,values:{geography:label,persons:String(n),annual_guideline:vals[1],additional_person_above_eight:extra,period:'2024',applicable_date:'2024-01-11'},locator:'89 FR 2962; '+label+' table, '+n+' persons; reader line '+(start+n-1),note:'Applicable date may differ when the administering programme specifies its own date. This is a historical reference, not an individual eligibility determination.'});
  }
  return dataset('us-hhs-poverty-guidelines-2024','HHS poverty guidelines, 2024','Complete published eight-person schedules for the contiguous states/DC, Alaska and Hawaii, with the additional-person increments.','2024 guideline edition','Three separately published geographic schedules; Ohio uses the contiguous-states/DC schedule',source({...p,publisher:'U.S. Department of Health and Human Services / Government Publishing Office'},'89 FR 2961–2963, document 2024-00796'),[col('geography','Geographic schedule','text','geography'),col('persons','Persons in family/household','integer','denominator'),col('annual_guideline','Annual guideline','integer','value','USD per year'),col('additional_person_above_eight','Add for each person above eight','integer','value','USD per year'),col('period','Guideline edition','text','period'),col('applicable_date','Published applicable date','text','note')],rows,'Values are retained as published in the original HHS notice. The guidelines simplify Census thresholds for administrative use and use programme-specific definitions of income, family and applicability. They are not SPM thresholds or the Census statistical grid.');
}
function methods(input) {
  const p=input.sources.cps2024;
  const rows=[
    ['unit','Resource-sharing unit','People related by birth, marriage or adoption form a family; unrelated individuals are measured separately.','The unit also includes unmarried partners and their relatives, coresident unrelated children under 15, and foster children under 22.','Printed pp.2–3, lines 296–330'],
    ['threshold','Threshold basis','The historical base is three times the cost of a minimum food diet in 1963, updated for prices.','Recent expenditure on food, clothing, shelter, utilities, telephone and internet.','Printed p.2, lines 331–335'],
    ['adjustments','Family, housing and location','Thresholds vary by family size, composition and householder age; the statistical thresholds do not vary geographically.','Thresholds vary by family size, composition and housing tenure, and reflect geographic differences in housing costs.','Printed p.2, lines 336–342; p.17, line 1824'],
    ['updating','Annual update','Consumer Price Index for All Urban Consumers, all items.','Most recent five-year moving average of the specified expenditures, lagged one year.','Printed p.2, lines 343–346'],
    ['resources','Resources counted','Pretax cash income; excludes tax credits, capital gains and noncash benefits.','Cash income plus qualifying noncash benefits and tax credits, less taxes, work and medical expenses, and child support paid to another household.','Printed p.2, lines 347–351; p.17, lines 1818–1823'],
    ['universe','Population universe','Civilian noninstitutionalized population, excluding unrelated individuals under 15 for whom poverty status cannot be determined.','The official universe plus unrelated individuals under 15.','Printed p.2, lines 352–357'],
    ['series','Published time series','1959 onward in this Census report.','2009 onward in this Census report.','Printed p.2, line 358'],
    ['comparison','Comparing the two measures','For direct comparison with SPM, the report uses official+ and assigns unrelated children under 15 the household reference person’s official poverty status.','SPM includes those children; it complements the official measure and is not designed to determine programme eligibility or funding distribution.','Printed p.3, lines 359–378']
  ].map(([id,aspect,official,supplemental,locator])=>({id,values:{aspect,official,supplemental,period:'2024 methods in September 2025 Census report'},locator,note:'Plain-language paraphrase tied to the specified original source location.'}));
  return dataset('us-poverty-measure-comparison-2024','How the official and supplemental measures differ','Source-specific comparison of the units, resources, thresholds, universe and use of the two measures.','2024 methodology','United States',source(p,'Differences in Poverty Measures, printed pp.2–3 / physical pp.8–9'),[col('aspect','Aspect','text','label'),col('official','Official poverty measure','text','note'),col('supplemental','Supplemental Poverty Measure','text','note'),col('period','Methodology edition','text','period')],rows,'Eight definitions paraphrase the original federal statistical publication. These are methodological definitions, not eight population observations.');
}
function dynamics(input) {
  const p=input.sources.sipp2019, lines=lineMap(p.text), p17=input.sources.sipp2022, lines17=lineMap(p17.text);
  const spec=[
    ['all','All people','All people',412,469],
    ['white','White','Race and Hispanic origin',414,471],
    ['white-nonhispanic','White, non-Hispanic','Race and Hispanic origin',415,472],
    ['black','Black','Race and Hispanic origin',416,473],
    ['hispanic','Hispanic','Race and Hispanic origin',417,474],
    ['nonhispanic','Non-Hispanic','Race and Hispanic origin',418,475],
    ['under18','Under 18 years','Age',420,477],
    ['18to64','18 to 64 years','Age',421,478],
    ['65plus','65 years and over','Age',422,479],
    ['married','In married-couple families','Family status',424,481],
    ['male-no-spouse','In families with a male householder, no spouse present','Family status',426,483],
    ['female-no-spouse','In families with a female householder, no spouse present','Family status',428,485],
    ['unrelated','Unrelated individuals','Family status',429,486]
  ];
  const columns=[col('population','Population group','text','label'),col('group','Characteristic','text','note'),col('geography','Geography','text','geography'),col('period','Observation period','text','period'),col('months','Months observed','integer','period'),col('population_thousands','Total population','decimal','denominator','thousand persons'),col('episodic_count_thousands','Episodic poverty count','decimal','value','thousand persons'),col('episodic_count_ci90','Episodic count 90% CI half-width','decimal','margin-of-error','thousand persons'),col('episodic_pct','Episodic poverty rate','decimal','value','percent'),col('episodic_pct_ci90','Episodic rate 90% CI half-width','decimal','margin-of-error','percentage points'),col('chronic_count_thousands','Chronic poverty count','decimal','value','thousand persons'),col('chronic_count_ci90','Chronic count 90% CI half-width','decimal','margin-of-error','thousand persons'),col('chronic_pct','Chronic poverty rate','decimal','value','percent'),col('chronic_pct_ci90','Chronic rate 90% CI half-width','decimal','margin-of-error','percentage points'),col('source_edition','Published source edition','text','source'),col('release_status','Source release status','text','note'),col('demographic_timing','Timing and population notes','text','note')];
  const rows=[];
  const empty=()=>Object.fromEntries(columns.map(c=>[c.key,'']));
  for(const[id,label,group,e,c]of spec){
    const ep=exactValues(lines,e,12),ch=exactValues(lines,c,12);
    for(let i=0;i<2;i++){
      const off=i*5;if(ep[off]!==ch[off])throw Error('Dynamics population mismatch');
      const period=i?'2013–2014':'2011–2012';
      const values={...empty(),population:label,group,geography:'United States',period,months:'24',population_thousands:ep[off],episodic_count_thousands:ep[off+1],episodic_count_ci90:ep[off+2],episodic_pct:ep[off+3],episodic_pct_ci90:ep[off+4],chronic_count_thousands:ch[off+1],chronic_count_ci90:ch[off+2],chronic_pct:ch[off+3],chronic_pct_ci90:ch[off+4],source_edition:'SEHSD Working Paper 2019-38, November 12, 2019',release_status:i?'As published; 2014-panel data precede the July 2025 Social Security processing fix':'As published; 2008 SIPP panel',demographic_timing:'Demographic characteristics held at the beginning of the reference period. Race categories are alone; Hispanic origin overlaps race. Both periods require all 24 months in sample.'};
      rows.push({id:'sipp-'+(i?'2013-2014':'2011-2012')+'-'+id,values,locator:'SEHSD-WP2019-38 Tables 1–2, printed pp.20–21; reader lines '+e+' and '+c,note:'Original printed counts and 90% confidence half-widths are in thousands. Chronic poverty is a subset of episodic poverty; these groups overlap. Figures retain their published edition, not a recomputation from corrected microdata.'});
    }
  }
  const spec17=[['all','All people','All people'],['under18','Under 18 years','Age'],['18to64','18–64 years','Age'],['65plus','65 years and over','Age'],['male','Male','Sex'],['female','Female','Sex'],['white-nonhispanic','White, non-Hispanic','Race and Hispanic origin'],['black','Black','Race and Hispanic origin'],['asian','Asian','Race and Hispanic origin'],['hispanic','Hispanic','Race and Hispanic origin'],['no-high-school','No high school diploma','Educational attainment'],['high-school','High school, no college','Educational attainment'],['some-college','Some college, no degree','Educational attainment'],['bachelors','Bachelor’s degree or higher','Educational attainment'],['married','In married-couple families','Family status'],['male-no-spouse','In families with a male householder, no spouse present','Family status'],['female-no-spouse','In families with a female householder, no spouse present','Family status'],['unrelated','Unrelated individuals','Family status']];
  spec17.forEach(([id,label,group],i)=>{
    const vals=exactValues(lines17,445+i,2);
    const values={...empty(),population:label,group,geography:'United States',period:'2017–2019',months:'36',episodic_pct:vals[1],chronic_pct:vals[0],source_edition:'P70BR-179, September 29, 2022, Figure 5',release_status:'As published; underlying data precede the July 2025 Social Security processing fix',demographic_timing:'Age as of December 2019. Educational attainment covers people age 25 or older. Hispanic origin can overlap race.'};
    rows.push({id:'sipp-2017-2019-'+id,values,locator:'P70BR-179 Figure 5, printed/physical p.7; reader line '+(445+i),note:'Figure 5 prints rates without population counts or confidence intervals; unavailable cells stay blank. Poverty spells occur within 36 months. Do not compare this as an equal-duration trend with the 24-month periods.'});
  });
  if(rows.length!==44)throw Error('Incomplete dynamics source');
  return dataset('us-sipp-published-poverty-dynamics','Published SIPP poverty dynamics and source editions','Complete selected-characteristic tables for the two 24-month periods, plus every Figure 5 rate for the 36-month period.','2011–2012; 2013–2014; 2017–2019, separately identified','United States; national longitudinal samples, not Ohio estimates',source(p,'Tables 1–2; P70BR-179 Figure 5; current SIPP correction notices','Published historical editions are retained explicitly. Later corrections are tracked in the source concordance.'),columns,rows,'Episodic poverty means at least two consecutive months in poverty during the stated observation period. Chronic poverty means poverty in every month of that period. Published 24- and 36-month estimates have different opportunities to enter or remain in poverty. The 2019 working paper and 2022 report precede the July 24, 2025 corrected Social Security microdata; the separately published February 2024 corrected tables cover annual/monthly rates, not a replacement of these chronic/episodic tables. This dataset is an edition-labelled source reference.');
}
function transform(input){return {thresholds:thresholdDataset(input),guidelines:guidelines(input),methods:methods(input),dynamics:dynamics(input)};}
function rebuild(root){
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'MEASUREMENT_SOURCE_MANIFEST.json'),'utf8'));
  const input={sources:{}};
  for(const item of manifest.sources){
    const content=fs.readFileSync(path.join(root,item.path),'utf8');
    const b=Buffer.from(content,'utf8'),sha=crypto.createHash('sha256').update(b).digest('hex');
    if(b.length!==item.bytes||sha!==item.sha256)throw Error('Source bytes changed: '+item.path);
    input.sources[item.key]={...item,text:content};
  }
  const out=transform(input);
  for(const[key,doc]of Object.entries(out))fs.writeFileSync(path.join(root,manifest.outputs[key]),JSON.stringify(doc,null,2)+'\n');
  return Object.fromEntries(Object.entries(out).map(([k,v])=>[k,{id:v.id,rows:v.rows.length,columns:v.columns.length}]));
}
module.exports={lineMap,thresholdDataset,guidelines,methods,dynamics,transform,rebuild};
if(require.main===module)console.log(JSON.stringify(rebuild(process.argv[2]||process.cwd()),null,2));
