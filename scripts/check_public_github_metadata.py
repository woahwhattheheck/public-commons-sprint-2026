#!/usr/bin/env python3
"""Fail closed on internal build lineage in customer/evaluator-facing GitHub metadata."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import hashlib
import json
import os
import re
import sys
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

try:
    from .check_external_surface_isolation import (
        FORBIDDEN_MARKERS,
        ScanError as TextScanError,
        marker_present,
        normalized_for_scan,
    )
except ImportError:
    from check_external_surface_isolation import (
        FORBIDDEN_MARKERS,
        ScanError as TextScanError,
        marker_present,
        normalized_for_scan,
    )

REPORT_SCHEMA = "public-github-metadata-isolation/v1"
EXPORT_SCHEMA = "public-github-metadata-export/v1"
MAX_FIELD_CHARS = 1_000_000
MAX_OBJECTS = 20_000
MAX_API_PAGES = 25
MAX_API_CALLS = 500
API_PAGE_SIZE = 100

COMMONS_LINEAGE_RE = re.compile(
    r"\bcommons(?:"
    r"\s*(?:pull\s+request|pull|pr|issue)\s*(?:[:/#-]\s*)?#?\s*"
    r"|\s*#\s*"
    r"|\s*[:/-]\s*"
    r")\d{1,10}\b",
    re.IGNORECASE,
)
SWARM_LINEAGE_RE = re.compile(
    r"\bswarm\s+z\b|"
    r"\b(?:owner|build|source|review|reviewer|finalizer|lane|seat)"
    r"\s*(?::|/|-)?\s*z-[a-z][a-z0-9-]{1,80}\b",
    re.IGNORECASE,
)
SLACK_CHANNEL_RE = re.compile(r"\bC0[A-Z0-9]{8,12}\b", re.IGNORECASE)
SLACK_TS_RE = re.compile(
    r"\b(?:slack\s*)?(?:ts|timestamp)\s*(?::|=)?\s*\d{10}(?:\.\d{1,6})?\b",
    re.IGNORECASE,
)
SHA40_RE = re.compile(r"\b[0-9a-f]{40}\b", re.IGNORECASE)


class MetadataAuditError(RuntimeError):
    """The GitHub metadata audit could not establish a complete result."""


class _ApiBudget:
    """Aggregate GitHub REST call budget for one complete repository audit."""

    def __init__(self, limit: int = MAX_API_CALLS) -> None:
        self.limit = limit
        self.used = 0

    def charge(self) -> None:
        self.used += 1
        if self.used > self.limit:
            raise MetadataAuditError(
                f"GitHub metadata API call budget exceeds {self.limit}"
            )


@dataclass(frozen=True)
class MetadataObject:
    kind: str
    object_id: str
    field: str
    text: str
    number: int | None = None
    url: str | None = None


def _text_sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", "strict")).hexdigest()


def _bounded_text(value: Any, *, label: str) -> str:
    if value is None:
        return ""
    if type(value) is not str:
        raise MetadataAuditError(f"{label} must be text or null")
    if len(value) > MAX_FIELD_CHARS:
        raise MetadataAuditError(f"{label} exceeds {MAX_FIELD_CHARS} characters")
    try:
        value.encode("utf-8", "strict")
    except UnicodeEncodeError as exc:
        raise MetadataAuditError(f"{label} is not Unicode scalar text") from exc
    return value


def _stable_object_id(kind: str, raw: dict[str, Any]) -> tuple[str, int | None]:
    number = raw.get("number")
    if type(number) is int and not isinstance(number, bool) and number >= 0:
        return f"{kind}:{number}", number
    ident = raw.get("id")
    if type(ident) is int and not isinstance(ident, bool) and ident >= 0:
        return f"{kind}:id:{ident}", None
    node = raw.get("node_id")
    if type(node) is str and node:
        return f"{kind}:node:{node}", None
    raise MetadataAuditError(f"{kind} metadata lacks stable number/id")


def _url(raw: dict[str, Any]) -> str | None:
    for key in ("html_url", "url"):
        value = raw.get(key)
        if type(value) is str and value:
            return value
    return None


def _append_fields(
    out: list[MetadataObject],
    *,
    kind: str,
    raw: dict[str, Any],
    fields: Iterable[str],
    number_override: int | None = None,
) -> None:
    object_id, number = _stable_object_id(kind, raw)
    if number_override is not None:
        number = number_override
    for field in fields:
        text = _bounded_text(raw.get(field), label=f"{kind}.{field}")
        if text:
            out.append(
                MetadataObject(
                    kind=kind,
                    object_id=object_id,
                    field=field,
                    text=text,
                    number=number,
                    url=_url(raw),
                )
            )


def extract_event_objects(payload: Any, event_name: str) -> list[MetadataObject]:
    if type(payload) is not dict:
        raise MetadataAuditError("GitHub event payload must be an object")
    if type(event_name) is not str or not event_name:
        raise MetadataAuditError("event name must be non-empty text")

    out: list[MetadataObject] = []
    issue = payload.get("issue")
    pull = payload.get("pull_request")
    comment = payload.get("comment")
    review = payload.get("review")
    release = payload.get("release")

    if type(issue) is dict:
        _append_fields(out, kind="issue", raw=issue, fields=("title", "body"))
    if type(pull) is dict:
        _append_fields(out, kind="pull_request", raw=pull, fields=("title", "body"))
    if type(comment) is dict:
        if event_name == "issue_comment":
            kind = "issue_comment"
        elif event_name == "pull_request_review_comment":
            kind = "pull_request_review_comment"
        else:
            kind = "comment"
        parent_number = None
        if type(issue) is dict and type(issue.get("number")) is int:
            parent_number = issue["number"]
        elif type(pull) is dict and type(pull.get("number")) is int:
            parent_number = pull["number"]
        _append_fields(
            out,
            kind=kind,
            raw=comment,
            fields=("body",),
            number_override=parent_number,
        )
    if type(review) is dict:
        parent_number = pull.get("number") if type(pull) is dict else None
        _append_fields(
            out,
            kind="pull_request_review",
            raw=review,
            fields=("body",),
            number_override=parent_number if type(parent_number) is int else None,
        )
    if type(release) is dict:
        _append_fields(out, kind="release", raw=release, fields=("name", "body", "tag_name"))

    return out


def _line_number(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def scan_metadata_object(obj: MetadataObject) -> list[dict[str, Any]]:
    try:
        normalized = normalized_for_scan(obj.text)
    except TextScanError as exc:
        return [
            {
                "kind": obj.kind,
                "object_id": obj.object_id,
                "number": obj.number,
                "field": obj.field,
                "reason": "unscannable-metadata-text",
                "content_sha256": _text_sha256(obj.text),
                "line": 0,
            }
        ]

    reasons: list[tuple[str, int]] = []
    for label, marker in FORBIDDEN_MARKERS:
        if marker_present(normalized, marker):
            reasons.append((label, 0))

    lineage_match = COMMONS_LINEAGE_RE.search(normalized)
    if lineage_match:
        reasons.append(("commons-work-item-lineage", lineage_match.start()))
        sha = SHA40_RE.search(normalized)
        if sha:
            reasons.append(("internal-commit-locator", sha.start()))

    swarm_match = SWARM_LINEAGE_RE.search(normalized)
    if swarm_match:
        reasons.append(("internal-swarm-lineage", swarm_match.start()))

    slack_channel = SLACK_CHANNEL_RE.search(normalized)
    if slack_channel:
        reasons.append(("internal-slack-channel-id", slack_channel.start()))
    slack_ts = SLACK_TS_RE.search(normalized)
    if slack_ts:
        reasons.append(("internal-slack-timestamp", slack_ts.start()))

    seen: set[str] = set()
    findings: list[dict[str, Any]] = []
    digest = _text_sha256(obj.text)
    for reason, offset in sorted(reasons, key=lambda item: (item[0], item[1])):
        if reason in seen:
            continue
        seen.add(reason)
        findings.append(
            {
                "kind": obj.kind,
                "object_id": obj.object_id,
                "number": obj.number,
                "field": obj.field,
                "reason": reason,
                "content_sha256": digest,
                "line": _line_number(normalized, offset),
            }
        )
    return findings


def audit_objects(
    objects: Iterable[MetadataObject], *, repository: str | None = None
) -> dict[str, Any]:
    items = list(objects)
    if len(items) > MAX_OBJECTS:
        raise MetadataAuditError(f"metadata object count exceeds {MAX_OBJECTS}")
    findings: list[dict[str, Any]] = []
    for obj in items:
        findings.extend(scan_metadata_object(obj))
    findings.sort(
        key=lambda item: (
            item["kind"],
            item["object_id"],
            item["field"],
            item["reason"],
            item["line"],
        )
    )
    return {
        "schema": REPORT_SCHEMA,
        "repository": repository,
        "safe": not findings,
        "metadata_fields_scanned": len(items),
        "finding_count": len(findings),
        "findings": findings,
    }


def load_export(path: str) -> tuple[str | None, list[MetadataObject]]:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            doc = json.load(handle)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise MetadataAuditError(f"cannot read metadata export: {path}") from exc
    if type(doc) is not dict or doc.get("schema") != EXPORT_SCHEMA:
        raise MetadataAuditError("metadata export schema mismatch")
    repository = doc.get("repository")
    if repository is not None and (type(repository) is not str or not repository):
        raise MetadataAuditError("metadata export repository must be text")
    rows = doc.get("objects")
    if type(rows) is not list:
        raise MetadataAuditError("metadata export objects must be an array")
    if len(rows) > MAX_OBJECTS:
        raise MetadataAuditError(f"metadata object count exceeds {MAX_OBJECTS}")

    out: list[MetadataObject] = []
    for index, row in enumerate(rows):
        if type(row) is not dict:
            raise MetadataAuditError(f"metadata export object {index} must be an object")
        kind = row.get("kind")
        object_id = row.get("object_id")
        field = row.get("field")
        text = row.get("text")
        if not all(type(value) is str and value for value in (kind, object_id, field)):
            raise MetadataAuditError(f"metadata export object {index} identity invalid")
        number = row.get("number")
        if number is not None and (type(number) is not int or isinstance(number, bool)):
            raise MetadataAuditError(f"metadata export object {index} number invalid")
        url = row.get("url")
        if url is not None and type(url) is not str:
            raise MetadataAuditError(f"metadata export object {index} url invalid")
        out.append(
            MetadataObject(
                kind=kind,
                object_id=object_id,
                field=field,
                text=_bounded_text(text, label=f"objects[{index}].text"),
                number=number,
                url=url,
            )
        )
    return repository, out


def _api_get_json(
    url: str, token: str, budget: _ApiBudget
) -> tuple[Any, str | None]:
    budget.charge()
    request = Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "public-metadata-isolation/1",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        method="GET",
    )
    try:
        with urlopen(request, timeout=20) as response:
            raw = response.read(8 * 1024 * 1024 + 1)
            if len(raw) > 8 * 1024 * 1024:
                raise MetadataAuditError("GitHub API response exceeds 8 MiB")
            link = response.headers.get("Link")
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        raise MetadataAuditError("GitHub metadata API read failed") from exc
    try:
        return json.loads(raw.decode("utf-8", "strict")), link
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise MetadataAuditError("GitHub metadata API returned invalid JSON") from exc


def _paged_api(
    path: str, token: str, budget: _ApiBudget
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for page in range(1, MAX_API_PAGES + 1):
        separator = "&" if "?" in path else "?"
        payload, _link = _api_get_json(
            f"https://api.github.com{path}{separator}{urlencode({'per_page': API_PAGE_SIZE, 'page': page})}",
            token,
            budget,
        )
        if type(payload) is not list:
            raise MetadataAuditError("GitHub paged metadata endpoint returned non-array")
        if any(type(item) is not dict for item in payload):
            raise MetadataAuditError("GitHub paged metadata endpoint returned non-object row")
        rows.extend(payload)
        if len(rows) > MAX_OBJECTS:
            raise MetadataAuditError(f"metadata object count exceeds {MAX_OBJECTS}")
        if len(payload) < API_PAGE_SIZE:
            return rows
    raise MetadataAuditError("GitHub metadata pagination exceeded bounded page limit")


def fetch_repository_objects(repository: str, token: str) -> list[MetadataObject]:
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise MetadataAuditError("repository must be owner/name")
    budget = _ApiBudget()
    issues = _paged_api(f"/repos/{repository}/issues?state=all", token, budget)
    out: list[MetadataObject] = []

    for issue in issues:
        is_pr = type(issue.get("pull_request")) is dict
        kind = "pull_request" if is_pr else "issue"
        _append_fields(out, kind=kind, raw=issue, fields=("title", "body"))
        number = issue.get("number")
        if type(number) is not int or isinstance(number, bool):
            raise MetadataAuditError("GitHub issue row missing integer number")

        comments = _paged_api(
            f"/repos/{repository}/issues/{number}/comments", token, budget
        )
        for comment in comments:
            _append_fields(
                out,
                kind="issue_comment",
                raw=comment,
                fields=("body",),
                number_override=number,
            )

        if is_pr:
            reviews = _paged_api(
                f"/repos/{repository}/pulls/{number}/reviews", token, budget
            )
            for review in reviews:
                _append_fields(
                    out,
                    kind="pull_request_review",
                    raw=review,
                    fields=("body",),
                    number_override=number,
                )
            review_comments = _paged_api(
                f"/repos/{repository}/pulls/{number}/comments", token, budget
            )
            for comment in review_comments:
                _append_fields(
                    out,
                    kind="pull_request_review_comment",
                    raw=comment,
                    fields=("body",),
                    number_override=number,
                )

    releases = _paged_api(f"/repos/{repository}/releases", token, budget)
    for release in releases:
        _append_fields(
            out, kind="release", raw=release, fields=("name", "body", "tag_name")
        )

    if len(out) > MAX_OBJECTS:
        raise MetadataAuditError(f"metadata object count exceeds {MAX_OBJECTS}")
    return out


def run_self_test() -> dict[str, Any]:
    """Run deterministic policy hostiles without network access."""
    repo_marker = "woahwhattheheck" + "/commons"
    repository_reason = "commons" + "-repository"

    def reasons(text: str) -> set[str]:
        row = MetadataObject("issue", "issue:114", "body", text, 114)
        return {item["reason"] for item in scan_metadata_object(row)}

    cases = 0
    for candidate in (
        repo_marker,
        "woahwhattheheck/%63" + "ommons",
        "woahwhattheheck/&#99;" + "ommons",
        "woahwhattheheck/\\u0063" + "ommons",
    ):
        cases += 1
        if repository_reason not in reasons(candidate):
            raise MetadataAuditError("self-test normalized marker escape")

    cases += 1
    lineage = reasons("Derived from " + "Commons" + " #15734 (" + "a" * 40 + ").")
    if not {"commons-work-item-lineage", "internal-commit-locator"} <= lineage:
        raise MetadataAuditError("self-test symbolic lineage escape")

    cases += 1
    if reasons("public-commons-sprint-2026 release " + "a" * 40):
        raise MetadataAuditError("self-test product SHA false positive")

    cases += 1
    if repository_reason in reasons("not" + repo_marker):
        raise MetadataAuditError("self-test owner-prefix false positive")
    if repository_reason in reasons(repo_marker + "-demo"):
        raise MetadataAuditError("self-test repo-suffix false positive")

    cases += 1
    report = audit_objects(
        [MetadataObject("pull_request", "pull_request:7", "body", repo_marker, 7)]
    )
    if report["safe"] or repo_marker in json.dumps(report, sort_keys=True):
        raise MetadataAuditError("self-test report disclosure")

    cases += 1
    sanitized = (
        "OneWriter browser product: transactional writer leases, retained identifiers, "
        "immutable receipts, bounded human-event refencing, no external send authority."
    )
    if reasons(sanitized):
        raise MetadataAuditError("self-test sanitized contract false positive")

    for candidate in (
        "see commons#15734",
        "commons PR 15734",
        "commons issue 15734",
        "commons pull request 15734",
        "commons:15734",
        "commons/15734",
    ):
        cases += 1
        if "commons-work-item-lineage" not in reasons(candidate):
            raise MetadataAuditError("self-test short-form Commons lineage escape")

    cases += 1
    if "internal-slack-channel-id" not in reasons("channel %43%30BRGMDQB6G"):
        raise MetadataAuditError("self-test normalized Slack channel escape")

    cases += 1
    if "internal-slack-timestamp" not in reasons("slack ts=1789690299"):
        raise MetadataAuditError("self-test seconds-only Slack timestamp escape")

    cases += 1
    release_objects = extract_event_objects(
        {
            "release": {
                "id": 9,
                "tag_name": "commons#15734",
                "name": "public release",
                "body": "",
            }
        },
        "release",
    )
    release_report = audit_objects(release_objects)
    if not any(
        item["field"] == "tag_name"
        and item["reason"] == "commons-work-item-lineage"
        for item in release_report["findings"]
    ):
        raise MetadataAuditError("self-test release tag lineage escape")

    cases += 1
    budget = _ApiBudget(limit=1)
    budget.charge()
    try:
        budget.charge()
    except MetadataAuditError:
        pass
    else:
        raise MetadataAuditError("self-test aggregate API budget fail-open")

    return {"schema": REPORT_SCHEMA, "self_test": "PASS", "cases": cases}


def _print_report(report: dict[str, Any]) -> None:
    print(json.dumps(report, indent=2, sort_keys=True, ensure_ascii=True))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Reject internal build lineage in public GitHub metadata."
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--event", help="GitHub event JSON path")
    source.add_argument("--export", dest="export_path", help="bounded metadata export JSON")
    source.add_argument("--self-test", action="store_true", help="run deterministic hostiles")
    source.add_argument(
        "--full-repository",
        action="store_true",
        help="audit the complete live repository metadata via GitHub REST",
    )
    parser.add_argument("--event-name", default=os.environ.get("GITHUB_EVENT_NAME"))
    parser.add_argument("--repository", default=os.environ.get("GITHUB_REPOSITORY"))
    parser.add_argument("--token-env", default="GITHUB_TOKEN")
    args = parser.parse_args(argv)

    try:
        if args.self_test:
            _print_report(run_self_test())
            return 0
        if args.event:
            try:
                with open(args.event, "r", encoding="utf-8") as handle:
                    payload = json.load(handle)
            except (OSError, UnicodeError, json.JSONDecodeError) as exc:
                raise MetadataAuditError("cannot read GitHub event payload") from exc
            objects = extract_event_objects(payload, args.event_name or "")
            report = audit_objects(objects, repository=args.repository)
        elif args.export_path:
            repository, objects = load_export(args.export_path)
            report = audit_objects(objects, repository=repository)
        else:
            repository = args.repository
            if type(repository) is not str or not repository:
                raise MetadataAuditError("--full-repository requires --repository")
            token = os.environ.get(args.token_env)
            if type(token) is not str or not token:
                raise MetadataAuditError(
                    f"--full-repository requires token environment {args.token_env}"
                )
            report = audit_objects(
                fetch_repository_objects(repository, token), repository=repository
            )
    except MetadataAuditError as exc:
        _print_report(
            {
                "schema": REPORT_SCHEMA,
                "safe": False,
                "audit_complete": False,
                "error": str(exc),
            }
        )
        return 2

    report["audit_complete"] = True
    _print_report(report)
    return 0 if report["safe"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
