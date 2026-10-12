// MIT. Shared values for the municipal GIS handoff application.
import { createHash } from 'node:crypto';
import { canonicalJson } from '../domain.mjs';
export const canonical = canonicalJson;
export const copy = value => JSON.parse(canonical(value));
export function digest(value) { return createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) || value instanceof Uint8Array ? value : canonical(value)).digest('hex'); }
export function fail(code, message, status = 400, details = null) { const error = new Error(message); error.code = code; error.status = status; if (details !== null) error.details = details; throw error; }
export function object(value, name = 'Value') { if (!value || typeof value !== 'object' || Array.isArray(value)) fail('OBJECT_REQUIRED', name + ' must be an object.'); return value; }
export function text(value, name, max = 200, { empty = false } = {}) { if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max || value.includes('\0')) fail('INVALID_TEXT', name + ' must be ' + (empty ? 'at most ' : '1–') + max + ' characters.'); return value; }
export function instant(value, name) { if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail('INVALID_DATETIME', name + ' needs an explicit offset or Z.'); return value; }
export function parseJson(value, name = 'JSON file') { if (typeof value !== 'string') fail('ORIGINAL_TEXT_REQUIRED', name + ' must be complete UTF-8 text.'); try { const parsed = JSON.parse(value.charCodeAt(0)===0xFEFF?value.slice(1):value); canonical(parsed); return parsed; } catch (error) { if (error.code === 'INVALID_JSON') throw error; fail('INVALID_JSON', name + ' is not complete finite JSON.'); } }
export const equal = (a, b) => canonical(a) === canonical(b);
export const now = () => new Date().toISOString();
export const entityId = (prefix, identity) => prefix + '-' + digest(identity).slice(0,32);
export function seal(value) { const result = copy(value); delete result.sha256; return { ...result, sha256: digest(result) }; }
export function verifySeal(value, schema) { object(value); const { sha256, ...body } = value; if (schema && value.schema !== schema || !/^[a-f0-9]{64}$/.test(sha256 ?? '') || digest(body) !== sha256) fail('ENTITY_HASH_MISMATCH', 'The complete saved edition does not match its schema and SHA-256.'); return copy(value); }
export function uniqueStrings(value, name, { empty = true, max = 100000 } = {}) { if (!Array.isArray(value) || value.length > max || !empty && !value.length || value.some(v => typeof v !== 'string') || new Set(value).size !== value.length) fail('INVALID_SELECTION', name + ' must be an array of distinct strings.'); return [...value]; }
export function page(rows, filter = {}) { const offset = filter.offset === undefined ? 0 : Number(filter.offset), limit = filter.limit === undefined ? 100 : Number(filter.limit); if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) fail('INVALID_PAGE', 'Use a nonnegative offset and a limit from 1 to 1000.'); return { items: rows.slice(offset,offset+limit),total:rows.length,offset,limit }; }
export function rowSearch(rows, q = '') { if (typeof q !== 'string') fail('INVALID_SEARCH','Search must be text.'); const terms=q.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean); return !terms.length ? rows : rows.filter(row => { const value = [row.serviceRequestId,row.serviceCode,row.serviceName,row.sourceStatus,row.address,row.description,row.agency,row.sourceStatusNotes,...Object.values(row.operator??{})].map(v=>typeof v==='string'?v:canonical(v??null)).join(' ').toLocaleLowerCase(); return terms.every(term=>value.includes(term)); }); }
export function originalBytes({originalText,contentBase64,format}) { if (format==='gpkg') { if (typeof contentBase64!=='string' || originalText!==undefined) fail('BINARY_FILE_REQUIRED','Use contentBase64 for the complete GeoPackage file.'); const bytes=Buffer.from(contentBase64,'base64'); if(bytes.toString('base64')!==contentBase64)fail('INVALID_BASE64','Use canonical complete base64.'); return bytes; } if(contentBase64!==undefined||typeof originalText!=='string')fail('TEXT_FILE_REQUIRED','Use originalText for the complete UTF-8 analyst file.');return Buffer.from(originalText,'utf8'); }
export const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
export const MAX_PACKAGE_BYTES = 256 * 1024 * 1024;
export const MAX_ROWS = 100000;
