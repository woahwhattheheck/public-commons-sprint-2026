"""MIT. Whole reviewer document preparation through the original Domain."""
from __future__ import annotations
import base64
import binascii
import io
from pathlib import Path
import re

from model import InputError, MAX_SOURCE, json_bytes, stable, sha
import review_exchange

HERE = Path(__file__).resolve().parent


def _bytes(descriptor):
    if not isinstance(descriptor, dict) or set(descriptor) != {"sha256", "bytes", "base64"}:
        raise InputError("Use the complete prepared original issue descriptor")
    try:
        raw = base64.b64decode(descriptor["base64"], validate=True)
    except (ValueError, TypeError, binascii.Error) as error:
        raise InputError("The prepared original issue bytes are invalid") from error
    if (type(descriptor["bytes"]) is not int or len(raw) != descriptor["bytes"] or
            sha(raw) != descriptor["sha256"] or
            base64.b64encode(raw).decode("ascii") != descriptor["base64"]):
        raise InputError("The complete prepared issue identity changed")
    return raw


def render_copy(issued_raw):
    returned = review_exchange.initial_return(issued_raw)
    initial = json_bytes(returned).decode("utf-8").replace("<", "\\u003c")
    public = HERE / "public"
    template = (public / "reviewer-copy.html").read_text(encoding="utf-8")
    replacements = {
        "__SOURCE_REVIEW_CSS__": (public / "reviewer-copy.css").read_text(encoding="utf-8"),
        "__SOURCE_REVIEW_JS__": (public / "reviewer-copy.js").read_text(encoding="utf-8"),
        "__SOURCE_REVIEW_RETURN__": initial,
    }
    if any(template.count(token) != 1 for token in replacements):
        raise InputError("The complete selected reviewer template differs")
    if "</script" in replacements["__SOURCE_REVIEW_JS__"].lower() or "</style" in replacements["__SOURCE_REVIEW_CSS__"].lower():
        raise InputError("The selected standalone reviewer source cannot be safely embedded")
    # Match only tokens in the original template, never carried customer text.
    raw = re.sub("|".join(re.escape(token) for token in replacements),
                 lambda match: replacements[match.group(0)], template).encode("utf-8")
    if len(raw) > MAX_SOURCE:
        raise InputError("The complete editable reviewer HTML exceeds 256 MiB; retain the full source and select a supported explicit assignment")
    return raw


def issue(domain, selection):
    """Prepare, retain and register one exact issue under the original mutex."""
    if not isinstance(selection, dict):
        raise InputError("Select the complete reviewer issue input")
    with domain.mutex:
        old = review_exchange.request(domain, selection.get("requestId"))
        if old["committed"]:
            event = old["event"]
            if event["request"]["action"] != "issue" or stable(event["observations"].get("issueRequest")) != stable(selection):
                raise InputError("This original reviewer request UUID has different issue input")
            return event["result"]
        prepared = review_exchange.prepare_issue(domain, selection)
        issued_raw = _bytes(prepared["issued"])
        html_raw = render_copy(issued_raw)
        if len(issued_raw) > MAX_SOURCE:
            raise InputError("The complete original reviewer issue exceeds 256 MiB")
        name = prepared["issued"]["sha256"]
        issued = domain.put_object(io.BytesIO(issued_raw), "Reviewer_Issue_" + name[:16] + ".json",
                                   "application/json", {"kind": "reviewer-exchange-issue", "requestId": selection["requestId"]})
        html = domain.put_object(io.BytesIO(html_raw), "Reviewer_Copy_" + name[:16] + ".html",
                                 "text/html; charset=utf-8", {"kind": "reviewer-exchange-editor", "requestId": selection["requestId"]})
        command = {"requestId": selection["requestId"], "action": "issue",
                   "actor": selection["actor"], "at": selection["at"],
                   "body": {"issued": {"sha256": issued["id"], "bytes": issued["bytes"]},
                            "html": {"sha256": html["id"], "bytes": html["bytes"]}}}
        return review_exchange.command(domain, command)


def preview_return(domain, selected):
    """Read the selected complete retained file before creating a receive command."""
    if not isinstance(selected, dict) or set(selected) != {"sha256", "bytes", "name", "mediaType"}:
        raise InputError("Select the original returned file identity, name and media type")
    with domain.mutex:
        descriptor = domain._one("objects", selected["sha256"])
        raw = domain.object_path(selected["sha256"]).read_bytes()
        if descriptor["bytes"] != selected["bytes"] or len(raw) != selected["bytes"]:
            raise InputError("The original returned file size changed")
        return review_exchange.prepare_return(domain, raw, selected["name"], selected["mediaType"])
