// MIT. Original portfolio file manifest for the maintained merchant transport.
import {createHash} from 'node:crypto';
export const GRANT_PORTFOLIO_MANIFEST = 'grant-portfolio-manifest.json';
export const GRANT_PORTFOLIO_EXPORT_SCHEMA = 'stellar-forge.grant-portfolio-merchant-export.v1';
export const GRANT_PORTFOLIO_CONNECTION_SCHEMA = 'stellar-forge.grant-portfolio-connection.v1';
export const GRANT_PORTFOLIO_MAX_BYTES = 4 * 1024 * 1024 * 1024;
export const GRANT_PORTFOLIO_SHA = /^[0-9a-f]{64}$/;
export const GRANT_PORTFOLIO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const GRANT_PORTFOLIO_OPERATION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
export const GRANT_PORTFOLIO_ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const portfolioHash = value => createHash('sha256').update(value).digest('hex');
export const portfolioPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const portfolioFailure = (code, message) => Object.assign(new Error(message), {code:'GRANT_PORTFOLIO_' + code});
export const portfolioNeed = (value, code, message) => {if (!value) throw portfolioFailure(code, message);};
export function portfolioExact(value, allowed, required = []) {
  portfolioNeed(portfolioPlain(value) && Object.keys(value).every(key => allowed.includes(key)) &&
    required.every(key => Object.hasOwn(value, key)), 'INVALID_PARAMS', 'Supply the declared original fields.');
}
export function portfolioChecked(value, pattern, label) {
  portfolioNeed(typeof value === 'string' && pattern.test(value), 'INVALID_PARAMS', 'Use the original ' + label + '.'); return value;
}
export function portfolioInteger(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  portfolioNeed(Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    'INVALID_PARAMS', 'Use an integer inside the declared original range.'); return value;
}
const stable = value => Array.isArray(value) ? '[' + value.map(stable).join(',') + ']' :
  portfolioPlain(value) ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}' : JSON.stringify(value);
export const portfolioJson = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function nativeFile(value) {
  portfolioExact(value, ['sha256','bytes','filename'], ['sha256','bytes','filename']);
  portfolioChecked(value.sha256, GRANT_PORTFOLIO_SHA, 'native export SHA-256');
  portfolioInteger(value.bytes, 1, GRANT_PORTFOLIO_MAX_BYTES);
  portfolioNeed(typeof value.filename === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(value.filename),
    'EXPORT_INVALID', 'Use the original safe native packet filename.');
}
export function createGrantPortfolioManifest(input) {
  portfolioExact(input, ['workspace','workspaceId','operationId','portfolioId','revision','snapshot','nativeExport'],
    ['workspace','workspaceId','operationId','portfolioId','revision','snapshot','nativeExport']);
  portfolioChecked(input.workspace, GRANT_PORTFOLIO_ALIAS, 'workspace alias');
  portfolioChecked(input.workspaceId, GRANT_PORTFOLIO_UUID, 'workspace identity');
  portfolioChecked(input.operationId, GRANT_PORTFOLIO_OPERATION, 'operation ID');
  portfolioChecked(input.portfolioId, GRANT_PORTFOLIO_UUID, 'portfolio identity');
  portfolioChecked(input.snapshot, GRANT_PORTFOLIO_SHA, 'portfolio snapshot');
  portfolioInteger(input.revision, 1); nativeFile(input.nativeExport);
  const value = {schema:GRANT_PORTFOLIO_EXPORT_SCHEMA, ...input,
    files:[{name:'portfolio.zip', bytes:input.nativeExport.bytes, sha256:input.nativeExport.sha256, type:'application/zip'}]};
  return {...value, exportId:portfolioHash(stable(value) + '\n')};
}
export function parseGrantPortfolioManifest(bytes, expectedId) {
  let value;
  try {value = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));}
  catch {throw portfolioFailure('EXPORT_INVALID', 'The complete original receiving manifest is invalid.');}
  portfolioExact(value, ['schema','workspace','workspaceId','operationId','portfolioId','revision','snapshot','nativeExport','files','exportId'],
    ['schema','workspace','workspaceId','operationId','portfolioId','revision','snapshot','nativeExport','files','exportId']);
  portfolioNeed(value.schema === GRANT_PORTFOLIO_EXPORT_SCHEMA, 'EXPORT_INVALID', 'Select the original portfolio receiving manifest.');
  const {schema, files, exportId, ...input} = value, expected = createGrantPortfolioManifest(input);
  portfolioNeed(exportId === expected.exportId && (expectedId === undefined || exportId === expectedId) &&
    stable(files) === stable(expected.files), 'EXPORT_CHANGED', 'The original portfolio, native packet or selected manifest changed.');
  return value;
}
