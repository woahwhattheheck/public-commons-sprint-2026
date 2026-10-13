/** Explicit opt-in WQP characteristic interpretation; original cells stay retained. */
export const WQP_CHARACTERISTIC_EDITION='wqp-characteristics/v1';
export const CHARACTERISTIC_MAPPING='_wqp_characteristics';
export const CHARACTERISTIC_FIELDS={
 speciation:['Result_MethodSpeciation','MethodSpeciationName','speciation'],
 methodContext:['Result_AnalyticalMethodIdentifierContext','ResultAnalyticalMethod/MethodIdentifierContext','ResultAnalyticalMethod.MethodIdentifierContext','methodContext'],
 methodName:['Result_AnalyticalMethodName','ResultAnalyticalMethod/MethodName','ResultAnalyticalMethod.MethodName','methodName'],
 resultDepth:['Result_DepthHeightMeasure','ResultDepthHeightMeasure/MeasureValue','ResultDepthHeightMeasure.MeasureValue','resultDepth'],
 resultDepthUnit:['Result_DepthHeightMeasureUnit','ResultDepthHeightMeasure/MeasureUnitCode','ResultDepthHeightMeasure.MeasureUnitCode','resultDepthUnit'],
 resultDepthReference:['Result_DepthAltitudeReferencePoint','ResultDepthAltitudeReferencePointText','resultDepthReference'],
 activityDepth:['Activity_DepthHeightMeasure','ActivityDepthHeightMeasure/MeasureValue','ActivityDepthHeightMeasure.MeasureValue','activityDepth'],
 activityDepthUnit:['Activity_DepthHeightMeasureUnit','ActivityDepthHeightMeasure/MeasureUnitCode','ActivityDepthHeightMeasure.MeasureUnitCode','activityDepthUnit'],
 activityDepthReference:['Activity_DepthAltitudeReferencePoint','ActivityDepthAltitudeReferencePointText','activityDepthReference'],
 relativeDepth:['Activity_RelativeDepth','ActivityRelativeDepthName','relativeDepth'],
 timeBasis:['Result_TimeBasis','ResultTimeBasisText','timeBasis'],
 temperatureBasis:['Result_TemperatureBasis','ResultTemperatureBasisText','temperatureBasis'],
 weightBasis:['Result_WeightBasis','ResultWeightBasisText','weightBasis'],
};
const clean=value=>value==null?'':String(value).trim();
const label=value=>clean(value).toLowerCase().replace(/\s+/g,' ');
function chemical(value){
 const text=clean(value).replace(/^as\s+/i,'').replace(/[\s_]/g,'').toUpperCase();
 return ({N:'N',NITROGEN:'N',P:'P',PHOSPHORUS:'P',O2:'O2',NO3:'NO3',NO2:'NO2',NH3:'NH3',NH4:'NH4',PO4:'PO4',CACO3:'CaCO3',HG:'Hg',ZN:'Zn',FE:'Fe',CU:'Cu',MN:'Mn',NI:'Ni',MG:'Mg',CR:'Cr',CA:'Ca',PB:'Pb',CD:'Cd'})[text]||clean(value).replace(/^as\s+/i,'');
}
export function characteristicUnit(raw,characteristic,base){
 const u=label(raw).replaceAll('μ','u').replaceAll('µ','u').replace(/\s/g,'');
 const spec=(kind,unit,factor=1)=>({kind,unit,factor,offset:0,basis:''});
 if(base.kind!=='unknown')return {...base,basis:chemical(base.basis)};
 if(['m','meter','metre','meters','metres'].includes(u))return spec('length','m');
 if(u==='cm')return spec('length','m',.01);
 if(u==='mm')return spec('length','m',.001);
 if(['ft','feet'].includes(u))return spec('length','m',.3048);
 if(['umho/cm','umhos/cm','us/cm','microsiemens/cm'].includes(u))return spec('conductivity','uS/cm');
 if(['ms/cm','mmho/cm','mmhos/cm'].includes(u))return spec('conductivity','uS/cm',1000);
 if(['mpn/100ml','mpn/100mL'].map(x=>x.toLowerCase()).includes(u))return spec('microbial-mpn','MPN/100mL');
 if(u==='cfu/100ml')return spec('microbial-cfu','CFU/100mL');
 if(u==='ntu')return spec('turbidity-ntu','NTU');
 if(u==='fnu')return spec('turbidity-fnu','FNU');
 if(label(characteristic)==='ph'&&['','none','su','s.u.','ph','phunits','standardunits'].includes(u))return spec('acidity','pH units');
 if(label(characteristic)==='salinity'&&u==='ppt')return spec('salinity-ppt','ppt');
 return {...base};
}
const metals={mercury:'Hg',zinc:'Zn',iron:'Fe',copper:'Cu',manganese:'Mn',nickel:'Ni',magnesium:'Mg',chromium:'Cr',calcium:'Ca',lead:'Pb',cadmium:'Cd'};
/** Classification is deliberately separate from model/calibration eligibility. */
export function interpretCharacteristic({characteristic,fraction,spec,pcode='',speciation='',method='',methodContext='',methodName='',resultDepth='',resultDepthUnit='',resultDepthReference='',activityDepth='',activityDepthUnit='',activityDepthReference='',relativeDepth='',timeBasis='',temperatureBasis='',weightBasis=''}){
 const name=label(characteristic),f=label(fraction),declared=chemical(speciation),unitBasis=chemical(spec.basis);
 const total=['total','unfiltered','total recoverable'].includes(f);
 const issues=[],conflict=!!(declared&&unitBasis&&declared!==unitBasis);
 let basis=declared||unitBasis||'',basisSource=declared?'source-speciation':unitBasis?'source-unit':'unspecified',parameter='unmapped';
 const inherent=value=>{if(basis&&basis!==value){issues.push('conflicting-characteristic-basis');return false;}if(!basis){basis=value;basisSource='explicit-characteristic';}return true;};
 if(conflict)issues.push('conflicting-source-chemical-basis');
 if(spec.kind==='flow'&&(pcode==='00060'||['stream flow, instantaneous','stream flow','discharge','flow'].includes(name)))parameter='flow';
 if(spec.kind==='temperature'&&(pcode==='00010'||['temperature, water','water temperature','temperature'].includes(name)))parameter='temperature';
 if(spec.kind==='length'&&['depth, secchi disk depth','secchi depth','secchi disk depth'].includes(name))parameter='secchi_depth';
 if(spec.kind==='length'&&name==='depth')parameter='depth';
 if(spec.kind==='conductivity'&&['conductivity','specific conductance'].includes(name))parameter=name==='specific conductance'?'specific_conductance':'conductivity';
 if(['microbial-mpn','microbial-cfu'].includes(spec.kind)&&['escherichia coli','e. coli'].includes(name))parameter='ecoli';
 if(['turbidity-ntu','turbidity-fnu'].includes(spec.kind)&&name==='turbidity')parameter='turbidity';
 if(spec.kind==='acidity'&&name==='ph')parameter='ph';
 if(spec.kind==='salinity-ppt'&&name==='salinity')parameter='salinity';
 if(spec.kind==='concentration'){
  if(['oxygen','dissolved oxygen','dissolved oxygen (do)'].includes(name)&&inherent('O2'))parameter='do';
  const fiveDay=/5[ -]?day/i.test(methodName)||/5[ -]?day/i.test(characteristic)||(/^(?:5210[- ]?B)$/i.test(method)&&label(methodContext)==='apha');
  if((['biochemical oxygen demand, standard conditions','biochemical oxygen demand, 5 day','biochemical oxygen demand, 5-day'].includes(name)||pcode==='00310')&&fiveDay&&inherent('O2'))parameter='bod5';
  if(name.includes('carbonaceous')&&fiveDay&&inherent('O2'))parameter='cbod5';
  if(['nitrogen','nitrogen, total','total nitrogen','nitrogen, mixed forms (nh3), (nh4), organic, (no2) and (no3)'].includes(name))parameter=total&&basis==='N'?'tn':'nitrogen';
  if(['phosphorus','phosphorus, total','total phosphorus'].includes(name))parameter=total&&basis==='P'?'tp':'phosphorus';
  if(['kjeldahl nitrogen','nitrogen, kjeldahl','total kjeldahl nitrogen'].includes(name))parameter='tkn';
  if(['nitrate + nitrite','nitrate plus nitrite','nitrite + nitrate'].includes(name))parameter='nitrate_nitrite';
  if(['nitrate','nitrate-nitrogen'].includes(name))parameter='nitrate';
  if(['nitrite','nitrite-nitrogen'].includes(name))parameter='nitrite';
  if(['ammonia','ammonia-nitrogen'].includes(name))parameter='ammonia';
  if(name==='ammonium')parameter='ammonium';
  if(['orthophosphate','orthophosphate as p'].includes(name))parameter='orthophosphate';
  if(['alkalinity, total','alkalinity'].includes(name))parameter='alkalinity';
  if(['hardness, ca, mg','hardness','hardness, total'].includes(name))parameter='hardness';
  if(Object.hasOwn(metals,name)&&inherent(metals[name]))parameter=name;
  if(['tn','nitrogen','tkn','nitrate_nitrite','nitrate','nitrite','ammonia','ammonium','tp','phosphorus','orthophosphate','alkalinity','hardness'].includes(parameter)&&!basis){
   basis='unspecified';issues.push('chemical-basis-unspecified');
  }
 }
 const permitted={tn:['N'],nitrogen:['N'],tkn:['N'],nitrate_nitrite:['N'],nitrate:['N','NO3'],nitrite:['N','NO2'],ammonia:['N','NH3'],ammonium:['N','NH4'],tp:['P'],phosphorus:['P','PO4'],orthophosphate:['P','PO4'],alkalinity:['CaCO3']};
 if(basis&&basis!=='unspecified'&&permitted[parameter]&&!permitted[parameter].includes(basis))issues.push('conflicting-characteristic-basis');
 if(conflict||issues.includes('conflicting-characteristic-basis'))parameter='unmapped';
 return {parameter,basis,issues,metadata:{
  edition:WQP_CHARACTERISTIC_EDITION,sourceCharacteristic:characteristic,sourceSpeciation:speciation,
  sourceUnitBasis:unitBasis,basisSource,chemicalBasis:basis,sourceFraction:fraction,
  chemicalConversion:'none',unitKind:spec.kind,
  microbialCountMethod:spec.kind==='microbial-mpn'?'MPN':spec.kind==='microbial-cfu'?'CFU':null,
  turbidityScale:spec.kind==='turbidity-ntu'?'NTU':spec.kind==='turbidity-fnu'?'FNU':null,
  conductivityTemperatureCorrection:'none',
  method,methodContext,methodName,resultDepth,resultDepthUnit,resultDepthReference,
  activityDepth,activityDepthUnit,activityDepthReference,relativeDepth,timeBasis,temperatureBasis,weightBasis,
  eligibility:'Characteristic recognition does not establish calibration, matched catchment support or annual-load eligibility.',
 }};
}
export function compatibleCharacteristicLimit(limitSpec,resultSpec,interpretation,limitRaw,resultRaw){
 if(limitSpec.kind!==resultSpec.kind||limitSpec.unit!==resultSpec.unit)return false;
 if(limitSpec.kind==='unknown'&&label(limitRaw)!==label(resultRaw))return false;
 if(interpretation.issues.some(x=>x.startsWith('conflicting-')))return false;
 const lb=chemical(limitSpec.basis),rb=interpretation.basis;
 // A limit without an as-X unit belongs to this exact result; explicit
 // incompatible chemical bases are never silently converted.
 return !lb||!!rb&&rb!=='unspecified'&&lb===rb;
}
