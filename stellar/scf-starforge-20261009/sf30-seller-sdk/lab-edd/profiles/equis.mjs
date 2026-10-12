// MIT. Explicit three-file EQEDD-family and four-file EFWEDD-family lab receiving profiles.
const EQEDD = 'https://help.earthsoft.com/lib_eqedd_format.htm';
const EFWEDD = 'https://help.earthsoft.com/lib_efwedd-format.htm';
const QUALIFIERS = 'https://help.earthsoft.com/qualifiers.htm';
const TEST_FIELDS = ['sys_sample_code','lab_anl_method_name','analysis_date','analysis_time','total_or_dissolved','column_number','test_type','identifier'];
const RESULT_FIELDS = [...TEST_FIELDS,'cas_rn','result_type_code'];
const valuesKey = (row,fields) => fields.map(field=>row.values[field]??'');
const tuple = values => JSON.stringify(values);
const present = value => typeof value === 'string' && value !== '';
function group(rows,key) {
  const out=new Map();
  for(const row of rows){const id=tuple(key(row));if(!out.has(id))out.set(id,[]);out.get(id).push(row);}
  return out;
}
function fraction(value) {
  if(typeof value!=='string')return null;
  const match=/^([+-]?)(\d+)(?:\.(\d*))?(?:[Ee]([+-]?\d+))?$/.exec(value);
  if(!match)return null;
  const exponent=Number(match[4]??0),scale=(match[3]??'').length-exponent;
  if(!Number.isSafeInteger(exponent)||Math.abs(scale)>1000||value.length>2000)return null;
  let numerator=BigInt(match[2]+(match[3]??''))*(match[1]==='-'?-1n:1n);
  return scale>=0?{numerator,denominator:10n**BigInt(scale)}:{numerator:numerator*10n**BigInt(-scale),denominator:1n};
}
function compare(a,b){return a.numerator*b.denominator<b.numerator*a.denominator?-1:a.numerator*b.denominator>b.numerator*a.denominator?1:0;}
function observedFamilies(rows,field) {
  const counts=new Map();for(const row of rows){const value=row.values[field]??'';counts.set(value,(counts.get(value)??0)+1);}
  return [...counts].sort(([a],[b])=>a.localeCompare(b,'en')).map(([value,count])=>({value,count}));
}
function createProfile(count) {
  const url=count===3?EQEDD:EFWEDD,id='equis-lab-'+count;
  return Object.freeze({
    id,version:'1.0.0',label:count+'-file laboratory EDD',delimiters:[',','\t'],
    references:[{title:count===3?'EarthSoft EQEDD format':'EarthSoft EFWEDD format',url},
      {title:'EarthSoft qualifier fields and laboratory provenance',url:QUALIFIERS}],
    editableFields:['sample_type_code','parent_sample_code','lab_anl_method_name','total_or_dissolved','test_type',
      'reportable_result','lab_qualifiers','validator_qualifiers','interpreted_qualifiers','result_comment','comment'],
    match({keys}) {
      const has=key=>keys.includes(key);
      if(has('sys_sample_code')&&has('test_batch_id')&&has('test_batch_type'))return 'batches';
      if(has('sys_sample_code')&&has('cas_rn')&&has('result_type_code'))return 'results';
      if(has('sys_sample_code')&&has('lab_anl_method_name')&&has('analysis_date'))return 'tests';
      if(has('sys_sample_code')&&has('sample_type_code')&&has('sample_matrix_code'))return 'samples';
      return null;
    },
    recordKey({table,row}) {
      if(table.id==='samples')return [row.values.sys_sample_code??''];
      if(table.id==='tests')return valuesKey(row,TEST_FIELDS);
      if(table.id==='results')return valuesKey(row,RESULT_FIELDS);
      if(table.id==='batches')return [...valuesKey(row,TEST_FIELDS),row.values.test_batch_type??'',row.values.test_batch_id??''];
      return [table.filename,row.rowNumber];
    },
    analyze({tables}) {
      const byType=new Map(),issues=[],lineage=[];
      for(const table of tables){if(!byType.has(table.id))byType.set(table.id,[]);byType.get(table.id).push(...table.rows);}
      const samples=byType.get('samples')??[],tests=byType.get('tests')??[],results=byType.get('results')??[],batches=byType.get('batches')??[];
      const add=(code,severity,message,rows,fields=[],details,reference=url)=>{
        const targets=rows.flatMap(row=>fields.length?fields.filter(field=>Object.hasOwn(row.values,field)).map(field=>({recordId:row.recordId,field})):[{recordId:row.recordId}]);
        issues.push({code,severity,message,targets,reference,...(details===undefined?{}:{details})});
      };
      for(const section of count===3?['samples','results','batches']:['samples','tests','results','batches'])
        if(!byType.has(section))add('MISSING_SECTION','error','The selected '+count+'-file profile requires its '+section+' section.',[],[],{section});
      if(count===3&&tests.length)add('EXTRA_TEST_SECTION','review','The selected three-file source already carries test fields in its result table; review the additional independent test section.',tests);
      for(const table of tables){
        const required=table.id==='samples'?['sys_sample_code','sample_type_code','sample_matrix_code']:
          table.id==='results'?['sys_sample_code','lab_anl_method_name','analysis_date','test_type','cas_rn','result_type_code','detect_flag']:
          ['sys_sample_code','lab_anl_method_name','analysis_date','test_type'];
        for(const field of required)if(!table.keys.includes(field))
          add('MISSING_HEADER','error','A field used by this profile is absent from the original header.',[],[],{filename:table.filename,section:table.id,field});
        for(const row of table.rows)for(const field of required.filter(name=>name!=='detect_flag'))
          if(Object.hasOwn(row.values,field)&&row.values[field]==='')
            add('EMPTY_IDENTITY_FIELD','review','A reported identity or classification field is empty; retain it for the receiving format review.',[row],[field]);
      }
      const sampleGroups=group(samples,row=>[row.values.sys_sample_code??'']);
      for(const [key,rows]of sampleGroups)if(rows.length>1){
        const variants=new Set(rows.map(row=>JSON.stringify(row.values)));
        add(variants.size===1?'DUPLICATE_SAMPLE_ROWS':'CONFLICTING_SAMPLE_ID','review',
          variants.size===1?'The same sample identity is repeated with identical source cells.':'The same sample identity has different source fields.',
          rows,['sys_sample_code'],{identity:JSON.parse(key),rows:rows.map(row=>row.recordId)});
      }
      for(const row of samples){
        const parent=row.values.parent_sample_code;
        if(!parent)continue;
        const matches=sampleGroups.get(tuple([parent]))??[];
        if(!matches.length)add('PARENT_SAMPLE_NOT_PRESENT','review','This parent sample is not present in the current delivery; resolve it against the receiver or include the original parent.',[row],['parent_sample_code'],{parent});
        else if(parent===row.values.sys_sample_code)add('SELF_PARENT_SAMPLE','review','The source parent code equals the sample code; retain both reported fields for review.',[row],['parent_sample_code','sys_sample_code']);
      }
      const testRows=count===3?results:tests,testGroups=group(testRows,row=>valuesKey(row,TEST_FIELDS));
      const batchGroups=group(batches,row=>valuesKey(row,TEST_FIELDS)),resultGroups=group(results,row=>valuesKey(row,RESULT_FIELDS));
      if(count===4)for(const [key,rows]of testGroups)if(rows.length>1)
        add('DUPLICATE_TEST_IDENTITY','review','Multiple original test rows share the complete reported test identity.',rows,[],{identity:JSON.parse(key)});
      for(const [key,rows]of resultGroups)if(rows.length>1)
        add('DUPLICATE_RESULT_IDENTITY','review','Multiple original result rows share the complete reported test, analyte and result-type identity.',rows,[],{identity:JSON.parse(key)});
      const orphanSampleRows=new Set(),orphanTestRows=new Set();
      for(const row of [...tests,...results,...batches]){
        const sampleCode=row.values.sys_sample_code??'',matches=sampleGroups.get(tuple([sampleCode]))??[];
        if(!matches.length){orphanSampleRows.add(row.recordId);add('SAMPLE_PARENT_MISSING','error','A child row has no matching sample record in this delivery.',[row],['sys_sample_code'],{sampleCode});}
      }
      for(const row of [...results,...batches]){
        const testKey=tuple(valuesKey(row,TEST_FIELDS)),matches=testGroups.get(testKey)??[];
        if(count===4&&!matches.length){orphanTestRows.add(row.recordId);add('TEST_PARENT_MISSING','error','A child row has no matching test with the exact reported method, date/time, fraction, column, type and identifier.',[row],TEST_FIELDS,{identity:JSON.parse(testKey)});}
      }
      let nonDetectBlankResults=0,detectedBlankTargetResults=0,reportedLimits=0,qcRecords=0;
      for(const row of results){
        const value=row.values,detect=value.detect_flag??'',type=value.result_type_code??'';
        if(detect==='N'&&value.result_value==='')nonDetectBlankResults++;
        if(detect==='Y'&&['TRG','TIC'].includes(type)&&!present(value.result_value)){
          detectedBlankTargetResults++;add('DETECTED_RESULT_VALUE_REQUIRED','error','The published format requires a result value for a detected target or tentatively identified compound.',[row],['detect_flag','result_type_code','result_value']);
        }
        for(const field of ['method_detection_limit','reporting_detection_limit','quantitation_limit'])
          if(present(value[field]))reportedLimits++;
        if(Object.keys(value).some(field=>field.startsWith('qc_')&&present(value[field])))qcRecords++;
        for(const [metric,low,high]of [['qc_spike_recovery','qc_spike_lcl','qc_spike_ucl'],['qc_dup_spike_recovery','qc_spike_lcl','qc_spike_ucl']]){
          const measured=fraction(value[metric]),lo=fraction(value[low]),hi=fraction(value[high]);
          if(measured&&lo&&hi){
            if(compare(lo,hi)>0)add('QC_BOUND_ORDER','review','The reported lower QC bound exceeds its upper bound.',[row],[low,high]);
            else if(compare(measured,lo)<0||compare(measured,hi)>0)
              add('QC_RECOVERY_OUTSIDE_REPORTED_BOUNDS','review','The supplied QC recovery lies outside the supplied lower and upper bounds; preserve the laboratory qualification for reviewer disposition.',[row],[metric,low,high],{metric:value[metric],lower:value[low],upper:value[high]},QUALIFIERS);
          }
        }
        const rpd=fraction(value.qc_rpd),rpdLimit=fraction(value.qc_rpd_cl);
        if(rpd&&rpdLimit&&compare(rpd,rpdLimit)>0)add('QC_RPD_ABOVE_REPORTED_BOUND','review',
          'The supplied relative percent difference exceeds its supplied bound; preserve the laboratory qualification for review.',[row],['qc_rpd','qc_rpd_cl'],undefined,QUALIFIERS);
        const sampleKey=tuple([value.sys_sample_code??'']),testKey=tuple(valuesKey(row,TEST_FIELDS));
        lineage.push({recordId:row.recordId,sampleCode:value.sys_sample_code??'',
          sampleRecordIds:(sampleGroups.get(sampleKey)??[]).map(item=>item.recordId),
          testIdentity:JSON.parse(testKey),testRecordIds:count===4?(testGroups.get(testKey)??[]).map(item=>item.recordId):[],
          batchRecordIds:(batchGroups.get(testKey)??[]).map(item=>item.recordId),
          analyteCode:value.cas_rn??'',resultType:type});
      }
      return {
        summary:{sampleRows:samples.length,sampleIdentities:sampleGroups.size,
          testRows:tests.length,testIdentities:testGroups.size,resultRows:results.length,batchAssignmentRows:batches.length,
          laboratoryBatchIdentities:new Set(batches.map(row=>tuple([row.values.test_batch_type??'',row.values.test_batch_id??'']))).size,
          missingSampleParentRows:orphanSampleRows.size,missingTestParentRows:orphanTestRows.size,
          nonDetectBlankResults,detectedBlankTargetResults,reportedLimitCells:reportedLimits,recordsWithQcFields:qcRecords},
        issues,lineage,
        facts:{testIdentityFields:TEST_FIELDS,rawIdentifiersPreserved:true,
          samples:observedFamilies(samples,'sample_type_code'),matrices:observedFamilies(samples,'sample_matrix_code'),
          resultTypes:observedFamilies(results,'result_type_code'),detectFlags:observedFamilies(results,'detect_flag'),
          resultUnits:observedFamilies(results,'result_unit'),limitUnits:observedFamilies(results,'detection_limit_unit'),
          laboratoryQualifiers:observedFamilies(results,'lab_qualifiers'),
          receivingStep:'Run the prepared files in the client-selected native EDP format and current reference-value set; retain that result with this source review.'},
      };
    },
  });
}
export const equisLab3=createProfile(3);
export const equisLab4=createProfile(4);
export const equisProfiles=Object.freeze([equisLab3,equisLab4]);
