#!/usr/bin/env python3
"""Operate one complete named-staff Grant Operations case and receive its installation."""
from __future__ import annotations
import argparse, base64, concurrent.futures, hashlib, hmac, http.cookiejar, json, os
from pathlib import Path
import subprocess, sys, threading, time, traceback
from urllib.error import HTTPError
from urllib.request import Request, build_opener, HTTPCookieProcessor
from uuid import uuid4

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from server import create_server, atomic_private as write_private
from STAFF_INSTALLATION_RECEIVING import receive_workspace
from staff_installation import export_installation, private_json as encode_private_json
from staff_access import secret_hash

def private_json(path, value):
    """Update the same retained output through the original private atomic writer."""
    write_private(path, encode_private_json(value))

def require(value, message):
    if not value:
        raise RuntimeError(message)

class Journey:
    def __init__(self, server, output):
        self.server, self.output, self.events = server, output, []
        self.lock = threading.Lock()
        self.deliveries = output / "private-http-deliveries"
        self.deliveries.mkdir(mode=0o700, exist_ok=True)

    def delivery_path(self, path, request_id):
        key = hashlib.sha256((path + "\0" + request_id).encode()).hexdigest()
        return self.deliveries / (key + ".json")

    def event(self, value):
        with self.lock:
            self.events.append(value)
            with (self.output / "operating-events.jsonl").open("a") as stream:
                stream.write(json.dumps(value, ensure_ascii=False, sort_keys=True) + "\n")
                stream.flush()
            print(json.dumps(value, ensure_ascii=False), flush=True)

    def audience(self, name, code=None, owner=False):
        return Audience(self, name, code, owner)

class Audience:
    def __init__(self, journey, name, code=None, owner=False):
        self.journey, self.name = journey, name
        self.opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.csrf, self.principal = None, None
        if owner:
            result = self.call("/api/staff/owner-session", {}, headers={
                "Authorization": "Bearer " + journey.server.token})
        else:
            result = self.call("/api/staff/login", {"staffId": name, "accessCode": code})
        self.csrf, self.principal = result["csrfToken"], result["principal"]

    def call(self, path, body=None, expect=200, headers=None, csrf=True, raw=False):
        supplied = dict(headers or {})
        payload = None
        if body is not None:
            supplied.update({"Content-Type": "application/json", "Origin": self.journey.server.origin})
            if self.csrf and csrf:
                supplied["X-CSRF-Token"] = self.csrf
            payload = json.dumps(body, ensure_ascii=False, allow_nan=False).encode()
        delivery_path, delivery = None, None
        if isinstance(body, dict) and isinstance(body.get("requestId"), str):
            delivery_path = self.journey.delivery_path(path, body["requestId"])
            request = {"audience": self.name, "path": path, "body": body}
            if delivery_path.exists():
                delivery = json.loads(delivery_path.read_bytes())
                require(delivery["request"] == request, "The retained HTTP request changed before replay.")
            else:
                delivery = {"request": request, "responses": [], "dispatchedAt": time.time()}
                private_json(delivery_path, delivery)
        try:
            response = self.opener.open(Request(self.journey.server.origin + path, data=payload, headers=supplied), timeout=25)
        except HTTPError as error:
            response = error
        with response:
            data, status = response.read(), response.status
            value = json.loads(data) if response.headers.get("Content-Type", "").startswith("application/json") else data
        if delivery_path is not None:
            delivery["responses"].append({"at": time.time(), "status": status, "value": value})
            private_json(delivery_path, delivery)
        event = {"at": time.time(), "audience": self.name, "method": "POST" if body is not None else "GET",
                 "path": path, "status": status}
        if isinstance(body, dict):
            event["action"] = body.get("action")
        if isinstance(value, dict):
            event.update({key: value[key] for key in ("id", "version", "recordId", "code") if key in value})
        self.journey.event(event)
        diagnostic = value.get("error", {"responseKeys": sorted(value)}) if isinstance(value, dict) else {"responseBytes": len(data)}
        require(status == expect, self.name + " " + path + " expected " + str(expect) + " but received "
                + str(status) + ": " + repr(diagnostic)[:1000])
        return value

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--browser", type=Path, default=HERE / "staff_workflow_browser.mjs")
    parser.add_argument("--node", default="node")
    parser.add_argument("--skip-browser", action="store_true")
    parser.add_argument("--resume-browser", action="store_true",
                        help="Continue the same completed HTTP case using its private context.")
    parser.add_argument("--resume-initial", type=Path,
                        help="Continue a saved initial case, clone and lead from an explicit original-state binding.")
    args = parser.parse_args()
    require(not (args.resume_browser and args.resume_initial), "Select the original HTTP or browser continuation.")
    output = args.output.resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    private_context = output / "private-browser-context.json"
    server = create_server(output / "workspace")
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    journey = Journey(server, output)
    owner = journey.audience("owner", owner=True)
    context = {}
    try:
        def create_member(name, display, role, cases, bindings=None, admin=False):
            body = {"id": name, "displayName": display, "role": role, "caseIds": cases,
                    "contributorIds": bindings or {}, "administrator": admin, "requestId": str(uuid4())}
            result = owner.call("/api/staff/members/create", body)
            context.setdefault("profiles", {})[name] = {"code": result["accessCode"], "member": result["member"]}
            private_json(private_context, context)
            replay = owner.call("/api/staff/members/create", body)
            require(replay["replayed"] and "accessCode" not in replay, "A repeated enrollment reissued its private code.")
            return journey.audience(name, result["accessCode"])

        if args.resume_browser:
            context = json.loads(private_context.read_bytes())
            require(context.get("httpComplete"), "The original HTTP case has not completed.")
            lead = journey.audience("delivery-lead", context["profiles"]["delivery-lead"]["code"])
            finance = journey.audience("finance-operator", context["profiles"]["finance-operator"]["code"])
            reviewer = journey.audience("case-reviewer", context["profiles"]["case-reviewer"]["code"])
            contributor = journey.audience("case-contributor", context["profiles"]["case-contributor"]["code"])
            case_id, other_case, plan_id = context["caseId"], context["otherCaseId"], context["planId"]
        elif args.resume_initial:
            binding = json.loads(args.resume_initial.read_bytes())
            require(binding.get("schema") == "stellar-forge.sf47-staff-initial-receiving.v1",
                    "Use the original initial-case receiving binding.")
            case_id, plan_id = binding["caseId"], binding["planId"]
            other_plan_id = binding["otherPlanId"]
            context = json.loads(private_context.read_bytes()) if private_context.exists() else {}
            require(not context.get("httpComplete"), "Continue the completed HTTP case with --resume-browser.")
            with server.workspace.mutex:
                selected = server.workspace.db.execute(
                    "SELECT id,plan_id,version,name,mode FROM ops_programs WHERE id=?", (case_id,)).fetchone()
                profiles = server.staff.members()
                require(selected is not None and selected[1] == plan_id and selected[2] == 1
                        and selected[3] == "Named staff delivery receiving" and selected[4] == "WALKTHROUGH",
                        "The original initial case has advanced; continue its retained request journal.")
                require(len(profiles) == 1 and profiles[0]["id"] == "delivery-lead"
                        and profiles[0]["role"] == "lead" and profiles[0]["caseIds"] == ["*"]
                        and profiles[0]["administrator"] and profiles[0]["state"] == "ACTIVE",
                        "The original roster has advanced; continue its retained request journal.")
                lead_row = server.staff.member("delivery-lead")
            plan = owner.call("/api/plans/" + plan_id)
            other_plan = owner.call("/api/plans/" + other_plan_id)
            require(other_plan["name"] == "Separate staff receiving case",
                    "The selected clone is not the original receiving plan.")
            retained_code = context.get("profiles", {}).get("delivery-lead", {}).get("code")
            rotation_path = "/api/staff/members/rotate"
            if not retained_code and binding.get("leadRotationRequestId"):
                saved_path = journey.delivery_path(rotation_path, binding["leadRotationRequestId"])
                if saved_path.exists():
                    saved = json.loads(saved_path.read_bytes())
                    for response in reversed(saved["responses"]):
                        if response["status"] == 200 and response["value"].get("accessCode"):
                            retained_code = response["value"]["accessCode"]
                            break
            valid_code = isinstance(retained_code, str) and hmac.compare_digest(
                secret_hash(retained_code, "staff-code:delivery-lead"), lead_row["credential_hash"] or "")
            if not valid_code:
                # A delivered code survives in the private response record. If its
                # original response was lost, the owner reissues it through the
                # existing rotation action and retains this new request first.
                binding["leadRotationRequestId"] = str(uuid4())
                private_json(args.resume_initial, binding)
                rotated = owner.call(rotation_path, {"id": "delivery-lead",
                    "expectedRevision": lead_row["revision"], "requestId": binding["leadRotationRequestId"]})
                retained_code = rotated["accessCode"]
                profiles[0] = rotated["member"]
            context.setdefault("profiles", {})["delivery-lead"] = {"code": retained_code, "member": profiles[0]}
            context.update(caseId=case_id, planId=plan_id, otherPlanId=other_plan_id,
                           packageId=plan["scenario"]["future_costs"][0]["id"])
            private_json(private_context, context)
            lead = journey.audience("delivery-lead", retained_code)
            # The first POST may have committed before its response failed. Reuse
            # that case and create only the separate case that is actually absent.
            with server.workspace.mutex:
                matches = server.workspace.db.execute(
                    "SELECT id,version FROM ops_programs WHERE plan_id=? AND name=?",
                    (other_plan_id, "Separately assigned receiving case")).fetchall()
            require(len(matches) <= 1, "The original secondary case is ambiguous.")
            if matches:
                require(matches[0][1] == 1, "The original secondary case has advanced.")
                other_case = matches[0][0]
            else:
                binding.setdefault("secondaryCaseRequestId", str(uuid4()))
                private_json(args.resume_initial, binding)
                other_case = lead.call("/api/operations", {
                    "name": "Separately assigned receiving case", "mode": "WALKTHROUGH",
                    "calendarStart": "2026-10-12", "planId": other_plan_id,
                    "selectedRevision": other_plan["revision"],
                    "expectedContentSha256": other_plan["contentSha256"],
                    "actor": "Editable caller label", "requestId": binding["secondaryCaseRequestId"]})["id"]
            context["otherCaseId"] = other_case
            private_json(private_context, context)
        else:
            require(not private_context.exists(), "Continue the original retained receiving context.")
            lead = create_member("delivery-lead", "Delivery lead", "lead", ["*"], admin=True)
            plan = lead.call("/api/plans")["plans"][0]
            plan = lead.call("/api/plans/" + plan["id"])
            plan_id = plan["id"]
            other_plan = lead.call("/api/plans/" + plan_id + "/clone", {
                "expectedRevision": plan["revision"], "name": "Separate staff receiving case",
                "requestId": str(uuid4())})
            def open_case(selected, name):
                return lead.call("/api/operations", {
                    "name": name, "mode": "WALKTHROUGH", "calendarStart": "2026-10-12",
                    "planId": selected["id"], "selectedRevision": selected["revision"],
                    "expectedContentSha256": selected["contentSha256"],
                    "actor": "Editable caller label", "requestId": str(uuid4())})["id"]
            case_id = open_case(plan, "Named staff delivery receiving")
            other_case = open_case(other_plan, "Separately assigned receiving case")
            context.update(caseId=case_id, otherCaseId=other_case, planId=plan_id,
                           otherPlanId=other_plan["id"], packageId=plan["scenario"]["future_costs"][0]["id"])

        def state():
            return owner.call("/api/operations/" + case_id)

        def command(who, action, data, note, expect=200, version=None, request_id=None, csrf=True):
            current = state()
            body = {"expectedVersion": current["program"]["version"] if version is None else version,
                    "action": action, "data": data, "actor": "Editable caller label",
                    "note": note, "requestId": request_id or str(uuid4())}
            return who.call("/api/operations/" + case_id + "/command", body, expect, csrf=csrf)

        if not args.resume_browser:
            person = command(lead, "contributor.save", {"name": "Case contributor", "kind": "PERSON"},
                             "Enroll the original contributor record")["recordId"]
            teammate = command(lead, "contributor.save", {"name": "Separate contributor", "kind": "PERSON"},
                               "Enroll the second original contributor")["recordId"]
            context.update(personId=person, teammateId=teammate)
            finance = create_member("finance-operator", "Finance operator", "finance", [case_id])
            reviewer = create_member("case-reviewer", "Case reviewer", "reviewer", [case_id])
            contributor = create_member("case-contributor", "Case contributor", "contributor", [case_id], {case_id: person})
            colleague = create_member("other-contributor", "Separate contributor", "contributor", [case_id], {case_id: teammate})
            limited_lead = create_member("limited-lead", "Assigned delivery lead", "lead", [case_id])
            require([p["id"] for p in finance.call("/api/plans")["plans"]] == [plan_id], "The finance plan list escaped its cases.")
            require([c["id"] for c in reviewer.call("/api/operations")["cases"]] == [case_id], "The review case list escaped its assignment.")
            reviewer.call("/api/operations/" + other_case, expect=403)
            limited_lead.call("/api/plans/" + plan_id + "/clone", {
                "expectedRevision": 1, "name": "Outside assignment", "requestId": str(uuid4())}, expect=403)
            contributor.call("/api/plans", expect=403)
            original = b"Named staff operating walkthrough: contributor work and original invoice source.\n"
            source = command(contributor, "source.add", {
                "filename": "contributor-work.txt", "mediaType": "text/plain", "kind": "work",
                "contentBase64": base64.b64encode(original).decode()}, "Retain the original contributor document")["recordId"]
            require(contributor.call("/api/operations/" + case_id + "/sources/" + source) == original,
                    "The contributor source download changed its bytes.")
            restricted = command(finance, "source.add", {
                "filename": "case-finance-reference.txt", "mediaType": "text/plain", "kind": "payment",
                "contentBase64": base64.b64encode(b"Operating walkthrough finance allocation reference.\n").decode()},
                "Retain the finance source")["recordId"]
            contributor.call("/api/operations/" + case_id + "/sources/" + restricted, expect=403)
            work_data = {"contributorId": person, "costId": context["packageId"], "description": "Implement the named staff delivery workflow",
                         "startDate": "2026-10-12", "endDate": "2026-10-12", "hours": "2.5",
                         "fundingBasis": "INTERNAL", "sourceIds": [source], "sourceNote": "Operating walkthrough"}
            work = command(contributor, "work.save", work_data, "Record the contributor's original work")["recordId"]
            other_data = {**work_data, "contributorId": teammate, "hours": "1", "sourceIds": [],
                          "description": "Prepare the separate contributor handover"}
            other_work = command(colleague, "work.save", other_data, "Record the second contributor work")["recordId"]
            command(contributor, "work.save", {**other_data, "id": other_work}, "Try another original contributor record", expect=403)
            command(contributor, "work.save", {**work_data, "id": work, "sourceIds": [restricted]},
                    "Select a finance-only source", expect=403)
            command(contributor, "cash.record", {}, "A contributor has no cash writer", expect=403)
            command(finance, "invoice.save", {}, "A cookie write must keep its session token", expect=403, csrf=False)
            same_version = state()["program"]["version"]
            def competing(args):
                who, row, rid, message = args
                payload = {"expectedVersion": same_version, "action": "work.save", "data": {**row, "id": rid, "description": message},
                           "actor": "Editable caller label", "note": "Two staff save from the same open case",
                           "requestId": str(uuid4())}
                try:
                    value = who.call("/api/operations/" + case_id + "/command", payload)
                    return (True, who, row, rid, message, value)
                except RuntimeError as error:
                    if "received 409" not in str(error):
                        raise
                    return (False, who, row, rid, message, None)
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                results = list(executor.map(competing, [
                    (contributor, work_data, work, "Implement the named staff delivery workflow"),
                    (colleague, other_data, other_work, "Prepare the separate contributor handover")]))
            require(sum(item[0] for item in results) == 1, "Concurrent staff edits did not preserve a single case revision.")
            for saved, who, row, rid, message, _ in results:
                if not saved:
                    command(who, "work.save", {**row, "id": rid, "description": message},
                            "Reopen current case after the other staff save")
            command(contributor, "work.submit", {"id": work}, "Submit the completed contributor work")
            command(contributor, "work.void", {"id": work}, "Submitted work belongs to review", expect=403)
            command(reviewer, "work.accept", {"id": work}, "Accept the original work and attachment")
            command(reviewer, "work.reopen", {"id": work}, "Clarify the contributor handover")
            command(contributor, "work.submit", {"id": work}, "Resubmit the clarified handover")
            command(reviewer, "work.accept", {"id": work}, "Accept the completed clarification")
            invoice = command(contributor, "invoice.save", {"contributorId": person, "number": "STAFF-RECEIVING-001",
                "issuedDate": "2026-10-12", "dueDate": "2026-10-26", "sourceIds": [source],
                "sourceNote": "Operating walkthrough invoice", "lines": [
                    {"id": "implementation", "costId": context["packageId"], "description": "Completed implementation",
                     "amountUsd": "200.00", "workIds": [work]},
                    {"id": "handover", "costId": context["packageId"], "description": "Completed contributor handover",
                     "amountUsd": "50.00", "workIds": [work]}]},
                "Receive the contributor's original two-line invoice")["recordId"]
            command(finance, "invoice.review", {"id": invoice}, "Review the original supplier invoice")
            def pay(amount, reference):
                return command(finance, "cash.record", {"direction": "OUT", "category": "INVOICE",
                    "date": "2026-10-12", "currency": "USD", "amount": amount, "externalRef": reference,
                    "allocations": [{"invoiceId": invoice, "amountUsd": amount}], "sourceIds": [restricted],
                    "sourceNote": "Operating walkthrough cash allocation"},
                    "Record the original invoice allocation")["recordId"]
            first_payment = pay("100.00", "STAFF-RECEIVING-PAYMENT-100")
            balance = contributor.call("/api/staff/workboard")["cases"][0]["invoiceBalances"][0]
            require(balance["paidUsd"] == "100.00" and balance["openUsd"] == "150.00", "Contributor partial payment is wrong.")
            pay("150.00", "STAFF-RECEIVING-PAYMENT-150")
            command(finance, "cash.void", {"id": first_payment}, "Correct the original walkthrough payment identity")
            pay("100.00", "STAFF-RECEIVING-PAYMENT-100-CORRECTED")
            board = contributor.call("/api/staff/workboard")
            require([r["id"] for r in board["cases"][0]["work"]] == [work], "Contributor work desk included another person.")
            balance = board["cases"][0]["invoiceBalances"][0]
            require(balance["paidUsd"] == "250.00" and balance["openUsd"] == "0.00", "The contributor invoice did not settle.")
            member = context["profiles"]["case-contributor"]["member"]
            renamed = owner.call("/api/staff/members/update", {"id": member["id"], "displayName": "Contributor delivery desk",
                "role": "contributor", "caseIds": [case_id], "contributorIds": {case_id: person},
                "administrator": False, "expectedRevision": member["revision"], "requestId": str(uuid4())})
            require(renamed["member"]["actor"] == member["actor"], "A display-name edit changed the original recording identity.")
            context["profiles"]["case-contributor"]["member"] = renamed["member"]
            contributor.call("/api/staff/workboard", expect=401)
            contributor = journey.audience("case-contributor", context["profiles"]["case-contributor"]["code"])
            member = context["profiles"]["finance-operator"]["member"]
            rotated = owner.call("/api/staff/members/rotate", {"id": member["id"], "expectedRevision": member["revision"],
                                 "requestId": str(uuid4())})
            finance.call("/api/operations/" + case_id, expect=401)
            context["profiles"]["finance-operator"] = {"code": rotated["accessCode"], "member": rotated["member"]}
            finance = journey.audience("finance-operator", rotated["accessCode"])
            member = context["profiles"]["other-contributor"]["member"]
            owner.call("/api/staff/members/revoke", {"id": member["id"], "expectedRevision": member["revision"],
                       "requestId": str(uuid4())})
            colleague.call("/api/staff/workboard", expect=401)
            member = context["profiles"]["limited-lead"]["member"]
            owner.call("/api/staff/members/sign-out", {"id": member["id"], "expectedRevision": member["revision"],
                       "requestId": str(uuid4())})
            limited_lead.call("/api/operations/" + case_id, expect=401)
            owner.call("/api/staff/events?after=not-a-cursor", expect=422)
            current = state()
            require(next(r for r in current["records"]["work"] if r["id"] == work)["recordedBy"]
                    == context["profiles"]["case-contributor"]["member"]["actor"], "Original work accepted an editable caller actor.")
            context.update(workId=work, invoiceId=invoice, httpComplete=True)
            private_json(output / "http-case.json", current)
            private_json(private_context, context)

        browser_result = None
        if not args.skip_browser:
            context.update(origin=server.origin, output=str(output))
            private_json(private_context, context)
            result = subprocess.run([args.node, str(args.browser), str(private_context)], cwd=HERE,
                                    capture_output=True, text=True, timeout=240)
            write_private(output / "browser.stdout.log", result.stdout.encode())
            write_private(output / "browser.stderr.log", result.stderr.encode())
            require(result.returncode == 0, "The original browser journey failed: " + result.stderr[-2500:])
            browser_result = json.loads((output / "browser-result.json").read_bytes())
            require(browser_result["finalVersion"] == state()["program"]["version"],
                    "The browser and original operating case have different final versions.")
        else:
            review = command(reviewer, "review", {}, "Review the complete named-staff operating case")
            command(lead, "close", {"reviewId": review["recordId"], "expectedReviewSha256": review["businessSha256"]},
                    "Close the exact reviewed delivery and payment record")
            command(lead, "reopen", {}, "Continue operating the delivered team workspace")
        final_case = state()
        expected_invoice = "375.00" if browser_result else "250.00"
        require(final_case["report"]["cash"]["invoiceLiabilityUsd"] == expected_invoice
                and final_case["report"]["cash"]["openInvoiceUsd"] == "0.00", "Final original invoice balances differ.")
        private_json(output / "operated-case.json", final_case)
        final_board = contributor.call("/api/staff/workboard")
        private_json(output / "contributor-workboard.json", final_board)
        recovery = receive_workspace(server.workspace, output / "independent-recovery", source_directory=HERE)
        summary = {"schema": "stellar-forge.sf47-staff-operating-receiving.v1", "mode": "WALKTHROUGH",
            "caseId": case_id, "version": final_case["program"]["version"],
            "profiles": len(owner.call("/api/staff/members")["members"]),
            "workRecords": len(final_case["records"]["work"]), "invoices": len(final_case["records"]["invoices"]),
            "invoiceTotalUsd": final_case["report"]["cash"]["invoiceLiabilityUsd"],
            "openInvoiceUsd": final_case["report"]["cash"]["openInvoiceUsd"],
            "cashOutUsd": final_case["report"]["cash"]["outUsd"],
            "browser": browser_result, "recovery": recovery,
            "completedAt": time.time()}
        private_json(output / "operating-result.json", summary)
        print(json.dumps({"result": "COMPLETE", "caseId": case_id, "version": summary["version"],
                          "invoiceTotalUsd": summary["invoiceTotalUsd"], "openInvoiceUsd": summary["openInvoiceUsd"]}), flush=True)
    except BaseException:
        trace = traceback.format_exc()
        # Preserve the original IDs and private code deliveries at the actual
        # interruption, including a request whose response was not successful.
        current = locals()
        context["interruptedIds"] = {key: current[key] for key in
            ("case_id", "other_case", "plan_id", "person", "teammate", "source",
             "restricted", "work", "other_work", "invoice", "first_payment")
            if isinstance(current.get(key), str)}
        private_json(private_context, context)
        write_private(output / "interrupted-traceback.txt", trace.encode())
        raise
    finally:
        try:
            raw, manifest = export_installation(server.workspace, source_directory=HERE)
            write_private(output / "operated-installation.zip", raw)
            private_json(output / "operated-installation-manifest.json", manifest)
            print(json.dumps({"checkpoint": "operated-installation.zip", "bytes": len(raw),
                              "sha256": hashlib.sha256(raw).hexdigest()}), flush=True)
        finally:
            server.shutdown()
            worker.join(timeout=10)
            server.server_close()
            server.workspace.close()
            require(not worker.is_alive(), "The original operating server did not close.")

if __name__ == "__main__":
    main()
