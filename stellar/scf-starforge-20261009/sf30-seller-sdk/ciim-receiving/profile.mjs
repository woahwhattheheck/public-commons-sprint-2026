// MIT. DataCite 4.5 profile for the original Proteus 3.0.0 engine.
// All repeated values remain arrays. Original native XML nodes accompany every
// mapped element; no authority, identifier, date or number is inferred.
export const PROFILE_SCHEMA = 'tjl.ciim.datacite-profile.v1';
export const OUTPUT_SCHEMA = 'tjl.ciim.datacite-record.v1';
export const DATACITE_NS = 'http://datacite.org/schema/kernel-4';
export const OAI_NS = 'http://www.openarchives.org/OAI/2.0/';
export const OAI_DATACITE_NS = 'http://schema.datacite.org/oai/oai-1.1/';
export const PROTEUS_VERSION = '3.0.0';

export const CONFIG = Object.freeze({
  path_not_found_to_null: true,
  path_parse_exception_to_null: false,
  unbox_singletons: false,
  empty_reads_to_null: false,
  http_client: 'disallowed',
  enable_file_read: false,
  enable_file_write: false,
  enable_file_delete: false
});

export const XML_SPEC = Object.freeze({
  '#type': 'xml_to_json',
  xml: '$.rawXml',
  require_convert: true,
  content_key: '@content',
  attributes_key: '@attributes',
  mixed_key: '@mixed',
  mixed_content_mode: 'node_array',
  features: {
    pre_filter_blank_strings_on_mixed: false,
    ignore_empty_elements: false,
    trim_strings: false
  }
});

// Each key names a XML tag exactly. The controller supplies namespace-verified
// tag spellings found in the original XML; a prefix is never guessed or stripped.
const literal = value => ({ '#type': 'literal', value });
// Native 3.0.0 for_each/flatten return null for an empty result. The
// controller checks every retained original value, including empty groups.
const list = values => ({ '#type': 'fallback', strategies:[
  { '#type': 'as_list', values }, literal([])
] });
const flatten = values => ({ '#type': 'flatten', values });
const each = (values, spec) => list({ '#type': 'for_each', values, spec });
const scope = (value, spec) => ({ '#type': 'scope', scope: value, value: spec });
const quoted = key => "['" + key.replaceAll('\\', '\\\\').replaceAll("'", "\\'") + "']";

export function buildProfile(tagNames = {}) {
  const tags = new Map();
  for (const name of DATACITE_TAGS) {
    const key = Object.prototype.hasOwnProperty.call(tagNames, name) ? tagNames[name] : name;
    if (key === null) { tags.set(name, null); continue; }
    if (typeof key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(key))
      throw new Error('Invalid exact XML tag spelling for ' + name);
    tags.set(name, key);
  }
  // StandardXmlToJsonConverter stores pure element children by tag; when text
  // is interleaved it stores the ordered children under @mixed. Both are native
  // representations. Values retain source order within the original tag.
  const children = name => {
    if (tags.get(name) === null) return literal([]);
    const key = quoted(tags.get(name) ?? name);
    return list(flatten(['$' + key, "$['@mixed'][*]" + key]));
  };
  const along = (names, spec) => {
    if (names.length === 0) return spec;
    return flatten(each(children(names[0]), along(names.slice(1), spec)));
  };
  const node = (fields = {}) => ({
    attributes: "$['@attributes']",
    content: "$['@content']",
    mixed: "$['@mixed']",
    ...fields,
    original: '$'
  });
  const elements = (...names) => list(along(names, node()));
  const structured = (names, fields) => list(along(names, node(fields)));
  const person = role => ({
    names: elements(role === 'creator' ? 'creatorName' : 'contributorName'),
    givenNames: elements('givenName'),
    familyNames: elements('familyName'),
    nameIdentifiers: elements('nameIdentifier'),
    affiliations: elements('affiliation')
  });
  const point = () => ({
    longitudes: elements('pointLongitude'),
    latitudes: elements('pointLatitude')
  });
  const relatedItem = () => ({
    identifiers: elements('relatedItemIdentifier'),
    creators: structured(['creators', 'creator'], person('creator')),
    titles: elements('titles', 'title'),
    publicationYears: elements('publicationYear'),
    volumes: elements('volume'),
    issues: elements('issue'),
    numbers: elements('number'),
    firstPages: elements('firstPage'),
    lastPages: elements('lastPage'),
    publishers: elements('publisher'),
    editions: elements('edition'),
    contributors: structured(['contributors', 'contributor'], person('contributor'))
  });
  const resource = node({
    identifiers: elements('identifier'),
    creators: structured(['creators', 'creator'], person('creator')),
    titles: elements('titles', 'title'),
    publishers: elements('publisher'),
    publicationYears: elements('publicationYear'),
    subjects: elements('subjects', 'subject'),
    contributors: structured(['contributors', 'contributor'], person('contributor')),
    dates: elements('dates', 'date'),
    languages: elements('language'),
    resourceTypes: elements('resourceType'),
    alternateIdentifiers: elements('alternateIdentifiers', 'alternateIdentifier'),
    relatedIdentifiers: elements('relatedIdentifiers', 'relatedIdentifier'),
    sizes: elements('sizes', 'size'),
    formats: elements('formats', 'format'),
    versions: elements('version'),
    rights: elements('rightsList', 'rights'),
    descriptions: elements('descriptions', 'description'),
    geoLocations: structured(['geoLocations', 'geoLocation'], {
      places: elements('geoLocationPlace'),
      points: structured(['geoLocationPoint'], point()),
      boxes: structured(['geoLocationBox'], {
        westLongitudes: elements('westBoundLongitude'),
        eastLongitudes: elements('eastBoundLongitude'),
        southLatitudes: elements('southBoundLatitude'),
        northLatitudes: elements('northBoundLatitude')
      }),
      polygons: structured(['geoLocationPolygon'], {
        points: structured(['polygonPoint'], point()),
        interiorPoints: structured(['inPolygonPoint'], point())
      })
    }),
    fundingReferences: structured(['fundingReferences', 'fundingReference'], {
      funderNames: elements('funderName'),
      funderIdentifiers: elements('funderIdentifier'),
      awardNumbers: elements('awardNumber'),
      awardTitles: elements('awardTitle')
    }),
    relatedItems: structured(['relatedItems', 'relatedItem'], relatedItem())
  });
  return {
    schema: literal(OUTPUT_SCHEMA),
    profile: literal({ schema: PROFILE_SCHEMA, datacite: '4.5', proteus: PROTEUS_VERSION }),
    identifier: '$.observation.identifier',
    status: '$.observation.status',
    datestamp: '$.observation.datestamp',
    setSpecs: list('$.observation.setSpecs'),
    provenance: '$.provenance',
    observation: '$.observation',
    oaiHeader: '$.header',
    sourceAbout: '$.about',
    wrapper: {
      schemaVersions: '$.schemaVersions',
      datacentreSymbols: '$.datacentreSymbols'
    },
    resources: each('$.resources', resource),
    originalRecord: '$.record'
  };
}

export const DATACITE_TAGS = Object.freeze([
  'identifier', 'creators', 'creator', 'creatorName', 'givenName', 'familyName',
  'nameIdentifier', 'affiliation', 'titles', 'title', 'publisher',
  'publicationYear', 'subjects', 'subject', 'contributors', 'contributor',
  'contributorName', 'dates', 'date', 'language', 'resourceType',
  'alternateIdentifiers', 'alternateIdentifier', 'relatedIdentifiers',
  'relatedIdentifier', 'sizes', 'size', 'formats', 'format', 'version',
  'rightsList', 'rights', 'descriptions', 'description', 'geoLocations',
  'geoLocation', 'geoLocationPlace', 'geoLocationPoint', 'pointLongitude',
  'pointLatitude', 'geoLocationBox', 'westBoundLongitude', 'eastBoundLongitude',
  'southBoundLatitude', 'northBoundLatitude', 'geoLocationPolygon',
  'polygonPoint', 'inPolygonPoint', 'fundingReferences', 'fundingReference',
  'funderName', 'funderIdentifier', 'awardNumber', 'awardTitle',
  'relatedItems', 'relatedItem', 'relatedItemIdentifier', 'volume', 'issue',
  'number', 'firstPage', 'lastPage', 'edition'
]);

export const FIELD_CATALOG = Object.freeze([
  {number:1,field:'identifiers',xml:'identifier',minimum:1,maximum:1,
    attributes:['identifierType'],requiredAttributes:['identifierType']},
  {number:2,field:'creators',xml:'creators/creator',minimum:1,maximum:null,
    children:['creatorName','givenName','familyName','nameIdentifier','affiliation']},
  {number:3,field:'titles',xml:'titles/title',minimum:1,maximum:null,
    attributes:['titleType','xml:lang']},
  {number:4,field:'publishers',xml:'publisher',minimum:1,maximum:1,
    attributes:['xml:lang','publisherIdentifier','publisherIdentifierScheme','schemeURI']},
  {number:5,field:'publicationYears',xml:'publicationYear',minimum:1,maximum:1},
  {number:6,field:'subjects',xml:'subjects/subject',minimum:0,maximum:null,
    attributes:['subjectScheme','schemeURI','valueURI','classificationCode','xml:lang']},
  {number:7,field:'contributors',xml:'contributors/contributor',minimum:0,maximum:null,
    attributes:['contributorType'],requiredAttributes:['contributorType'],
    children:['contributorName','givenName','familyName','nameIdentifier','affiliation']},
  {number:8,field:'dates',xml:'dates/date',minimum:0,maximum:null,
    attributes:['dateType','dateInformation'],requiredAttributes:['dateType']},
  {number:9,field:'languages',xml:'language',minimum:0,maximum:1},
  {number:10,field:'resourceTypes',xml:'resourceType',minimum:1,maximum:1,
    attributes:['resourceTypeGeneral'],requiredAttributes:['resourceTypeGeneral']},
  {number:11,field:'alternateIdentifiers',xml:'alternateIdentifiers/alternateIdentifier',
    minimum:0,maximum:null,attributes:['alternateIdentifierType'],
    requiredAttributes:['alternateIdentifierType']},
  {number:12,field:'relatedIdentifiers',xml:'relatedIdentifiers/relatedIdentifier',
    minimum:0,maximum:null,
    attributes:['relatedIdentifierType','relationType','relatedMetadataScheme','schemeURI','schemeType','resourceTypeGeneral'],
    requiredAttributes:['relatedIdentifierType','relationType']},
  {number:13,field:'sizes',xml:'sizes/size',minimum:0,maximum:null},
  {number:14,field:'formats',xml:'formats/format',minimum:0,maximum:null},
  {number:15,field:'versions',xml:'version',minimum:0,maximum:1},
  {number:16,field:'rights',xml:'rightsList/rights',minimum:0,maximum:null,
    attributes:['rightsURI','rightsIdentifier','rightsIdentifierScheme','schemeURI','xml:lang']},
  {number:17,field:'descriptions',xml:'descriptions/description',minimum:0,maximum:null,
    attributes:['descriptionType','xml:lang'],requiredAttributes:['descriptionType']},
  {number:18,field:'geoLocations',xml:'geoLocations/geoLocation',minimum:0,maximum:null,
    children:['geoLocationPlace','geoLocationPoint','geoLocationBox','geoLocationPolygon']},
  {number:19,field:'fundingReferences',xml:'fundingReferences/fundingReference',minimum:0,maximum:null,
    children:['funderName','funderIdentifier','awardNumber','awardTitle']},
  {number:20,field:'relatedItems',xml:'relatedItems/relatedItem',minimum:0,maximum:null,
    attributes:['relatedItemType','relationType'],requiredAttributes:['relatedItemType','relationType'],
    children:['relatedItemIdentifier','creators','titles','publicationYear','volume','issue','number','firstPage','lastPage','publisher','edition','contributors']}
]);

export const CONTRACT = Object.freeze({
  schema: PROFILE_SCHEMA,
  engine: {groupId:'com.k-int.proteus',artifactId:'proteus-core',version:PROTEUS_VERSION,
    source:'https://gitlab.com/knowledge-integration/ciim/proteus.git',tag:'proteus-3.0.0',
    documentation:'https://docs.proteus.k-int.com/component-reference/'},
  input: {metadataPrefix:'oai_datacite',namespace:OAI_DATACITE_NS,
    resourceNamespace:DATACITE_NS,version:'4.5',
    schema:'https://schema.datacite.org/meta/kernel-4.5/metadata.xsd'},
  receiving: {documentedInput:'OAI harvester plus reviewed Proteus transform',
    endpoint:null,processingProfile:null,institutionalAuthorities:null,receivingEnvironment:null},
  identity: {key:['repositoryId','identifier'],normalization:'none',
    repeatedValues:'ordered arrays',dates:'original lexical strings',
    numericValues:'original XML strings',sourceNodes:'native converter result retained'},
  state: {active:'retain metadata',deleted:'explicit OAI deleted header only',
    absentFromSelection:'no deletion',restore:'explicit new active observation'},
  fields: FIELD_CATALOG
});

const leaf = path => ({path:path.split('/')});
const people = role => ({
  names:leaf(role === 'creator' ? 'creatorName' : 'contributorName'),
  givenNames:leaf('givenName'),familyNames:leaf('familyName'),
  nameIdentifiers:leaf('nameIdentifier'),affiliations:leaf('affiliation')
});
const pointLayout = () => ({longitudes:leaf('pointLongitude'),latitudes:leaf('pointLatitude')});
const nested = (path,fields) => ({path:path.split('/'),fields});
// Receiving validation walks the declared paths in the original expanded-name
// XML tree as well as in the actual native output. This catches a foreign
// namespace with a familiar local tag rather than treating it as DataCite.
export const NESTED_LAYOUT = Object.freeze({
  creators:people('creator'),contributors:people('contributor'),
  geoLocations:{
    places:leaf('geoLocationPlace'),
    points:nested('geoLocationPoint',pointLayout()),
    boxes:nested('geoLocationBox',{
      westLongitudes:leaf('westBoundLongitude'),eastLongitudes:leaf('eastBoundLongitude'),
      southLatitudes:leaf('southBoundLatitude'),northLatitudes:leaf('northBoundLatitude')
    }),
    polygons:nested('geoLocationPolygon',{
      points:nested('polygonPoint',pointLayout()),
      interiorPoints:nested('inPolygonPoint',pointLayout())
    })
  },
  fundingReferences:{
    funderNames:leaf('funderName'),funderIdentifiers:leaf('funderIdentifier'),
    awardNumbers:leaf('awardNumber'),awardTitles:leaf('awardTitle')
  },
  relatedItems:{
    identifiers:leaf('relatedItemIdentifier'),
    creators:nested('creators/creator',people('creator')),
    titles:leaf('titles/title'),publicationYears:leaf('publicationYear'),
    volumes:leaf('volume'),issues:leaf('issue'),numbers:leaf('number'),
    firstPages:leaf('firstPage'),lastPages:leaf('lastPage'),
    publishers:leaf('publisher'),editions:leaf('edition'),
    contributors:nested('contributors/contributor',people('contributor'))
  }
});
