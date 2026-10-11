// MIT. IRIS routes and metadata in the original private conversion workspace.
import { pipeline } from 'node:stream/promises';
import { IrisWorkbenchError } from './workbench.mjs';
import { WorkspaceError } from '../../scap-workspace/mapping.mjs';

const PROFILE = 'ers-iris-2026';
const clean = value => value === undefined || value === null ? null : structuredClone(value);
const fail = (code, message, status = 400) => { throw new IrisWorkbenchError(code, message, status); };
function uploaded(value, maximum) {
  if (!value || value.encoding !== 'base64' || typeof value.data !== 'string' || value.data.length > Math.ceil(maximum / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data)) fail('IRIS_UPLOAD_INVALID', 'Choose a complete file within the filing limit.');
  const bytes = Buffer.from(value.data, 'base64');
  if (!bytes.length || bytes.length > maximum || bytes.toString('base64') !== value.data) fail('IRIS_UPLOAD_INVALID', 'The selected file upload is invalid.');
  return { bytes };
}
export function createIrisExtension(workbench) {
  return Object.freeze({
    id: PROFILE, browserModule: '/iris/panel.mjs',
    assets: ['panel.mjs', 'panel.css'].map(name => ({ path: '/iris/' + name, file: new URL(name, import.meta.url),
      type: name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8' })),
    decorateDraft({ spec, draft }) { return { ...draft, iris: clean(spec.workspace?.iris) }; },
    async compileSpec({ spec, draft, inputPins }) {
      try {
        if (spec.workspace?.profile?.id !== PROFILE) fail('IRIS_PROFILE_REQUIRED', 'Use the IRIS profile with this filing desk.');
        if (!draft.iris) fail('IRIS_PROJECTION_REQUIRED', 'Select the retained XML projection in the IRIS filings desk before staging.');
        const selected = await workbench.binding(draft.iris);
        if (!inputPins?.target) fail('IRIS_HOST_UPGRADE_REQUIRED', 'Use the maintained host that supplies exact selected input digests.', 503);
        if (inputPins.target.sha256 !== selected.targetSha256) fail('IRIS_TARGET_PROJECTION_CONFLICT', 'Select this retained XML projection’s exact CSV as the target before staging.', 409);
        return { ...spec, workspace: { ...spec.workspace, iris: selected } };
      } catch (error) { if (error instanceof IrisWorkbenchError) throw new WorkspaceError(error.code, error.message, error.status); throw error; }
    },
    async handleRequest({ req, res, url, send, readJson }) {
      if (!url.pathname.startsWith('/api/iris/')) return false;
      try {
        if (req.method === 'GET' && url.pathname === '/api/iris/configuration') {
          send(res, 200, { ...workbench.configuration, schemaConfigured: workbench.schemaConfigured }); return true;
        }
        if (req.method === 'GET' && url.pathname === '/api/iris/filings') {
          send(res, 200, await workbench.listFilings({ limit: Number(url.searchParams.get('limit') ?? 25),
            after: url.searchParams.get('after') ?? '', familyId: url.searchParams.get('familyId') || undefined })); return true;
        }
        const match = /^\/api\/iris\/filings\/([A-Za-z0-9][A-Za-z0-9._-]{0,95})(?:\/(transmission|response|decision|download|handoff))?$/.exec(url.pathname);
        if (req.method === 'GET' && match) {
          const filingId = match[1], action = match[2];
          if (!action) send(res, 200, await workbench.getFiling(filingId));
          else if (action === 'transmission') send(res, 200, await workbench.transmissionPage(filingId, {
            submissionId: url.searchParams.get('submissionId') ?? '', offset: Number(url.searchParams.get('offset') ?? 0), limit: Number(url.searchParams.get('limit') ?? 50) }));
          else if (action === 'response') send(res, 200, await workbench.responsePage(filingId, url.searchParams.get('responseId'), {
            submissionId: url.searchParams.get('submissionId') ?? '', offset: Number(url.searchParams.get('offset') ?? 0), limit: Number(url.searchParams.get('limit') ?? 50) }));
          else if (action === 'decision') send(res, 200, await workbench.decisionView(filingId, url.searchParams.get('decisionId')));
          else if (action === 'download') {
            const artifact = await workbench.download(filingId, url.searchParams.get('kind'), url.searchParams.get('id'));
            res.statusCode = 200; res.setHeader('Content-Type', artifact.type); res.setHeader('Content-Length', artifact.bytes.length);
            res.setHeader('Content-Disposition', `attachment; filename="${artifact.filename}"`);
            res.setHeader('X-IRIS-Artifact-Sha256', artifact.sha256); res.end(artifact.bytes);
          } else {
            const artifact = await workbench.createHandoff(filingId);
            try {
              res.statusCode = 200; res.setHeader('Content-Type', 'application/gzip'); res.setHeader('Content-Length', artifact.bytes);
              res.setHeader('Content-Disposition', `attachment; filename="${artifact.filename}"`);
              res.setHeader('X-IRIS-Manifest-Sha256', artifact.exported.manifest.sha256);
              await pipeline(artifact.stream(), res);
            } finally { await artifact.close(); }
          }
          return true;
        }
        if (req.method === 'POST') {
          const names = new Set(['intake', 'project', 'response', 'select-response', 'failure', 'evidence', 'plan', 'bind-comparison', 'binding', 'rebuild-lineage']);
          const action = url.pathname.slice('/api/iris/'.length);
          if (names.has(action)) {
            const maximum = workbench.configuration.maxArtifactBytes;
            const uploadAction = ['intake', 'response', 'failure', 'evidence'].includes(action);
            const body = await readJson(req, uploadAction ? Math.ceil(maximum / 3) * 4 + 16384 : 1024 * 1024);
            let result;
            if (action === 'intake') result = await workbench.intake({ filingId: body.filingId, input: uploaded(body.input, maximum),
              familyId: body.familyId || undefined, parent: body.parent || undefined, preparedRecordMap: body.preparedRecordMap, validation: body.validation });
            if (action === 'project') result = await workbench.project({ filingId: body.filingId, expectedRevision: body.expectedRevision,
              projectionId: body.projectionId, mapping: uploaded(body.mapping, 256 * 1024) });
            if (action === 'response') result = await workbench.importResponse({ filingId: body.filingId, expectedRevision: body.expectedRevision,
              input: uploaded(body.input, maximum), select: body.select });
            if (action === 'select-response') result = await workbench.selectResponse(body);
            if (action === 'failure') result = await workbench.importFailure({ filingId: body.filingId, expectedRevision: body.expectedRevision,
              input: uploaded(body.input, Math.min(maximum, 8 * 1024 * 1024)), httpStatus: body.httpStatus, operation: body.operation });
            if (action === 'evidence') result = await workbench.retainEvidence({ filingId: body.filingId, expectedRevision: body.expectedRevision,
              input: uploaded(body.input, maximum), evidenceId: body.evidenceId });
            if (action === 'plan') result = await workbench.plan(body);
            if (action === 'bind-comparison') result = await workbench.linkComparison(body);
            if (action === 'rebuild-lineage') result = await workbench.rebuildLineage(body);
            if (action === 'binding') result = await workbench.binding(body);
            send(res, 200, result); return true;
          }
        }
        send(res, 404, { error: 'IRIS_ENDPOINT_NOT_FOUND', message: 'The filing operation was not found.' }); return true;
      } catch (error) {
        if (res.headersSent) { res.destroy(); return true; }
        if (error instanceof IrisWorkbenchError) send(res, error.status, { error: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) });
        else if (error.code === 'ENOENT') send(res, 404, { error: 'IRIS_INPUT_NOT_FOUND', message: 'The selected retained input or original comparison could not be found.' });
        else if (error.code === 'EEXIST') send(res, 409, { error: 'IRIS_EXPORT_EXISTS', message: 'Choose a new create-only destination for this handoff.' });
        else send(res, 500, { error: 'IRIS_OPERATION_FAILED', message: 'The filing operation could not finish. Reopen its retained revision before making another change.' });
        return true;
      }
    },
  });
}
