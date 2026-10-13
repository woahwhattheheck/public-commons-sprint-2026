#!/usr/bin/env python3
"""Complete mixed property, register and finance receiving in the original Store.

No new journal, vendor connector, financial posting or customer acceptance is
created here. This composes the maintained CaseReceiving operation and its full
portable deliveries. Run the same complete --input and --out to continue.
"""
from __future__ import annotations
import json
from pathlib import Path

from case_receiving import (Receiving, main, need, json_file, encoded, SOURCE_ROOT,
                            APPLICATION_FILES, ordinary_directory, build_reports)
from migration_store import canonical, identity, identifier, file_hash, regular
from migration_reports import case_pages
from migration_portable import inspect_delivery, receive_delivery
import migration_registers
import property_workspace
import financial_workspace

SCHEMA = "commons.housing-receiving/v1"
MODULE_KINDS = {
    "register": ("register.dataset", "register.plan", "register.rehearsal",
                 "register.review", "register.cutover"),
    "property": tuple(property_workspace.KINDS),
    "finance": tuple(financial_workspace.KINDS),
}
MODULE_ACTIONS = {
    "register": tuple(migration_registers.MUTATIONS),
    "property": tuple(property_workspace.MUTATIONS),
    "finance": tuple(financial_workspace.MUTATIONS),
}
REQUIRED_SOURCE = ("case_receiving.py", "housing_receiving.py", "migration_store.py",
                   "migration_workspace.py", "migration_portable.py",
                   "migration_registers.py", "property_workspace.py",
                   "property_domain.py", "financial_workspace.py", "financial_domain.py")


def unique_pairs(pairs):
    value = {}
    for key, item in pairs:
        need(key not in value, "The complete housing input repeats a JSON member: " + key)
        value[key] = item
    return value


class HousingReceiving(Receiving):
    schema = SCHEMA
    domain = "housing"
    catalog_key = "selected_entities"
    lanes = (("producer", "steps"), ("customer", "customer_steps"),
             ("second_customer", "second_customer_steps"))
    delivery_lanes = ("producer", "customer", "second_customer")
    phases = ("01-original-input", "02-original-mixed-actions", "03-complete-reports",
              "04-producer-delivery", "05-customer-receive", "06-customer-actions",
              "07-older-customer-receiving-replay", "08-customer-delivery",
              "09-second-customer-receive", "10-second-customer-actions",
              "11-older-second-receiving-replay", "12-second-customer-delivery",
              "13-final-receiving", "14-complete-comparisons",
              "15-original-request-replay", "16-cold-reopen")
    meaning = ("Complete original property, register and finance records, independent "
               "recipient edits, three portable archives and final receiving. "
               "Local reconciliation and recorded decisions do not establish tenant "
               "execution, financial posting, completed repair or customer acceptance.")

    def configure_input(self, value):
        # The inherited parser's original numeric handling stays unchanged; this
        # additional pass rejects ambiguous duplicate keys before any mutation.
        json.loads(self.raw.decode("utf-8"), object_pairs_hook=unique_pairs)
        modules = value.get("modules")
        need(isinstance(modules, list) and len(modules) == 3 and
             set(modules) == set(MODULE_KINDS),
             "Explicitly select register, property and finance for this mixed course")
        self.modules = tuple(modules)
        need(isinstance(value.get("title"), str) and value["title"].strip(),
             "Retain the complete original housing handover title")
        self.kinds = tuple(kind for module in self.modules for kind in MODULE_KINDS[module])
        self.allowed = {"source.import", "workspace.update"}
        for module in self.modules:
            self.allowed.update(MODULE_ACTIONS[module])
        need(set(REQUIRED_SOURCE).issubset(APPLICATION_FILES),
             "The current complete application must include the mixed receiver and every selected original module")
        for name in ("actor", "customer_actor", "second_customer_actor"):
            need(isinstance(value.get(name), str) and value[name].strip() and len(value[name]) <= 512,
                 "Retain the actual named operator for each original receiving lane")
        source = value.get("workspace")
        need(isinstance(source, dict) and isinstance(source.get("path"), str) and
             isinstance(source.get("expected_revision"), int) and
             not isinstance(source["expected_revision"], bool) and source["expected_revision"] >= 0,
             "Select the actual original workspace path, identity and current revision")
        identifier(source.get("id"))
        actor_fields = {"producer":"actor", "customer":"customer_actor",
                        "second_customer":"second_customer_actor"}
        known_results, file_keys, selected_ids = set(), set(), set()
        for item in value.get("source_files", []):
            need(isinstance(item, dict), "Select complete source-file descriptors")
            file_keys.add(identifier(item.get("key")))
        for lane, field in self.lanes:
            steps = value.get(field)
            need(isinstance(steps, list) and steps, "Supply the complete original " + field)
            selected_modules = set()
            for step in steps:
                need(isinstance(step, dict), "Select a complete original action")
                need(step.get("actor", value[actor_fields[lane]]) == value[actor_fields[lane]],
                     "Each lane retains its explicitly selected original actor")
                operation = step.get("operation")
                need(operation in self.allowed, "Select only maintained local module/source actions")
                if operation.split(".", 1)[0] in self.modules:
                    selected_modules.add(operation.split(".", 1)[0])
                self.validate_references(step.get("payload"), known_results, file_keys)
                known_results.add(lane + ":" + identifier(step.get("key")))
                selected_ids.add(identifier(step.get("operation_id")))
            need(selected_modules, "A recipient edit must use an actual selected domain operation")
            if lane == "producer":
                need(selected_modules == set(self.modules),
                     "The complete original course must retain actual work in all three selected domains")
        self.selected_action_ids = selected_ids
        self.validate_references(value.get("comparisons", []), known_results, file_keys)

    @staticmethod
    def validate_references(value, known, file_keys):
        if isinstance(value, dict):
            if "$result" in value:
                need(set(value) == {"$result", "pointer"} and value["$result"] in known,
                     "A result reference must select an earlier original action in this course")
                need(isinstance(value["pointer"], str) and
                     (value["pointer"] == "" or value["pointer"].startswith("/")),
                     "Retain the original result JSON pointer")
                for part in value["pointer"].split("/")[1:]:
                    i = 0
                    while i < len(part):
                        if part[i] == "~":
                            need(i + 1 < len(part) and part[i + 1] in "01",
                                 "The original result pointer has an invalid escape")
                            i += 1
                        i += 1
                return
            if "$file" in value:
                need(set(value) == {"$file", "field"} and value["$file"] in file_keys and
                     value["field"] in ("sha256", "filename", "bytes"),
                     "A file reference must select its full retained original descriptor")
                return
            for item in value.values():
                HousingReceiving.validate_references(item, known, file_keys)
        elif isinstance(value, list):
            for item in value:
                HousingReceiving.validate_references(item, known, file_keys)

    def validate_comparison_input(self, value):
        need("comparison" not in value,
             "Use the explicit optional comparisons list for a mixed receiving course")
        comparisons = value.get("comparisons", [])
        need(isinstance(comparisons, list), "Select the complete optional comparison list")
        seen = set()
        for item in comparisons:
            need(isinstance(item, dict) and set(item) == {"key", "before_id", "after_id"},
                 "A comparison selects its key and two original register rehearsals")
            key = identifier(item["key"])
            need(key not in seen, "Keep complete comparison keys distinct")
            seen.add(key)

    def actor_for_lane(self, lane):
        return self.input[{"producer":"actor", "customer":"customer_actor",
                           "second_customer":"second_customer_actor"}[lane]]

    def records(self, workspace, kind):
        module, bare = kind.split(".", 1)
        need(kind in self.kinds, "Select an original retained module kind")
        yield from case_pages(workspace, module + ".list",
                              {"kind":bare if module == "register" else kind})

    def get_record(self, workspace, kind, entity_id):
        module = kind.split(".", 1)[0]
        need(kind in self.kinds, "Select an original retained module kind")
        if module == "register":
            return workspace.dispatch(kind + ".get", {"id":entity_id})
        return workspace.dispatch(module + ".get", {"kind":kind, "id":entity_id})

    def export_kind(self, kind):
        need(kind in self.kinds, "Select an original retained module export")
        return kind

    def verify_source(self):
        selected = []
        for name in APPLICATION_FILES:
            path = SOURCE_ROOT / name
            regular(path)
            selected.append({"path":name, **file_hash(path)})
        need(selected == self.selection["application"],
             "The complete admitted application source changed; preserve the original edition")

    def verify_domains(self, workspace):
        # Run each full verifier once per snapshot, never once per catalogue row.
        # Interrupted own actions resume before this complete semantic verification.
        revision = workspace.project["revision"]
        results = {}
        for module in self.modules:
            if module in ("property", "finance"):
                results[module] = workspace.dispatch(module + ".verify", {})
        # Register has no invented verify verb. Complete original record readers,
        # exports, operation bindings and archive identity verify its actual ABI.
        for kind in MODULE_KINDS["register"]:
            for record in self.records(workspace, kind):
                need(self.get_record(workspace, kind, record["id"]) == record,
                     "A retained original register record changed")
                original = workspace.dispatch("operation.get", {"id":record["operation_id"]})
                need(original["found"] and original["operation"]["status"] == "SUCCEEDED" and
                     original["operation"]["operation"] == kind + ".create" and
                     original["operation"]["result"]["result"] == record,
                     "A retained register edition differs from its original completed operation")
        need(workspace.project["revision"] == revision,
             "The selected module verification changed the original workspace")
        return results

    def catalog(self, workspace, label):
        self.verify_source()
        checks = self.verify_domains(workspace)
        catalog = super().catalog(workspace, label)
        self.put(label + "/revision-" + str(catalog["revision"]) + "/domain-verification.json",
                 encoded(checks))
        return catalog

    def action(self, workspace, step, lane):
        self.verify_source()
        return super().action(workspace, step, lane)

    def delivery(self, workspace, lane):
        self.verify_source()
        return super().delivery(workspace, lane)

    def continue_original(self, workspace, folder, operation_id, actor, reason):
        """Continue only the same original local action under the held Store lease.

        A resume-control cannot itself be resumed by MigrationWorkspace. Preserve
        every prior control and observation; an explicit rerun may admit one new
        control targeting the same original action. No provider operation exists
        in this selected local course. The Store's exclusive process lock is held.
        """
        need(isinstance(reason, str) and reason.strip(), "Retain the explicit original continuation reason")
        selected = workspace.dispatch("operation.get", {"id":operation_id})
        need(selected["found"] and selected["operation"]["operation"] != "operation.resume",
             "Continue the actual admitted original action, never a resume control")
        _, frozen = json_file(self.out / folder / "request.json")
        if "request" in frozen:
            operation, request = frozen["operation"], frozen["request"]
        else:
            operation, request = "delivery.prepare", frozen
        semantic = identity({"operation":operation, "payload":
                             {k:v for k,v in request.items() if k not in ("operation_id","expected_revision")}})
        need(request["operation_id"] == operation_id and
             selected["operation"]["operation"] == operation and
             selected["operation"]["request_sha256"] == semantic,
             "The selected interrupted target differs from its frozen original request")
        if selected["operation"]["status"] == "SUCCEEDED":
            return True
        need(selected["operation"]["status"] in ("RUNNING", "INTERRUPTED"),
             "Preserve an unrecognized original operation disposition")
        generation = 0
        while True:
            stem = folder + "/continuations/" + str(generation).zfill(8)
            path = self.out / stem / "request.json"
            if not path.exists():
                break
            _, prior = json_file(path)
            need(prior["target_operation_id"] == operation_id and prior["actor"] == actor and
                 prior["reason"] == reason, "The retained original continuation intent changed")
            observation = workspace.dispatch("operation.get", {"id":prior["operation_id"]})
            target = workspace.dispatch("operation.get", {"id":operation_id})
            self.put(stem + "/observation-" + identity({"control":observation,"target":target}) + ".json",
                     encoded({"control":observation,"target":target}))
            self.remember(path)
            if target["found"] and target["operation"]["status"] == "SUCCEEDED":
                return True
            if observation["found"]:
                op = observation["operation"]
                expected = identity({"operation":"operation.resume", "payload":
                                     {k:v for k,v in prior.items() if k not in ("operation_id","expected_revision")}})
                need(op["operation"] == "operation.resume" and op["request_sha256"] == expected,
                     "A retained continuation ID belongs to another request")
                need(op["status"] in ("RUNNING", "INTERRUPTED"),
                     "A completed continuation disagrees with its original target")
            elif prior["expected_revision"] == workspace.project["revision"]:
                # This exact retained control was not yet admitted. Reuse it.
                break
            generation += 1
            need(generation < 100000, "The original continuation history exceeds its explicit bound")
        target = workspace.dispatch("operation.get", {"id":operation_id})
        need(target["found"], "The admitted original target disappeared")
        if target["operation"]["status"] == "SUCCEEDED":
            return True
        control_id = "housing-resume-" + identity(
            {"input":self.input_sha,"target":operation_id,"generation":generation})
        reserved = {self.operation_id + "-" + lane + "-delivery" for lane in self.delivery_lanes}
        need(control_id not in self.selected_action_ids | reserved,
             "A selected business action conflicts with its original continuation identity")
        control = {"operation_id":control_id,"target_operation_id":operation_id,
                   "actor":actor,"reason":reason,"expected_revision":workspace.project["revision"]}
        if path.exists():
            _, control = json_file(path)
        self.put(stem + "/request.json", encoded(control))
        try:
            workspace.dispatch("operation.resume", control)
        finally:
            observed = {"control":workspace.dispatch("operation.get", {"id":control["operation_id"]}),
                        "target":workspace.dispatch("operation.get", {"id":operation_id})}
            self.put(stem + "/observation-" + identity(observed) + ".json", encoded(observed))
        need(observed["target"]["found"] and observed["target"]["operation"]["status"] == "SUCCEEDED",
             "Retain the interrupted original action and its complete continuation observations")
        return True

    def verify_catalog(self, workspace, catalog):
        need(workspace.project["id"] == catalog["workspace_id"] and
             workspace.project["revision"] >= catalog["revision"],
             "An original workspace lost its retained identity or revision")
        need(set(catalog[self.catalog_key]) == set(self.kinds),
             "The complete selected module catalogue changed")
        for kind, records in catalog[self.catalog_key].items():
            for record in records:
                need(self.get_record(workspace, kind, record["id"]) == record,
                     "A later workspace changed an original immutable edition")

    def compare_registers(self, workspace):
        comparisons = []
        revision = workspace.project["revision"]
        for selected in self.input.get("comparisons", []):
            item = self.resolve(selected)
            before, after = item["before_id"], item["after_id"]
            identifier(before); identifier(after)
            need(before != after, "Compare two distinct actual register rehearsals")
            rows, offset, total, seen = [], 0, None, set()
            while True:
                page = workspace.dispatch("register.rehearsal.compare",
                    {"before_id":before,"after_id":after,"offset":offset,"limit":250})
                count = page.get("total")
                need(isinstance(count,int) and not isinstance(count,bool) and count >= 0 and
                     page.get("offset") == offset and page.get("before_id") == before and
                     page.get("after_id") == after and isinstance(page.get("rows"),list),
                     "Retain the exact original register comparison page")
                if total is None: total = count
                need(count == total and len(page["rows"]) <= 250 and offset + len(page["rows"]) <= total,
                     "The selected complete comparison population changed")
                for row in page["rows"]:
                    key = canonical([row["kind"],row.get("register"),row["key"]])
                    need(key not in seen, "An original comparison identity repeated")
                    seen.add(key); rows.append(row)
                offset += len(page["rows"])
                need(workspace.project["revision"] == revision, "Comparison source revision changed")
                if offset == total: break
                need(page["rows"], "The original comparison ended before its complete population")
            result = {"key":item["key"],"before_id":before,"after_id":after,
                      "workspace_id":workspace.project["id"],"revision":revision,"rows":rows,"total":total}
            self.put("comparisons/" + item["key"] + "/revision-" + str(revision) + ".json", encoded(result))
            comparisons.append(result)
        return comparisons

    def lane_actions(self, workspace, lane, baseline=None):
        if baseline is not None:
            self.verify_catalog(workspace, baseline)
        field = dict(self.lanes)[lane]
        results = [self.action(workspace, step, lane) for step in self.input[field]]
        after = self.catalog(workspace, lane + "-after")
        if baseline is not None:
            self.compare_entities(baseline, after)
        else:
            need(all(any(after[self.catalog_key][kind] for kind in MODULE_KINDS[module])
                     for module in self.modules),
                 "The complete original course has no retained record for a selected domain")
        return {"actions":results,"catalog":after}

    def reports(self, workspace):
        self.verify_source()
        revision = workspace.project["revision"]
        directory = self.out / "reports" / ("revision-" + str(revision))
        ordinary_directory(directory, create=True)
        names = build_reports(workspace, directory, source_revision=revision,
                             title=self.input["title"], note=self.input["authorization"])
        return {"revision":revision,"files":[self.remember(directory / name) for name in names]}

    def replay_older(self, workspace, delivery, destination, label, lanes):
        before = workspace.project
        self.close(workspace)
        receipt = self.receive(self.out / delivery["archive"]["path"], destination, label)
        current = self.open(destination / "workspace")
        try:
            need(current.project == before, "An earlier complete delivery overwrote later recipient work")
            for lane in lanes:
                self.verify_action_history(current, lane)
        finally:
            self.close(current)
        return {"before":before,"after":before,"receipt":receipt}

    def check_deliveries(self, deliveries):
        need(isinstance(deliveries,list) and len(deliveries) == len(self.delivery_lanes),
             "Retain all three original complete deliveries")
        for lane, delivery in zip(self.delivery_lanes, deliveries):
            self.verify(delivery["archive"])
            inspected = inspect_delivery(self.out / delivery["archive"]["path"])
            _, request = json_file(self.out / "deliveries" / lane / "request.json")
            operation_id = self.operation_id + "-" + lane + "-delivery"
            semantic = identity({"operation":"delivery.prepare", "payload":
                                 {k:v for k,v in request.items() if k not in ("operation_id","expected_revision")}})
            record, manifest = delivery["record"], inspected["manifest"]
            need(request["operation_id"] == operation_id and record["operation_id"] == operation_id and
                 manifest["operation_id"] == operation_id and manifest["request_sha256"] == semantic and
                 record["id"] == manifest["id"] and
                 record["archive_sha256"] == delivery["archive"]["sha256"] and
                 record["archive_bytes"] == delivery["archive"]["bytes"] and
                 inspected["manifest_sha256"] == delivery["manifest_sha256"] and
                 manifest["workspace_id"] == delivery["catalog"]["workspace_id"] and
                 manifest["revision"] == delivery["catalog"]["revision"],
                 "An original full delivery no longer matches its frozen request and selected snapshot")

    def cold_reopen(self, locations, catalogs, lane_sets, deliveries):
        self.close_all()
        for label, delivery in zip(("customer","second_customer","final"), deliveries):
            destination = locations[label].parent
            # A completed recipient may have newer valid SQLite records; its
            # original application and object members must still match exactly.
            # Missing READY never authorizes extraction over completed work.
            ordinary_directory(destination)
            regular(destination / "READY.json")
            regular(destination / ".migration-receiving.json")
            receipt = receive_delivery(self.out / delivery["archive"]["path"], destination)
            need(receipt["reopened"] is True and receipt["complete"] is True and
                 receipt["archive_sha256"] == delivery["archive"]["sha256"] and
                 receipt["manifest_sha256"] == delivery["manifest_sha256"],
                 "A completed receiving changed its original immutable members")
        result = {}
        for label, path in locations.items():
            workspace = self.open(path)
            try:
                self.verify_catalog(workspace, catalogs[label])
                if label in self.delivery_lanes:
                    delivery = deliveries[self.delivery_lanes.index(label)]
                    record = workspace.dispatch("delivery.get", {"id":delivery["record"]["id"]})
                    original = workspace.dispatch("operation.get", {"id":delivery["record"]["operation_id"]})
                    need(record == delivery["record"] and original["found"] and
                         original["operation"]["operation"] == "delivery.prepare" and
                         original["operation"]["status"] == "SUCCEEDED" and
                         original["operation"]["result"]["result"] == record,
                         "An original delivery owner lost its complete operation or archive receipt")
                for lane in lane_sets[label]:
                    self.verify_action_history(workspace, lane)
                verification = self.verify_domains(workspace)
                result[label] = {"path":str(Path(path).resolve()),"project":workspace.project,
                                 "verification":verification}
            finally:
                self.close(workspace)
        return result

    def completed(self, producer, saved):
        need(saved.get("schema") == self.schema and saved.get("state") == "COMPLETE" and
             saved.get("operation_id") == self.operation_id and saved.get("input_sha256") == self.input_sha and
             saved.get("selection") == self.selection and saved.get("modules") == list(self.modules) and
             saved.get("lifetimes") == {"workspaces":"CLOSED","children":"NONE_CREATED"} and
             saved.get("actions") == self.action_receipts and
             [x.get("phase") for x in saved.get("phases",[])] == list(self.phases),
             "The completed original mixed operation/source selection differs")
        for phase in saved["phases"]:
            _, held = json_file(self.out / "phases" / (phase["phase"] + ".json"))
            need(held == phase and phase["schema"] == self.schema + "/phase" and
                 phase["input_sha256"] == self.input_sha,
                 "A retained complete phase changed")
        for receipt in saved["artifacts"]:
            self.verify(receipt)
        phases = {item["phase"]:item["result"] for item in saved["phases"]}
        deliveries = [phases[self.phases[index]] for index in (3,7,11)]
        catalogs = {"producer":deliveries[0]["catalog"],"customer":deliveries[1]["catalog"],
                    "second_customer":deliveries[2]["catalog"],"final":phases[self.phases[12]]["catalog"]}
        need(saved["deliveries"] == deliveries and saved["catalogs"] == catalogs,
             "The completed delivery/catalogue selection differs from its original phases")
        self.check_deliveries(saved["deliveries"])
        locations = self.locations()
        need(saved["locations"] == {key:str(Path(path).resolve()) for key,path in locations.items()},
             "The completed original recipient locations changed")
        self.close(producer)
        self.cold_reopen(locations, saved["catalogs"], self.lane_sets(), saved["deliveries"])
        # Never extract over a missing/damaged completed recipient. A successful
        # replay returns the original first completion, preserving later edits.
        return saved

    def locations(self):
        return {"producer":Path(self.input["workspace"]["path"]),
                "customer":self.out / "customer" / "workspace",
                "second_customer":self.out / "second-customer" / "workspace",
                "final":self.out / "final" / "workspace"}

    @staticmethod
    def lane_sets():
        return {"producer":("producer",),"customer":("producer","customer"),
                "second_customer":("producer","customer","second_customer"),
                "final":("producer","customer","second_customer")}

    def run(self):
        self.verify_source()
        source = self.input["workspace"]
        locations, lane_sets = self.locations(), self.lane_sets()
        producer = self.open(locations["producer"])
        need(producer.project["id"] == source["id"], "The selected original housing workspace identity differs")
        self.adopt_actions()
        complete = self.out / "COMPLETE.json"
        if complete.exists():
            return self.completed(producer, json_file(complete)[1])
        first = self.out / "phases" / (self.phases[0] + ".json")
        if not first.exists() and not self.action_receipts:
            # The prepared builder may already have executed the identical
            # original producer IDs. All must be found with the exact semantics
            # by action(); a different source head is never silently accepted.
            all_found = all(producer.dispatch("operation.get", {"id":step["operation_id"]})["found"]
                            for step in self.input["steps"])
            need(producer.project["revision"] == source["expected_revision"] or all_found,
                 "Select the current original revision or all actual pre-admitted producer operations")
        self.stage(self.phases[0], lambda:{"project":producer.project,"files":self.stage_files(producer)})
        if not self.files:
            for item in self.input.get("source_files", []):
                self.files[item["key"]] = {key:item[key] for key in ("sha256","bytes","filename")}
        original = self.stage(self.phases[1], lambda:self.lane_actions(producer,"producer"))
        self.adopt_actions()
        self.verify_action_history(producer,"producer")
        self.stage(self.phases[2], lambda:self.reports(producer))
        delivery1 = self.stage(self.phases[3], lambda:self.delivery(producer,"producer"))
        self.stage(self.phases[4], lambda:self.receive(self.out / delivery1["archive"]["path"],
                                                     self.out / "customer","customer-receive"))
        customer = self.open(locations["customer"])
        def customer_actions():
            before = self.frozen_catalog(customer,"customer-baseline.json","customer-before")
            self.compare_entities(delivery1["catalog"],before,exact=True)
            return {"before":before,**self.lane_actions(customer,"customer",before)}
        customer_result = self.stage(self.phases[5],customer_actions)
        self.adopt_actions()
        for lane in lane_sets["customer"]: self.verify_action_history(customer,lane)
        if not (self.out / "phases" / (self.phases[6]+".json")).exists():
            self.stage(self.phases[6],lambda:self.replay_older(customer,delivery1,self.out/"customer",
                "older-customer-receiving-replay",lane_sets["customer"]))
            customer = self.open(locations["customer"])
        else:
            self.stage(self.phases[6],lambda:None)
        delivery2 = self.stage(self.phases[7],lambda:self.delivery(customer,"customer"))
        self.stage(self.phases[8],lambda:self.receive(self.out / delivery2["archive"]["path"],
                                                    self.out/"second-customer","second-customer-receive"))
        second = self.open(locations["second_customer"])
        def second_actions():
            before = self.frozen_catalog(second,"second-customer-baseline.json","second-customer-before")
            self.compare_entities(delivery2["catalog"],before,exact=True)
            return {"before":before,**self.lane_actions(second,"second_customer",before)}
        second_result = self.stage(self.phases[9],second_actions)
        self.adopt_actions()
        for lane in lane_sets["second_customer"]: self.verify_action_history(second,lane)
        if not (self.out/"phases"/(self.phases[10]+".json")).exists():
            self.stage(self.phases[10],lambda:self.replay_older(second,delivery2,self.out/"second-customer",
                "older-second-receiving-replay",lane_sets["second_customer"]))
            second = self.open(locations["second_customer"])
        else:
            self.stage(self.phases[10],lambda:None)
        delivery3 = self.stage(self.phases[11],lambda:self.delivery(second,"second_customer"))
        def final_receive():
            receipt = self.receive(self.out/delivery3["archive"]["path"],self.out/"final","final-receive")
            final = self.open(locations["final"])
            try:
                catalog = self.catalog(final,"final-received")
                self.compare_entities(delivery3["catalog"],catalog,exact=True)
                for lane in lane_sets["final"]: self.verify_action_history(final,lane)
                return {"receipt":receipt,"catalog":catalog}
            finally:
                self.close(final)
        final_result = self.stage(self.phases[12],final_receive)
        self.stage(self.phases[13],lambda:self.compare_registers(second))
        def replay_actions():
            results = []
            for lane,workspace in (("producer",producer),("customer",customer),("second_customer",second)):
                before = workspace.project
                for accepted in self.action_receipts:
                    if accepted["lane"] != lane: continue
                    _, original = json_file(self.out/"actions"/lane/accepted["key"]/"request.json")
                    result = workspace.dispatch(accepted["operation"],original["request"])
                    need(result["reused"] is True and result["result"] == accepted["original_result"]["result"],
                         "The original request replay differs from its retained result")
                    results.append({"lane":lane,"operation_id":accepted["operation_id"],
                                    "original_revision":result["revision"]})
                need(workspace.project == before,"Original request replay changed later customer work")
                self.verify_action_history(workspace,lane)
            return results
        self.stage(self.phases[14],replay_actions)
        catalogs = {"producer":delivery1["catalog"],"customer":delivery2["catalog"],
                    "second_customer":delivery3["catalog"],"final":final_result["catalog"]}
        deliveries = [delivery1,delivery2,delivery3]
        already_cold = (self.out / "phases" / (self.phases[15]+".json")).exists()
        self.stage(self.phases[15],lambda:self.cold_reopen(locations,catalogs,lane_sets,deliveries))
        if already_cold:
            self.cold_reopen(locations,catalogs,lane_sets,deliveries)
        self.close_all()
        self.check_deliveries(deliveries)
        need([x["phase"] for x in self.stage_receipts] == list(self.phases),
             "Retain every ordered original mixed receiving phase")
        result = {"schema":self.schema,"state":"COMPLETE","operation_id":self.operation_id,
                  "input_sha256":self.input_sha,"selection":self.selection,"modules":list(self.modules),
                  "phases":self.stage_receipts,"actions":self.action_receipts,
                  "artifacts":list(self.artifacts.values()),"catalogs":catalogs,"deliveries":deliveries,
                  "locations":{key:str(Path(path).resolve()) for key,path in locations.items()},
                  "lifetimes":{"workspaces":"CLOSED","children":"NONE_CREATED"},
                  "rendered_product":{"status":"NOT_VERIFIED","client_ready":False},
                  "meaning":self.meaning}
        self.put("COMPLETE.json",encoded(result))
        return result


if __name__ == "__main__":
    raise SystemExit(main(HousingReceiving))
