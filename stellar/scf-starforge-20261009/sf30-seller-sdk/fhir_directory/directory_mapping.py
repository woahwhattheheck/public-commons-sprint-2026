"""MIT. Reviewed directory mappings and original-source native FHIR conversion."""
from __future__ import annotations
from pathlib import Path
from directory_runtime import InputError,source,write_zip,safe_read,original_workspace
from directory_domain import DirectoryView,convert,public_ref
import directory_schema as schema

class DirectoryMapping:
    def save_directory_mapping(self,raw):
        value=schema.mapping(raw)
        with self.mutex:
            view=DirectoryView(self,value["editionId"])
            if value["predecessorId"]:
                old=self.directory_record("mappings",value["predecessorId"])
                if old["mode"]!=value["mode"]:raise InputError("A mapping successor retains its original mode")
            for ref in value["selectedRefs"]:view.row(ref)
            for row in value["identityOverrides"]:view.row(row["ref"])
            for rule in value["rules"]:
                for ref in rule["includeRefs"]:view.row(ref)
            return self._directory_store("mappings",value)

    def preview_directory_mapping(self,raw):
        value=schema.input_value("mapping_preview",raw)
        with self.mutex,self.scratch() as temp:
            mapping=self.directory_record("mappings",value["mappingId"])
            result=convert(DirectoryView(self,mapping["editionId"]),mapping)
            directory=Path(temp);report=directory/"preview.json";bundle=directory/"directory.fhir.json";fields=directory/"field-map.json"
            original_workspace.private_write(report,source.lexical_json(result).encode()+b"\n")
            original_workspace.private_write(bundle,source.lexical_json(result["bundle"]).encode()+b"\n")
            original_workspace.private_write(fields,source.lexical_json(result["fields"]).encode()+b"\n")
            if report.stat().st_size>schema.MAX_RECORD:raise InputError("The complete mapping report exceeds64MiB; select a smaller explicit conversion")
            return self._directory_store("mappingPreviews",{"mappingId":mapping["id"],"editionId":mapping["editionId"],"summary":result["summary"],
                "reportFile":self._retain_file(report,"complete-directory-mapping-preview"),
                "bundleFile":self._retain_file(bundle,"derived-directory-fhir-collection"),
                "fieldMapFile":self._retain_file(fields,"complete-original-field-map")})

    def directory_preview(self,ident):
        record=self.directory_record("mappingPreviews",ident)
        return source.json_value(safe_read(self._file_path(record["reportFile"]),schema.MAX_RECORD),lexical=True)

    def directory_preview_page(self,ident,group,offset=0,limit=50):
        if group not in {"resources","fields","findings"}:raise InputError("Select original mapping resources, fields or findings")
        return self._directory_rows_page(self.directory_preview(ident)[group],offset,limit)

    def apply_directory_mapping(self,raw):
        value=schema.input_value("mapping_apply",raw)
        with self.mutex,self.scratch() as temp:
            preview=self.directory_record("mappingPreviews",value["previewId"])
            mapping=self.directory_record("mappings",preview["mappingId"])
            report=self.directory_preview(preview["id"])
            if preview["summary"]["errors"]:raise InputError("Resolve the exact identity/reference/field errors in this mapping preview before generating its native source")
            view=DirectoryView(self,mapping["editionId"]);directory=Path(temp)
            document=self._file_path(preview["bundleFile"])
            documents=[{"name":"documents/directory.fhir.json","bytes":document.stat().st_size,"sha256":original_workspace.file_digest(document),"role":"reviewed-directory-fhir-collection","sourceUrl":None}]
            members={documents[0]["name"]:document};protocol=[]
            def retain(name,path,role):
                descriptor={"name":name,"bytes":path.stat().st_size,"sha256":original_workspace.file_digest(path),"role":role}
                members[name]=path;protocol.append(descriptor)
            retain("review/mapping-preview.json",self._file_path(preview["reportFile"]),"complete-reviewed-mapping")
            retain("review/field-map.json",self._file_path(preview["fieldMapFile"]),"original-row-to-fhir-field-map")
            used_sources=sorted(set(view.edition["sourceIds"]))
            for ident in used_sources:
                original=self.directory_source(ident)
                path,descriptor=self.directory_source_file(ident)
                retain("originals/"+ident+"/original.bin",path,"unchanged-complete-directory-input")
                metadata=directory/(ident+".json");original_workspace.private_write(metadata,source.jbytes(original))
                retain("originals/"+ident+"/source.json",metadata,"original-directory-source-record")
            context={"schema":"stellar-forge.human-services-directory-conversion.v1","mappingId":mapping["id"],"previewId":preview["id"],"editionId":mapping["editionId"],
                "actor":value["actor"],"note":value["note"],"identitySystem":mapping["identitySystem"],"referenceBase":mapping["referenceBase"],
                "classification":"operator_transformation","sourceRefs":report["sourceRefs"],"sourceScope":view.edition.get("scope","unknown")}
            manifest={"schema":source.SOURCE_SCHEMA,"origin":"operator_transformation","documents":documents,"protocol":protocol,"predecessors":[],"context":context}
            members["manifest.json"]=source.jbytes(manifest)
            if sum(v.stat().st_size if isinstance(v,Path) else len(v) for v in members.values())>source.MAX_SOURCE:
                raise InputError("The complete derived FHIR packet and original sources exceed256MiB; select a smaller source edition")
            packet=directory/"directory-native-source.zip";write_zip(packet,members)
            with packet.open("rb") as stream:added=self.add_source(stream,value["label"],"directory-native-source.zip")
            return self._directory_store("sourceConversions",{**value,"mappingId":mapping["id"],"editionId":mapping["editionId"],"sourceId":added["id"],
                "summary":preview["summary"],"resourceMapFile":preview["reportFile"],"bundleFile":preview["bundleFile"],"fieldMapFile":preview["fieldMapFile"],
                "nativePacket":self._retain_file(packet,"complete-directory-native-source"),"sourceScope":view.edition.get("scope","unknown")})

    def directory_conversion(self,ident):
        record=self.directory_record("sourceConversions",ident)
        self.source(record["sourceId"])
        return record

    def directory_conversion_resources(self,ident):
        record=self.directory_conversion(ident)
        return source.json_value(safe_read(self._file_path(record["resourceMapFile"]),schema.MAX_RECORD),lexical=True)["resources"]
