"""MIT. Explicit reviewed directory choices joined to the original Gravity resources."""
from __future__ import annotations
import copy
from pathlib import Path
from directory_runtime import InputError,source,safe_read,write_zip,original_workspace
from directory_domain import ref_key,public_ref,DirectoryView
import directory_schema as schema
from eltss_correction import CorrectionMixin

class _OriginalCorrection:
    def __init__(self,workspace):self.workspace=workspace
    def __getattr__(self,name):return getattr(self.workspace,name)
    def edition(self,ident):return self.workspace.referral_record("editions",ident)

def original_resource(row):
    return source.json_value(row["jsonText"],lexical=True)

class DirectoryReferral:
    def join_directory_referrals(self,raw):
        request=schema.input_value("referral_join",raw)
        request.setdefault("configurationId",None)
        request_sha=source.sha(source.jbytes(request))
        with self.mutex,self.scratch() as temp:
            for existing in self.directory_records("referralJoins"):
                if existing["requestSha256"]==request_sha:
                    self.source(existing["sourceId"])
                    self.referral_record("editions",existing["successorEditionId"])
                    return existing
            directory=Path(temp)
            selection=self.directory_record("selections",request["selectionId"])
            conversion=self.directory_conversion(request["conversionId"])
            before=self.referral_record("editions",request["referralEditionId"])
            configuration=request["configurationId"] or before["configurationId"]
            self.referral_record("configurations",configuration)
            if selection["editionId"]!=conversion["editionId"]:
                raise InputError("The reviewed service selection and mapping conversion must use the same original directory edition")
            if selection.get("conversionId") and selection["conversionId"]!=conversion["id"]:
                raise InputError("The selected source conversion differs from the service choice's retained conversion")
            view=DirectoryView(self,conversion["editionId"])
            chosen={ref_key(r)for r in selection["chosenRefs"]}
            mapping_rows=self.directory_conversion_resources(conversion["id"])
            by_ref={ref_key(r["ref"]):r for r in mapping_rows}
            directory_bundle=source.json_value(safe_read(self._file_path(conversion["bundleFile"]),source.MAX_SOURCE),lexical=True)
            directory_entries=directory_bundle.get("entry",[])
            by_url={}
            for entry in directory_entries:
                url=entry.get("fullUrl")
                if not url or url in by_url:raise InputError("Mapped directory resources require distinct complete reference identities")
                by_url[url]=entry
            bindings=[];patches=[];mutations={};existing_aliases={}
            with self._graph(before["graphId"]) as (_,index,resolved,__):
                for row in index.all_rows():
                    if row.get("fullUrl"):existing_aliases.setdefault(row["fullUrl"],[]).append(row)
                for b in request["taskBindings"]:
                    if ref_key(b["serviceRef"])not in chosen:
                        raise InputError("A referral binding must choose a service in the saved selected set")
                    view.row(b["serviceRef"])
                    service=by_ref.get(ref_key(b["serviceRef"]))
                    if not service or service["resourceType"]!="HealthcareService":raise InputError("The selected service needs its exact mapped HealthcareService resource")
                    service_entry=by_url[service["fullUrl"]]
                    target=service_entry
                    if b["recipientType"]=="Organization":
                        reference=service_entry["resource"].get("providedBy",{}).get("reference")
                        target=by_url.get(reference)
                        if not target or target["resource"].get("resourceType")!="Organization":
                            raise InputError("The selected provider Organization must be explicitly resolved in this same conversion")
                    if b["taskId"]not in before["taskIds"]:raise InputError("The binding must select an original Task in this exact referral edition")
                    task=index.row(b["taskId"])
                    if task["resourceType"]!="Task":raise InputError("Selected original referral resource is not a Task")
                    if not b["reason"].strip():raise InputError("Each directory-to-referral binding retains its reviewed reason")
                    selected_resource=task;field=None;replacement=None
                    if b["destinationField"]=="Task.owner":
                        field="owner";replacement={"reference":target["fullUrl"],"type":b["recipientType"]}
                    elif b["destinationField"]=="ServiceRequest.performer":
                        if not b.get("serviceRequestId"):raise InputError("Select the exact original ServiceRequest for a performer addition")
                        selected_resource=index.row(b["serviceRequestId"])
                        if selected_resource["resourceType"]!="ServiceRequest":raise InputError("Performer additions require an original ServiceRequest")
                        target_ids=set()
                        for edge in resolved.outgoing(task["recordId"]):
                            if edge.get("path")==["focus"] and edge.get("status")=="resolved":
                                target_ids.update(edge.get("targetRecordIds",[]))
                        if selected_resource["recordId"]not in target_ids:
                            raise InputError("The original Task.focus must resolve to this selected ServiceRequest in its saved graph")
                        field="performer"
                        replacement=copy.deepcopy(selected_resource["_resource"].get("performer",[]))
                        if not isinstance(replacement,list):raise InputError("Original ServiceRequest.performer is not its native reference array")
                        addition={"reference":target["fullUrl"],"type":b["recipientType"]}
                        if not any(isinstance(r,dict) and r.get("reference")==target["fullUrl"] for r in replacement):replacement.append(addition)
                    elif b["destinationField"]!="link-only":raise InputError("Unknown original resource binding field")
                    before_value=selected_resource["_resource"].get(field) if field else None
                    if field:
                        identity=(selected_resource["recordId"],field)
                        if identity in mutations:
                            raise InputError("Select one complete reviewed assignment per original Task owner or ServiceRequest performer field")
                        mutations[identity]=replacement
                        patches.append({"recordId":selected_resource["recordId"],"path":[field],
                            "action":"replace" if field in selected_resource["_resource"] else "add","valueJson":source.lexical_json(replacement)})
                    bindings.append({**b,"serviceFullUrl":service["fullUrl"],"recipientFullUrl":target["fullUrl"],
                        "originalTaskSourceId":before["sourceId"],"originalTaskSha256":task["resourceSha256"],
                        "resourceId":selected_resource["recordId"],"originalResourceSha256":selected_resource["resourceSha256"],
                        "beforeJson":source.lexical_json(before_value) if field else None,
                        "afterJson":source.lexical_json(replacement) if field else None,
                        "originalTaskStatus":task["_resource"].get("status"),"originalTaskIntent":task["_resource"].get("intent"),
                        "originalTaskBusinessStatus":task["_resource"].get("businessStatus")})
                if not bindings:raise InputError("Choose at least one complete explicit referral binding")
                added_entries=[];reused=[]
                for entry in directory_entries:
                    matching=existing_aliases.get(entry["fullUrl"],[])
                    if matching:
                        expected=source.lexical_json(entry["resource"])
                        if any(source.lexical_json(r["_resource"])!=expected for r in matching):
                            raise InputError("A mapped directory identity conflicts with a different original clinical resource; review its source or identity before joining")
                        if len(matching)!=1:raise InputError("The original clinical source has ambiguous copies of this directory identity")
                        reused.append({"fullUrl":entry["fullUrl"],"recordId":matching[0]["recordId"],"resourceSha256":matching[0]["resourceSha256"]})
                    else:added_entries.append(entry)
            correction_request={"label":request["label"],"actor":request["actor"],"note":request["note"],
                "editionId":before["id"],"reason":"Reviewed directory service selection "+selection["id"],"patches":patches}
            # Use the original complete correction engine; contained and nested resources retain their owners.
            derived=CorrectionMixin._derive_correction(_OriginalCorrection(self),correction_request,directory)
            directory_document=directory/"selected-directory.json"
            original_workspace.private_write(directory_document,source.lexical_json({"resourceType":"Bundle","type":"collection",
                "id":"selected-directory-"+request_sha[:32],"entry":added_entries}).encode()+b"\n")
            doc={"name":"documents/selected-directory.json","bytes":directory_document.stat().st_size,
                "sha256":original_workspace.file_digest(directory_document),"role":"reviewed-directory-resources","sourceUrl":None}
            originals=[]
            original_paths={}
            for ident,role in [(before["sourceId"],"complete-original-referral-predecessor"),(conversion["sourceId"],"complete-original-directory-conversion")]:
                path=self.source_path(ident);name="predecessors/"+ident+".eltss"
                originals.append({"name":name,"bytes":path.stat().st_size,"sha256":ident,"role":role});original_paths[name]=path
            report={"schema":"stellar-forge.human-services-directory-referral-join.v1","request":request,"requestSha256":request_sha,
                "sourceEditionId":before["id"],"sourceId":before["sourceId"],"selectionId":selection["id"],"conversionId":conversion["id"],
                "bindings":bindings,"nativeCorrectionRequest":correction_request,"nativeCorrectionRequestSha256":derived["requestSha256"],
                "recordMap":derived["recordMap"],"addedDirectoryResources":len(added_entries),"reusedResources":reused,
                "classification":"operator_transformation","clinicalFieldsRetained":["Task.status","Task.intent","Task.businessStatus","Task.output",
                    "ServiceRequest.status","ServiceRequest.intent","Consent","original outcomes"],
                "sourceRefs":[public_ref(view.row(b["serviceRef"]))for b in request["taskBindings"]]}
            report_path=directory/"join.json";original_workspace.private_write(report_path,source.lexical_json(report).encode()+b"\n")
            protocol=[{"name":"review/directory-referral-join.json","bytes":report_path.stat().st_size,"sha256":original_workspace.file_digest(report_path),"role":"reviewed-directory-service-bindings"},
                {"name":"review/native-changes.jsonl","bytes":derived["changesPath"].stat().st_size,"sha256":original_workspace.file_digest(derived["changesPath"]),"role":"complete-original-engine-change-record"}]
            manifest={"schema":source.SOURCE_SCHEMA,"origin":"operator_transformation","documents":[derived["document"],doc],
                "protocol":protocol,"predecessors":originals,"context":report}
            members={derived["document"]["name"]:derived["bundlePath"],doc["name"]:directory_document,
                protocol[0]["name"]:report_path,protocol[1]["name"]:derived["changesPath"],**original_paths,"manifest.json":source.jbytes(manifest)}
            if sum(v.stat().st_size if isinstance(v,Path) else len(v)for v in members.values())>source.MAX_SOURCE:
                raise InputError("The complete clinical source, directory source and review exceed the native256MiB source bound")
            packet=directory/"directory-referral-source.zip";write_zip(packet,members)
            with packet.open("rb")as stream:added=self.add_source(stream,request["label"],packet.name)
            successor=self.save_referral_edition({"label":request["label"],"actor":request["actor"],"note":request["note"],
                "sourceId":added["id"],"configurationId":configuration,"predecessorId":before["id"],
                "taskIds":[derived["recordMap"][i]for i in before["taskIds"]],
                "referencePolicy":before["referencePolicy"],"baseUrl":before["baseUrl"],"decisionIds":[]})
            for binding in bindings:
                retained=self.source_row(added["id"],derived["recordMap"][binding["taskId"]])
                current=original_resource(retained)
                before_task=self.source_row(before["sourceId"],binding["taskId"])
                original=original_resource(before_task)
                for field in ["status","intent","businessStatus","output","restriction","for","focus"]:
                    if source.lexical_json(current.get(field))!=source.lexical_json(original.get(field)):
                        raise InputError("The reviewed directory join changed an unrelated original Task field")
            return self._directory_store("referralJoins",{**request,"requestSha256":request_sha,"sourceId":added["id"],
                "sourceEditionId":before["id"],"successorEditionId":successor["id"],"graphId":successor["graphId"],
                "recordMap":derived["recordMap"],"bindings":bindings,"summary":{"bindings":len(bindings),"clinicalFieldEdits":derived["changeCount"],
                    "addedDirectoryResources":len(added_entries),"reusedResources":len(reused),"tasks":len(before["taskIds"])},
                "reportFile":self._retain_file(report_path,"complete-directory-referral-binding"),
                "changesFile":self._retain_file(derived["changesPath"],"original-referral-change-record"),
                "nativePacket":self._retain_file(packet,"complete-directory-referral-native-source")})

    def directory_referral_join(self,ident):
        record=self.directory_record("referralJoins",ident)
        return source.json_value(safe_read(self._file_path(record["reportFile"]),schema.MAX_RECORD),lexical=True)
