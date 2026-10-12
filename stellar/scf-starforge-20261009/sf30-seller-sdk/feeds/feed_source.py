"""MIT. RSS 2.0 / Atom 1.0 semantics over the original namespace-aware XML parser."""
from __future__ import annotations

from calendar import timegm
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from email.utils import parsedate_to_datetime
import io
import re
from urllib.parse import urljoin, urlsplit
from xml.etree import ElementTree as ET

from original import InputError, parser, parse_stream, expanded, MAX_DEPTH, Node, digest, json_bytes

ATOM = "{http://www.w3.org/2005/Atom}"
TOMBSTONE = "{http://purl.org/atompub/tombstones/1.0}"
XML = "{http://www.w3.org/XML/1998/namespace}"
XHTML = "{http://www.w3.org/1999/xhtml}"
CONTENT = "{http://purl.org/rss/1.0/modules/content/}"
DC = "{http://purl.org/dc/elements/1.1/}"
MAX_FEED_BYTES = 32 * 1024 * 1024
MAX_NODES = 250000
DATE = re.compile(r"(\d{4})-(\d\d)-(\d\d)[Tt](\d\d):(\d\d):(\d\d)(\.\d+)?([Zz]|[+-]\d\d:\d\d)\Z")


def instant(value: str, atom: bool = True) -> str | None:
    """An exact decimal UTC ordering key; the original source date stays unchanged."""
    if not value:
        return None
    try:
        if not atom:
            dt = parsedate_to_datetime(value)
            if dt.tzinfo is None:
                return None
            return str(timegm(dt.astimezone(timezone.utc).timetuple()))
        m = DATE.fullmatch(value)
        if not m:
            return None
        y, mo, d, h, mi, sec = map(int, m.groups()[:6])
        fraction, offset = m.group(7), m.group(8)
        if sec > 60:
            return None
        shift = 0
        if offset.upper() != "Z":
            oh, om = int(offset[1:3]), int(offset[4:6])
            if oh > 23 or om > 59:
                return None
            shift = (oh * 60 + om) * (1 if offset[0] == "+" else -1)
        # Retain the source date exactly; ambiguous leap-second ordering
        # is sent to explicit review instead of rounding to another instant.
        dt = datetime(y, mo, d, h, mi, min(sec, 59)) - timedelta(minutes=shift)
        epoch = Decimal(timegm(dt.timetuple())) + Decimal(fraction or "0")
        if sec == 60:
            # RFC3339 leap seconds cannot safely be ranked against arbitrary
            # precision fractions without a leap-second table. Review explicitly.
            return None
        return str(epoch)
    except (ValueError, OverflowError, TypeError):
        return None


def children(node: Node, name: str) -> list[Node]:
    return [c for c in node.children if c.name == name]


def one(node: Node, name: str, required: bool = False) -> Node | None:
    found = children(node, name)
    if len(found) > 1 or (required and not found):
        raise InputError(f"Expected {'one' if required else 'at most one'} {name}")
    return found[0] if found else None


def txt(node: Node | None) -> str:
    return node.text("descendant") if node else ""


def scalar(node: Node, name: str, required: bool = False) -> str:
    value = txt(one(node, name, required))
    if required and not value.strip():
        raise InputError(f"{name} cannot be empty")
    return value


def xml_element(node: Node) -> ET.Element:
    element = ET.Element(node.name, node.attrs)
    previous = None
    for part in node.content:
        if isinstance(part, str):
            if previous is None:
                element.text = (element.text or "") + part
            else:
                previous.tail = (previous.tail or "") + part
        else:
            previous = xml_element(part)
            element.append(previous)
    return element


def markup(node: Node) -> str:
    parts = []
    for item in node.content:
        parts.append(item if isinstance(item, str) else ET.tostring(xml_element(item), encoding="unicode"))
    return "".join(parts)


def text_construct(node: Node | None) -> dict:
    if node is None:
        return {"type": "text", "value": "", "text": "", "src": None}
    kind = node.attrs.get("type", "text")
    value = markup(node) if node.children else txt(node)
    return {"type": kind, "value": value, "text": txt(node), "src": node.attrs.get("src")}


def resolve_reference(value: str, base: str) -> str:
    return urljoin(base, value) if value else ""


def usable_link(value: str) -> str:
    try:
        u = urlsplit(value)
        return value if u.scheme in ("https", "http") and u.hostname and not u.username and not u.password else ""
    except ValueError:
        return ""


def parse_feed(data: bytes, url: str, rss_identity: str = "guid-or-link") -> dict:
    if len(data) > MAX_FEED_BYTES:
        raise InputError("Feed response exceeds 32 MiB; select a smaller source page")
    if rss_identity not in ("guid", "guid-or-link"):
        raise InputError("RSS identity must be guid or guid-or-link")
    p = parser()
    stack = []
    bases = {}
    root = None
    nodes = 0

    def start(raw, attrs):
        nonlocal root, nodes
        nodes += 1
        if len(stack) >= MAX_DEPTH or nodes > MAX_NODES or len(attrs) > 256:
            raise InputError("Feed exceeds the supported XML shape size")
        node = Node(expanded(raw), {expanded(k): v for k, v in attrs.items()})
        parent_base = bases[id(stack[-1])] if stack else url
        bases[id(node)] = resolve_reference(node.attrs.get(XML + "base", ""), parent_base) or parent_base
        if stack:
            stack[-1].children.append(node)
            stack[-1].content.append(node)
        else:
            root = node
        stack.append(node)

    def text(value):
        if stack:
            stack[-1].content.append(value)

    p.StartElementHandler, p.EndElementHandler, p.CharacterDataHandler = start, lambda _: stack.pop(), text
    parse_stream(p, io.BytesIO(data))
    if root is None:
        raise InputError("The feed is empty")

    def links(node):
        rows = []
        for c in children(node, ATOM + "link"):
            href = c.attrs.get("href", "")
            if not href:
                raise InputError("Atom link is missing href")
            rows.append({k: c.attrs.get(k) for k in ("type", "hreflang", "title", "length")} |
                        {"rel": c.attrs.get("rel", "alternate"), "href": resolve_reference(href, bases[id(c)])})
        return rows

    def people(node, inherited=None):
        rows = []
        for c in children(node, ATOM + "author"):
            uri = one(c, ATOM + "uri")
            rows.append({"name": scalar(c, ATOM + "name", True), "email": scalar(c, ATOM + "email"),
                         "uri": resolve_reference(txt(uri), bases[id(uri)]) if uri else ""})
        return rows or (inherited or [])

    entries = []
    if root.name == ATOM + "feed":
        feed_id = scalar(root, ATOM + "id", True)
        if feed_id.strip() != feed_id or any(c.isspace() for c in feed_id):
            raise InputError("Atom feed id must be its exact absolute IRI without whitespace")
        if not urlsplit(feed_id).scheme:
            raise InputError("Atom feed id must be an absolute IRI")
        updated = scalar(root, ATOM + "updated", True)
        title = text_construct(one(root, ATOM + "title", True))
        metadata = {"format": "atom1", "id": feed_id, "title": title, "updated": updated,
                    "authors": people(root), "links": links(root),
                    "rights": text_construct(one(root, ATOM + "rights")),
                    "complete": bool(children(root, "{http://purl.org/syndication/history/1.0}complete")),
                    "archive": bool(children(root, "{http://purl.org/syndication/history/1.0}archive"))}
        for ordinal, node in enumerate(root.children):
            if node.name == TOMBSTONE + "deleted-entry":
                ident, when = node.attrs.get("ref", ""), node.attrs.get("when", "")
                if not ident or not urlsplit(ident).scheme or not when or not DATE.fullmatch(when):
                    raise InputError("Atom deleted-entry needs its original absolute ref and RFC3339 when")
                entry = {"id": ident, "identityKind": "atom:id", "deleted": True,
                         "title": "", "link": "", "published": "", "updated": when,
                         "timeKey": instant(when), "summary": text_construct(None), "content": text_construct(None),
                         "authors": people(node), "categories": [], "links": links(node), "enclosures": []}
            elif node.name == ATOM + "entry":
                ident = scalar(node, ATOM + "id", True)
                if ident.strip() != ident or any(c.isspace() for c in ident) or not urlsplit(ident).scheme:
                    raise InputError("Atom entry id must be its exact absolute IRI")
                changed = scalar(node, ATOM + "updated", True)
                entry_links = links(node)
                source = one(node, ATOM + "source")
                authors = people(node, people(source, metadata["authors"]) if source else metadata["authors"])
                content = text_construct(one(node, ATOM + "content"))
                content_node = one(node, ATOM + "content")
                if content["src"]:
                    content["src"] = resolve_reference(content["src"], bases[id(content_node)])
                entry = {"id": ident, "identityKind": "atom:id", "deleted": False,
                         "title": text_construct(one(node, ATOM + "title", True))["text"],
                         "titleConstruct": text_construct(one(node, ATOM + "title", True)),
                         "link": next((usable_link(x["href"]) for x in entry_links if x["rel"] in
                                      ("alternate", "http://www.iana.org/assignments/relation/alternate") and usable_link(x["href"])), ""),
                         "published": scalar(node, ATOM + "published"), "updated": changed,
                         "timeKey": instant(changed), "summary": text_construct(one(node, ATOM + "summary")),
                         "content": content, "authors": authors,
                         "categories": [{k: c.attrs.get(k, "") for k in ("term", "scheme", "label")} for c in children(node, ATOM + "category")],
                         "links": entry_links, "enclosures": [x for x in entry_links if x["rel"] in
                                      ("enclosure", "http://www.iana.org/assignments/relation/enclosure")]}
            else:
                continue
            entry["ordinal"] = ordinal
            entries.append(entry)
    elif root.name == "rss" and root.attrs.get("version") == "2.0":
        channel = one(root, "channel", True)
        metadata = {"format": "rss2", "id": "", "title": {"type": "text", "value": scalar(channel, "title", True),
                    "text": scalar(channel, "title", True), "src": None},
                    "updated": scalar(channel, "lastBuildDate") or scalar(channel, "pubDate"),
                    "description": scalar(channel, "description", True), "authors": [],
                    "links": [{"rel": "alternate", "href": resolve_reference(scalar(channel, "link", True), bases[id(channel)])}] + links(channel),
                    "rights": {"type": "text", "value": scalar(channel, "copyright"), "text": scalar(channel, "copyright"), "src": None},
                    "complete": False, "archive": False}
        for ordinal, node in enumerate(children(channel, "item")):
            guid = one(node, "guid")
            item_link = resolve_reference(scalar(node, "link"), bases[id(node)])
            ident = txt(guid) if guid else ""
            identity_kind = "rss:guid"
            if guid and guid.attrs.get("isPermaLink", "true") not in ("true", "false"):
                raise InputError("RSS guid isPermaLink must be true or false")
            if not ident.strip() and rss_identity == "guid-or-link" and item_link:
                ident, identity_kind = item_link, "rss:link"
            if not ident.strip():
                raise InputError(f"RSS item {ordinal + 1} has no chosen stable identity; select guid-or-link or correct the source")
            published = scalar(node, "pubDate")
            summary = scalar(node, "description")
            title = scalar(node, "title")
            if not title and not summary:
                raise InputError("RSS items need a title or description")
            encoded = one(node, CONTENT + "encoded")
            content = txt(encoded) if encoded else ""
            authors = [txt(c) for c in children(node, "author") + children(node, DC + "creator")]
            enclosures = [{"href": resolve_reference(c.attrs.get("url", ""), bases[id(c)]),
                           "type": c.attrs.get("type", ""), "length": c.attrs.get("length", "")}
                          for c in children(node, "enclosure")]
            entry = {"id": ident, "identityKind": identity_kind, "deleted": False, "title": title,
                     "link": usable_link(item_link), "published": published, "updated": published,
                     "timeKey": instant(published, False), "guidIsPermaLink": guid.attrs.get("isPermaLink", "true") if guid else None,
                     "summary": {"type": "html", "value": summary, "text": summary, "src": None},
                     "content": {"type": "html", "value": content, "text": content, "src": None},
                     "authors": authors, "categories": [{"term": txt(c), "scheme": c.attrs.get("domain", ""), "label": ""}
                        for c in children(node, "category")], "links": [], "enclosures": enclosures, "ordinal": ordinal}
            entries.append(entry)
    else:
        raise InputError("Choose RSS 2.0 or Atom 1.0; the exact response remains retained")
    for entry in entries:
        entry["identity"] = digest(json_bytes([entry["identityKind"], entry["id"]]))
        body = {k: v for k, v in entry.items() if k not in ("ordinal", "identity")}
        entry["contentHash"] = digest(json_bytes(body))
    metadata["next"] = [x["href"] for x in metadata["links"] if x["rel"] in
                        ("next", "http://www.iana.org/assignments/relation/next")]
    if len(set(metadata["next"])) > 1:
        raise InputError("Feed advertises different next pages; review the original XML")
    metadata["next"] = metadata["next"][0] if metadata["next"] else None
    return {"schema": "stellar-forge.feed-document.v1", "sourceUrl": url,
            "sourceSha256": digest(data), "metadata": metadata, "entries": entries}


def choose_observations(documents: list[dict]) -> dict[str, list[dict]]:
    grouped = {}
    for doc in documents:
        for entry in doc["entries"]:
            value = entry | {"sourceSha256": doc["sourceSha256"], "sourceUrl": doc["sourceUrl"]}
            bucket = grouped.setdefault(entry["identity"], [])
            if not any(x["contentHash"] == value["contentHash"] for x in bucket):
                bucket.append(value)
    return grouped


def proposal(current: dict | None, candidates: list[dict]) -> dict:
    """Rank actual Atom dates; RSS pubDate is publication time, not update time."""
    incoming = candidates
    if len(candidates) > 1 and all(x["identityKind"] == "atom:id" and x["timeKey"] is not None for x in candidates):
        latest = max(Decimal(x["timeKey"]) for x in candidates)
        incoming = [x for x in candidates if Decimal(x["timeKey"]) == latest]
    if len(incoming) != 1:
        return {"kind": "CONFLICT", "candidate": None, "candidates": candidates, "current": current}
    item = incoming[0]
    if current is None:
        kind = "DELETE" if item["deleted"] else "ADD"
    elif current["contentHash"] == item["contentHash"]:
        kind = "UNCHANGED"
    elif item["identityKind"] == "atom:id" and current["timeKey"] is not None and item["timeKey"] is not None:
        order = Decimal(item["timeKey"]).compare(Decimal(current["timeKey"]))
        kind = "STALE" if order < 0 else "CONFLICT" if order == 0 else "DELETE" if item["deleted"] else "UPDATE"
    else:
        kind = "CONFLICT"
    return {"kind": kind, "candidate": item, "candidates": candidates, "current": current}
