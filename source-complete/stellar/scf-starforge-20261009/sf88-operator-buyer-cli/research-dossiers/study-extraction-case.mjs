// MIT. Original NCT03529110 commissioning input for the maintained Research product.
import {isAbsolute,resolve} from 'node:path';
import {readResearchHostFile} from './workspace-files.mjs';
import {createSourceBundle,SOURCE_MANIFEST_SCHEMA} from './source-bundles.mjs';
import {extractionDigest} from './study-extraction.mjs';
import {digest,jsonBytes,need,object} from '../node/store.mjs';

export const STUDY_CASE_SCHEMA='sf88-study-extraction-commissioning-case/v1';
export const ORIGINAL_STUDY=Object.freeze({
  nctId:'NCT03529110',fileName:'NCT03529110_Original_Registry_Study.json',
  bytes:99951,sha256:'1e8f401843a30673b2d653ceb2682ad8f6d038af268a185c3333028d339d14c1',
  provenanceBytes:923,provenanceSha256:'97e7af80fa105e38307228f657744d6ecd0ac0da20f023ee8677ad01ceef8720',
  projectionBytes:22605,projectionSha256:'26fe9d252136ec2e2428c2c04dd7afa9f0ab4b5a70b0e8dabc20c8802fe4c093'
});
export const STUDY_CASE_REVIEWERS=Object.freeze([
  {id:'registry-extractor-a',name:'Registry extractor A'},
  {id:'registry-extractor-b',name:'Registry extractor B'},
  {id:'registry-resolver',name:'Registry review resolver'}
]);
const clone=value=>structuredClone(value);
const same=(a,b)=>extractionDigest(a)===extractionDigest(b);
const absent=()=>['NoneType',null];
const fields=[
  ['value','Reported value','decimal','Preserve the source string and its precision. A reported NA retains its explanatory status.'],
  ['lower_limit','Lower confidence bound','decimal','Retain the original bound separately from the point estimate.'],
  ['upper_limit','Upper confidence bound','decimal','Retain NA and the source comment when the bound is not estimable.'],
  ['comment','Measurement comment','text','Keep the complete original measurement comment; record an absent field explicitly.'],
  ['outcome_denominator','Outcome participant count','integer','Use this outcome/group denominator and retain its original unit and location.'],
  ['class_denominator','Class participant count','integer','Keep the class/group count separately from the outcome count.'],
  ['category_denominator','Category participant count','integer','Record the actual category container; an absent container remains absent.'],
  ['unit','Measurement unit','text','Use the original unitOfMeasure field.'],
  ['parameter_type','Parameter type','text','Retain the original paramType field.'],
  ['precision','Precision description','text','Retain the original dispersionType field.'],
  ['time_frame','Time frame','text','Keep the original timeFrame in full.'],
  ['population','Analysis population','text','Keep the complete original populationDescription.'],
  ['analyses','Reported comparative analyses','json','Retain the actual analyses field or its absence.']
];
export function studyExtractionDefinition({edition=1}={}){
  need(edition===1||edition===2,'STUDY_CASE_FORM_EDITION_INVALID');
  return {fields:fields.map(([id,label,valueType,instructions])=>({
    id,label,valueType,required:true,
    instructions:instructions+(edition===2?
      ' Review the original group and denominator scope before continuing this form edition.':'')
  })),reviewers:clone(STUDY_CASE_REVIEWERS),extractorIds:STUDY_CASE_REVIEWERS.slice(0,2).map(value=>value.id),
  resolverIds:[STUDY_CASE_REVIEWERS[2].id],minimumExtractions:2,
  disagreementProcedure:'Each extractor saves and submits its own complete draft. Compare the original typed source values and every submitted entry. Resolve each result with both current submission identities and a source-based reason; retain corrections and prior form editions.'};
}

function atPointer(value,pointer){
  need(typeof pointer==='string'&&(pointer===''||pointer.startsWith('/')),'STUDY_CASE_POINTER_INVALID');
  let selected=value;
  for(const raw of pointer===''?[]:pointer.slice(1).split('/')){
    need(!/~(?![01])/u.test(raw),'STUDY_CASE_POINTER_INVALID');
    const key=raw.replace(/~1/g,'/').replace(/~0/g,'~');
    if(selected===null||typeof selected!=='object'||!Object.hasOwn(selected,key))return {found:false};
    selected=selected[key];
  }
  return {found:true,value:selected};
}
const metadata=(value,children)=>Object.fromEntries(Object.entries(value).filter(([key])=>!children.includes(key)));
function requireProjection(study,projection){
  need(projection?.schema==='commons.clinicaltrials-original-result-projection.v1'&&
    projection.source?.sha256===ORIGINAL_STUDY.sha256&&projection.source?.bytes===ORIGINAL_STUDY.bytes&&
    projection.source?.nct_id===ORIGINAL_STUDY.nctId,'STUDY_CASE_PROJECTION_SOURCE_CHANGED');
  need(study?.protocolSection?.identificationModule?.nctId===ORIGINAL_STUDY.nctId,'STUDY_CASE_IDENTIFIER_CHANGED');
  const actual=study?.resultsSection?.outcomeMeasuresModule?.outcomeMeasures;
  need(Array.isArray(actual)&&Array.isArray(projection.outcomes)&&actual.length===5&&projection.outcomes.length===actual.length,
    'STUDY_CASE_OUTCOME_POPULATION_CHANGED');
  let classes=0,categories=0,measurements=0;
  const rows=[];
  for(const [oi,outcome]of projection.outcomes.entries()){
    const op='/resultsSection/outcomeMeasuresModule/outcomeMeasures/'+oi,original=actual[oi];
    need(outcome.json_pointer===op&&same(outcome.metadata,metadata(original,['classes']))&&
      outcome.classes.length===original.classes.length,'STUDY_CASE_OUTCOME_CHANGED');
    for(const [ci,groupClass]of outcome.classes.entries()){
      const cp=op+'/classes/'+ci,originalClass=original.classes[ci];classes++;
      need(groupClass.json_pointer===cp&&same(groupClass.metadata,metadata(originalClass,['categories']))&&
        groupClass.categories.length===originalClass.categories.length,'STUDY_CASE_CLASS_CHANGED');
      for(const [ki,category]of groupClass.categories.entries()){
        const kp=cp+'/categories/'+ki,originalCategory=originalClass.categories[ki];categories++;
        need(category.json_pointer===kp&&same(category.metadata,metadata(originalCategory,['measurements']))&&
          category.measurements.length===originalCategory.measurements.length,'STUDY_CASE_CATEGORY_CHANGED');
        for(const [mi,measurement]of category.measurements.entries()){
          const mp=kp+'/measurements/'+mi,originalMeasurement=originalCategory.measurements[mi];measurements++;
          need(measurement.json_pointer===mp&&same(measurement.original,originalMeasurement),
            'STUDY_CASE_MEASUREMENT_CHANGED');
          const groupIndex=outcome.metadata.groups.findIndex(value=>value.id===measurement.original.groupId);
          need(groupIndex>=0,'STUDY_CASE_GROUP_REQUIRED');
          rows.push({id:'outcome-'+oi+'-class-'+ci+'-category-'+ki+'-measurement-'+mi,
            label:outcome.metadata.title+' / '+(groupClass.metadata.title||'class '+ci)+' / '+outcome.metadata.groups[groupIndex].title,
            outcome,groupClass,category,measurement,groupIndex});
        }
      }
    }
  }
  need(classes===7&&categories===7&&measurements===14&&
    same(projection.counts,{outcomes:5,classes:7,categories:7,measurements:14}),'STUDY_CASE_CELL_POPULATION_CHANGED');
  return rows;
}
async function exactFile(file,bytes,sha256){
  need(typeof file==='string'&&isAbsolute(file)&&resolve(file)===file,'STUDY_CASE_ABSOLUTE_PATH_REQUIRED');
  const body=await readResearchHostFile(file,bytes,{sha256});
  need(body.length===bytes&&digest(body)===sha256,'STUDY_CASE_ORIGINAL_BYTES_CHANGED');
  return body;
}
export async function loadStudyExtractionInputs({studyFile,provenanceFile,projectionFile}){
  const raw=await exactFile(studyFile,ORIGINAL_STUDY.bytes,ORIGINAL_STUDY.sha256);
  const provenanceBytes=await exactFile(provenanceFile,ORIGINAL_STUDY.provenanceBytes,ORIGINAL_STUDY.provenanceSha256);
  const projectionBytes=await exactFile(projectionFile,ORIGINAL_STUDY.projectionBytes,ORIGINAL_STUDY.projectionSha256);
  const study=JSON.parse(raw.toString('utf8')),provenance=JSON.parse(provenanceBytes.toString('utf8')),
    projection=JSON.parse(projectionBytes.toString('utf8'));
  const rows=requireProjection(study,projection);
  need(provenance.schema==='stellar-forge.clinicaltrials-study-receiving.v1'&&
    provenance.rawJsonFile===ORIGINAL_STUDY.fileName&&provenance.sha256===ORIGINAL_STUDY.sha256&&
    provenance.source?.sha256===ORIGINAL_STUDY.sha256&&
    provenance.source?.captureId===projection.source.capture_id&&
    provenance.source?.pageReference?.sha256===projection.source.page_body_sha256,'STUDY_CASE_PROVENANCE_CHANGED');
  const manifest={schema:SOURCE_MANIFEST_SCHEMA,label:'NCT03529110 original registry source and result review',
    sourceReference:'https://clinicaltrials.gov/study/NCT03529110',
    sourceTerms:'Original ClinicalTrials.gov registry content, with the original capture locator and source URL retained.',
    description:'Review all original outcome measurements, their group context and denominator containers.',
    sources:[{key:'NCT03529110-original-study',title:study.protocolSection.identificationModule.briefTitle,
      url:'https://clinicaltrials.gov/study/NCT03529110',
      summary:'Original registry study, original capture provenance and complete source-field projection.',
      selected:true,classification:'unreviewed',
      note:'Retained for the question-specific commissioning review.',
      metadata:{nctId:ORIGINAL_STUDY.nctId,rawStudySha256:ORIGINAL_STUDY.sha256,
        captureId:provenance.source.captureId,sourceProjectionSha256:ORIGINAL_STUDY.projectionSha256},
      files:[ORIGINAL_STUDY.fileName,'original-provenance.json','original-result-projection.json']}]
  };
  const bundle=createSourceBundle({manifestBytes:jsonBytes(manifest),files:new Map([
    [ORIGINAL_STUDY.fileName,raw],['original-provenance.json',provenanceBytes],
    ['original-result-projection.json',projectionBytes]
  ])});
  return {raw,provenanceBytes,projectionBytes,study,provenance,projection,rows,bundle};
}

function denominator(container,containerPointer,groupId,scope){
  const groups=container.denoms;
  if(!Object.hasOwn(container,'denoms'))return {scope,pointer:containerPointer+'/denoms',found:false,units:null};
  need(Array.isArray(groups),'STUDY_CASE_DENOMINATOR_CONTAINER_INVALID');
  const matches=[];
  for(const [di,denom]of groups.entries())for(const [gi,count]of (denom.counts??[]).entries())
    if(count.groupId===groupId)matches.push({scope,pointer:containerPointer+'/denoms/'+di+'/counts/'+gi+'/value',
      unitsPointer:containerPointer+'/denoms/'+di+'/units',found:true,units:denom.units,
      containerPointer:containerPointer+'/denoms',container:clone(groups)});
  need(matches.length===1,'STUDY_CASE_DENOMINATOR_SELECTION_AMBIGUOUS');
  return matches[0];
}
function fieldPlan(row){
  const o=row.outcome,c=row.groupClass,k=row.category,m=row.measurement,g=m.original.groupId;
  const denominators=[
    denominator(o.metadata,o.json_pointer,g,'outcome'),
    denominator(c.metadata,c.json_pointer,g,'class'),
    denominator(k.metadata,k.json_pointer,g,'category')
  ];
  return {denominators,fields:[
    {id:'value',pointer:m.json_pointer+'/value'},
    {id:'lower_limit',pointer:m.json_pointer+'/lowerLimit'},
    {id:'upper_limit',pointer:m.json_pointer+'/upperLimit'},
    {id:'comment',pointer:m.json_pointer+'/comment'},
    ...denominators.map(value=>({id:value.scope+'_denominator',pointer:value.pointer,denominator:value})),
    {id:'unit',pointer:o.json_pointer+'/unitOfMeasure'},
    {id:'parameter_type',pointer:o.json_pointer+'/paramType'},
    {id:'precision',pointer:o.json_pointer+'/dispersionType'},
    {id:'time_frame',pointer:o.json_pointer+'/timeFrame'},
    {id:'population',pointer:o.json_pointer+'/populationDescription'},
    {id:'analyses',pointer:o.json_pointer+'/analyses'}
  ]};
}
export async function bindStudyExtractionCase({store,dossierId,questionId,occurrenceId,revision,inputs}){
  need(object(inputs)&&inputs.raw?.length===ORIGINAL_STUDY.bytes,'STUDY_CASE_INPUTS_REQUIRED');
  const planned=inputs.rows.map(row=>({row,...fieldPlan(row)}));
  const pointers=[...new Set(planned.flatMap(value=>value.fields.map(field=>field.pointer)))];
  const resolved=await store.extractionSourceValues(dossierId,{
    revision,occurrenceId,pointers,fileName:ORIGINAL_STUDY.fileName});
  need(resolved.schema==='sf88-research-extraction-source-values/v1'&&resolved.dossierId===dossierId&&
    resolved.revision===revision&&resolved.occurrence?.questionId===questionId&&
    resolved.occurrence?.occurrenceId===occurrenceId&&Array.isArray(resolved.values)&&
    resolved.values.length===pointers.length,'STUDY_CASE_SOURCE_RESOLUTION_CHANGED');
  const values=new Map(resolved.values.map(value=>[value.pointer,value]));
  need(values.size===pointers.length&&pointers.every(pointer=>values.has(pointer)),'STUDY_CASE_POINTER_POPULATION_CHANGED');
  const answers=[],rows=[];
  for(const {row,fields:plannedFields,denominators}of planned){
    const m=row.measurement,o=row.outcome,c=row.groupClass,k=row.category;
    const context={
      source:{nctId:ORIGINAL_STUDY.nctId,fileName:ORIGINAL_STUDY.fileName,sha256:ORIGINAL_STUDY.sha256,
        bytes:ORIGINAL_STUDY.bytes,occurrenceId,questionId},
      outcome:{pointer:o.json_pointer,metadata:clone(o.metadata)},
      class:{pointer:c.json_pointer,metadata:clone(c.metadata)},
      category:{pointer:k.json_pointer,metadata:clone(k.metadata)},
      group:{pointer:o.json_pointer+'/groups/'+row.groupIndex,metadata:clone(o.metadata.groups[row.groupIndex])},
      measurement:{pointer:m.json_pointer,original:clone(m.original)},
      denominators:clone(denominators)
    };
    rows.push({id:row.id,label:row.label,occurrenceIds:[occurrenceId],context});
    for(const field of plannedFields){
      const source=values.get(field.pointer),original=atPointer(inputs.study,field.pointer);
      need(source.kind==='json-pointer'&&source.file?.name===ORIGINAL_STUDY.fileName&&
        source.file.sha256===ORIGINAL_STUDY.sha256&&source.contentSha256===ORIGINAL_STUDY.sha256&&
        source.contentBytes===ORIGINAL_STUDY.bytes&&source.found===original.found,'STUDY_CASE_BOUND_SOURCE_CHANGED');
      // Container inspection above selects pointers only. The original Decimal
      // helper supplies every typed answer; JavaScript does not reinterpret numbers.
      if(source.found&&typeof original.value==='string')
        need(same(source.typedValue,['str',original.value]),'STUDY_CASE_SOURCE_STRING_CHANGED');
      const notEstimable=source.found&&source.typedValue?.[0]==='str'&&source.typedValue[1]==='NA';
      const note=!source.found?'The original registry has no field at '+field.pointer+'.':
        notEstimable?m.original.comment||'The original registry reports NA at this field.':
        'Retained from the original registry field.';
      answers.push({rowId:row.id,fieldId:field.id,status:!source.found?'not-reported':notEstimable?'not-estimable':'reported',
        value:source.found?clone(source.typedValue):absent(),
        bases:[{occurrenceId,kind:'json-pointer',pointer:field.pointer,fileName:ORIGINAL_STUDY.fileName}],
        context:field.denominator?{scope:field.denominator.scope,units:field.denominator.units,
          containerPointer:field.denominator.containerPointer??field.pointer}: {},
        note});
    }
  }
  need(rows.length===14&&answers.length===14*fields.length,'STUDY_CASE_ANSWER_POPULATION_CHANGED');
  const disagreementRow=rows.find(row=>row.context.measurement.pointer===
    '/resultsSection/outcomeMeasuresModule/outcomeMeasures/2/classes/0/categories/0/measurements/0');
  need(disagreementRow,'STUDY_CASE_DISAGREEMENT_ROW_REQUIRED');
  const canonical=answers.find(value=>value.rowId===disagreementRow.id&&value.fieldId==='value');
  need(same(canonical.value,['str','79.7']),'STUDY_CASE_ORIGINAL_ORR_CHANGED');
  const sourceCase={schema:STUDY_CASE_SCHEMA,source:clone(ORIGINAL_STUDY),dossierId,questionId,occurrenceId,
    sourceRevision:revision,sourceBinding:clone(resolved.occurrence),
    reviewers:clone(STUDY_CASE_REVIEWERS),definition:studyExtractionDefinition(),rows,answers,
    disagreement:{rowId:disagreementRow.id,fieldId:'value',actorId:STUDY_CASE_REVIEWERS[1].id,
      originalValue:clone(canonical.value),enteredValue:['str','79.0'],
      reason:'Commissioning operator entry: 79.0 was entered for the registry value 79.7. Review the original source and resolve the entry.'},
    sourcePointerCount:pointers.length};
  sourceCase.sha256=extractionDigest(sourceCase);
  return sourceCase;
}
export function studyCaseAnswers(sourceCase,{discrepant=false}={}){
  need(sourceCase?.schema===STUDY_CASE_SCHEMA,'STUDY_CASE_REQUIRED');
  const answers=clone(sourceCase.answers);
  if(discrepant){
    const choice=sourceCase.disagreement,answer=answers.find(value=>value.rowId===choice.rowId&&value.fieldId===choice.fieldId);
    need(answer&&same(answer.value,choice.originalValue),'STUDY_CASE_ORIGINAL_ANSWER_CHANGED');
    answer.value=clone(choice.enteredValue);answer.note=choice.reason;
  }
  return answers;
}
export function studyCaseTableDefinition(questionId,{edition=1}={}){
  const column=(id,label,pointer,format='text')=>({id,label,pointer,format,description:label});
  return {name:'NCT03529110 complete reported outcome table',description:
    'All fourteen original arm measurements with source-bound values, original populations, independent submissions and retained resolution history.',
    questionIds:[questionId],columns:[
      column('outcome','Outcome','/row/context/outcome/metadata/title'),
      column('assessment','Assessment class','/row/context/class/metadata/title'),
      column('group','Group','/row/context/group/metadata/title'),
      column('parameter','Parameter','/values/parameter_type/value','typed'),
      column('unit','Unit','/values/unit/value','typed'),
      column('value','Value','/values/value/value','typed'),
      column('lower','Lower bound','/values/lower_limit/value','typed'),
      column('upper','Upper bound','/values/upper_limit/value','typed'),
      column('precision','Precision','/values/precision/value','typed'),
      column('outcome_n','Outcome N','/values/outcome_denominator/value','typed'),
      column('class_n','Class N','/values/class_denominator/value','typed'),
      column('category_n','Category N','/values/category_denominator/value','typed'),
      column('population','Analysis population','/values/population/value','typed'),
      column('time_frame','Time frame','/values/time_frame/value','typed'),
      column('comment','Registry comment','/values/comment/value','typed'),
      ...(edition===2?[column('denominator_context','Original denominator scopes','/row/context/denominators','json')]:[])
    ],notes:'Values and bounds preserve their source strings. Denominators retain the outcome, class or category scope. Exact original source, complete result records and every prior edition accompany this table.'};
}
