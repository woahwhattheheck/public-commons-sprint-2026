"""Eligibility programmes on the original Research workspace and call journal.

The original engine owns protocols, decisions, resolutions, source bindings and
portable history. This client preserves the full selected request before a
write and uses its unchanged request ID for recovery.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import re

from .errors import StateError
from .research_workspace import _json, _value
from .storage import dump, parse, read

SECTIONS = ("overview", "reviews", "occurrences", "queue", "decisions",
            "resolutions", "studies", "impact", "operations")
EXPORT_SECTIONS = ("queue", "decisions", "resolutions", "studies",
                   "impact", "operations", "occurrences")
ACTIONS = ("create-review", "revise-protocol", "create-workset", "decide",
           "resolve", "study-link", "apply-outcomes", "review-impact")
_PREPARED = "stellar-forge.research-eligibility-prepared.v1"
_DOSSIER = re.compile(r"d_[a-f0-9-]{36}")
_LIMIT = 16 * 1024 * 1024


def _need(condition, code):
    if not condition:
        raise StateError(code)


def _snapshot(value):
    return parse(_json(value))


class ResearchEligibility:
    """Borrow an existing ResearchWorkspace; closing it never stops its server."""
    def __init__(self, workspace, dossier_id):
        _need(isinstance(dossier_id, str) and _DOSSIER.fullmatch(dossier_id),
              "ELIGIBILITY_DOSSIER_REQUIRED")
        self.workspace, self.dossier_id = workspace, dossier_id

    def read(self, *, section="overview", review_id=None, work_set_id=None,
             revision=None, offset=0, limit=30, cancel_event=None):
        _need(section in SECTIONS and type(offset) is int and offset >= 0 and
              type(limit) is int and 1 <= limit <= 100 and
              (revision is None or type(revision) is int and revision >= 1) and
              (offset == 0 or revision is not None), "ELIGIBILITY_PAGE_INVALID")
        options = {"section": section, "offset": offset, "limit": limit}
        for key, value in (("revision", revision), ("reviewId", review_id),
                           ("workSetId", work_set_id)):
            if value is not None:
                options[key] = value
        return self.workspace._read("eligibility", {
            "dossierId": self.dossier_id, "options": options}, cancel_event=cancel_event)

    def iter_rows(self, *, section, review_id=None, work_set_id=None, revision=None,
                  limit=100, cancel_event=None):
        """Retain the first observed revision through every subsequent page."""
        offset, total = 0, None
        while True:
            page = self.read(section=section, review_id=review_id, work_set_id=work_set_id,
                             revision=revision, offset=offset, limit=limit,
                             cancel_event=cancel_event)
            selected = page["dossier"]["revision"]
            _need(revision is None or selected == revision, "ELIGIBILITY_PAGE_REVISION_CHANGED")
            _need(total is None or total == page["total"], "ELIGIBILITY_PAGE_TOTAL_CHANGED")
            revision, total = selected, page["total"]
            for item in page["items"]:
                yield deepcopy(item)
            next_offset = page["nextOffset"]
            if next_offset is None:
                return
            _need(type(next_offset) is int and next_offset > offset,
                  "ELIGIBILITY_PAGE_CURSOR_CHANGED")
            offset = next_offset

    def validate(self, request):
        """Normalize using the installed original JavaScript request parser."""
        _need(isinstance(request, dict) and len(_json(request)) <= _LIMIT,
              "ELIGIBILITY_INPUT_TOO_LARGE")
        result = self.workspace._read("eligibility-input", {"request": request})
        _need(isinstance(result, dict) and isinstance(result.get("request"), dict) and
              isinstance(result.get("sha256"), str), "ELIGIBILITY_INPUT_REPLY_INVALID")
        return result

    def prepare(self, action, data, *, request_id, actor, review_id=None,
                expected_revision=None):
        """Prepare the exact action; the caller can inspect/save it before submit.

        A revision is selected now. It is never silently refreshed on submit or
        recovery. Reviewer assignments and any minimum number of decisions come
        from the caller's original protocol.
        """
        _need(action in ACTIONS and isinstance(data, dict), "ELIGIBILITY_ACTION_INVALID")
        if expected_revision is None:
            expected_revision = self.workspace.metadata(self.dossier_id)["revision"]
        body = {"requestId": request_id, "expectedRevision": expected_revision,
                "actor": deepcopy(actor), "action": action, "data": deepcopy(data)}
        if review_id is not None:
            body["reviewId"] = review_id
        normalized = self.validate(body)
        self.workspace.status()
        return {"schema": _PREPARED, "workspaceId": self.workspace.workspace_id,
                "dossierId": self.dossier_id, **normalized}

    def save_prepared(self, prepared, file):
        """Publish one exact, portable request JSON without replacing prior work."""
        _need(isinstance(prepared, dict) and prepared.get("schema") == _PREPARED and
              prepared.get("dossierId") == self.dossier_id, "ELIGIBILITY_PREPARED_CHANGED")
        normalized = self.validate(prepared.get("request"))
        _need(normalized["sha256"] == prepared.get("sha256") and
              normalized["request"] == prepared["request"], "ELIGIBILITY_PREPARED_CHANGED")
        file = Path(file).expanduser().absolute()
        if file.exists() or file.is_symlink():
            _need(parse(read(file, _LIMIT)) == prepared, "ELIGIBILITY_PREPARED_FILE_CHANGED")
        else:
            try:
                dump(file, prepared, exclusive=True)
            except FileExistsError:
                _need(parse(read(file, _LIMIT)) == prepared, "ELIGIBILITY_PREPARED_FILE_CHANGED")
        return {"file": str(file), **deepcopy(prepared)}

    def submit_prepared(self, prepared, *, resume=False, cancel_event=None):
        if isinstance(prepared, (str, Path)):
            prepared = parse(read(Path(prepared), _LIMIT))
        _need(isinstance(prepared, dict) and prepared.get("schema") == _PREPARED and
              prepared.get("dossierId") == self.dossier_id, "ELIGIBILITY_PREPARED_CHANGED")
        self.workspace.status()
        _need(prepared.get("workspaceId") == self.workspace.workspace_id,
              "ELIGIBILITY_PREPARED_WORKSPACE_CHANGED")
        normalized = self.validate(prepared.get("request"))
        _need(normalized["sha256"] == prepared.get("sha256") and
              normalized["request"] == prepared["request"], "ELIGIBILITY_PREPARED_CHANGED")
        return self.submit(normalized["request"], resume=resume, cancel_event=cancel_event)

    def submit(self, request, *, resume=False, cancel_event=None):
        """Persist then send the full original action using the existing journal."""
        normalized = self.validate(request)["request"]
        return self.workspace._write("eligibility-review",
            {"dossierId": self.dossier_id, "body": normalized},
            request_id=normalized["requestId"], replay_safe=True,
            resume=resume, cancel_event=cancel_event)

    def saved_request(self, request_id):
        record = self.workspace.call_record(request_id)
        saved = record["request"]
        _need(saved.get("action") == "eligibility-review" and
              saved.get("input", {}).get("dossierId") == self.dossier_id and
              saved["input"].get("body", {}).get("requestId") == request_id,
              "ELIGIBILITY_SAVED_SELECTION_CHANGED")
        return record

    def recover(self, request_id, *, cancel_event=None):
        """Recover the same saved operation; do not generate a replacement ID."""
        self.saved_request(request_id)
        return self.workspace.resume(request_id, cancel_event=cancel_event)

    def _action(self, action, data, *, request_id, expected_revision, actor,
                review_id=None, resume=False, cancel_event=None):
        request = {"requestId": request_id, "expectedRevision": expected_revision,
                   "actor": actor, "action": action, "data": data}
        if review_id is not None:
            request["reviewId"] = review_id
        return self.submit(request, resume=resume, cancel_event=cancel_event)

    def create_review(self, data, **request):
        """data: questionId, name, optional description, complete protocol."""
        return self._action("create-review", data, **request)

    def revise_protocol(self, data, **request):
        """data: complete protocol and reason; request retains review_id."""
        return self._action("revise-protocol", data, **request)

    def create_workset(self, data, **request):
        """data: protocolId, name, exact occurrenceIds and reason."""
        return self._action("create-workset", data, **request)

    def decide(self, data, **request):
        """data: full stage decision/basis; supersedes selects a correction."""
        return self._action("decide", data, **request)

    def resolve(self, data, **request):
        """data: every current decisionId, method, disposition and reason."""
        return self._action("resolve", data, **request)

    def study_link(self, data, **request):
        """data: report identities and retained evidence supporting each link."""
        return self._action("study-link", data, **request)

    def apply_outcomes(self, data, **request):
        """data: explicit current resolution IDs and exact report occurrences."""
        return self._action("apply-outcomes", data, **request)

    def review_impact(self, data, **request):
        """data: exact impactId, disposition, reason and optional workSetId."""
        return self._action("review-impact", data, **request)

    def export(self, file, *, review_id, format="json", section="queue",
               work_set_id=None, revision=None, expected_sha256=None):
        _need(isinstance(review_id, str) and bool(review_id), "ELIGIBILITY_REVIEW_REQUIRED")
        _need(format in ("json", "csv") and section in EXPORT_SECTIONS,
              "ELIGIBILITY_EXPORT_INVALID")
        if revision is None:
            revision = self.read(review_id=review_id, work_set_id=work_set_id)["dossier"]["revision"]
        options = {"format": format, "section": section, "revision": revision}
        for key, value in (("reviewId", review_id), ("workSetId", work_set_id)):
            if value is not None:
                options[key] = value
        return self.workspace._download("eligibility-export",
            {"dossierId": self.dossier_id, "options": options},
            file=file, expected_sha256=expected_sha256)

    def delivery(self, directory, *, review_id, revision=None, work_set_id=None):
        """Freeze and export the complete selected review and original history."""
        from .research_eligibility_delivery import EligibilityDelivery
        return EligibilityDelivery.prepare(self, directory, review_id=review_id,
                                           revision=revision, work_set_id=work_set_id)
