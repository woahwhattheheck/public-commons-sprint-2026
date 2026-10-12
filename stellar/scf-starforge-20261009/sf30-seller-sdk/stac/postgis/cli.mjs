#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {need, canonical, parseExactJSON, normalizeProfile} from './contract.mjs';
import {regularFile, readJSON} from './files.mjs';
import {openPostgisIntake} from './index.mjs';
import {verifyReceiving} from './verify.mjs';

export async function connectionFile(path) {
  const selected = resolve(path), stat = await regularFile(selected);
  need((stat.mode & 0o077) === 0, 'POSTGIS_PRIVATE_CONNECTION_FILE_REQUIRED');
  const value = parseExactJSON(await readFile(selected, 'utf8'));
  need(value && typeof value === 'object' && !Array.isArray(value), 'POSTGIS_CONNECTION_OBJECT_REQUIRED');
  return value;
}
export function argumentsOf(values) {
  const args = {command: values.shift() || 'help'};
  for (let i = 0; i < values.length; i += 2) {
    need(/^--[a-z][a-z-]*$/.test(values[i]) && values[i + 1] && !values[i + 1].startsWith('--'),
      'POSTGIS_NAMED_ARGUMENT_VALUE_REQUIRED', values[i]);
    const name = values[i].slice(2);
    need(!Object.hasOwn(args, name), 'POSTGIS_DUPLICATE_ARGUMENT', name);
    args[name] = values[i + 1];
  }
  return args;
}
const METHODS = Object.freeze({
  inspect: 'inspect', history: 'operationHistory', 'recover-operation': 'recoverOperation',
  stage: 'stage', review: 'review', row: 'readRow',
  promote: 'promote', rollback: 'rollback',
  'export-receiving': 'exportReceiving', 'export-backup': 'exportBackup', 'restore-backup': 'restoreBackup'
});
export async function runPostgisCommand(argv) {
  const args = argumentsOf([...argv]);
  if (args.command === 'help') return {usage: [
    'node stac/postgis/cli.mjs inspect|history --connection PRIVATE_JSON --profile PROFILE_JSON --workspace DIRECTORY',
    'node stac/postgis/cli.mjs recover-operation --connection PRIVATE_JSON --profile CURRENT_PROFILE_JSON --workspace DIRECTORY --operation ORIGINAL_OPERATION_ID',
    'node stac/postgis/cli.mjs stage|review|row|promote|rollback|export-receiving|export-backup|restore-backup --connection PRIVATE_JSON --profile PROFILE_JSON --workspace DIRECTORY --request ORIGINAL_REQUEST_JSON',
    'node stac/postgis/cli.mjs verify-receiving --connection PRIVATE_READER_JSON --request ORIGINAL_REQUEST_JSON',
    'node stac/postgis/cli.mjs serve --connection PRIVATE_JSON --profile PROFILE_JSON --workspace DIRECTORY --port 0'
  ], requestGuide: 'OPERATOR.md',
    recovery: 'recover-operation is read only. It reads a committed original result and verifies its retained export files; it never executes the old request. Use --operation ID or --request JSON containing only operationId.',
    originalOperation: 'Keep the same request file and operationId after an interrupted response. On a restored database, recover the committed result without replaying the old database profile.'};
  need(args.command === 'recover-operation' || args.operation === undefined,
    'POSTGIS_OPERATION_OPTION_REQUIRES_RECOVERY_COMMAND');
  need(args.connection, 'POSTGIS_CONNECTION_FILE_REQUIRED');
  const connection = await connectionFile(args.connection);
  if (args.command === 'verify-receiving') {
    need(args.request, 'POSTGIS_REQUEST_FILE_REQUIRED');
    return verifyReceiving({...await readJSON(resolve(args.request)), connection});
  }
  need(args.profile && args.workspace, 'POSTGIS_PROFILE_AND_WORKSPACE_REQUIRED');
  const profile = normalizeProfile(await readJSON(resolve(args.profile)));
  if (args.command === 'serve') {
    const {startOperator} = await import('./operator.mjs');
    const server = await startOperator({connection, profile, directory: resolve(args.workspace), python: args.python,
      port: args.port === undefined ? 0 : Number(args.port)});
    return {schema: 'starforge.postgis-operator-started.v1', url: server.url, projectId: profile.projectId,
      database: {profileId: profile.database.profileId, name: profile.database.name, schema: profile.database.schema}};
  }
  const method = METHODS[args.command];
  need(method, 'POSTGIS_COMMAND_NOT_FOUND', args.command);
  need(!(args.command === 'recover-operation' && args.operation !== undefined && args.request !== undefined),
    'POSTGIS_RECOVERY_SELECT_ONE_OPERATION_INPUT');
  const request = args.command === 'recover-operation' && args.operation !== undefined
    ? {operationId: args.operation}
    : ['inspect', 'history'].includes(args.command) && !args.request ? {}
      : args.request ? await readJSON(resolve(args.request)) : null;
  need(request && typeof request === 'object' && !Array.isArray(request), 'POSTGIS_REQUEST_FILE_REQUIRED');
  if (args.command === 'recover-operation') need(Object.keys(request).length === 1 &&
    typeof request.operationId === 'string' && request.operationId.length > 0,
    'POSTGIS_RECOVERY_OPERATION_ID_ONLY');
  const intake = await openPostgisIntake({connection, profile, directory: resolve(args.workspace), python: args.python});
  try { return await intake[method](request); } finally { await intake.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(canonical(await runPostgisCommand(process.argv.slice(2))) + '\n'); }
  catch (error) {
    process.stderr.write(canonical({code: error.code || 'POSTGIS_COMMAND_FAILED',
      message: error.code?.startsWith('POSTGIS_') ? error.message : 'The selected native operation returned an error.',
      detail: error.code?.startsWith('POSTGIS_') ? error.detail : undefined,
      operationId: error.operationId, commitOutcome: error.postgisCommitOutcome}) + '\n');
    process.exitCode = 1;
  }
}
