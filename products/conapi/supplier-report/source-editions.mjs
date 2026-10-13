import {createEdition,canonicalJSON,ReportError} from './supplier-report.mjs';

const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const plain=value=>value!==null && typeof value==='object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value)===Object.prototype || Object.getPrototypeOf(value)===null);
const hash=/^[a-f0-9]{64}$/;
const check=(condition,code,message)=>{if(!condition)throw new ReportError(code,message);};
const equal=(left,right)=>canonicalJSON(left)===canonicalJSON(right);

/** Read a complete exported source; source identities are preserved on reopening. */
export function reopenSourceEdition(input) {
  let value=input;
  if(typeof input==='string'){
    try{value=JSON.parse(input.replace(/^\uFEFF/,''));}
    catch(error){throw new ReportError('SOURCE_JSON_INVALID','The complete source file must be valid JSON: '+error.message);}
  }
  check(plain(value),'SOURCE_JSON_INVALID','Choose a complete exported source edition JSON file.');
  check(value.schemaVersion===undefined || value.schemaVersion===1,'SOURCE_JSON_VERSION','Unsupported source edition version.');
  for(const key of ['id','sourceId','capturedAt','source','columns','rows','sourceDigest','digest']){
    check(own(value,key),'SOURCE_JSON_INCOMPLETE','The complete source file is missing '+key+'.');
  }
  check(hash.test(value.sourceDigest) && hash.test(value.digest),'SOURCE_JSON_DIGEST','The source file must retain its original source and edition digests.');
  check(value.rawCSV===undefined || value.rawCSV===null || typeof value.rawCSV==='string',
    'SOURCE_JSON_INVALID','rawCSV must retain the complete original CSV text or null.');
  const rebuilt=createEdition({
    id:value.id,sourceId:value.sourceId,capturedAt:value.capturedAt,source:value.source,
    delimiter:value.delimiter===undefined?',':value.delimiter,
    ...(typeof value.rawCSV==='string'?{csv:value.rawCSV}:{columns:value.columns,rows:value.rows})
  });
  check(rebuilt.sourceDigest===value.sourceDigest && rebuilt.digest===value.digest,
    'SOURCE_JSON_CHANGED','The retained source content, metadata or identity differs from its digest.');
  for(const key of ['columns','rows','source']){
    check(equal(rebuilt[key],value[key]),'SOURCE_JSON_CHANGED','The complete source '+key+' differs from its original representation.');
  }
  if(value.rawCSV!==undefined)check(rebuilt.rawCSV===value.rawCSV,'SOURCE_JSON_CHANGED','The original CSV representation changed.');
  return rebuilt;
}

export function serializeSourceEdition(edition) {
  const original=reopenSourceEdition(edition);
  return JSON.stringify(original,null,2)+'\n';
}

export function nativeSourceIdentity(edition) {
  const source=edition?.source;
  if(source?.kind!=='datasette-native-edition')return null;
  check(source.bridge==='conapi.datasette-supplier-edition.v1' && plain(source.native),
    'NATIVE_SOURCE_METADATA','The native supplier source must retain its original bridge metadata.');
  const native=source.native;
  check(hash.test(native.editionSha256) && hash.test(native.captureSha256) &&
    plain(native.edition) && plain(native.capture) && plain(native.review) &&
    native.edition.schema==='stellar-forge.datasette-edition.v1' && native.edition.state==='REVIEWED' &&
    native.capture.schema==='stellar-forge.datasette-capture.v1' && native.capture.state==='COMPLETE' &&
    native.review.approved===true &&
    native.edition.captureSha256===native.captureSha256 &&
    hash.test(native.edition.reviewSha256),
    'NATIVE_SOURCE_METADATA','The native supplier source must retain the reviewed edition and complete capture identities.');
  check(Array.isArray(native.sourceColumns) && Array.isArray(native.projectedColumns) &&
    typeof native.nativeRowsJSON==='string' && plain(native.projection) &&
    equal(native.projection,native.edition.projection) && equal(native.projection,native.review.projection) &&
    equal(native.projectedColumns,edition.columns) &&
    native.edition.rowCount===edition.rows.length && native.capture.rowCount===edition.rows.length,
    'NATIVE_SOURCE_METADATA','The native source rows, columns and reviewed projection must agree.');
  return {
    editionSha256:native.editionSha256,captureSha256:native.captureSha256,
    reviewSha256:native.edition.reviewSha256,sourceSelectionHash:native.capture.selectionHash,
    projection:native.projection,numericFormat:source.numericFormat || 'source',
    rowCount:edition.rows.length
  };
}

/** Compare restored native content without rewriting its original local-path observations. */
export function assertNativeSourceMatches(retained,reopened) {
  const before=nativeSourceIdentity(retained),after=nativeSourceIdentity(reopened);
  check(before!==null && after!==null && equal(before,after),
    'NATIVE_SOURCE_CHANGED','The received archive belongs to another native edition or projection.');
  check(equal(retained.columns,reopened.columns) && equal(retained.rows,reopened.rows),
    'NATIVE_SOURCE_CHANGED','The received archive does not reproduce every original projected source row.');
  const keys=['edition','capture','review','sourceColumns','nativeRowsJSON','projectedColumns',
    'projection','projectionTransformations','pageRanges'];
  for(const key of keys){
    check(equal(retained.source.native[key],reopened.source.native[key]),
      'NATIVE_SOURCE_CHANGED','The received archive differs from the retained native '+key+'.');
  }
  return before;
}
