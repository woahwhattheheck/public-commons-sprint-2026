#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Operate and retain the complete original LandSage parcel-evidence receiving course."""
from __future__ import annotations

import argparse
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import uuid
import zipfile

OPERATION = "LANDSAGE-PARCEL-EVIDENCE-OPERATOR-103D-20261013"
SCHEMA = "commons.landsage-evidence-receiving/v1"
PARCEL_SHA = "3c7b30af07053862a87ea4b1a1639364e8f983576b02a2febe7339b2b94adcbf"
METADATA_SHA = "c1cdce8b8834fbb83041553f6f7c67dcd0d5620a3f73141cf5384f3a91fbdf07"
PARCEL_ID = "530533210083000005"
SOURCE_LAYER_URL = "https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_2025/FeatureServer/0"
SOURCE_QUERY_URL = "https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_2025/FeatureServer/0/query?where=1%3D1&geometry=-86.55%2C39.15%2C-86.50%2C39.19&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=objectid%2Cstate_parcel_id%2Cparcel_id%2Cnguid%2Cprop_add%2Cprop_city%2Cprop_state%2Ccounty_id%2Ccounty_fips%2Csource_featureid%2Csource_originator%2Cloaddate&returnGeometry=true&outSR=4326&orderByFields=objectid%20ASC&resultRecordCount=1&f=json"
NAMESPACE = uuid.UUID("3bd9f166-0868-5d38-a1cf-173a57b6bf70")
CURRENT_CHILD = None


def check(condition, message):
    if not condition:
        raise ValueError(message)


def measured(body):
    return {"bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}


def canonical(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def read(path, limit=268435456):
    path = Path(path).expanduser().absolute()
    check(path.is_file() and not path.is_symlink(), "Select an ordinary retained input: " + str(path))
    with path.open("rb") as stream:
        before = os.fstat(stream.fileno())
        body = stream.read(limit + 1)
        after = os.fstat(stream.fileno())
    named = path.stat()
    fields = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
    check(fields(before) == fields(after) == fields(named) and len(body) == before.st_size,
          "The selected original input changed during reading: " + str(path))
    check(len(body) <= limit, "The complete selected input exceeds the receiving bound.")
    return body


def json_file(path):
    return json.loads(read(path).decode("utf-8"),
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))


def stop(signum, frame):
    raise InterruptedError("Receiving was interrupted; retain this operation and resume the same directory.")


def run_worker(command, output, timeout):
    """One foreground original worker; its inherited process group is owned here."""
    global CURRENT_CHILD
    check(CURRENT_CHILD is None, "Only one original worker may run at a time.")
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    started = time.monotonic()
    with output.open("ab", buffering=0) as stream:
        child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=stream,
                                 stderr=subprocess.STDOUT, start_new_session=True)
        CURRENT_CHILD = child
        try:
            while child.poll() is None:
                remaining = timeout - (time.monotonic() - started)
                if remaining <= 0:
                    raise TimeoutError("The original worker is retained for explicit same-request continuation.")
                try:
                    child.wait(timeout=min(1.0, remaining))
                except subprocess.TimeoutExpired:
                    continue
        except BaseException:
            if child.poll() is None:
                # This process group was created for this exact original worker.
                # Its SIGTERM handler records INTERRUPTED and releases its original flock.
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
            raise
        finally:
            CURRENT_CHILD = None
    return child.returncode


class Course:
    def __init__(self, args, inputs):
        self.args, self.inputs = args, inputs
        self.root = Path(args.directory).expanduser().absolute()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.app = Path(args.application_root).expanduser().resolve(strict=True)
        check((self.app / "analyst" / "worker.py").is_file() and
              (self.app / "starforge_stac" / "parcel_evidence.py").is_file(),
              "Select the complete maintained QGIS application.")
        sys.path[:0] = [str(self.app), str(self.app)]
        from starforge_stac import model, parcel_evidence, parcel_evidence_operator
        from starforge_stac.analyst_state import AnalystJournal
        from analyst.actions import normalize_payload, NATIVE_ACTIONS, native_runtime
        self.model, self.domain, self.operator = model, parcel_evidence, parcel_evidence_operator
        self.Journal, self.normalize, self.native_actions = AnalystJournal, normalize_payload, NATIVE_ACTIONS
        self.reviewer = inputs["reviewer"]
        check(isinstance(self.reviewer, str) and self.reviewer.strip(), "Retain the actual receiving reviewer.")
        self.runtime = native_runtime(json_file(inputs["nativeRuntimeFile"])) if inputs.get("nativeRuntimeFile") else {}
        self.workspace_path = Path(inputs.get("workspace", self.root / "workspace")).expanduser().absolute()
        existed = (self.workspace_path / "workspace.sqlite").exists()
        marker = self.root / "course-inputs.json"
        if existed and not marker.exists():
            check(inputs.get("existingWorkspaceId"), "Name the original existing workspace ID before joining it.")
        self.keep("course-inputs.json", canonical(inputs))
        self.workspace = model.QgisWorkspace(self.workspace_path, create=not existed,
                                             title="Bloomington original parcel evidence receiving")
        if inputs.get("existingWorkspaceId"):
            check(self.workspace.read()["id"] == inputs["existingWorkspaceId"],
                  "The selected original workspace identity changed.")
        self.keep("workspace-binding.json", canonical({"operationId":OPERATION,
                  "workspaceId":self.workspace.read()["id"],"directory":str(self.workspace_path)}))
        self.journal = AnalystJournal(self.workspace)
        self.records, self.sources, self.source_definitions = {}, {}, {}
        self.input_receipts = []
        self.domain_results = []
        self.native = copy.deepcopy(inputs.get("native", {}))
        self.keep("receiver-source.py", read(Path(__file__)))

    def keep(self, name, body):
        return self.model.retain_bytes(self.root, name, body)

    def step(self, name, action, payload):
        request_id = "landsage-" + str(uuid.uuid5(NAMESPACE, OPERATION + "/" + name))
        filename = self.root / "requests" / (name + ".json")
        payload = self.normalize(action, payload, self.workspace)
        if filename.exists():
            request = json_file(filename)
            check(request["requestId"] == request_id and request["action"] == action and
                  request["payload"] == payload and request["actor"] == self.reviewer,
                  "The retained original step changed: " + name)
        else:
            request = {"requestId":request_id, "action":action, "payload":payload,
                       "revision":self.workspace.read()["revision"], "actor":self.reviewer}
            self.keep("requests/" + name + ".json", canonical(request))
        runtime = self.runtime if action in self.native_actions else {}
        if action in self.native_actions:
            check(runtime, "This selected native phase needs its actual installed QGIS runtime.")
        record = self.journal.create(request_id=request_id, action=action, payload=payload,
                                    revision=request["revision"], actor=request["actor"], native_runtime=runtime)
        if record["status"] != "COMPLETED":
            check(record["input"]["workspaceDirectory"] == str(self.workspace.root),
                  "Preserve the unfinished original request host instead of relaunching on another host.")
            command = runtime.get("native_command") if action in self.native_actions else [sys.executable]
            check(command, "Select the original installed native executable.")
            code = run_worker([*command, "-B", str(self.app / "analyst" / "worker.py"),
                               "--workspace", str(self.workspace.root), "--request-id", request_id,
                               "--instance-id", "landsage-course-" + name],
                              self.root / "logs" / (name + ".log"), self.args.operation_timeout)
            record = self.journal.get(request_id)
            if record["status"] != "COMPLETED":
                self.keep("failures/" + name + "-" + str(len(record["attempts"])) + ".json", canonical(record))
                raise RuntimeError("Original step " + name + " retained " + record["status"] +
                                   " (worker exit " + str(code) + "): " + json.dumps(record.get("error")))
        self.keep("results/" + name + ".json", canonical(record))
        self.records[name] = record
        if action == "evidence.command" and payload["action"] not in ("source.inspect", "source.compare"):
            self.domain_results.append((request, record))
        print(json.dumps({"phase":name,"requestId":request_id,"status":record["status"],
                          "revision":self.workspace.read()["revision"]}), flush=True)
        return record["result"]

    def evidence(self, name, action, payload):
        return self.step(name, "evidence.command", {"action":action,"payload":payload})

    def input(self, name, descriptor, expected=None):
        body = read(descriptor["path"], limit=128*1024*1024)
        actual = measured(body)
        check(actual == {k:descriptor[k] for k in ("bytes","sha256")},
              "The selected input differs from its frozen descriptor: " + name)
        if expected:
            check(actual == expected, "The retained original Bloomington source changed: " + name)
        suffix = Path(descriptor["path"]).suffix or ".bin"
        retained = self.keep("inputs/" + name + suffix, body)
        self.input_receipts.append({"name":name,"originalPath":str(Path(descriptor["path"]).absolute()),
                                    **retained,"sourceUri":descriptor.get("sourceUri")})
        return self.root / retained["path"], body

    def source(self, name, path, definition):
        info = measured(read(path, limit=128*1024*1024))
        inspected = self.evidence(name+"-inspect", "source.inspect", {"file":str(path)})
        check({k:inspected[k] for k in ("bytes","sha256")} == info,
              "The original source inspection returned different file bytes.")
        result = self.evidence(name+"-save", "source.save",
                              {"file":str(path),**info,"definition":definition})
        self.sources[name] = result["source"]
        self.source_definitions[name] = definition
        return result["source"]

    def ref(self, name, locator, **extra):
        return {"sourceId":self.sources[name]["id"],"locator":locator,**extra}

    def prepare_sources(self):
        parcel_path, parcel_body = self.input("parcel", self.inputs["parcel"], {"bytes":2489,"sha256":PARCEL_SHA})
        metadata_path, metadata_body = self.input("parcel-metadata", self.inputs["metadata"],
                                                  {"bytes":16132,"sha256":METADATA_SHA})
        contract_path, contract_body = self.input("flood-contract", self.inputs["floodContract"])
        self.contract = json.loads(contract_body)
        check(self.contract["schema"] == "commons.public-flood-source-contract.v1",
              "Use the original complete acquired FEMA/DNR source contract.")
        parcel = json.loads(parcel_body)
        check(len(parcel["features"]) == 1 and parcel["features"][0]["attributes"]["state_parcel_id"] == PARCEL_ID and
              parcel["exceededTransferLimit"] is True, "Preserve the original selected parcel and partial-query flag.")
        self.parcel = parcel
        self.captures = {r["key"]:r for r in self.contract["captures"]}
        check(len(self.captures) == len(self.contract["captures"]) and
              set(self.captures) == {"fema_hazard_metadata","dnr_metadata","fema_panel_metadata",
                                    "dnr_selected_parcel_query","fema_selected_parcel_query","fema_selected_panel_query"},
              "Retain the original complete six-capture contract.")
        at = self.contract["checkedAt"]
        def definition(title, series, role, issuer, uri, **extra):
            return {"title":title,"seriesKey":series,"edition":"Retained publisher response " + at,
                    "role":role,"issuer":issuer,"jurisdiction":"Monroe County, Indiana; site jurisdiction requires review",
                    "sourceUri":uri,"retrievedAt":at,"mediaType":"application/json",
                    "publishedDate":None,"effectiveDate":None,
                    "documentScope":"Complete retained source response; not a complete publisher inventory.",
                    "coverageNotes":"Preserve original flags, nulls, dates, identifiers and the actual query selection.",
                    **extra}
        self.source("parcel", parcel_path, definition(
            "IGIO original Bloomington parcel response", "igio-parcel-2025-bloomington-selected", "PARCEL",
            "Indiana Geographic Information Office; original Monroe County attributes",
            self.inputs["parcel"].get("sourceUri") or SOURCE_QUERY_URL,
            coordinateReference="EPSG:4326; original spatialReference wkid/latestWkid 4326",
            coverageNotes="One original parcel. exceededTransferLimit=true; no complete county or city inventory claim.",
            queryDescription="Original selected publisher response; one retained feature, OBJECTID 17636."))
        self.source("parcel-metadata", metadata_path, definition(
            "IGIO original parcel layer metadata", "igio-parcel-2025-layer-metadata", "OTHER",
            "Indiana Geographic Information Office", SOURCE_LAYER_URL+"?f=json"))
        self.source("flood-contract", contract_path, definition(
            "Original acquisition contract and publisher response receipts", "landsage-flood-acquisition-contract",
            "OTHER", "C94 original public-source acquisition",
            "urn:commons:landsage:original-flood-source-contract",
            notes="Original acquisition packaging is retained unchanged. Publisher facts cite its exact embedded original responses."))
        self.provenance = []
        for key, capture in self.captures.items():
            body = capture["content"].encode("utf-8")
            identity = measured(body)
            check(identity["bytes"] == capture["bytes"], "Embedded original capture length changed: " + key)
            file = self.keep("inputs/captures/" + key + ".json", body)
            self.provenance.append({"key":key,"sourceUri":capture["url"],"fileUploadId":capture.get("file_upload_id"),
                                    "declared":{"bytes":capture["bytes"],"sha256":capture["sha256"]},
                                    "observed":identity,
                                    "declaredHashMatches":identity["sha256"] == capture["sha256"]})
            dnr = key.startswith("dnr_")
            role = "DNR_BEST_AVAILABLE" if dnr else "EFFECTIVE_FEMA"
            issuer = "Indiana Department of Natural Resources" if dnr else "Federal Emergency Management Agency"
            crs = "EPSG:26916, NAD83 / UTM zone 16N, metres" if dnr else "EPSG:4269, NAD83 geographic degrees"
            notes = "Original attributes-only selected-polygon query; no geometry is returned." if "selected" in key else "Original layer metadata."
            if identity["sha256"] != capture["sha256"]:
                notes += " The packaging's declared digest differs from the preserved UTF-8 capture; both identities are recorded in the original input-provenance.json."
            self.source(key, self.root/file["path"], definition(
                key.replace("_"," ").capitalize(), "landsage-"+key, role, issuer, capture["url"],
                coordinateReference=crs, notes=notes,
                queryDescription=capture["url"] if "selected" in key else "",
                effectiveDate="2010-12-17" if key=="fema_selected_panel_query" else None))
        self.keep("input-provenance.json", canonical({"operationId":OPERATION,"inputs":self.input_receipts,
                  "captureIdentities":self.provenance,"meaning":"Observed digests bind the preserved exact bytes. Declared publisher/acquisition values remain distinct."}))
        if self.inputs.get("ordinance"):
            path, body = self.input("ordinance", self.inputs["ordinance"])
            check(body.startswith(b"%PDF-"), "The original ordinance input must retain its actual PDF bytes.")
            self.source("ordinance", path, self.inputs["ordinance"]["definition"])

    def subject(self, name, kind, label, field):
        source = self.sources[name]
        rows = self.domain.source_rows(self.workspace, source["id"], 0, 25)
        check(rows["items"], "The actual selected source has no retained feature.")
        selected = rows["items"][0]
        properties = selected["properties"]
        result = {"id":"landsage-"+name, "label":label, "kind":kind,
                  "jurisdiction":"Monroe County, Indiana; municipality applicability remains unconfirmed",
                  "identity":str(properties[field]),
                  "sourceReferences":[self.ref(name,"features[0].attributes."+field)],
                  "feature":{"sourceId":source["id"],"index":0,
                             "featureSha256":selected["featureSha256"],"businessField":field}}
        binding = self.native.get("subjects",{}).get(result["id"])
        if binding:
            result["mapObservation"] = copy.deepcopy(binding)
        return result

    def finding(self, title, classification, statement, references, subject_ids, **extra):
        return {"title":title,"classification":classification,"status":"REVIEWED" if classification=="SOURCE_FACT" else "OPEN",
                "statement":statement,
                "applicability":"Retained selected publisher response for the source parcel; proposed work and jurisdiction remain to be established.",
                "assumptions":"This software receiving case preserves source observations. Flood-zone attribution is not an elevation, permit or flood-risk determination.",
                "subjectIds":subject_ids,"sourceReferences":references,"reviewer":self.reviewer,
                "reviewedAt":self.contract["checkedAt"],"nextAction":"Retain original source and resolve the named outstanding review questions.",
                "responsibleRole":"Named parcel due-diligence reviewer", **extra}

    def prepare_case(self):
        subjects = [
            self.subject("parcel","PARCEL","Original Bloomington parcel","state_parcel_id"),
            self.subject("fema_selected_parcel_query","AREA","Selected effective FEMA hazard record","FLD_AR_ID"),
            self.subject("dnr_selected_parcel_query","AREA","Selected Indiana DNR best-available record","fld_ar_id")]
        case_def = {"title":"Bloomington original parcel evidence — software receiving case",
          "jurisdiction":"Monroe County, Indiana; postal Bloomington is not municipal boundary proof",
          "purpose":"Operate a complete original-source research and named-review case with editable receiving.",
          "proposedUse":"No structure footprint, proposed improvement or site-specific use has been supplied.",
          "asOf":self.contract["checkedAt"][:10],
          "scope":"One original parcel and the retained attributes-only selected-polygon FEMA/DNR responses. This is not a county inventory or a permit conclusion.",
          "assumptions":"Original raw responses and separate source roles remain unchanged. Case edits and the later same-byte source edition are explicitly software receiving operations.",
          "sourceReferences":[self.ref(name,"Complete retained source and original response metadata") for name in self.sources],
          "subjects":subjects,
          "professionalQuestions":["Confirm the legally applicable municipal/county jurisdiction and current complete ordinance.",
             "Obtain actual proposed-use and structure/improvement geometry before site-specific review.",
             "Reconcile effective FEMA, applicable LOMC/preliminary material, DNR best-available and local requirements through the responsible reviewer.",
             "Establish any needed elevation/vertical datum and professional survey; a horizontal CRS does not provide these."]}
        self.case_initial = self.evidence("case-initial","case.save",{"definition":case_def})["case"]
        parcel_id, fema_id, dnr_id = [s["id"] for s in subjects]
        fema = json.loads(self.captures["fema_selected_parcel_query"]["content"])["features"][0]["attributes"]
        dnr = json.loads(self.captures["dnr_selected_parcel_query"]["content"])["features"][0]["attributes"]
        panel = json.loads(self.captures["fema_selected_panel_query"]["content"])["features"][0]["attributes"]
        check(fema["FLD_ZONE"]=="X" and dnr["fld_zone"]=="X" and panel["FIRM_PAN"]=="18105C0142D",
              "The retained example differs; author a source-specific case rather than reuse these findings.")
        definitions = [
          self.finding("Effective FEMA source observation","SOURCE_FACT",
            "The retained FEMA query returns FLD_ZONE X, ZONE_SUBTY "+str(fema.get("ZONE_SUBTY"))+
            ", SFHA_TF "+str(fema.get("SFHA_TF"))+", FLD_AR_ID "+str(fema["FLD_AR_ID"])+
            " and SOURCE_CIT "+str(fema["SOURCE_CIT"])+". These are the selected source's original attributes.",
            [self.ref("fema_selected_parcel_query","features[0].attributes; original polygon query"),
             self.ref("fema_selected_panel_query","features[0].attributes.FIRM_PAN / EFF_DATE / PRE_DATE")],[parcel_id,fema_id]),
          self.finding("DNR source is a separate authority and identifier","SOURCE_FACT",
            "The DNR best-available response records fld_ar_id "+str(dnr["fld_ar_id"])+
            ", source_cit "+str(dnr["source_cit"])+", source_dnr "+str(dnr.get("source_dnr"))+
            ". Its matching zone label does not collapse it into the separate FEMA record.",
            [self.ref("dnr_selected_parcel_query","features[0].attributes"),
             self.ref("fema_selected_parcel_query","features[0].attributes.FLD_AR_ID / SOURCE_CIT")],[parcel_id,dnr_id]),
          self.finding("Parcel response coverage","SOURCE_FACT",
            "The original IGIO response retains one selected feature and exceededTransferLimit=true. Local source paging reaches the end of this file only.",
            [self.ref("parcel","features[0]; exceededTransferLimit")],[parcel_id]),
          self.finding("Jurisdiction, complete ordinance and proposed work","PROFESSIONAL_QUESTION",
            "Which jurisdiction and complete current provisions apply to the actual proposed work, including source conflicts and any required professional review?",
            [self.ref("parcel","features[0].attributes.prop_city; postal city is not jurisdiction proof"),
             self.ref("fema_selected_parcel_query","Original selected source context")],[parcel_id],
            responsibleRole="Applicable local floodplain/land-use official and named professional reviewer")]
        if "ordinance" in self.sources:
            definitions[-1]["sourceReferences"].append(self.ref(
                "ordinance","Original retained chapter excerpt; confirm complete current applicable text",
                sourcePageIndex0=0,printedPage="110",section="Chapter 20.04 excerpt"))
        self.initial_findings=[]
        for i, definition in enumerate(definitions):
            result=self.evidence("finding-"+str(i+1),"finding.save",
                {"caseId":self.case_initial["caseId"],"caseVersionId":self.case_initial["id"],"definition":definition})
            self.initial_findings.append(result["finding"])
        revised=copy.deepcopy(case_def)
        revised["assumptions"] += " The same original source now has an explicit software receiving review checkpoint; no factual source or regulation changed."
        self.case=self.evidence("case-review-checkpoint","case.save",
            {"caseId":self.case_initial["caseId"],"previousId":self.case_initial["id"],"definition":revised})["case"]
        pending_path=self.root/"case-before-review.json"
        if pending_path.exists():
            pending=json_file(pending_path)
            check(pending["case"]["id"]==self.case["id"] and
                  all(r["state"]=="REVIEW_REQUIRED" for r in pending["findingReview"]),
                  "The retained original review checkpoint changed.")
        else:
            pending=self.domain.case_snapshot(self.workspace.read(),self.case["caseId"])
            check(all(r["state"]=="REVIEW_REQUIRED" for r in pending["findingReview"]),
                  "The changed case basis must remain visible until the original findings are reviewed.")
            self.keep("case-before-review.json",canonical(pending))
        self.reviewed_findings=[]
        for i, previous in enumerate(self.initial_findings):
            definition=copy.deepcopy(definitions[i])
            definition["correctionReason"]="Reviewed the explicit software case checkpoint against the identical original sources; factual meaning is unchanged."
            result=self.evidence("finding-"+str(i+1)+"-review","finding.save",
                {"caseId":self.case["caseId"],"caseVersionId":self.case["id"],"findingId":previous["findingId"],
                 "previousId":previous["id"],"definition":definition})
            self.reviewed_findings.append(result["finding"])

    def succession(self):
        left=self.sources["fema_selected_parcel_query"]
        definition=copy.deepcopy(self.source_definitions["fema_selected_parcel_query"])
        definition.update(previousId=left["id"],edition="Software receiving edition — identical original publisher bytes",
            title="Effective FEMA source — same-byte software receiving edition",
            notes=definition.get("notes","")+" Explicit receiving/provenance edition; this records no new FEMA publication, regulatory change or currentness claim.")
        path=self.root/"inputs"/"captures"/"fema_selected_parcel_query.json"
        right=self.source("fema-software-edition",path,definition)
        comparison=self.evidence("source-comparison","source.compare",
            {"caseId":self.case["caseId"],"leftSourceId":left["id"],"rightSourceId":right["id"]})
        check(comparison["sameOriginalBytes"] is True and len(comparison["affectedFindings"])>=2,
              "The complete source comparison must include direct and subject-linked affected findings.")
        self.keep("complete-source-comparison.json",canonical(comparison))
        current={row["id"]:row for row in self.domain.data(self.workspace.read())["findings"] if row["caseId"]==self.case["caseId"]}
        decisions=[]
        for index, affected in enumerate(comparison["affectedFindings"]):
            decision={"findingVersionId":affected["id"],"decision":"KEEP_EARLIER",
                      "reason":"Reviewed both complete original editions. Keep the earlier source observation; publisher bytes and scientific meaning are identical."}
            if index==0:
                previous=current[affected["id"]]
                keys=("title","classification","status","statement","applicability","assumptions","subjectIds",
                      "sourceReferences","reviewer","reviewedAt","nextAction","responsibleRole","dueDate","answer","answerReferences")
                replacement={key:copy.deepcopy(previous[key]) for key in keys}
                replacement["sourceReferences"]=self.domain.raw_refs(replacement["sourceReferences"])
                replacement["answerReferences"]=self.domain.raw_refs(replacement["answerReferences"])
                replacement["sourceReferences"].append({"sourceId":right["id"],"locator":"Identical original response; explicit software receiving provenance edition"})
                replacement["correctionReason"]="Adopted the explicit software receiving source edition after reviewing identical original bytes. No regulatory or scientific change is asserted."
                decision.update(decision="ADOPT_LATER",reason=replacement["correctionReason"],replacement=replacement)
            decisions.append(decision)
        self.succession_result=self.evidence("complete-source-review","succession.save",
            {"caseId":self.case["caseId"],"leftSourceId":left["id"],"rightSourceId":right["id"],
             "comparisonSha256":comparison["comparisonSha256"],"decisions":decisions,
             "note":"Every affected current finding has an explicit named decision. This is a same-byte software receiving example."})

    def native_observations(self):
        self.native_results=[]
        for i, selected in enumerate(self.native.get("spatial",[])):
            check(set(selected)=={"leftSubjectId","rightSubjectId","measurementCrs","purpose"},
                  "Select the complete actual native geometry observation input.")
            self.native_results.append(self.step("native-spatial-"+str(i+1),"evidence.spatial",
                {"caseId":self.case["caseId"],"caseVersionId":self.case["id"],**selected}))
        map_ids=self.native.get("mapRequestIds",[])
        check(isinstance(map_ids,list), "Retain the exact original completed map request selection.")
        for request_id in map_ids:
            original=self.journal.get(request_id)
            check(original["status"]=="COMPLETED" and original["input"]["action"]=="map.render",
                  "Select an actual completed native map render from this same original workspace.")
        return map_ids

    def report_and_receive(self, map_ids):
        interpretation=("This report retains the original selected parcel, separate effective FEMA and Indiana DNR observations, "
            "named findings and complete source-review decisions. Postal city, zone X and source geometry do not establish site-specific "
            "jurisdiction, vertical elevation, improvement applicability or permit requirements. The later source edition retains identical "
            "publisher bytes and is explicitly a software receiving exercise. Original acquisition digest discrepancies remain visible in "
            "the retained contract and input provenance. Actual native observations and maps are included only when supplied from their "
            "completed original requests.")
        result=self.evidence("freeze-complete-report","report.build",
            {"caseId":self.case["caseId"],"caseVersionId":self.case["id"],
             "title":"Bloomington original parcel findings and receiving record",
             "interpretation":interpretation,"mapRequestIds":map_ids})
        self.report=result["report"]
        report_path=self.workspace.root/self.report["archive"]["path"]
        self.model.file_digest(report_path,expected=self.report["archive"])
        with zipfile.ZipFile(report_path) as archive:
            manifest=json.loads(archive.read("manifest.json"))
            expected={r["path"]:r for r in manifest["files"]}
            check(set(archive.namelist())==set(expected)|{"manifest.json"} and len(archive.namelist())==len(expected)+1,
                  "The complete report must retain exactly its manifest and declared files.")
            for name, record in expected.items():
                check(measured(archive.read(name))=={k:record[k] for k in ("bytes","sha256")},
                      "A complete report member differs: "+name)
            check(json.loads(archive.read("report.json"))["interpretation"]==interpretation,
                  "The full interpretation must survive report generation.")
            self.keep("rendered-report/OPEN.html",archive.read("OPEN.html"))
            for name in archive.namelist():
                self.keep("report/"+name,archive.read(name))
        exported=self.step("whole-project-export","project.export",
                           {"directory":str(self.root/"deliveries")})
        with self.model.opened_package_archive(exported["path"],expected_sha256=exported["sha256"]) as (archive, identity, unchanged):
            manifest, manifest_body, records=self.model.read_package_manifest(archive)
            for name, descriptor in records.items():
                check(measured(archive.read(name))=={k:descriptor[k] for k in ("bytes","sha256")},
                      "An original editable handover member differs: "+name)
            frozen=json.loads(archive.read("workspace-snapshot.json"))
            unchanged()
        self.keep("exported-workspace-snapshot.json",canonical(frozen))
        cold=self.step("independent-project-receive","project.receive",
            {"file":exported["path"],"expectedSha256":exported["sha256"],
             "destination":str(self.root/"received-workspace")})
        received=self.model.QgisWorkspace(cold["directory"])
        check(received.snapshot()==frozen,"The independent received workspace must equal the complete original exported snapshot.")
        self.domain.validate_evidence_files(received.root,received.snapshot())
        before=received.snapshot()
        for request, record in self.domain_results:
            payload=request["payload"]
            common={"revision":request["revision"],"request_id":request["requestId"],"actor":request["actor"]}
            replay=self.operator.execute(received,payload["action"],payload["payload"],common)
            check(replay==record["result"],"The original saved mutation replay changed its complete result.")
        check(received.snapshot()==before,"Replaying original complete evidence operations changed received state or history.")
        cold_replay=self.model.receive_package(exported["path"],cold["directory"],expected_sha256=exported["sha256"])
        check(cold_replay["replayed"] is True and cold_replay["receipt"]==cold["receipt"],
              "The same complete archive must reopen with its original receiving receipt.")
        self.model.QgisWorkspace(received.root).project_files()
        self.keep("cold-receiving-result.json",canonical({"receipt":cold["receipt"],
                  "snapshotSha256":self.model.value_sha(frozen),"sameArchiveReplay":True,
                  "originalMutationReplays":len(self.domain_results),"workspaceId":frozen["state"]["id"],
                  "revision":frozen["state"]["revision"]}))
        return exported,cold,frozen

    def run(self):
        completed=self.root/"backend-receiving-result.json"
        if completed.exists():
            saved=json_file(completed)
            check(saved["schema"]==SCHEMA and saved["operationId"]==OPERATION and
                  saved["workspaceId"]==self.workspace.read()["id"],
                  "The completed original course identity changed.")
            self.model.file_digest(saved["editableProject"]["path"],expected=saved["editableProject"])
            self.model.file_digest(saved["reportArchive"]["path"],expected=saved["reportArchive"])
            # A receiving browser may now have deliberately edited its own workspace.
            # Preserve that later work rather than rerun the completed original course.
            print(json.dumps(saved,ensure_ascii=False,allow_nan=False),flush=True)
            return saved
        self.prepare_sources()
        self.prepare_case()
        self.succession()
        map_ids=self.native_observations()
        exported,cold,frozen=self.report_and_receive(map_ids)
        output={"schema":SCHEMA,"operationId":OPERATION,"state":"BACKEND_RECEIVING_COMPLETE",
            "workspaceId":self.workspace.read()["id"],"workspace":str(self.workspace.root),
            "receivedWorkspace":cold["directory"],"caseId":self.case["caseId"],"caseVersionId":self.case["id"],
            "reportId":self.report["id"],"reportArchive":{"path":str(self.workspace.root/self.report["archive"]["path"]),
                **{k:self.report["archive"][k] for k in ("bytes","sha256")}},
            "editableProject":exported,"coldReceipt":cold["receipt"],"sourceEditions":len(self.sources),
            "completeSteps":[{"name":name,"requestId":r["requestId"],"inputSha256":r["inputSha256"],"status":r["status"]}
                             for name,r in self.records.items()],
            "nativeSpatialObservations":len(self.native_results),"nativeMapRequestIds":map_ids,
            "captureDigestDiscrepancies":[r for r in self.provenance if not r["declaredHashMatches"]],
            "browserReceiving":{"state":"REQUIRED","inputFile":str(self.root/"browser-inputs.json")},
            "meaning":"Actual original backend, original worker, report and independent editable receiving. Rendered-product inspection is a separate retained continuation."}
        self.keep("browser-inputs.json",canonical({"schema":"commons.landsage-browser-inputs/v1",
            "operationId":OPERATION,"workspace":str(self.workspace.root),"receivedWorkspace":cold["directory"],
            "workspaceId":frozen["state"]["id"],"caseId":self.case["caseId"],"caseVersionId":self.case["id"],
            "reportId":self.report["id"],"reportDirectory":str(self.root/"report"),
            "outputDirectory":str(self.root/"browser"),"expectedProject":exported,
            "sourceIds":{name:row["id"] for name,row in self.sources.items()},
            "nativeMapRequestIds":map_ids}))
        self.keep("backend-receiving-result.json",canonical(output))
        print(json.dumps(output,ensure_ascii=False,allow_nan=False),flush=True)
        return output


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application-root",required=True)
    parser.add_argument("--directory",required=True)
    group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--inputs",help="Complete byte-pinned original input JSON, schema commons.landsage-evidence-inputs/v1.")
    group.add_argument("--public-example",action="store_true",help="Use the complete retained Bloomington example beside this application.")
    parser.add_argument("--reviewer",help="Actual receiving operator name, required with --public-example.")
    parser.add_argument("--operation-timeout",type=float,default=900)
    args=parser.parse_args(argv)
    check(0<args.operation_timeout<=7200,"Select the intended complete-operation timeout up to two hours.")
    if args.public_example:
        check(isinstance(args.reviewer,str) and args.reviewer.strip(),"Name the actual reviewer for the complete public example.")
        base=Path(args.application_root).expanduser().absolute()/"evidence-example"/"bloomington"
        inputs={"schema":"commons.landsage-evidence-inputs/v1","operationId":OPERATION,
                "reviewer":args.reviewer.strip(),
                "parcel":{"path":str(base/"parcel.json"),"bytes":2489,"sha256":PARCEL_SHA,"sourceUri":SOURCE_QUERY_URL},
                "metadata":{"path":str(base/"parcel-metadata.json"),"bytes":16132,"sha256":METADATA_SHA},
                "floodContract":{"path":str(base/"flood-source-contract.json"),"bytes":117356,
                    "sha256":"555730fb7285ec5740d88b674583ff3be4dbbdc8c1b57f8b7964e44b3204d6f2"}}
    else:
        check(args.reviewer is None,"The selected original input JSON already retains its reviewer; do not override it.")
        inputs=json_file(args.inputs)
    check(inputs.get("schema")=="commons.landsage-evidence-inputs/v1" and inputs.get("operationId")==OPERATION,
          "Continue the original LandSage receiving operation and complete source inputs.")
    root=Path(args.directory).expanduser().absolute()
    root.mkdir(parents=True,exist_ok=True,mode=0o700)
    fd=os.open(root/"receiving.lock",os.O_CREAT|os.O_RDWR|getattr(os,"O_NOFOLLOW",0),0o600)
    old={}
    try:
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        for signum in (signal.SIGINT,signal.SIGTERM):
            old[signum]=signal.signal(signum,stop)
        Course(args,inputs).run()
    finally:
        for signum,handler in old.items():
            signal.signal(signum,handler)
        os.close(fd)
    return 0


if __name__=="__main__":
    raise SystemExit(main())
