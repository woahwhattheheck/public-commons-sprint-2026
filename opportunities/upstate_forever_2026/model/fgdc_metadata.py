"""Retained source/contact content for FGDC CSDGM XML delivery."""
from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime
import json
import re
import xml.etree.ElementTree as ET

METADATA_EDITION = "fgdc-retained-content-20261013-1"


def text(value):
    return value.strip() if isinstance(value, str) and value.strip() else None


def calendar_date(value, *, publication=False, ending=False):
    """Normalize an actual date without extracting dates from edition labels."""
    value = str(value).strip() if type(value) is int else text(value)
    if not value:
        return "Unknown"
    if value.lower() == "unknown":
        return "Unknown"
    if publication and value.lower() == "unpublished material":
        return "Unpublished material"
    if ending and value.lower() == "present":
        return "Present"
    if re.fullmatch(r"\d{4}(-?\d{2}){0,2}", value):
        compact = value.replace("-", "")
        try:
            year = int(compact[:4])
            month = int(compact[4:6]) if len(compact) >= 6 else 1
            day = int(compact[6:8]) if len(compact) == 8 else 1
            date(year, month, day)
        except ValueError:
            return "Unknown"
        return compact
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}T.+", value):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).date().strftime("%Y%m%d")
        except ValueError:
            pass
    return "Unknown"


def retained_source_metadata(entry):
    """Keep original declarations, excluding duplicate binary member descriptors."""
    return deepcopy({key: value for key, value in entry.items()
                     if key not in {"body", "companions", "path"}})


def _values(source):
    original = source.get("source_metadata") or source
    if not isinstance(original, dict):
        original = source
    metadata = original.get("metadata")
    metadata = metadata if isinstance(metadata, dict) else {}
    citation = original.get("citation") or metadata.get("citation")
    citation = citation if isinstance(citation, dict) else {}
    return {**metadata, **citation, **original}


def _first(values, *keys):
    for key in keys:
        value = values.get(key)
        if value is not None and value != "" and value != []:
            return value
    return None


def _strings(value):
    values = value if isinstance(value, (list, tuple)) else [value]
    return [item for candidate in values if (item := text(candidate))]


def _child(parent, name, value):
    node = ET.SubElement(parent, name)
    node.text = str(value)
    return node


def source_information(lineage, source):
    """Write one original source using citation, time and media productions."""
    values = _values(source)
    node = ET.SubElement(lineage, "srcinfo")
    cite = ET.SubElement(ET.SubElement(node, "srccite"), "citeinfo")
    origins = _strings(_first(values, "originators", "originator", "origin"))
    for origin in origins or ["Unknown"]:
        _child(cite, "origin", origin)
    publication = calendar_date(_first(values, "publication_date", "published_at", "pubdate"),
                                publication=True)
    _child(cite, "pubdate", publication)
    _child(cite, "title", source["title"])
    if source.get("vintage") is not None:
        _child(cite, "edition", source["vintage"])
    kind = text(values.get("kind"))
    form = {"raster": "raster digital data", "vector": "vector digital data",
            "table": "tabular digital data", "document": "document"}.get(kind)
    if form:
        _child(cite, "geoform", form)
    publisher = text(values.get("publisher"))
    if publisher:
        publication_info = ET.SubElement(cite, "pubinfo")
        _child(publication_info, "pubplace", text(values.get("publication_place")) or "Unknown")
        _child(publication_info, "publish", publisher)
    _child(cite, "othercit", "Original retained source declarations: " +
           json.dumps(values, ensure_ascii=False, sort_keys=True))
    for uri in _strings(source.get("uri")):
        _child(cite, "onlink", uri)
    media = text(_first(values, "source_media", "typesrc"))
    if not media:
        media = ("online" if not source.get("derivation") and
                 re.match(r"^https?://", str(source.get("uri", ""))) else "digital data")
    _child(node, "typesrc", media)
    period = ET.SubElement(node, "srctime")
    timing = ET.SubElement(period, "timeinfo")
    extent = _first(values, "observation_period", "temporal_extent", "time_period")
    extent = extent if isinstance(extent, dict) else {}
    start = _first(extent, "start", "start_date", "begin", "beginning_date")
    finish = _first(extent, "end", "end_date", "ending_date")
    current = text(_first(values, "source_currentness", "srccurr"))
    if start is not None or finish is not None:
        interval = ET.SubElement(timing, "rngdates")
        _child(interval, "begdate", calendar_date(start))
        _child(interval, "enddate", calendar_date(finish, ending=True))
        current = current or "Period declared in original source metadata; its ground-condition/publication reference was not supplied."
    else:
        original_date = _first(values, "content_date", "observation_date")
        content = calendar_date(original_date)
        if original_date is not None:
            current = current or "Date declared in original source metadata; its ground-condition/publication reference was not supplied."
        elif current and current.lower() == "publication date" and publication not in {"Unknown", "Unpublished material"}:
            content = publication
        else:
            current = current or ("Source content date not recorded. The original edition label is retained "
                                  "in the citation and is not assumed to be its publication or observation date.")
        _child(ET.SubElement(timing, "sngdate"), "caldate", content)
    _child(period, "srccurr", current)
    _child(node, "srccitea", source["id"])
    contribution = text(values.get("contribution")) or text(source.get("derivation")) or "Original retained input."
    _child(node, "srccontr", contribution + " Original source SHA256 " + source["sha256"])
    return node


def contact_information(parent, contact):
    """Retain actual contact details and make absent required values explicit."""
    contact = contact if isinstance(contact, dict) else {}
    info = ET.SubElement(parent, "cntinfo")
    person = text(_first(contact, "name", "person"))
    organization = text(contact.get("organization"))
    if person:
        primary = ET.SubElement(info, "cntperp")
        _child(primary, "cntper", person)
        if organization:
            _child(primary, "cntorg", organization)
    else:
        _child(ET.SubElement(info, "cntorgp"), "cntorg", organization or "Unknown")
    if text(contact.get("position")):
        _child(info, "cntpos", contact["position"])
    addresses = contact.get("addresses")
    if not isinstance(addresses, list) or not addresses:
        address = contact.get("address")
        addresses = [address if isinstance(address, dict) else {**contact, "address": address}]
    for address in addresses:
        address = address if isinstance(address, dict) else {"address": address}
        node = ET.SubElement(info, "cntaddr")
        _child(node, "addrtype", text(_first(address, "address_type", "type", "addrtype")) or "Unknown")
        for line in _strings(_first(address, "lines", "address")):
            _child(node, "address", line)
        for name, keys in (("city", ("city",)), ("state", ("state", "state_or_province")),
                           ("postal", ("postal_code", "postal", "zip"))):
            _child(node, name, text(_first(address, *keys)) or "Unknown")
        if text(address.get("country")):
            _child(node, "country", address["country"])
    voices = _strings(_first(contact, "phone", "telephone", "voice", "cntvoice"))
    for voice in voices or ["Unknown"]:
        _child(info, "cntvoice", voice)
    for key, tag in (("tdd", "cnttdd"), ("fax", "cntfax"), ("email", "cntemail")):
        for value in _strings(contact.get(key)):
            _child(info, tag, value)
    if text(contact.get("hours")):
        _child(info, "hours", contact["hours"])
    instructions = text(contact.get("instructions"))
    _child(info, "cntinst", (instructions + " " if instructions else "") +
           "Unknown in a required contact field means that detail was not supplied in the retained contact; "
           "it does not assert that the person or organization has no such contact method.")
    return info
