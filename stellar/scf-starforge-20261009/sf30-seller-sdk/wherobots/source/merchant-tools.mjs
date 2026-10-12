// MIT. Source-owned Wherobots metadata; discovery opens no runtime or workspace.
import { wherobotsToolDefinitions } from "./tools.mjs";
// Public file-transport ceiling, matching the original shared retained-file ABI.
// Kept in this pure product metadata so a complete received source ZIP imports independently.
export const MAX_RETAINED_CHUNK_BYTES = 196608;

export const WHEROBOTS_CONNECTION_SCHEMA = "stellar-forge.wherobots-workspace-connection.v1";
export const WHEROBOTS_EXPORT_SCHEMA = "stellar-forge.wherobots-merchant-export.v1";
export const aliasSchema = {type:"string", pattern:"^[a-z0-9][a-z0-9_-]{0,63}$"};
export const hashSchema = {type:"string", pattern:"^[0-9a-f]{64}$"};
const read = {readOnly:true, idempotent:true};
const readonly = new Set(["state","runtime","get","list","events","rows","logs"]);
const fileSelection = {
  workspace:aliasSchema, kind:{type:"string",enum:["export","object"]},
  export_id:aliasSchema, file:{type:"string",minLength:1,maxLength:4096},
  object_sha256:hashSchema,
};
export function wherobotsMerchantTools(tool) {
  const result = [
    tool("merchant_wherobots_status","List the original configured Wherobots workspace aliases, pinned identities, connection state and selected input files.",{workspace:aliasSchema},[],read),
    tool("merchant_wherobots_open","Open the same original saved Python workspace through its host-selected runtime and pinned workspace identity.",{workspace:aliasSchema},["workspace"],{idempotent:true}),
    tool("merchant_wherobots_close","Drain this attachment's accepted calls and retained file reads; preserve the original native runs and saved workspace.",{workspace:aliasSchema},["workspace"],{idempotent:true}),
    tool("merchant_wherobots_inputs","List named original host inputs, or inspect the complete bytes of one selected input.",{workspace:aliasSchema,input:aliasSchema},["workspace"],read),
  ];
  for (const definition of wherobotsToolDefinitions) {
    const operation = definition.name.slice("wherobots_".length);
    if (operation === "inspect_export") continue;
    const properties = structuredClone(definition.inputSchema.properties);
    let required = [...definition.inputSchema.required];
    if (operation === "import_source") {
      delete properties.path; required=required.filter(key=>key!=="path");
      properties.input=aliasSchema; properties.expected_sha256=hashSchema;
      required.push("input","expected_sha256");
    }
    if (operation === "adopt") {
      properties.input=aliasSchema; properties.input_sha256=hashSchema;
      properties.files={type:"object",additionalProperties:aliasSchema};
      required.push("input_sha256");
    }
    if (operation === "import") {
      delete properties.source; required=required.filter(key=>key!=="source");
      properties.input=aliasSchema; properties.expected_sha256=hashSchema;
      required.push("input","expected_sha256");
    }
    if (["export","export_dataset"].includes(operation)) {
      delete properties.destination; delete properties.reuse_existing;
      required=required.filter(key=>key!=="destination");
      properties.export_id=aliasSchema; properties.expected_revision=hashSchema;
      required.push("export_id","expected_revision");
    }
    result.push(tool("merchant_wherobots_"+operation,definition.description,
      {workspace:aliasSchema,...properties},["workspace",...new Set(required)],
      readonly.has(operation)?read:{idempotent:["review","submit","recover","export","export_dataset","import"].includes(operation),
        openWorld:["submit","recover","refresh","cancel","capture"].includes(operation)}));
  }
  result.push(
    tool("merchant_wherobots_export_status","Reopen the original named complete export manifest and its exact file inventory. A completed export keeps its original bytes after subsequent workspace edits.",
      {workspace:aliasSchema,export_id:aliasSchema},["workspace","export_id"],read),
    tool("merchant_wherobots_file","Read an original content object or one exact file named by a retained export manifest. Continue by read_id and offset, or reopen the same expected_sha256 after a restart.",
      {...fileSelection,expected_sha256:hashSchema,read_id:{type:"string",minLength:1,maxLength:64},
        offset:{type:"integer",minimum:0},limit:{type:"integer",minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}},
      ["workspace","kind","expected_sha256"],read),
    tool("merchant_wherobots_file_release","Release this attachment's original read session for an export or content object.",
      {...fileSelection,read_id:{type:"string",minLength:1,maxLength:64}},["workspace","kind","read_id"],{idempotent:true})
  );
  return result;
}
