// MIT. Original SF74 workorder source assembler, shared by HTTP, MCP and case commissioning.
import {createHash} from 'node:crypto';
import {validateIntake} from '../sf76-merchant-remediation-delta/compare.mjs';
import {buildPacket,buildRuntimePacket,renderHtml,renderChecklist} from '../sf77-merchant-workorder/workorder.mjs';
const MAX_SOURCE=2_000_000;

export function uploadedSource(encoded, field, required = false) {
  if (encoded === undefined || encoded === null) {
    if (required) throw new TypeError('Missing ' + field + ' source');
    return null;
  }
  if (typeof encoded !== 'string' || !encoded.length ||
      encoded.length > Math.ceil(MAX_SOURCE / 3) * 4)
    throw new TypeError(field + ' source must contain 1..2,000,000 bytes');
  // Hash the uploaded bytes, never a parsed/reformatted JSON representation.
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded || !bytes.length || bytes.length > MAX_SOURCE)
    throw new TypeError(field + ' source has invalid encoding or size');
  let data;
  try { data = JSON.parse(new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes)); }
  catch { throw new TypeError(field + ' source must be valid UTF-8 JSON'); }
  return {data, sha: createHash('sha256').update(bytes).digest('hex')};
}

export function workorderFromSources(input,{generatedAt=new Date().toISOString()}={}) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new TypeError('Expected original capture files and owner terms');
  const fields = ['before', 'after', 'postBefore', 'postAfter', 'terms', 'supportText', 'inputs'];
  if (Object.keys(input).some(key => !fields.includes(key))) throw new TypeError('Unexpected workorder field');
  const terms = uploadedSource(input.terms, 'terms', true);
  if(Object.hasOwn(input,'supportText')) {
    if(['before','after','postBefore','postAfter'].some(key=>Object.hasOwn(input,key)))
      throw new TypeError('Select original diagnostic sources or the attached runtime case for this workorder');
    const packet=buildRuntimePacket({supportText:input.supportText,inputs:input.inputs},terms.data,generatedAt);
    return {packet,html:renderHtml(packet),checklist:renderChecklist(packet)};
  }
  if(Object.hasOwn(input,'inputs'))throw new TypeError('Runtime mapping requires its original supportText');
  const before = uploadedSource(input.before, 'before', true);
  const after = uploadedSource(input.after, 'after');
  const pb = uploadedSource(input.postBefore, 'postBefore'), pa = uploadedSource(input.postAfter, 'postAfter');
  if (!after && (pb || pa)) throw new TypeError('Browser check comparison requires an after capture');
  validateIntake(before.data);
  // Original SF77 owns terms, economics, acceptance and its optional SF76 repair review.
  const packet = buildPacket(before.data, terms.data, before.sha, generatedAt, after ? {
    after: after.data, afterSha: after.sha, postBefore: pb?.data, postAfter: pa?.data,
    postBeforeSha: pb?.sha, postAfterSha: pa?.sha,
  } : null);
  return {packet, html: renderHtml(packet), checklist: renderChecklist(packet)};
}
