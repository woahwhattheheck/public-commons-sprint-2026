// MIT. File actions borrow the existing private host, bearer token and abort lifetime.
import { readFile } from 'node:fs/promises';
import { need } from '../../../sf30-seller-sdk/jobs/intake/protocol.mjs';
import { MAX_PLAN_BYTES } from '../../../sf30-seller-sdk/jobs/inputs/protocol.mjs';
import { readInputChunk } from '../../../sf30-seller-sdk/jobs/inputs/http.mjs';

export async function jobInputFileExtension(intake) {
  need(intake?.inputFiles, 'JOB_INPUT_CUSTOMER_REQUIRED');
  const additionalAssets = await Promise.all([
    ['/jobs/request/files.mjs', 'public/files.mjs'],
    ['/jobs/request/sha256.mjs', 'public/sha256.mjs'],
    ['/jobs/request/hash-worker.mjs', 'public/hash-worker.mjs'],
  ].map(async ([route, file]) => ({ route, type: 'text/javascript', bytes: await readFile(new URL(file, import.meta.url)) })));
  const authenticatedRoute = async ({ request, url, send, body, signal }) => {
    if (url.pathname === '/api/job-intake/files/library') {
      need(request.method === 'GET', 'JOB_INPUT_METHOD_REJECTED', 405);
      send(intake.inputFiles.searchLibrary({ q: url.searchParams.get('q') ?? '',
        offset: Number(url.searchParams.get('offset') ?? 0), limit: Number(url.searchParams.get('limit') ?? 20) }));
      return true;
    }
    const match = /^\/api\/job-intake\/requests\/([a-f0-9]{64})\/files(?:\/(begin|local|library|remove|cleanup|[a-f0-9]{64}(?:\/(?:seal|chunks\/(?:0|[1-9][0-9]{0,4})))?))?$/.exec(url.pathname);
    if (!match) return false;
    const [, id, action] = match;
    if (!action && request.method === 'GET') { send((await intake.get(id)).inputFiles); return true; }
    let result;
    if (action === 'begin' && request.method === 'POST') {
      const value = await body(MAX_PLAN_BYTES + 512);
      result = await intake.inputFiles.begin(id, { plan: value.plan, expectedRevision: value.expectedRevision,
        source: { kind: 'browser-file', filename: value.plan?.file?.filename }, signal });
    } else if (action === 'local' && request.method === 'POST') {
      const value = await body(8192);
      result = (await intake.inputFiles.local(id, { ...value, signal })).upload;
    } else if (action === 'library' && request.method === 'POST') {
      const value = await body(8192);
      result = (await intake.inputFiles.library(id, { ...value, signal })).upload;
    } else if (action === 'remove' && request.method === 'POST') {
      const value = await body(4096);
      send(await intake.inputFiles.remove(id, { slot: value.slot, expectedRevision: value.expectedRevision, signal }));
      return true;
    } else if (action === 'cleanup' && request.method === 'POST') {
      const value = await body(4096);
      send(await intake.inputFiles.cleanup(id, { expectedRevision: value.expectedRevision, signal }));
      return true;
    } else {
      const chunk = /^([a-f0-9]{64})\/chunks\/(0|[1-9][0-9]{0,4})$/.exec(action ?? '');
      const seal = /^([a-f0-9]{64})\/seal$/.exec(action ?? '');
      if (chunk && request.method === 'PUT') result = await intake.inputFiles.chunk(id, {
        uploadId: chunk[1], index: Number(chunk[2]), body: await readInputChunk(request), signal });
      else if (seal && request.method === 'POST') {
        await body(4096);
        result = await intake.inputFiles.seal(id, { uploadId: seal[1], signal });
      } else need(false, 'JOB_INPUT_METHOD_REJECTED', 405);
    }
    send({ upload: result, request: (await intake.get(id)).id }); return true;
  };
  return { additionalAssets, authenticatedRoute };
}
