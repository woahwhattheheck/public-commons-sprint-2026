import {tools as nativeTools} from "./catalog.mjs";
export const AUDIT_MERCHANT_REQUEST_BYTES=8*1024*1024;
const s={type:"string"},workspace={workspace:s},read={readOnly:true,idempotent:true},write={idempotent:true};
export function auditWorkspaceTools(tool){
  return [
    tool("merchant_audit_workspaces","List configured original audit workspace and full input aliases.",{},[],read),
    tool("merchant_audit_connection","Inspect the selected original running audit application.",workspace,["workspace"],read),
    tool("merchant_audit_reconnect","Attach an explicitly reviewed new running instance of the same original audit workspace.",{...workspace,expectedInstanceId:s},["workspace","expectedInstanceId"],write),
    ...nativeTools.map(native=>tool("merchant_"+native.name,native.description,{...workspace,...native.inputSchema.properties},["workspace",...native.inputSchema.required],{readOnly:!native.mutation,idempotent:true})),
    tool("merchant_audit_input","Read full input metadata after verifying its original complete bytes.",{...workspace,input:s,expectedSha256:s},["workspace","input","expectedSha256"],read),
    tool("merchant_audit_import_file","Import a complete host-pinned original XML or editable workspace package.",{...workspace,input:s,expectedSha256:s,kind:{enum:["source","workspace"]},requestId:s,expectedVersion:{type:"integer",minimum:0},actor:s,note:s,selectedSchema:s,profileIds:{type:"array",items:s}},["workspace","input","expectedSha256","kind","requestId","expectedVersion","actor","note"],write),
    tool("merchant_audit_analyse_file","Run the original selected source stream with complete observed weather from a host-pinned input alias.",{...workspace,...nativeTools.find(x=>x.action==="analysis.run").inputSchema.properties,weatherInput:s,expectedWeatherSha256:s},["workspace",...nativeTools.find(x=>x.action==="analysis.run").inputSchema.required.filter(k=>!["weatherCsvBase64","weatherName","weatherSource"].includes(k)),"weatherInput","expectedWeatherSha256"],write)
  ];
}
