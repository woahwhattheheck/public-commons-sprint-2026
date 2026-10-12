// MIT. Mounted only behind the original merchant workspace authentication.
import { acquirePaidJobAgentOperations } from './operations.mjs';
import { need } from './format.mjs';
import { RESOLUTION_RECEIVING_BYTES } from '../resolution/contract.mjs';

export const JOB_AGENT_REQUEST_BYTES = 1100000;
export function paidJobAgentExtension({ model, inputDesk }) {
  const retained = acquirePaidJobAgentOperations({ model, inputDesk });
  return {
    close: () => retained.close(),
    async authenticatedRoute({ request, url, body, send, signal }) {
      if (!url.pathname.startsWith('/api/job-agent/')) return false;
      const match = /^\/api\/job-agent\/([a-z]+(?:_[a-z]+)*)$/.exec(url.pathname);
      need(match, 'JOB_AGENT_ACTION_NOT_FOUND', 'Select an original paid-job agent endpoint.', 404);
      need(request.method === 'POST', 'JOB_AGENT_METHOD_REQUIRED', 'Use POST with the declared JSON object.', 405);
      const input = await body(match[1] === 'receive' ? RESOLUTION_RECEIVING_BYTES : JOB_AGENT_REQUEST_BYTES);
      signal?.throwIfAborted();
      send(await retained.operations.call(match[1], input, { signal }));
      return true;
    },
  };
}
