// MIT. Complete Dublin Core profile for the same original Proteus converter.
// The OAI header owns record identity and deletion state. The source's about
// nodes remain separate from the receiver's harvest and review provenance.
export const DC_NS='http://purl.org/dc/elements/1.1/';
export const OAI_DC_NS='http://www.openarchives.org/OAI/2.0/oai_dc/';
export const DC_OUTPUT_SCHEMA='tjl.ciim.dublin-core-record.v1';
export const DC_FIELDS=Object.freeze([
  {field:'titles',xml:'title',minimum:1,maximum:null,rule:'The agreed CIIM source-workshare intake requires a title.'},
  {field:'creators',xml:'creator',minimum:0,maximum:null},
  {field:'subjects',xml:'subject',minimum:0,maximum:null},
  {field:'descriptions',xml:'description',minimum:0,maximum:null},
  {field:'publishers',xml:'publisher',minimum:0,maximum:null},
  {field:'contributors',xml:'contributor',minimum:0,maximum:null},
  {field:'dates',xml:'date',minimum:0,maximum:null},
  {field:'types',xml:'type',minimum:0,maximum:null},
  {field:'formats',xml:'format',minimum:0,maximum:null},
  {field:'identifiers',xml:'identifier',minimum:0,maximum:null},
  {field:'sources',xml:'source',minimum:0,maximum:null},
  {field:'languages',xml:'language',minimum:0,maximum:null},
  {field:'relations',xml:'relation',minimum:0,maximum:null},
  {field:'coverages',xml:'coverage',minimum:0,maximum:null},
  {field:'rights',xml:'rights',minimum:0,maximum:null}
]);
export const DC_TAGS=Object.freeze(DC_FIELDS.map(field=>field.xml));
const literal=value=>({'#type':'literal',value});
// Native 3.0.0 for_each/flatten return null for an empty result.
// The fallback emits the explicitly declared empty collection; the receiving
// controller verifies every original repeated value against the native output.
const list=values=>({'#type':'fallback',strategies:[{'#type':'as_list',values},literal([])]});
const flat=values=>({'#type':'flatten',values});
const each=(values,spec)=>list({'#type':'for_each',values,spec});
const quoted=key=>"['"+key.replaceAll('\\','\\\\').replaceAll("'","\\'")+"']";
export function buildDcProfile(tagNames={}) {
  const children=name=>{
    const key=Object.prototype.hasOwnProperty.call(tagNames,name)?tagNames[name]:name;
    if(key===null)return literal([]);
    if(typeof key!=='string'||!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(key))
      throw new Error('Invalid original Dublin Core tag spelling for '+name);
    const path=quoted(key);
    return list(flat(['$'+path,"$['@mixed'][*]"+path]));
  };
  const element={
    attributes:"$['@attributes']",content:"$['@content']",mixed:"$['@mixed']",original:'$'
  };
  const resource={
    attributes:"$['@attributes']",content:"$['@content']",mixed:"$['@mixed']",
    ...Object.fromEntries(DC_FIELDS.map(field=>[field.field,each(children(field.xml),element)])),
    original:'$'
  };
  return {
    schema:literal(DC_OUTPUT_SCHEMA),
    profile:literal({schema:'tjl.ciim.dublin-core-profile.v1',dublinCore:'elements/1.1',proteus:'3.0.0'}),
    identifier:'$.observation.identifier',status:'$.observation.status',
    datestamp:'$.observation.datestamp',setSpecs:list('$.observation.setSpecs'),
    provenance:'$.provenance',observation:'$.observation',oaiHeader:'$.header',
    sourceAbout:'$.about',
    wrapper:{schemaVersions:'$.schemaVersions',datacentreSymbols:'$.datacentreSymbols'},
    resources:each('$.resources',resource),originalRecord:'$.record'
  };
}
