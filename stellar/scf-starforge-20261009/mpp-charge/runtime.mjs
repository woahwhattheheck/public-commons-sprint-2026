// MIT. Isolated published peer set; no global loader or fetch mutation.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { absolute } from './config.mjs';
import { requireValue } from './storage.mjs';
export const versions=Object.freeze({'@stellar/mpp':'0.7.1','mppx':'0.6.29','@stellar/stellar-sdk':'15.1.0'});
export async function loadNative(dependencyRoot) {
  const resolver=createRequire(join(absolute(dependencyRoot),'package.json'));
  for(const [name,version] of Object.entries(versions)) {
    let directory=dirname(resolver.resolve(name)), found=false;
    while(dirname(directory)!==directory) {
      try {
        const meta=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
        if(meta.name===name) {
          requireValue(meta.version===version,'MPP_PUBLISHED_RUNTIME_VERSION_MISMATCH');
          found=true; break;
        }
      } catch(error) { if(error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
      directory=dirname(directory);
    }
    requireValue(found,'MPP_RUNTIME_PACKAGE_METADATA_REQUIRED');
  }
  const imported=await Promise.all(['mppx','mppx/server','@stellar/stellar-sdk',
    '@stellar/mpp/charge/server','@stellar/mpp/charge/client'].map(name=>import(pathToFileURL(resolver.resolve(name)).href)));
  const [core,server,sdk,stellarServer,stellarClient]=imported;
  return {...core,server,sdk,stellarServer,stellarClient,versions};
}
