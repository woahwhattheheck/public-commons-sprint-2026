// MIT. Enviro Data DTS8D (May 2026), composed with the original lab EDD workflow.
import { decodeLabWorkbooks, renderLabWorkbooks } from '../workbook.mjs';

export const DTS8D_VERSION = '8D-2026-05';
export const DTS8D_REFERENCE = 'https://geotech.com/documents/EnviroDataDTS8.pdf';
export const DTS8D_FIELDS = Object.freeze([
  {"name":"SiteName","key":"sitename","position":1,"type":"text","maxLength":50,"required":"sample","target":"Sites","source":{"page":12}},
  {"name":"StationName","key":"stationname","position":2,"type":"text","maxLength":50,"required":"sample","target":"Stations","source":{"page":12}},
  {"name":"SampleDate_D","key":"sampledate_d","position":3,"type":"datetime","required":"sample","target":"Samples","source":{"page":12}},
  {"name":"SampleTypeCode","key":"sampletypecode","position":4,"type":"text","maxLength":5,"required":"sample","target":"Samples","source":{"page":12}},
  {"name":"SampleMatrix","key":"samplematrix","position":5,"type":"text","maxLength":15,"required":"sample","target":"Samples","source":{"page":12}},
  {"name":"SampleTop","key":"sampletop","position":6,"type":"float32","required":"sample","target":"Samples","source":{"page":12}},
  {"name":"SampleBottom","key":"samplebottom","position":7,"type":"float32","required":"sample","target":"Samples","source":{"page":12}},
  {"name":"DepthUnits","key":"depthunits","position":8,"type":"text","maxLength":15,"required":"sample","target":"Samples","source":{"page":12}},
  {"name":"Duplicate","key":"duplicate","position":9,"type":"int16","required":false,"target":"Samples","source":{"page":12}},
  {"name":"FieldSampleID","key":"fieldsampleid","position":10,"type":"text","maxLength":40,"required":"sample","target":"Samples","source":{"page":12}},
  {"name":"AltSampleID","key":"altsampleid","position":11,"type":"text","maxLength":40,"required":false,"target":"Samples","source":{"page":12}},
  {"name":"CoolerID","key":"coolerid","position":12,"type":"text","maxLength":40,"required":false,"target":"Samples","source":{"page":12}},
  {"name":"Sampler","key":"sampler","position":13,"type":"text","maxLength":50,"required":false,"target":"Samples","source":{"page":12}},
  {"name":"Description","key":"description","position":14,"type":"text","maxLength":50,"required":false,"target":"Samples","source":{"page":12}},
  {"name":"SampleMethodCode","key":"samplemethodcode","position":15,"type":"text","maxLength":4,"required":"sample","target":"Samples","source":{"page":12}},
  {"name":"LogCode","key":"logcode","position":16,"type":"text","maxLength":4,"required":false,"target":"Samples","source":{"page":12}},
  {"name":"COCNumber","key":"cocnumber","position":17,"type":"text","maxLength":40,"required":false,"target":"Samples","source":{"page":12}},
  {"name":"DeliveryGroup","key":"deliverygroup","position":18,"type":"text","maxLength":25,"required":false,"target":"Analyses","source":{"page":12}},
  {"name":"AmbientBlankLot","key":"ambientblanklot","position":19,"type":"text","maxLength":8,"required":false,"target":"Samples","source":{"page":12}},
  {"name":"EquipmentBlankLot","key":"equipmentblanklot","position":20,"type":"text","maxLength":8,"required":false,"target":"Samples","source":{"page":12}},
  {"name":"TripBlankLot","key":"tripblanklot","position":21,"type":"text","maxLength":8,"required":false,"target":"Samples","source":{"page":12}},
  {"name":"FilteredSample","key":"filteredsample","position":22,"type":"text","maxLength":20,"required":"sample","target":"Samples","source":{"page":12}},
  {"name":"QCSequenceID","key":"qcsequenceid","position":23,"type":"text","maxLength":40,"required":false,"target":"Samples","source":{"page":12}},
  {"name":"QCSampleCode","key":"qcsamplecode","position":24,"type":"text","maxLength":3,"required":"sample","target":"Samples","source":{"page":12}},
  {"name":"TaskNumber","key":"tasknumber","position":25,"type":"text","maxLength":40,"required":false,"target":"Samples","source":{"page":12}},
  {"name":"PrimarySample","key":"primarysample","position":26,"type":"text","maxLength":40,"required":false,"target":"Samples","source":{"page":12}},
  {"name":"SampleResult","key":"sampleresult","position":27,"type":"text","maxLength":255,"required":false,"target":"Samples","source":{"page":12}},
  {"name":"Container","key":"container","position":28,"type":"text","maxLength":30,"required":false,"target":"Samples","source":{"page":12}},
  {"name":"NumContainers","key":"numcontainers","position":29,"type":"int16","required":false,"target":"Samples","source":{"page":12}},
  {"name":"CoolerTemp","key":"coolertemp","position":30,"type":"float32","required":false,"target":"Samples","source":{"page":12}},
  {"name":"FieldEquip","key":"fieldequip","position":31,"type":"text","maxLength":60,"required":false,"target":"Samples","source":{"page":12}},
  {"name":"GeologicUnitCode","key":"geologicunitcode","position":32,"type":"text","maxLength":5,"required":"sample","target":"Samples","source":{"page":12}},
  {"name":"LithologyCode","key":"lithologycode","position":33,"type":"text","maxLength":5,"required":"sample","target":"Samples","source":{"page":12}},
  {"name":"Odor","key":"odor","position":34,"type":"text","maxLength":15,"required":false,"target":"Samples","source":{"page":12}},
  {"name":"Preservation","key":"preservation","position":35,"type":"text","maxLength":20,"required":false,"target":"Samples","source":{"page":12}},
  {"name":"PumpFault","key":"pumpfault","position":36,"type":"text","maxLength":1,"required":false,"target":"Samples","source":{"page":12}},
  {"name":"Purged","key":"purged","position":37,"type":"text","maxLength":1,"required":false,"target":"Samples","source":{"page":12}},
  {"name":"QAPlanNumber","key":"qaplannumber","position":38,"type":"text","maxLength":50,"required":false,"target":"Samples","source":{"page":12}},
  {"name":"SampConcentration","key":"sampconcentration","position":39,"type":"text","maxLength":20,"required":false,"target":"Analyses","source":{"page":12}},
  {"name":"SampleCollProc","key":"samplecollproc","position":40,"type":"text","maxLength":8,"required":false,"target":"Samples","source":{"page":13}},
  {"name":"SampleEventName","key":"sampleeventname","position":41,"type":"text","maxLength":50,"required":false,"target":"Samples","source":{"page":13}},
  {"name":"SampleEventID","key":"sampleeventid","position":42,"type":"int32","required":false,"target":"Samples","source":{"page":13}},
  {"name":"SamplePurposeCode","key":"samplepurposecode","position":43,"type":"text","maxLength":2,"required":"sample","target":"Samples","source":{"page":13}},
  {"name":"SampleSource","key":"samplesource","position":44,"type":"text","maxLength":5,"required":false,"target":"Samples","source":{"page":13}},
  {"name":"Witness","key":"witness","position":45,"type":"text","maxLength":30,"required":false,"target":"Samples","source":{"page":13}},
  {"name":"TaxonSerial","key":"taxonserial","position":46,"type":"text","maxLength":6,"required":false,"target":"Samples","source":{"page":13}},
  {"name":"GenderCode","key":"gendercode","position":47,"type":"text","maxLength":12,"required":false,"target":"Samples","source":{"page":13}},
  {"name":"LifeStageCode","key":"lifestagecode","position":48,"type":"text","maxLength":12,"required":false,"target":"Samples","source":{"page":13}},
  {"name":"TissueTypeCode","key":"tissuetypecode","position":49,"type":"text","maxLength":12,"required":false,"target":"Samples","source":{"page":13}},
  {"name":"ParameterName","key":"parametername","position":50,"type":"text","maxLength":20,"required":"analysis","target":"Analyses","source":{"page":13,"note":"The superscript 6 before 20 is the text-width footnote in the table."}},
  {"name":"CASNumber","key":"casnumber","position":51,"type":"text","maxLength":20,"required":false,"target":"Analyses","source":{"page":13}},
  {"name":"AltParamNumber","key":"altparamnumber","position":52,"type":"text","maxLength":20,"required":false,"target":"Analyses","source":{"page":13}},
  {"name":"STORETCode","key":"storetcode","position":53,"type":"text","maxLength":5,"required":false,"target":"ParameterUnits","source":{"page":13}},
  {"name":"Superseded","key":"superseded","position":54,"type":"int16","required":false,"target":"Analyses","source":{"page":13}},
  {"name":"AnalyticMethod","key":"analyticmethod","position":55,"type":"text","maxLength":40,"required":"analysis","target":"Analyses","source":{"page":13}},
  {"name":"Value","key":"value","position":56,"type":"text","maxLength":50,"required":false,"target":"Analyses","source":{"page":13,"note":"The explicit content rule on page 7 and revision on page 27 specify 50 characters; the layout table still shows 25."}},
  {"name":"ReportingUnits","key":"reportingunits","position":57,"type":"text","maxLength":15,"required":"analysis","target":"Analyses","source":{"page":13}},
  {"name":"FlagCode","key":"flagcode","position":58,"type":"text","maxLength":20,"required":"analysis","target":"Analyses","source":{"page":13}},
  {"name":"ProblemCode","key":"problemcode","position":59,"type":"text","maxLength":20,"required":"analysis","target":"Analyses","source":{"page":13}},
  {"name":"ValidationCode","key":"validationcode","position":60,"type":"text","maxLength":20,"required":"analysis","target":"Analyses","source":{"page":13}},
  {"name":"DetectedResult","key":"detectedresult","position":61,"type":"text","maxLength":1,"required":false,"target":"Analyses","source":{"page":13}},
  {"name":"Detect","key":"detect","position":62,"type":"float32","required":false,"target":"Analyses","source":{"page":13}},
  {"name":"LimitType","key":"limittype","position":63,"type":"text","maxLength":4,"required":false,"target":"Analyses","source":{"page":13}},
  {"name":"Detect2","key":"detect2","position":64,"type":"float32","required":false,"target":"Analyses","source":{"page":13}},
  {"name":"LimitType2","key":"limittype2","position":65,"type":"text","maxLength":4,"required":false,"target":"Analyses","source":{"page":13}},
  {"name":"Detect3","key":"detect3","position":66,"type":"float32","required":false,"target":"Analyses","source":{"page":13}},
  {"name":"LimitType3","key":"limittype3","position":67,"type":"text","maxLength":4,"required":false,"target":"Analyses","source":{"page":13}},
  {"name":"Detect4","key":"detect4","position":68,"type":"float32","required":false,"target":"Analyses","source":{"page":13}},
  {"name":"LimitType4","key":"limittype4","position":69,"type":"text","maxLength":4,"required":false,"target":"Analyses","source":{"page":13}},
  {"name":"Detect5","key":"detect5","position":70,"type":"float32","required":false,"target":"Analyses","source":{"page":13}},
  {"name":"LimitType5","key":"limittype5","position":71,"type":"text","maxLength":4,"required":false,"target":"Analyses","source":{"page":13}},
  {"name":"SpikeAmount","key":"spikeamount","position":72,"type":"float32","required":false,"target":"Analyses","source":{"page":13}},
  {"name":"RetentionTime","key":"retentiontime","position":73,"type":"float32","required":false,"target":"Analyses","source":{"page":13}},
  {"name":"Error","key":"error","position":74,"type":"float32","required":false,"target":"Analyses","source":{"page":13}},
  {"name":"DilutionFactor","key":"dilutionfactor","position":75,"type":"float32","required":false,"target":"Analyses","source":{"page":13}},
  {"name":"Basis","key":"basis","position":76,"type":"text","maxLength":1,"required":"analysis","target":"Analyses","source":{"page":13}},
  {"name":"FilteredAnalysis","key":"filteredanalysis","position":77,"type":"text","maxLength":20,"required":"analysis","target":"Analyses","source":{"page":13}},
  {"name":"LeachMethod","key":"leachmethod","position":78,"type":"text","maxLength":20,"required":"analysis","target":"Analyses","source":{"page":13}},
  {"name":"LeachateBatch","key":"leachatebatch","position":79,"type":"text","maxLength":12,"required":false,"target":"Analyses","source":{"page":13}},
  {"name":"LeachDate_D","key":"leachdate_d","position":80,"type":"datetime","required":false,"target":"Analyses","source":{"page":13}},
  {"name":"PrepMethod","key":"prepmethod","position":81,"type":"text","maxLength":40,"required":false,"target":"Analyses","source":{"page":13}},
  {"name":"PreparationLot","key":"preparationlot","position":82,"type":"text","maxLength":10,"required":false,"target":"Analyses","source":{"page":13}},
  {"name":"ReportableResult","key":"reportableresult","position":83,"type":"text","maxLength":1,"required":false,"target":"Analyses","source":{"page":13}},
  {"name":"AnalDate_D","key":"analdate_d","position":84,"type":"datetime","required":false,"target":"Analyses","source":{"page":13}},
  {"name":"ExtractDate_D","key":"extractdate_d","position":85,"type":"datetime","required":false,"target":"Analyses","source":{"page":13}},
  {"name":"LabReportDate_D","key":"labreportdate_d","position":86,"type":"datetime","required":false,"target":"Analyses","source":{"page":13}},
  {"name":"LabRecvDate_D","key":"labrecvdate_d","position":87,"type":"datetime","required":false,"target":"Samples","source":{"page":13}},
  {"name":"Lab","key":"lab","position":88,"type":"text","maxLength":20,"required":false,"target":"Analyses","source":{"page":13}},
  {"name":"LabComments","key":"labcomments","position":89,"type":"text","maxLength":50,"required":false,"target":"Analyses","source":{"page":13}},
  {"name":"AnalysisLabID","key":"analysislabid","position":90,"type":"text","maxLength":40,"required":false,"target":"Analyses","source":{"page":13}},
  {"name":"AnalyticalBatch","key":"analyticalbatch","position":91,"type":"text","maxLength":40,"required":false,"target":"Analyses","source":{"page":13}},
  {"name":"ValueCode","key":"valuecode","position":92,"type":"text","maxLength":6,"required":"analysis","target":"Analyses","source":{"page":13}},
  {"name":"RunCode","key":"runcode","position":93,"type":"text","maxLength":5,"required":"analysis","target":"Analyses","source":{"page":13}},
  {"name":"QCAnalysisCode","key":"qcanalysiscode","position":94,"type":"text","maxLength":3,"required":"analysis","target":"Analyses","source":{"page":13}},
  {"name":"AnalysisGroup","key":"analysisgroup","position":95,"type":"text","maxLength":20,"required":false,"target":"Analyses","source":{"page":13}},
  {"name":"AnalysisLocationCode","key":"analysislocationcode","position":96,"type":"text","maxLength":2,"required":"analysis","target":"Analyses","source":{"page":13}},
  {"name":"BatchTypeCode","key":"batchtypecode","position":97,"type":"text","maxLength":2,"required":"analysis","target":"Analyses","source":{"page":13}},
  {"name":"Cleanup","key":"cleanup","position":98,"type":"text","maxLength":50,"required":false,"target":"Analyses","source":{"page":13}},
  {"name":"DetectorMode","key":"detectormode","position":99,"type":"text","maxLength":50,"required":false,"target":"Analyses","source":{"page":13}},
  {"name":"DetectorType","key":"detectortype","position":100,"type":"text","maxLength":50,"required":false,"target":"Analyses","source":{"page":13}},
  {"name":"ExpectedValue","key":"expectedvalue","position":101,"type":"float64","required":false,"target":"Analyses","source":{"page":13}},
  {"name":"Extracted","key":"extracted","position":102,"type":"text","maxLength":1,"required":false,"target":"Analyses","source":{"page":13}},
  {"name":"HandlingBatch","key":"handlingbatch","position":103,"type":"text","maxLength":12,"required":false,"target":"Analyses","source":{"page":13}},
  {"name":"HandlingType","key":"handlingtype","position":104,"type":"text","maxLength":50,"required":false,"target":"Analyses","source":{"page":13}},
  {"name":"InstrumentCalibBy","key":"instrumentcalibby","position":105,"type":"text","maxLength":50,"required":false,"target":"Analyses","source":{"page":13}},
  {"name":"InstrumentCalibDate_D","key":"instrumentcalibdate_d","position":106,"type":"datetime","required":false,"target":"Analyses","source":{"page":14}},
  {"name":"InstrumentManufacturer","key":"instrumentmanufacturer","position":107,"type":"text","maxLength":50,"required":false,"target":"Analyses","source":{"page":14}},
  {"name":"InstrumentModel","key":"instrumentmodel","position":108,"type":"text","maxLength":50,"required":false,"target":"Analyses","source":{"page":14}},
  {"name":"InstrumentNum","key":"instrumentnum","position":109,"type":"text","maxLength":20,"required":false,"target":"Analyses","source":{"page":14}},
  {"name":"LabMatrixCode","key":"labmatrixcode","position":110,"type":"text","maxLength":2,"required":"analysis","target":"Analyses","source":{"page":14}},
  {"name":"LabPrepDate_D","key":"labprepdate_d","position":111,"type":"datetime","required":false,"target":"Analyses","source":{"page":14}},
  {"name":"LabReportNum","key":"labreportnum","position":112,"type":"text","maxLength":20,"required":false,"target":"Analyses","source":{"page":14}},
  {"name":"LabSampleID","key":"labsampleid","position":113,"type":"text","maxLength":40,"required":"analysis","target":"Analyses","source":{"page":14}},
  {"name":"MethodBatch","key":"methodbatch","position":114,"type":"text","maxLength":12,"required":false,"target":"Analyses","source":{"page":14}},
  {"name":"NumberDecimals","key":"numberdecimals","position":115,"type":"int16","required":false,"target":"Analyses","source":{"page":14}},
  {"name":"PercentRecovery","key":"percentrecovery","position":116,"type":"float32","required":false,"target":"Analyses","source":{"page":14}},
  {"name":"PrepBatch","key":"prepbatch","position":117,"type":"text","maxLength":12,"required":false,"target":"Analyses","source":{"page":14}},
  {"name":"PreserveIntact","key":"preserveintact","position":118,"type":"text","maxLength":1,"required":false,"target":"Analyses","source":{"page":14}},
  {"name":"RunBatch","key":"runbatch","position":119,"type":"text","maxLength":12,"required":false,"target":"Analyses","source":{"page":14}},
  {"name":"StatTypeCode","key":"stattypecode","position":120,"type":"text","maxLength":2,"required":"analysis","target":"Analyses","source":{"page":14}},
  {"name":"StdRefMaterial","key":"stdrefmaterial","position":121,"type":"text","maxLength":8,"required":false,"target":"Analyses","source":{"page":14}},
  {"name":"SubcontractLab","key":"subcontractlab","position":122,"type":"text","maxLength":20,"required":false,"target":"Analyses","source":{"page":14}},
  {"name":"ValidationComments","key":"validationcomments","position":123,"type":"text","maxLength":50,"required":false,"target":"Analyses","source":{"page":14}},
  {"name":"Validator","key":"validator","position":124,"type":"text","maxLength":20,"required":false,"target":"Analyses","source":{"page":14}},
  {"name":"ValueTypeCode","key":"valuetypecode","position":125,"type":"text","maxLength":2,"required":"analysis","target":"Analyses","source":{"page":14}},
  {"name":"WeightVolume","key":"weightvolume","position":126,"type":"float64","required":false,"target":"Analyses","source":{"page":14}},
  {"name":"WeightVolUnits","key":"weightvolunits","position":127,"type":"text","maxLength":4,"required":"analysis","target":"Analyses","source":{"page":14}},
  {"name":"UpperControlLimit","key":"uppercontrollimit","position":128,"type":"float32","required":false,"target":"Analyses","source":{"page":14}},
  {"name":"LowerControlLimit","key":"lowercontrollimit","position":129,"type":"float32","required":false,"target":"Analyses","source":{"page":14}},
  {"name":"RejectionControlLimit","key":"rejectioncontrollimit","position":130,"type":"float32","required":false,"target":"Analyses","source":{"page":14}},
  {"name":"RPDLimit","key":"rpdlimit","position":131,"type":"int16","required":false,"target":"Analyses","source":{"page":14}},
  {"name":"APDLimit","key":"apdlimit","position":132,"type":"int16","required":false,"target":"Analyses","source":{"page":14}},
  {"name":"CatResult","key":"catresult","position":133,"type":"text","maxLength":20,"required":false,"target":"Analyses","source":{"page":14}},
  {"name":"AnalysesTaxonSerial","key":"analysestaxonserial","position":134,"type":"text","maxLength":6,"required":false,"target":"Analyses","source":{"page":14}},
  {"name":"AnalysesLifeStageCode","key":"analyseslifestagecode","position":135,"type":"text","maxLength":12,"required":false,"target":"Analyses","source":{"page":14}},
  {"name":"BlankFlagCode","key":"blankflagcode","position":136,"type":"text","maxLength":12,"required":false,"target":"Analyses","source":{"page":14}},
  {"name":"FinalValue","key":"finalvalue","position":137,"type":"float64","required":false,"target":"Analyses","source":{"page":14}},
  {"name":"FinalQualifier","key":"finalqualifier","position":138,"type":"text","maxLength":25,"required":false,"target":"Analyses","source":{"page":14,"note":"Appendix B page 27 declares Text-25 for version 8; the layout table's numeric type conflicts with that explicit revision."}},
  {"name":"RPD","key":"rpd","position":139,"type":"float32","required":false,"target":"Samples","source":{"page":14}},
  {"name":"SampleEndDate_D","key":"sampleenddate_d","position":140,"type":"datetime","required":false,"target":"Samples","source":{"page":14}},
  {"name":"SampleStatusCode","key":"samplestatuscode","position":141,"type":"text","maxLength":10,"required":false,"target":"Samples","source":{"page":14}},
  {"name":"Sample_X","key":"sample_x","position":142,"type":"float64","required":false,"target":"Samples","source":{"page":14}},
  {"name":"Sample_Y","key":"sample_y","position":143,"type":"float64","required":false,"target":"Samples","source":{"page":14}},
  {"name":"Sample_Z","key":"sample_z","position":144,"type":"float64","required":false,"target":"Samples","source":{"page":14}},
  {"name":"StationReach","key":"stationreach","position":145,"type":"float64","required":false,"target":"Samples","source":{"page":14}},
  {"name":"PercentMoisture","key":"percentmoisture","position":146,"type":"float64","required":false,"target":"Analyses","source":{"page":14}},
  {"name":"ValReason1","key":"valreason1","position":147,"type":"text","maxLength":255,"required":false,"target":"Analyses","source":{"page":14}},
  {"name":"ValReason2","key":"valreason2","position":148,"type":"text","maxLength":255,"required":false,"target":"Analyses","source":{"page":14}},
  {"name":"ValReason3","key":"valreason3","position":149,"type":"text","maxLength":255,"required":false,"target":"Analyses","source":{"page":14}},
  {"name":"ValReason4","key":"valreason4","position":150,"type":"text","maxLength":255,"required":false,"target":"Analyses","source":{"page":14}}
].map(field => Object.freeze(field)));
export const DTS8D_HEADERS = Object.freeze(DTS8D_FIELDS.map(field => field.name));
const BY_KEY = new Map(DTS8D_FIELDS.map(field => [field.key, field]));
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const BOOLS = new Map([['detectedresult', new Set(['y','n','p'])],
  ...['pumpfault','purged','reportableresult','extracted','preserveintact'].map(key => [key,new Set(['y','n'])]),
  ['basis',new Set(['w','d','n','z'])]]);
const FLAGS = ['flagcode','problemcode','validationcode'];
// These lookup fields explicitly accept the full description as well as the stored code.
const CODE_OR_DESCRIPTION = new Set(['sampletypecode','samplematrix','depthunits','samplemethodcode',
  'filteredsample','qcsamplecode','geologicunitcode','lithologycode','samplepurposecode',
  'reportingunits','filteredanalysis','valuecode','runcode','qcanalysiscode']);
// Parameter aliases and client lookups are resolved by the receiving Enviro Data configuration.
const LOOKUP_FIELDS = new Set([...CODE_OR_DESCRIPTION,'parametername','analyticmethod','leachmethod',
  'labmatrixcode','analysislocationcode','batchtypecode','stattypecode','valuetypecode','weightvolunits',
  'gendercode','lifestagecode','tissuetypecode','catresult','analyseslifestagecode','samplestatuscode']);
const SAMPLE_KEYS = ['sitename','stationname','sampledate_d','samplematrix','sampletop','samplebottom','filteredsample'];
const SAMPLE_ATTRIBUTES = DTS8D_FIELDS.filter(field => ['Samples','Sites','Stations'].includes(field.target)).map(field => field.key);
const ANALYSIS_KEYS = ['parametername','casnumber','altparamnumber','analyticmethod','reportingunits',
  'filteredanalysis','leachmethod','prepmethod','lab','qcanalysiscode','runcode'];
const key = value => String(value ?? '').trim().toLowerCase().replace(/^#/,'');
const blank = value => value === undefined || value === null || String(value).trim() === '';
const exact = (row, field) => String(row.values?.[field] ?? '');
const tuple = values => JSON.stringify(values);
const add = (map, id, value) => { if (!map.has(id)) map.set(id, []); map.get(id).push(value); };
const identity = row => tuple(SAMPLE_KEYS.map(field => field === 'sampledate_d' ? calendarDate(row,field) : exact(row,field)));
function literalChoice(row,field) { return row.changes?.some(choice=>choice.field===field&&choice.action!=='keep')??false; }
function cellOf(table, row, field) {
  if(literalChoice(row,field))return null;
  const index = table.keys.indexOf(field); return index < 0 ? null : row.cells?.[index] ?? null;
}
function calendarDate(row, field) {
  const cell = literalChoice(row,field)?null:row.cells?.find(cell => key(cell?.field ?? '') === field);
  if (cell?.calendar?.date) return cell.calendar.date;
  const value=exact(row,field);
  if(!validCalendar(value))return value;
  const iso=/^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value);
  const us=/^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(value);
  const [year,month,day]=iso?iso.slice(1):[us[3],us[1],us[2]];
  return year+'-'+month.padStart(2,'0')+'-'+day.padStart(2,'0');
}
function observation(row) { return ['parametername','casnumber','altparamnumber'].some(field => !blank(exact(row,field))); }
function physicalSample(row) {
  return tuple([identity(row),exact(row,'duplicate'),exact(row,'fieldsampleid'),
    exact(row,'qcsamplecode'),exact(row,'labsampleid')]);
}
function parameterGroup(row) { return tuple([physicalSample(row),...ANALYSIS_KEYS.map(field => exact(row,field))]); }
function reference(page) { return DTS8D_REFERENCE + '#page=' + page; }
function validCalendar(value) {
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](.*))?$/.exec(value);
  const match = isoMatch || /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](.*))?$/.exec(value);
  if (!match) return false;
  const iso = !!isoMatch, year=Number(match[iso?1:3]), month=Number(match[iso?2:1]), day=Number(match[iso?3:2]);
  const leap=year%4===0&&(year%100!==0||year%400===0), days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if (year<1000||year>9999||month<1||month>12||day<1||day>days[month-1]) return false;
  if (!match[4]) return true;
  const time=/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:\s*(AM|PM))?(?:Z|([+-])(\d{2}):(\d{2}))?$/i.exec(match[4]);
  return !!time && Number(time[1])<=(time[5]?12:23) && (!time[5]||Number(time[1])>=1) &&
    Number(time[2])<=59 && (time[3]===undefined||Number(time[3])<=59) &&
    (time[6]===undefined||Number(time[7])<=23&&Number(time[8])<=59);
}
function significantDigits(value) {
  const [mantissa]=value.replace(/^[+-]/,'').split(/[eE]/);
  return mantissa.replace('.','').replace(/^0+/,'').length;
}
export function dts8dRecordKey({row}) {
  return tuple([physicalSample(row),...ANALYSIS_KEYS.map(field=>exact(row,field)),
    exact(row,'superseded'),exact(row,'analysislabid'),exact(row,'valuecode')]);
}
export function analyzeDts8d({sourceSha256,tables}) {
  const issues=[],lineage=[],sampleGroups=new Map(),duplicateGroups=new Map(),analysisGroups=new Map(),fieldIds=new Map();
  const rowFields=new Map(tables.flatMap(table=>(table.rows??[]).map(row=>[row.recordId,new Set(table.keys??[])])));
  const stats={workbooks:new Set(),tables:tables.length,rows:0,samples:0,analyses:0,sampleOnlyRows:0,
    detected:0,notDetected:0,pendingDetection:0,implicitDetection:0,detectionLimits:0,
    automaticDuplicateRows:0,automaticSupersededRows:0,exactNumericTextValues:0,formulaCells:0,errorCells:0};
  function issue(code,severity,message,targets=[],details={},page=12) {
    issues.push({code,severity,message,targets:targets.map(target=>target.field&&!rowFields.get(target.recordId)?.has(target.field)?
      {recordId:target.recordId}:target),reference:reference(page),details});
  }
  if (!tables.length) issue('DTS8D_WORKBOOK_REQUIRED','error','Select an original DTS8D workbook with its observation sheet.');
  for (const table of tables) {
    const origin=table.origin??{}, rows=table.rows??[], headers=table.headers??[];
    if (origin.containerSha256) stats.workbooks.add(origin.containerSha256);
    if (origin.format!=='xlsx') issue('DTS8D_XLSX_REQUIRED','error','The native DTS8D receiving output is an Excel workbook.',[],{tableId:table.id});
    if (origin.sheetCount!==1) issue('DTS8D_ONE_SHEET','error','DTS8D requires the first and only worksheet.',[],{tableId:table.id,sheets:origin.sheetCount});
    if (headers.length!==DTS8D_HEADERS.length || headers.some((name,index)=>name!==DTS8D_HEADERS[index]))
      issue('DTS8D_COLUMN_LAYOUT','error','Use the 150 exact first-row field names in the published DTS8D order.',[],
        {tableId:table.id,expected:DTS8D_HEADERS,actual:headers,
         differences:DTS8D_HEADERS.flatMap((name,index)=>headers[index]===name?[]:[{column:index+1,expected:name,actual:headers[index]??null}]),
         additional:headers.slice(DTS8D_HEADERS.length)});
    if (new Set(headers.map(key)).size!==headers.length) issue('DTS8D_DUPLICATE_HEADERS','error','Repeated headers cannot identify one original field.',[],{tableId:table.id});
    if (origin.mergedRanges?.length) issue('DTS8D_MERGED_CELLS','error','Observation data needs one independent cell per field.',[],{tableId:table.id,ranges:origin.mergedRanges});
    const headerProblems=(origin.headerCells??[]).filter(cell=>cell?.formula!=null||cell?.type==='error');
    if(headerProblems.length)issue('DTS8D_HEADER_LITERAL','error','First-row field names must be literal values.',[],
      {tableId:table.id,cells:headerProblems.map(cell=>cell.cell)});
    if(origin.externalRelationships||origin.externalDataParts?.length)issue('DTS8D_EXTERNAL_DATA','error',
      'Use a data-only workbook with its laboratory values stored in the source cells.',[],
      {tableId:table.id,relationships:origin.externalRelationships,parts:origin.externalDataParts??[]});
    for (const row of rows) {
      stats.rows++;
      const isAnalysis=observation(row), targets=field=>[{recordId:row.recordId,field}];
      if(isAnalysis)stats.analyses++;else stats.sampleOnlyRows++;
      const sampleId=physicalSample(row), duplicateId=identity(row), analyticalId=parameterGroup(row);
      add(sampleGroups,sampleId,{table,row});
      add(duplicateGroups,duplicateId,{table,row,sampleId});
      if(isAnalysis)add(analysisGroups,analyticalId,{table,row});
      if(!blank(exact(row,'fieldsampleid')))add(fieldIds,tuple([exact(row,'sitename'),exact(row,'fieldsampleid')]),sampleId);
      const limits=[];
      for(const field of DTS8D_FIELDS) {
        const value=exact(row,field.key), cell=cellOf(table,row,field.key);
        if(cell?.formula!=null){stats.formulaCells++;issue('DTS8D_FORMULA','error','Choose a literal laboratory value for this calculated cell.',targets(field.key),
          {cell:cell.cell,formula:cell.formula,cached:cell.cachedPresent},field.source.page);}
        if(cell?.type==='error'){stats.errorCells++;issue('DTS8D_CELL_ERROR','error','The original Excel cell contains an error value.',targets(field.key),{value},field.source.page);}
        if(blank(value)) {
          if(field.required==='sample'||field.required==='analysis'&&isAnalysis) {
            if(field.key==='parametername'&&(!blank(exact(row,'casnumber'))||!blank(exact(row,'altparamnumber'))))
              issue('DTS8D_PARAMETER_LOOKUP','review','Resolve the supplied parameter identifier against the client reference list.',targets(field.key),
                {casNumber:exact(row,'casnumber'),altParamNumber:exact(row,'altparamnumber')},7);
            else issue('DTS8D_REQUIRED_VALUE','error','Populate the required '+field.name+' field for this '+(isAnalysis?'observation':'sample')+'.',targets(field.key),{},field.source.page);
          }
          continue;
        }
        if(field.maxLength&&Array.from(value).length>field.maxLength) {
          const lookup=LOOKUP_FIELDS.has(field.key);
          issue(lookup?'DTS8D_LOOKUP_LABEL':'DTS8D_TEXT_WIDTH',lookup?'info':'error',
            lookup?'The complete lookup label is retained for resolution in the receiving configuration.':field.name+' exceeds its published text width.',
            targets(field.key),{characters:Array.from(value).length,codeWidth:lookup?field.maxLength:undefined,
              maximum:lookup?undefined:field.maxLength,codeOrDescription:CODE_OR_DESCRIPTION.has(field.key)},field.source.page);
        }
        if(field.key==='value'&&value.length>25&&value.length<=50) issue('DTS8D_VALUE_REVISION','info',
          'The complete value follows the 50-character content rule and revision history.',targets(field.key),{characters:value.length},27);
        if(BOOLS.has(field.key)&&!BOOLS.get(field.key).has(value.toLowerCase())) issue('DTS8D_CODE_SHAPE','error',
          'Use the published '+field.name+' code.',targets(field.key),{value,allowed:[...BOOLS.get(field.key)]},field.key==='detectedresult'?8:field.source.page);
        if(FLAGS.includes(field.key)) {
          const flags=value.split(/[ ,]+/).filter(Boolean);
          if(flags.length<1||flags.length>4||flags.some(flag=>flag.length>4)) issue('DTS8D_QUALIFIERS','error',
            'A qualifier contains one to four codes of at most four characters, separated by spaces or commas.',targets(field.key),{value,flags},3);
        }
        if(field.type==='datetime') {
          if(cell?.calendar?.error) issue('DTS8D_DATE','error',cell.calendar.error,targets(field.key),{raw:value,epoch:origin.epoch},3);
          else if(!cell?.calendar?.iso&&!validCalendar(value)) issue('DTS8D_DATE','review',
            'Review this date using a four-digit year and the original workbook calendar.',targets(field.key),{raw:value,cellType:cell?.type,epoch:origin.epoch},3);
        }
        if(field.type.startsWith('int')||field.type.startsWith('float')) {
          if(/^detect[2-5]?$/.test(field.key)&&/^[<>]=?\s*/.test(value)) {
            issue('DTS8D_LIMIT_COMPARATOR','review','The source limit includes a comparison operator; retain the full source while choosing the receiving value.',targets(field.key),{value},8);
          } else if(!NUMBER.test(value)||!Number.isFinite(Number(value))) issue('DTS8D_NUMBER','error',
            field.name+' requires a finite numeric value.',targets(field.key),{value},field.source.page);
          else if(field.type==='int16'||field.type==='int32') {
            const low=field.type==='int16'?-32768:-2147483648, high=field.type==='int16'?32767:2147483647;
            if(!Number.isInteger(Number(value))||Number(value)<low||Number(value)>high)issue('DTS8D_INTEGER_RANGE','error',
              field.name+' is outside its published integer range.',targets(field.key),{value,minimum:low,maximum:high},14);
          } else if(field.type==='float32') {
            if(Math.abs(Number(value))>3.4028234663852886e38) issue('DTS8D_SINGLE_RANGE','error',
              field.name+' exceeds the single-precision receiving range.',targets(field.key),{value},14);
            else if(significantDigits(value)>7)issue('DTS8D_SINGLE_PRECISION','review',
              'Retain this full numeric spelling while reviewing the receiving field\'s seven significant figures.',targets(field.key),{value},14);
          }
        }
        if(['duplicate','superseded'].includes(field.key)&&NUMBER.test(value)&&Number(value)<0)
          issue('DTS8D_VERSION_INDEX','error','Duplicate and superseded indices start at zero.',targets(field.key),{value},3);
        if(!isAnalysis&&field.target==='Analyses'&&!blank(value))issue('DTS8D_SAMPLE_ONLY_ANALYSIS_FIELD','error',
          'An unsuccessful sample-only record leaves analysis fields empty.',targets(field.key),{value},3);
      }
      if(blank(exact(row,'duplicate')))stats.automaticDuplicateRows++;
      if(isAnalysis) {
        if(blank(exact(row,'superseded')))stats.automaticSupersededRows++;
        const detect=exact(row,'detectedresult').toLowerCase();
        if(detect==='y')stats.detected++;else if(detect==='n')stats.notDetected++;else if(detect==='p')stats.pendingDetection++;else stats.implicitDetection++;
        if(NUMBER.test(exact(row,'value')))stats.exactNumericTextValues++;
        for(const suffix of ['', '2','3','4','5']) {
          const field='detect'+suffix, type='limittype'+suffix, value=exact(row,field), kind=exact(row,type);
          if(!blank(value)||!blank(kind)){stats.detectionLimits++;limits.push({field,typeField:type,value,limitType:kind,units:exact(row,'reportingunits')});
            if(blank(value)!==blank(kind))issue('DTS8D_LIMIT_PAIR','review','Review the limit value and its corresponding type together.',
              [{recordId:row.recordId,field},{recordId:row.recordId,field:type}],{value,limitType:kind},8);}
        }
        if(detect==='n'&&!limits.some(limit=>!blank(limit.value)))issue('DTS8D_NONDETECT_LIMIT','review',
          'This non-detect has no supplied detection limit in the five limit fields.',targets('detectedresult'),{},8);
        if(blank(exact(row,'value'))&&blank(exact(row,'catresult')))issue('DTS8D_RESULT_VALUE','review',
          'Review the absent measured or categorical result while preserving the original detection state.',targets('value'),{detectedResult:detect},7);
      }
      lineage.push({recordId:row.recordId,tableId:table.id,sampleKey:sampleId,analysisKey:isAnalysis?analyticalId:null,
        siteName:exact(row,'sitename'),stationName:exact(row,'stationname'),fieldSampleId:exact(row,'fieldsampleid'),
        labSampleId:exact(row,'labsampleid'),analysisLabId:exact(row,'analysislabid'),
        duplicate:exact(row,'duplicate'),superseded:exact(row,'superseded'),valueCode:exact(row,'valuecode'),
        primarySample:exact(row,'primarysample'),detectedResult:exact(row,'detectedresult'),limits});
    }
  }
  for(const [sampleId,entries] of sampleGroups) {
    const first=entries[0].row;
    for(const field of SAMPLE_ATTRIBUTES) {
      const differing=entries.filter(({row})=>exact(row,field)!==exact(first,field));
      if(differing.length)issue('DTS8D_SAMPLE_CONFLICT','review','Rows assigned to the same source sample contain different '+BY_KEY.get(field).name+' values.',
        [{recordId:first.recordId,field},...differing.map(({row})=>({recordId:row.recordId,field}))],{sampleKey:sampleId},4);
    }
  }
  for(const [group,entries] of duplicateGroups) {
    const sources=[...new Map(entries.map(entry=>[entry.sampleId,entry])).values()];
    const blankCount=sources.filter(({row})=>blank(exact(row,'duplicate'))).length;
    if(blankCount&&blankCount!==sources.length)issue('DTS8D_DUPLICATE_ASSIGNMENT','review',
      'This physical sampling group mixes supplied and automatic duplicate indices.',sources.map(({row})=>({recordId:row.recordId,field:'duplicate'})),{group},14);
    const slots=new Map();
    for(const entry of sources){const value=exact(entry.row,'duplicate');if(!blank(value))add(slots,NUMBER.test(value)?String(Number(value)):value,entry);}
    for(const [slot,values] of slots)if(values.length>1)issue('DTS8D_DUPLICATE_INDEX','review',
      'Different source samples share the same supplied duplicate index.',values.map(({row})=>({recordId:row.recordId,field:'duplicate'})),{group,index:slot},3);
  }
  for(const [group,entries] of analysisGroups) {
    const slots=new Map();
    for(const entry of entries){const value=exact(entry.row,'superseded');if(!blank(value))add(slots,NUMBER.test(value)?String(Number(value)):value,entry);}
    for(const [slot,values] of slots)if(values.length>1)issue('DTS8D_SUPERSEDED_INDEX','review',
      'Multiple observations share this source analysis and superseded index.',values.map(({row})=>({recordId:row.recordId,field:'superseded'})),{group,index:slot},3);
  }
  for(const record of lineage)if(!blank(record.primarySample)) {
    const matches=[...new Set(fieldIds.get(tuple([record.siteName,record.primarySample]))??[])];
    record.primarySampleKeys=matches;
    if(!matches.length)issue('DTS8D_PRIMARY_SAMPLE_EXTERNAL','review','The referenced primary sample is outside this delivery.',
      [{recordId:record.recordId,field:'primarysample'}],{primarySample:record.primarySample,siteName:record.siteName},5);
    else if(matches.length>1)issue('DTS8D_PRIMARY_SAMPLE_AMBIGUOUS','review','The primary sample identifier matches multiple source sample groups.',
      [{recordId:record.recordId,field:'primarysample'}],{primarySample:record.primarySample,sampleKeys:matches},5);
  }
  stats.samples=sampleGroups.size;
  const samples=[...sampleGroups].map(([sampleKey,entries])=>({sampleKey,recordIds:entries.map(({row})=>row.recordId)}));
  return {summary:{...stats,workbooks:stats.workbooks.size,errors:issues.filter(i=>i.severity==='error').length,
      reviews:issues.filter(i=>i.severity==='review').length},issues,lineage,
    facts:{format:'Enviro Data DTS8D',version:DTS8D_VERSION,sourceSha256,fields:DTS8D_FIELDS,samples,
      nativeWorkbook:'One XLSX worksheet with all 150 exact ordered headers.',
      referenceChecks:'The client Enviro Data configuration supplies receiving lookup membership and import options. Complete codes and descriptions remain in the source and prepared workbook.',
      retainedConventions:'Original values, qualifiers, units, duplicate indices, superseded indices and all five source limits remain explicit.'}};
}
export const dts8dProfile = Object.freeze({
  id:'geotech-dts8d',version:DTS8D_VERSION,label:'Enviro Data DTS8D',
  references:[{title:'Geotech DTS8D, May 2026',url:DTS8D_REFERENCE},
    {title:'Geotech import and duplicate handling',url:'https://www.geotech.com/support/faq/joomfaq-using-enviro-data/faq-importing'}],
  delimiters:[],nativeExtensions:['.xlsx'],
  match({headers}) { return ['SiteName','StationName','SampleDate_D','FieldSampleID','ParameterName'].every(name=>headers.includes(name))?'observations':null; },
  decode:decodeLabWorkbooks,renderPrepared:request=>renderLabWorkbooks({...request,fieldDefinitions:DTS8D_FIELDS}),
  analyze:analyzeDts8d,recordKey:dts8dRecordKey,
});
export default dts8dProfile;
