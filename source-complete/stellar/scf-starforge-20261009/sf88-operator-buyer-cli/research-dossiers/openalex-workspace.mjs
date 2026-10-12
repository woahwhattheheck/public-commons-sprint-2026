// MIT — Open an installed original saved research workspace for dossier imports.
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { need } from '../node/store.mjs';

/** The local launch command selects this code and directory; browser requests select only saved editions. */
export async function openSavedOpenAlexWorkspace({directory, modulePath} = {}) {
  need(typeof directory === 'string' && isAbsolute(directory) && resolve(directory) === directory,
    'OPENALEX_WORKSPACE_ABSOLUTE_PATH_REQUIRED');
  need(await realpath(directory) === directory, 'OPENALEX_WORKSPACE_SYMLINK_REFUSED');
  for (const name of ['queries', 'editions']) {
    const entry = await lstat(join(directory, name));
    need(entry.isDirectory() && !entry.isSymbolicLink(), 'OPENALEX_EXISTING_WORKSPACE_REQUIRED');
  }
  const selected = modulePath ?? fileURLToPath(new URL('../research/workspace.mjs', import.meta.url));
  need(typeof selected === 'string' && isAbsolute(selected) && resolve(selected) === selected,
    'OPENALEX_MODULE_ABSOLUTE_PATH_REQUIRED');
  let installed;
  try { installed = await import(pathToFileURL(selected).href); }
  catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') throw Object.assign(
      new Error('OPENALEX_ORIGINAL_MODULE_REQUIRED'), {code:'OPENALEX_ORIGINAL_MODULE_REQUIRED',cause:error});
    throw error;
  }
  need(typeof installed.openResearchWorkspace === 'function', 'OPENALEX_ORIGINAL_WORKSPACE_API_REQUIRED');
  const workspace = await installed.openResearchWorkspace(directory);
  try {
    need(workspace && typeof workspace.listEditions === 'function' && typeof workspace.exportFiles === 'function' &&
      typeof workspace.close === 'function', 'OPENALEX_ORIGINAL_WORKSPACE_API_REQUIRED');
    return workspace;
  } catch (error) { await workspace?.close?.(); throw error; }
}
