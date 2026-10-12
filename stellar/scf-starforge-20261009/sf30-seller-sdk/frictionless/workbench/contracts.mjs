// SPDX-License-Identifier: MIT
// The source package parser and scalar semantics remain in original package.py.
import { object, fault } from '../../postgres/publisher/files.mjs';
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const SHA = /^[a-f0-9]{64}$/;
export const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const NAME = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
export const SCHEMA = 'stellar-forge.frictionless-source-workbench.v1';
export const MAX_JSON = 8 * 1024 * 1024;
export const MAX_SOURCE_FILE = 256 * 1024 * 1024;
export const need = (value, code, message = code, status = 400) => { if (!value) throw fault(code, message, status); };
export function exact(value, allowed, required = []) {
  need(object(value) && Object.keys(value).every(k => allowed.includes(k)) && required.every(k => Object.hasOwn(value, k)),
    'FRICTIONLESS_ARGUMENTS_INVALID', 'Use the fields of this original source operation.');
  return value;
}
export function uuid(value) { need(typeof value === 'string' && UUID.test(value), 'FRICTIONLESS_REQUEST_ID_INVALID'); return value; }
export function hash(value) { need(typeof value === 'string' && SHA.test(value), 'FRICTIONLESS_DIGEST_INVALID'); return value; }
export function label(value, maximum = 160) {
  need(typeof value === 'string' && value.trim() && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value),
    'FRICTIONLESS_LABEL_INVALID', 'Use a nonempty plain label within its displayed limit.');
  return value.trim();
}
export function count(value, maximum = Number.MAX_SAFE_INTEGER, minimum = 0) {
  need(Number.isSafeInteger(value) && value >= minimum && value <= maximum, 'FRICTIONLESS_PAGE_INVALID'); return value;
}
export function page(rows, offset = 0, limit = 25) {
  count(offset); count(limit, 100, 1);
  return { items: rows.slice(offset, offset + limit), offset, limit, total: rows.length,
    next: offset + limit < rows.length ? offset + limit : null };
}
export function validateMutation(kind, value) {
  const common = ['workspaceId','requestId','expectedVersion'];
  const definitions = {
    intake: [['input','expectedSha256','label'], ['input','label']],
    edition: [['captureId','label','queries','queriesText'], ['captureId','label']],
    review: [['editionId','reviewer','note'], ['editionId','reviewer','note']],
    select: [['editionId','reviewId','expectedSourceHash'], ['editionId','reviewId','expectedSourceHash']],
    plan: [['editionId','reviewId','plan'], ['editionId','reviewId','plan']],
    compare: [['before','after','label'], ['before','after','label']],
    export: [['editionId','reviewId','label'], ['editionId','label']],
  };
  const d = definitions[kind]; need(d, 'FRICTIONLESS_ACTION_NOT_FOUND', 'Choose an original source action.', 404);
  exact(value, [...common,...d[0]], [...common,...d[1]]);
  uuid(value.workspaceId); uuid(value.requestId); count(value.expectedVersion);
  for (const key of ['captureId','editionId','reviewId','before','after']) if (value[key] !== undefined) uuid(value[key]);
  for (const key of ['expectedSha256','expectedSourceHash']) if (value[key] !== undefined) hash(value[key]);
  if (value.label !== undefined) label(value.label);
  if (value.reviewer !== undefined) label(value.reviewer, 80);
  if (value.note !== undefined) need(typeof value.note === 'string' && value.note.trim() && value.note.length <= 2000,
    'FRICTIONLESS_REVIEW_NOTE_REQUIRED');
  if (kind === 'intake') need(typeof value.input === 'string' && (value.input === 'current' || ALIAS.test(value.input)), 'FRICTIONLESS_INPUT_INVALID');
  if (kind === 'edition') {
    need(Number(value.queries!==undefined)+Number(value.queriesText!==undefined)===1,'FRICTIONLESS_QUERIES_REQUIRED');
    if(value.queriesText!==undefined)need(typeof value.queriesText==='string'&&value.queriesText.length<=MAX_JSON,'FRICTIONLESS_QUERY_TEXT_INVALID');
    let queries=value.queries;
    if(value.queriesText!==undefined){try{queries=JSON.parse(value.queriesText);}catch{throw fault('FRICTIONLESS_QUERY_TEXT_INVALID','Use one complete JSON object for the original query definitions.',400);}}
    need(object(queries)&&Object.keys(queries).length>0&&Object.keys(queries).length<=64,'FRICTIONLESS_QUERIES_REQUIRED');
    if(value.queriesText===undefined){
      const visit=item=>{if(typeof item==='number')need(Number.isFinite(item)&&(!Number.isInteger(item)||Number.isSafeInteger(item)),'FRICTIONLESS_EXACT_QUERY_TEXT_REQUIRED','Use queriesText for schema integers outside the exact browser range.');
        else if(Array.isArray(item))item.forEach(visit);else if(object(item))Object.values(item).forEach(visit);};
      visit(queries);
    }
  }
  if (kind === 'plan') need(object(value.plan), 'FRICTIONLESS_PLAN_REQUIRED');
  return value;
}
