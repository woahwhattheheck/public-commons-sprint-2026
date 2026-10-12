// MIT. GDELT GKG 2.1 article fields, occurrence views and original source semantics.
import { createHash } from 'node:crypto';

export const GKG_CAPTURE='stellar-forge.gdelt-gkg-capture.v1';
export const GKG_CODEBOOK_URL='https://data.gdeltproject.org/documentation/GDELT-Global_Knowledge_Graph_Codebook-V2.1.pdf';
export const GCAM_CODEBOOK_URL='https://data.gdeltproject.org/documentation/GCAM-MASTERCODEBOOK.xlsx';
export const GKG_NOTICE='GKG records automated document-level extraction. An update is a monitored-source window. Repeated documents and entity occurrences remain separate. Character offsets are approximate; co-occurrence does not establish a relationship, affiliation or event.';
export const GKG_FIELDS=Object.freeze(['GKGRECORDID','DATE','SourceCollectionIdentifier','SourceCommonName',
  'DocumentIdentifier','Counts','V2Counts','Themes','V2Themes','Locations','V2Locations','Persons','V2Persons',
  'Organizations','V2Organizations','V2Tone','Dates','GCAM','SharingImage','RelatedImages','SocialImageEmbeds',
  'SocialVideoEmbeds','Quotations','AllNames','Amounts','TranslationInfo','ExtrasXML']);
export const GKG_TABLES=Object.freeze(['articles','article-entities','article-measures','article-details']);
export const GKG_TONE_FIELDS=Object.freeze(['ToneScore','PositiveScore','NegativeScore','Polarity',
  'ActivityReferenceDensity','SelfGroupReferenceDensity','WordCount']);
const BASE=['source_batch','source_row','GKGRECORDID','SourceCollectionIdentifier','SourceCommonName','DocumentIdentifier'];
const ARTICLE_EXTRA=['document_key','record_translated','tone_parse_status',...GKG_TONE_FIELDS];
const OCCURRENCE=['source_field','occurrence_index','occurrence_kind','raw_entry','parse_status'];
const ENTITY=['value','character_offset','location_type','location_name','country_code','adm1_code','adm2_code',
  'latitude','longitude','feature_id'];
const MEASURES=['measure_key','measure_value','measure_kind','dictionary_id','dimension_id'];
const DETAILS=['value','character_offset','character_length','verb','amount','object','count_type','count_value',
  'location_type','location_name','country_code','adm1_code','latitude','longitude','feature_id',
  'date_resolution','date_month','date_day','date_year'];
const DECIMAL=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const UNSIGNED=/^\d+$/;
const need=(ok,message,code='GDELT_GKG_INVALID',status=400)=>{
  if(!ok)throw Object.assign(new Error(message),{code,status});
};
const sha=value=>createHash('sha256').update(value).digest('hex');
const blank=fields=>Object.fromEntries(fields.map(name=>[name,'']));
export const isGkgTable=table=>GKG_TABLES.includes(table);
export function gkgTableFields(table){
  need(isGkgTable(table),'Choose an original GKG article table.');
  if(table==='articles')return ['source_batch','source_row',...GKG_FIELDS,...ARTICLE_EXTRA];
  return [...BASE,...OCCURRENCE,...(table==='article-entities'?ENTITY:table==='article-measures'?MEASURES:DETAILS)];
}
export function gkgRequiredFields(table){
  return ['source_batch','source_row','GKGRECORDID',...(table==='articles'?[]:['source_field','occurrence_index'])];
}
function validDate(value){
  if(value==='0')return true;
  if(!/^\d{14}$/.test(value))return false;
  const date=new Date(value.slice(0,4)+'-'+value.slice(4,6)+'-'+value.slice(6,8)+'T'+value.slice(8,10)+':'+value.slice(10,12)+':'+value.slice(12,14)+'Z');
  return Number.isFinite(date.valueOf())&&date.toISOString().slice(0,19).replaceAll(/[-T:]/g,'')===value;
}
export function parseGkgTable(text,batch,{maxBytes=64*1024*1024,maxRows=1000000,maxCellChars=262144}={}){
  need(typeof text==='string'&&Buffer.byteLength(text)<=maxBytes&&!text.includes('\0')&&!text.startsWith('\uFEFF'),
    'Use the complete original UTF-8 GKG 2.1 TSV within the selected capacity.');
  need(/^\d{14}$/.test(batch)&&validDate(batch),'Select the original GKG update timestamp.');
  const lines=text.split('\n');if(lines.at(-1)==='')lines.pop();
  need(lines.length<=maxRows,'GKG table exceeds its source-row capacity.','GDELT_SOURCE_TOO_LARGE',413);
  const rows=[],ids=new Set();
  for(let index=0;index<lines.length;index++){
    const line=lines[index].endsWith('\r')?lines[index].slice(0,-1):lines[index];
    const values=line.split('\t');
    need(values.length===GKG_FIELDS.length&&values.every(value=>value.length<=maxCellChars&&!/[\r\0]/.test(value)),
      'Original GKG TSV row '+(index+1)+' must retain all27 fields.','GDELT_TABLE_CONTRACT_CHANGED');
    const row=Object.fromEntries(GKG_FIELDS.map((name,i)=>[name,values[i]]));
    const id=/^(\d{14})-(T?)(\d+)$/.exec(row.GKGRECORDID);
    need(id&&id[1]===batch,'GKG record ID belongs to another source update.','GDELT_BATCH_MISMATCH');
    need(!ids.has(row.GKGRECORDID),'An original GKG source repeats its record ID.','GDELT_GKG_RECORD_DUPLICATE');
    need(validDate(row.DATE),'Keep the original GKG publication datetime or explicit unknown0.');
    need(UNSIGNED.test(row.SourceCollectionIdentifier)&&row.DocumentIdentifier.length>0,
      'Keep the original source collection and document identifier.');
    ids.add(row.GKGRECORDID);rows.push({source_batch:batch,source_row:index+1,...row});
  }
  return rows;
}
function tone(row){
  const values=row.V2Tone===''?[]:row.V2Tone.split(',');
  const valid=values.length===7&&values.slice(0,6).every(value=>DECIMAL.test(value))&&UNSIGNED.test(values[6]);
  return {tone_parse_status:row.V2Tone===''?'EMPTY':valid?'PARSED':'RAW_UNRECOGNIZED',
    ...Object.fromEntries(GKG_TONE_FIELDS.map((name,i)=>[name,valid?values[i]:'']))};
}
export function gkgArticle(row){
  return {...row,document_key:sha(JSON.stringify([row.SourceCollectionIdentifier,row.DocumentIdentifier])),
    record_translated:/-T\d+$/.test(row.GKGRECORDID)?1:0,...tone(row)};
}
function records(raw,delimiter=';'){
  if(raw==='')return [];
  const values=raw.split(delimiter);
  // A trailing field terminator is not a fabricated occurrence. Empty internal
  // entries are retained with their original ordinal and a raw parse status.
  if(values.at(-1)==='')values.pop();
  return values;
}
function nameOffset(raw){
  const at=raw.lastIndexOf(',');
  if(at<1||!UNSIGNED.test(raw.slice(at+1)))return null;
  return {value:raw.slice(0,at),character_offset:raw.slice(at+1)};
}
function location(raw,enhanced=true){
  const fields=raw.split('#'),count=enhanced?9:7;
  if(fields.length!==count||!UNSIGNED.test(fields[0]))return null;
  const latitude=fields[enhanced?5:4],longitude=fields[enhanced?6:5];
  if((latitude!==''&&!DECIMAL.test(latitude))||(longitude!==''&&!DECIMAL.test(longitude)))return null;
  if(enhanced&&!UNSIGNED.test(fields[8]))return null;
  return {location_type:fields[0],location_name:fields[1],country_code:fields[2],adm1_code:fields[3],
    ...(enhanced?{adm2_code:fields[4]}:{}),latitude,longitude,feature_id:fields[enhanced?7:6],
    ...(enhanced?{character_offset:fields[8]}:{})};
}
function base(row,field,index,raw,kind,fields){
  return {...Object.fromEntries(BASE.map(name=>[name,row[name]])),...blank(fields),
    source_field:field,occurrence_index:index+1,occurrence_kind:kind,raw_entry:raw,
    parse_status:raw===''?'EMPTY_ENTRY':'RAW_UNRECOGNIZED'};
}
function entities(row){
  const result=[];
  for(const [field,kind] of [['V2Themes','theme'],['V2Persons','person'],['V2Organizations','organization'],
    ['V2Locations','location'],['AllNames','name']]){
    records(row[field]).forEach((raw,index)=>{
      const item=base(row,field,index,raw,kind,ENTITY),parsed=field==='V2Locations'?location(raw):nameOffset(raw);
      if(parsed)Object.assign(item,parsed,{parse_status:'PARSED'});
      result.push(item);
    });
  }
  return result;
}
function measures(row){
  const result=[];
  if(row.V2Tone!==''){
    const values=row.V2Tone.split(',');
    values.forEach((raw,index)=>{
      const item=base(row,'V2Tone',index,raw,'tone',MEASURES);
      item.measure_key=GKG_TONE_FIELDS[index]??'unknown-'+(index+1);
      if(index<7&&(index===6?UNSIGNED.test(raw):DECIMAL.test(raw))){
        item.measure_value=raw;item.measure_kind=index===6?'word-count':'tone-score';
        item.parse_status=values.length===7?'PARSED':'PARTIAL_FIELD';
      }
      result.push(item);
    });
  }
  records(row.GCAM,',').forEach((raw,index)=>{
    const item=base(row,'GCAM',index,raw,'gcam',MEASURES),at=raw.indexOf(':');
    if(at>0&&raw.indexOf(':',at+1)<0){
      const key=raw.slice(0,at),value=raw.slice(at+1),dimension=/^([cv])(\d+)\.(\d+)$/.exec(key);
      item.measure_key=key;
      if((key==='wc'||key==='nwc')&&UNSIGNED.test(value)){
        Object.assign(item,{measure_value:value,measure_kind:key==='wc'?'word-count':'native-word-count',parse_status:'PARSED'});
      }else if(dimension&&(dimension[1]==='c'?UNSIGNED.test(value):DECIMAL.test(value))){
        Object.assign(item,{measure_value:value,measure_kind:dimension[1]==='c'?'dictionary-count':'dictionary-score',
          dictionary_id:dimension[2],dimension_id:dimension[3],parse_status:'PARSED'});
      }
    }
    result.push(item);
  });
  return result;
}
function details(row){
  const result=[];
  for(const [field,kind,delimiter] of [['V2Counts','count',';'],['Dates','date',';'],
    ['Quotations','quote','#'],['Amounts','amount',';']]){
    records(row[field],delimiter).forEach((raw,index)=>{
      const item=base(row,field,index,raw,kind,DETAILS);let parsed=null;
      if(field==='Dates'){
        const values=raw.split(',');
        if(values.length===5&&values.every(value=>UNSIGNED.test(value))){
          parsed={date_resolution:values[0],date_month:values[1],date_day:values[2],date_year:values[3],character_offset:values[4]};
        }
      }else if(field==='Quotations'){
        const first=raw.indexOf('|'),second=raw.indexOf('|',first+1),third=raw.indexOf('|',second+1);
        if(first>0&&second>first&&third>second&&UNSIGNED.test(raw.slice(0,first))&&UNSIGNED.test(raw.slice(first+1,second))){
          parsed={character_offset:raw.slice(0,first),character_length:raw.slice(first+1,second),
            verb:raw.slice(second+1,third),value:raw.slice(third+1)};
        }
      }else if(field==='Amounts'){
        const first=raw.indexOf(','),last=raw.lastIndexOf(',');
        if(first>0&&last>first&&DECIMAL.test(raw.slice(0,first))&&UNSIGNED.test(raw.slice(last+1))){
          parsed={amount:raw.slice(0,first),object:raw.slice(first+1,last),character_offset:raw.slice(last+1)};
        }
      }else{
        const values=raw.split('#');
        if(values.length===11&&UNSIGNED.test(values[1])&&UNSIGNED.test(values[10])){
          const geo=location(values.slice(3,10).join('#'),false);
          if(geo)parsed={count_type:values[0],count_value:values[1],object:values[2],...geo,character_offset:values[10]};
        }
      }
      if(parsed)Object.assign(item,parsed,{parse_status:'PARSED'});
      result.push(item);
    });
  }
  return result;
}
export function gkgCollectionRows(models,table,{maxRows=1000000}={}){
  need(isGkgTable(table)&&models.length>0&&models.every(model=>model.format==='gkg'&&Array.isArray(model.articles)),
    'Select GKG article captures for this article table.');
  const result=[];
  for(const model of models)for(const row of model.articles){
    const rows=table==='articles'?[gkgArticle(row)]:table==='article-entities'?entities(row):table==='article-measures'?measures(row):details(row);
    need(result.length+rows.length<=maxRows,'Selected expanded GKG table exceeds its one-million-row capacity. Choose fewer source updates.','GDELT_SOURCE_TOO_LARGE',413);
    result.push(...rows);
  }
  return result;
}
const INTEGER=new Set(['source_row','record_translated','occurrence_index']);
const NUMERIC_TEXT=new Set([...GKG_TONE_FIELDS,'measure_value','latitude','longitude','character_offset','character_length',
  'amount','count_value','date_month','date_day','date_year','date_resolution','location_type','dictionary_id','dimension_id']);
const MEANINGS={
  GKGRECORDID:'Original globally unique update/sequence text; T marks a record processed through GDELT machine translation.',
  DATE:'Original document publication timestamp YYYYMMDDHHMMSS;0 is an explicit unknown. This is distinct from mentioned event dates and source_batch.',
  SourceCollectionIdentifier:'Original source collection code; it determines how the document identifier should be interpreted.',
  SourceCommonName:'Original display name of the reporting source.',
  DocumentIdentifier:'Original URL, citation or repository identifier, interpreted with SourceCollectionIdentifier.',
  document_key:'SHA256 of the exact original collection-code/document-identifier pair; repeated records retain their own GKGRECORDID.',
  record_translated:'1 when the original record ID contains the GDELT translated-record marker;0 otherwise.',
  source_field:'Original GKG column from which this occurrence was derived.',
  occurrence_index:'One-based occurrence ordinal within the original source cell; repeated and unrecognized entries retain their position.',
  occurrence_kind:'Declared original source-field family, without inferred relationships.',
  raw_entry:'Complete original delimited occurrence text retained before parsing.',
  parse_status:'PARSED, PARTIAL_FIELD, RAW_UNRECOGNIZED or EMPTY_ENTRY describes this projection while preserving raw_entry.',
  character_offset:'Original approximate character offset within the source document; preserved as text.',
  character_length:'Original quote length, preserved as text.',
  country_code:'Original FIPS10-4 geographic country code; its meaning differs from CAMEO actor codes.',
  adm1_code:'Original source administrative division1 code.',
  adm2_code:'Original source administrative division2 code, including the original empty value.',
  latitude:'Original location centroid latitude as exact decimal text.',
  longitude:'Original location centroid longitude as exact decimal text.',
  feature_id:'Original geographic identifier; may be negative, textual or empty.',
  measure_key:'Original GCAM key or positional GKG tone dimension.',
  measure_value:'Exact original measure text; count, average score and word count are separate measure_kind values.',
  measure_kind:'Original measure class. Sparse absent GCAM dimensions do not create rows in this projection.',
  dictionary_id:'Original GCAM dictionary identifier; consult the publisher’s master codebook for names, language and citations.',
  dimension_id:'Original GCAM dimension identifier within its dictionary.',
  date_resolution:'Original1=year,2=year/month,3=full date,4=month/day without a year; zero components remain explicit.',
  TranslationInfo:'Original language/translation engine provenance. Blank also includes human-translated material supplied in English.',
  ExtrasXML:'Complete original extension XML as source text.',
  V2Tone:'Original seven-value comma-delimited tone/word-count cell.',
  GCAM:'Complete original sparse GCAM cell, including its original dictionary keys, word counts and scores.',
  tone_parse_status:'PARSED when all seven original tone values match their declared forms; original V2Tone always remains available.'
};
export function gkgColumnMeaning(name){
  const known=new Set([...GKG_FIELDS,...ARTICLE_EXTRA,...BASE,...OCCURRENCE,...ENTITY,...MEASURES,...DETAILS]);
  if(!known.has(name))return null;
  return {name,sourceField:GKG_FIELDS.includes(name)?name:null,type:INTEGER.has(name)?'integer':'string',
    nullable:!['source_batch','source_row','GKGRECORDID','source_field','occurrence_index','occurrence_kind','parse_status',
      'document_key','record_translated','tone_parse_status'].includes(name),
    encoding:INTEGER.has(name)?'exact-safe-integer':NUMERIC_TEXT.has(name)?'numeric-text':'source-text',
    meaning:MEANINGS[name]??'Original GKG source text or a direct source-cell projection; complete raw cells remain retained.'};
}
export function gkgCoverage(models){
  need(models.every(model=>model.format==='gkg'),'Select one source format for a review.');
  const rows=models.flatMap(model=>model.articles),keys=new Set(rows.map(row=>JSON.stringify([row.SourceCollectionIdentifier,row.DocumentIdentifier])));
  return {articles:rows.length,distinctDocumentIdentifiers:keys.size,translatedRecords:rows.filter(row=>/-T\d+$/.test(row.GKGRECORDID)).length,
    recordsWithLocations:rows.filter(row=>row.V2Locations!=='').length,recordsWithThemes:rows.filter(row=>row.V2Themes!=='').length};
}
export function compareGkgModels(before,after){
  need(before.format==='gkg'&&after.format==='gkg','Compare two original GKG captures.');
  const index=rows=>{
    const map=new Map();
    for(const row of rows){const key=JSON.stringify([row.SourceCollectionIdentifier,row.DocumentIdentifier]);const entries=map.get(key)??[];entries.push(row);map.set(key,entries);}
    return map;
  };
  const left=index(before.articles),right=index(after.articles),documents=[];
  for(const key of [...new Set([...left.keys(),...right.keys()])].sort()){
    const a=left.get(key)??[],b=right.get(key)??[],[collection,identifier]=JSON.parse(key);
    const count=rows=>{const result=new Map();for(const row of rows){const text=JSON.stringify(GKG_FIELDS.filter(name=>!['GKGRECORDID','DATE'].includes(name)).map(name=>row[name]));result.set(text,(result.get(text)??0)+1);}return result;};
    const ac=count(a),bc=count(b);let same=0;for(const [value,n] of ac)same+=Math.min(n,bc.get(value)??0);
    documents.push({documentKey:sha(key),SourceCollectionIdentifier:collection,DocumentIdentifier:identifier,
      status:!a.length?'ONLY_IN_AFTER_WINDOW':!b.length?'ONLY_IN_BEFORE_WINDOW':'IN_BOTH_WINDOWS',
      beforeRecords:a.map(row=>({GKGRECORDID:row.GKGRECORDID,source_row:row.source_row,DATE:row.DATE})),
      afterRecords:b.map(row=>({GKGRECORDID:row.GKGRECORDID,source_row:row.source_row,DATE:row.DATE})),
      identicalMetadataOccurrences:same,remainingBeforeOccurrences:a.length-same,remainingAfterOccurrences:b.length-same});
  }
  return {schema:'stellar-forge.gdelt-gkg-comparison.v1',beforeBatch:before.batch,afterBatch:after.batch,notice:GKG_NOTICE,
    identity:'Exact source collection/document identifier, retaining every record. Metadata comparison excludes only record ID and publication DATE; original values are listed separately.',
    before:gkgCoverage([before]),after:gkgCoverage([after]),documents};
}
