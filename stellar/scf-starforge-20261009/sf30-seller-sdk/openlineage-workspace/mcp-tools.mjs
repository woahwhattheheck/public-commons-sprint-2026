// MIT. Pure declarations adapted from the native workspace catalog.
import { tools as nativeTools } from "./catalog.mjs";

const alias = { type: "string", pattern: "^[a-z0-9][a-z0-9_-]{0,63}$" };
const hash = { type: "string", pattern: "^[a-f0-9]{64}$" };
const workspace = { workspace: alias };
const operation = { operationId: { type: "string", minLength: 1 }, expectedRevision: { type: "integer", minimum: 0 } };
const read = { readOnly: true, idempotent: true }, change = { idempotent: true };
export const LINEAGE_MERCHANT_RESPONSE_BYTES = 8 * 1024 * 1024;
export const LINEAGE_MERCHANT_REQUEST_BYTES = 128 * 1024;

export function lineageWorkspaceTools(tool) {
  return [
    tool("merchant_lineage_workspaces", "List host-configured original OpenLineage workspace and file aliases.", {}, [], read),
    tool("merchant_lineage_connection", "Inspect the host-selected application's current identity without switching an attached client.", workspace, ["workspace"], read),
    tool("merchant_lineage_reconnect", "Explicitly attach the selected current instance of the same workspace after a restart. Recover unfinished mutations with their original operation ID and exact input.", {
      ...workspace, expectedInstanceId: { type: "string", minLength: 1 }
    }, ["workspace", "expectedInstanceId"], change),
    ...nativeTools.map(native => tool("merchant_" + native.name, native.description + " Uses the host-configured workspace alias.", {
      ...workspace, ...native.inputSchema.properties
    }, ["workspace", ...native.inputSchema.required], {
      readOnly: native.annotations.readOnlyHint, idempotent: native.annotations.idempotentHint
    })),
    tool("merchant_lineage_input", "Inspect one complete host-pinned original source or result file and verify its selected SHA-256.", {
      ...workspace, input: alias, expectedSha256: hash
    }, ["workspace", "input"], read),
    tool("merchant_lineage_import_file", "Import the complete original JSON/NDJSON file selected by the host. Preserve input alias, SHA-256, operation ID, and expected revision for recovery.", {
      ...workspace, ...operation, input: alias, expectedSha256: hash, sourceUrl: { type: "string" }
    }, ["workspace", "operationId", "expectedRevision", "input", "expectedSha256"], change),
    tool("merchant_lineage_attach_file", "Attach a complete host-selected result file to original entities and a saved edition. The source reference and full result remain in workspace exports.", {
      ...workspace, ...operation, input: alias, expectedSha256: hash,
      entityKeys: { type: "array", items: { type: "string" }, minItems: 1 },
      editionId: { type: "string", minLength: 1 }, sourceReference: { type: "string", minLength: 1 }, query: {}
    }, ["workspace", "operationId", "expectedRevision", "input", "expectedSha256", "entityKeys", "editionId", "sourceReference"], change),
    tool("merchant_lineage_cancel", "Cancel the local wait for one active mutation. Recover its original operation because the native workspace may already have saved it.", {
      ...workspace, operationId: { type: "string", minLength: 1 }
    }, ["workspace", "operationId"], change)
  ];
}
