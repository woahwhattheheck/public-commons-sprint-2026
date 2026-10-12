// SPDX-License-Identifier: MIT
// Complete original GIS migration operations; native source owns validation.
export const MIGRATION_CONNECTION_SCHEMA = "starforge.migration-merchant-connection.v1";
export const MIGRATION_EXPORT_SCHEMA = "starforge.migration-merchant-export.v1";
export const MIGRATION_EXPORT_MANIFEST = "migration-export.json";
export const MIGRATION_REQUEST_SCHEMA = "starforge.migration-native-request.v1";
export const MAX_MIGRATION_REQUEST_BYTES = 40 * 1024 * 1024;
export const MAX_MIGRATION_FILE_BYTES = 8 * 1024 * 1024 * 1024;
export const MIGRATION_TOOL_PREFIX = "merchant_migration_";
const text = description => ({type:"string",description});
const integer = (minimum, maximum, description) => ({type:"integer",minimum,maximum,description});
const choice = (values,description) => ({type:"string",enum:values,description});
const workspace = text("Original host-declared workspace alias.");
const id = text("Exact identity returned by this original workspace.");
const sha = {type:"string",pattern:"^[a-f0-9]{64}$",description:"Exact SHA-256 from the original retained input or file."};
const paging = {offset:integer(0,Number.MAX_SAFE_INTEGER,"Original row offset."),limit:integer(1,500,"Rows on this page.")};
const write = {revision:integer(0,Number.MAX_SAFE_INTEGER,"Original reviewed workspace revision."),
 requestId:text("Stable original request ID; repeat it with the same reviewed input."),
 actor:text("Original operator identity."),wait:{type:"boolean",description:"Await this native operation; false returns its durable task identity."}};
const task = {requestId:text("Original durable native request ID.")};
const fileRead = {expectedSha256:sha,readId:text("Original retained reader ID; omit to reopen the same exact file."),
 offset:integer(0,Number.MAX_SAFE_INTEGER,"Exact byte offset."),limit:integer(1,196608,"Requested original byte range.")};

export function migrationWorkspaceTools(t) {
 const rows=[];
 const add=(name,description,properties={},required=[],global=false)=>rows.push(t(
   MIGRATION_TOOL_PREFIX+name,description,global?properties:{workspace,...properties},global?required:["workspace",...required]));
 add("status","List configured original GIS migration workspaces and accepted native work.",{workspace},[],true);
 add("open","Open the declared original workspace and return its native identity.");
 add("inputs","Inspect the host-declared original selection, capture and complete-handover inputs.",{input:text("Optional original input alias.")});
 add("state","Read the complete original migration workspace summary.");
 add("records","Page original captures, plans, editions, project deliveries, reviews, source inputs, software or comparisons.",
   {kind:choice(["captures","plans","editions","projectDeliveries","reviews","inputs","software","comparisons"],"Original retained record collection."),...paging},["kind"]);
 add("document","Read one complete original source document with exact native JSON numbers.",{kind:text("Original document kind."),id},["kind","id"]);
 add("draft","Draft mappings from the actual original capture and optional preceding plan.",
   {captureId:id,predecessorPlanId:id},["captureId"]);
 add("source_rows","Page original native source rows and preserve exact numeric lexemes.",
   {captureId:id,layerId:id,...paging},["captureId","layerId"]);
 add("issues","Page the actual original mapping review findings.",
   {planId:id,layerId:id,kind:text("Optional original issue kind."),...paging},["planId"]);
 add("comparison_rows","Page the complete original corrected-capture comparison.",
   {comparisonId:id,layerId:id,status:text("Optional original comparison status."),...paging},["comparisonId"]);
 add("history","Page the original workspace event journal.",paging);
 add("operation","Read the original native journal result for a saved request.",task,["requestId"]);
 add("task","Read or reconcile this attachment's same durable native task and result file.",task,["requestId"]);
 add("cancel","Cancel only the selected original native task and retain its committed workspace history.",task,["requestId"]);
 add("capture","Capture the complete host-declared original selection through the original native vector engine.",
   {input:text("Original selection input alias."),expectedSha256:sha,...write},["input","expectedSha256","revision","requestId","actor"]);
 add("receive_capture","Receive the declared complete original native capture and exact manifest.",
   {input:text("Original native capture alias."),expectedSha256:sha,...write},["input","expectedSha256","revision","requestId","actor"]);
 add("save_plan","Save the complete reviewed native mapping document without converting its JSON numbers.",
   {planJson:text("Complete original plan JSON; decimal and large-integer tokens are retained."),...write},["planJson","revision","requestId","actor"]);
 add("review_plan","Record the original mapping acceptance or required correction.",
   {planId:id,outcome:choice(["accepted","changes-requested"],"Original review decision."),note:text("Complete operator review note."),...write},
   ["planId","outcome","note","revision","requestId","actor"]);
 add("compare_captures","Compare the complete original and corrected captures through the original engine.",
   {beforeCaptureId:id,afterCaptureId:id,...write},["beforeCaptureId","afterCaptureId","revision","requestId","actor"]);
 add("build_edition","Build the complete reviewed destination edition with its exact source, key, field, CRS and geometry decisions.",
   {planId:id,...write},["planId","revision","requestId","actor"]);
 add("build_projects","Build and reopen every QGIS project selected by the original migration edition.",
   {editionId:id,...write},["editionId","revision","requestId","actor"]);
 add("verify","Verify the original complete migration and declared file closure.",{wait:write.wait});
 add("native_info","Read the selected native vector runtime and complete original source closure.");
 add("qgis_info","Read the selected actual QGIS version and original application source closure.");
 add("native_reopen","Reopen original saved projects and complete cartographic publications in the selected QGIS runtime.",{wait:write.wait});
 add("files","Page the original declared workspace files or inspect one exact descriptor.",
   {path:text("Original declared relative file path."),query:text("Optional file-name search."),...paging});
 add("file","Read exact bytes from an original declared workspace file.",
   {path:text("Original declared relative file path."),...fileRead},["path","expectedSha256"]);
 add("file_release","Release this original workspace-file reader.",{path:text("Original declared relative file path."),readId:fileRead.readId},["path","readId"]);
 add("task_file","Read the exact original native result file for a completed or failed task.",
   {...task,kind:choice(["result","log"],"Original completed result or native log."),...fileRead},["requestId","expectedSha256"]);
 add("task_file_release","Release the original native-result reader.",{...task,kind:choice(["result","log"],"Original completed result or native log."),readId:fileRead.readId},["requestId","readId"]);
 add("export","Save the complete original native handover under one reviewed export identity.",
   {exportId:text("Stable original handover ID."),...write},["exportId","revision","requestId","actor"]);
 add("export_manifest","Inspect the immutable complete-handover manifest.",
   {exportId:text("Original handover ID.")},["exportId"]);
 add("export_file","Read the original handover or manifest through the shared retained-file reader.",
   {exportId:text("Original handover ID."),file:text("Exact file name from its original manifest."),
    expectedManifestSha256:sha,...fileRead},["exportId","file","expectedManifestSha256","expectedSha256"]);
 add("export_file_release","Release the original handover file reader.",
   {exportId:text("Original handover ID."),readId:fileRead.readId},["exportId","readId"]);
 add("receive","Independently receive the complete host-declared handover at its declared destination and reopen its original native projects.",
   {input:text("Original complete handover input alias."),destination:text("Host-declared receiving destination alias."),
    expectedSha256:sha,nativeReopen:choice(["auto","required","skip"],"Original native receiving mode; required opens actual QGIS."),
    requestId:write.requestId,wait:write.wait},["input","destination","expectedSha256","requestId"]);
 add("cartography_inventory","Read saved projects, original publication plans, operations and complete publications.");
 add("cartography_preview","Review the complete exact native publication plan and original source comparison.",
   {specJson:text("Complete original publication plan JSON.")},["specJson"]);
 add("cartography_save_plan","Save the complete reviewed original cartographic publication plan.",
   {specJson:text("Complete original publication plan JSON."),...write},["specJson","revision","requestId","actor"]);
 add("cartography_publish","Render or recover the same original complete QGZ/QPT/PDF/PNG publication.",
   {planId:id,...write},["planId","revision","requestId","actor"]);
 add("cartography_operation","Read the original cartographic render request and retained completion.",task,["requestId"]);
 add("cartography_publication","Inspect a complete original publication and all native output identities.",
   {publicationId:id},["publicationId"]);
 add("cartography_download","Resolve the exact original QGZ, QPT, PDF, PNG, plan or receipt descriptor for file receiving.",
   {publicationId:id,kind:choice(["qgz","qpt","pdf","png","plan","receipt"],"Original publication file.")},["publicationId","kind"]);
 add("cartography_reopen","Reopen selected or all original cartographic publications through the original native renderer.",
   {publicationId:id,wait:write.wait});
 add("close","Cancel and drain this original workspace attachment and release its retained file descriptors.");
 return rows;
}
export const migrationToolDefinitions = Object.freeze(migrationWorkspaceTools(
 (name,description,properties,required)=>Object.freeze({name,description,properties,required})));
