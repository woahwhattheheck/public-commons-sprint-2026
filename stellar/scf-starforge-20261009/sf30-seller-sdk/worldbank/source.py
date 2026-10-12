#!/usr/bin/env python3
"""World Bank V2 source semantics for the maintained Starforge merchant. MIT."""
from __future__ import annotations

import datetime as dt
import email.utils
import hashlib
import json
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

API = "https://api.worldbank.org/v2"
SOURCE_SCHEMA = "stellar-forge.worldbank-selection.v1"
NUMBER = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?\Z")
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,95}\Z")
MAX_PAGE_BYTES = 32 * 1024 * 1024


class SourceError(Exception):
    def __init__(self, code: str, message: str, **details: Any):
        super().__init__(message)
        self.code, self.details = code, details

    def public(self) -> dict:
        return {"code": self.code, "message": str(self), **self.details}


class NumericToken(str):
    """A JSON number's original lexical representation, without float conversion."""


def utc() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def encode(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode("utf-8")


def identity(value: Any) -> str:
    return digest(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8"))


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise SourceError("DUPLICATE_JSON_KEY", "The source response repeats a JSON object key.", key=key)
        value[key] = item
    return value


def parse_source(raw: bytes):
    try:
        return json.loads(raw.decode("utf-8-sig"), parse_float=NumericToken,
                          parse_int=NumericToken, object_pairs_hook=unique_object,
                          parse_constant=lambda token: (_ for _ in ()).throw(ValueError(token)))
    except (UnicodeError, ValueError) as exc:
        raise SourceError("SOURCE_JSON", "The original response is not valid UTF-8 JSON.") from exc


def whole(value, field: str, minimum=0, maximum=1_000_000_000) -> int:
    if value is None or isinstance(value, bool) or not re.fullmatch(r"0|[1-9][0-9]*", str(value)):
        raise SourceError("SOURCE_PAGINATION", "The response has an invalid " + field + ".")
    result = int(value)
    if result < minimum or result > maximum:
        raise SourceError("SOURCE_PAGINATION", "The response has an unsupported " + field + ".")
    return result


def clean_text(value: Any, name: str, *, maximum=20000, allow_empty=True) -> str:
    if not isinstance(value, str) or isinstance(value, NumericToken):
        raise SourceError("SOURCE_FIELD", "The response needs a text " + name + ".")
    if len(value) > maximum or "\x00" in value or (not allow_empty and not value):
        raise SourceError("SOURCE_FIELD", "The response has an invalid " + name + ".")
    return value


def selection(value: Any) -> dict:
    if not isinstance(value, dict) or set(value) - {"schema", "sourceId", "countries", "indicators", "date", "perPage"}:
        raise SourceError("SELECTION", "Choose sourceId, countries, indicators, date and perPage.")
    source = str(value.get("sourceId", "2"))
    if not re.fullmatch(r"[1-9][0-9]{0,7}", source):
        raise SourceError("SELECTION_SOURCE", "Choose the original numeric World Bank source ID.")
    countries = value.get("countries")
    indicators = value.get("indicators")
    if not isinstance(countries, list) or not countries or len(countries) > 300:
        raise SourceError("SELECTION_COUNTRIES", "Choose country or aggregate codes, or the single value all.")
    if countries == ["all"] or countries == ["ALL"]:
        countries = ["all"]
    else:
        if any(not isinstance(item, str) or not re.fullmatch(r"[A-Za-z0-9]{2,3}", item) for item in countries):
            raise SourceError("SELECTION_COUNTRIES", "Use the source's two- or three-character country and aggregate codes.")
        countries = sorted(set(item.upper() for item in countries))
    if not isinstance(indicators, list) or not 1 <= len(indicators) <= 60 or any(
        not isinstance(item, str) or not IDENTIFIER.fullmatch(item) for item in indicators
    ):
        raise SourceError("SELECTION_INDICATORS", "Choose 1–60 original indicator codes from the selected source.")
    indicators = sorted(set(item.upper() for item in indicators))
    period = value.get("date", "")
    # Explicit, comparable windows. The UI keeps annual, monthly and quarterly periods separate.
    match = re.fullmatch(r"([0-9]{4}(?:(?:M(?:0[1-9]|1[0-2]))|(?:Q[1-4]))?)(?::([0-9]{4}(?:(?:M(?:0[1-9]|1[0-2]))|(?:Q[1-4]))?))?", period) if isinstance(period, str) else None
    if not match:
        raise SourceError("SELECTION_DATE", "Use an explicit year, month, quarter or matching range, such as 2018:2024.")
    start, end = match[1], match[2] or match[1]
    if len(start) != len(end) or start > end:
        raise SourceError("SELECTION_DATE", "Use an ordered date range with one consistent frequency.")
    per_page = value.get("perPage", 1000)
    if isinstance(per_page, bool) or not isinstance(per_page, int) or not 1 <= per_page <= 10000:
        raise SourceError("SELECTION_PAGE", "Choose an integer page size from 1 to 10,000.")
    result = {"schema": SOURCE_SCHEMA, "sourceId": source, "countries": countries,
              "indicators": indicators, "date": period, "perPage": per_page}
    for part in (";".join(countries), ";".join(indicators)):
        if len(part) > 1500:
            raise SourceError("SELECTION_URL", "The selected codes exceed the source's 1,500-character URL-segment limit.")
    url_for(result, "data", 1)
    return result


def url_for(spec: dict, kind: str, page: int, indicator_id: str | None = None) -> str:
    page = whole(page, "page", 1)
    if indicator_id is not None:
        if kind != "indicators" or not isinstance(indicator_id, str) or indicator_id.upper() not in spec["indicators"]:
            raise SourceError("SOURCE_INDICATOR", "Choose one original indicator from this saved selection.")
        indicator_id = indicator_id.upper()
    countries = ";".join(spec["countries"])
    indicators = ";".join(spec["indicators"])
    params = {"format": "json", "page": str(page), "per_page": str(spec["perPage"])}
    if kind == "data":
        path = "/country/" + countries + "/indicator/" + indicators
        params.update(source=spec["sourceId"], date=spec["date"], footnote="y")
    elif kind == "countries":
        path = "/country/" + countries
    elif kind == "indicators":
        # The native metadata endpoint needs one indicator at a time. A null
        # indicator_id is retained for importing an earlier combined response.
        path = "/indicator/" + (indicator_id if indicator_id is not None else indicators)
        params["source"] = spec["sourceId"]
    elif kind == "sources":
        path = "/source/" + spec["sourceId"]
    else:
        raise SourceError("SOURCE_KIND", "Unsupported original source collection.")
    url = API + path + "?" + urllib.parse.urlencode(params)
    if len(url) > 4000:
        raise SourceError("SELECTION_URL", "The request exceeds the source's 4,000-character URL limit.")
    return url


def catalog_url(kind: str, page: int, source_id="2") -> str:
    paths = {"countries": "/country", "sources": "/source", "indicators": "/indicator"}
    if kind not in paths:
        raise SourceError("CATALOG_KIND", "Choose countries, sources or indicators.")
    params = {"format": "json", "per_page": "1000", "page": str(whole(page, "page", 1))}
    if kind == "indicators":
        if not re.fullmatch(r"[1-9][0-9]{0,7}", str(source_id)):
            raise SourceError("SELECTION_SOURCE", "Use a numeric source ID.")
        params["source"] = str(source_id)
    return API + paths[kind] + "?" + urllib.parse.urlencode(params)


def same_request(actual: str, expected: str) -> bool:
    """Accept equivalent query ordering while retaining the original request URL."""
    def parts(value):
        if not isinstance(value, str):
            return None
        parsed = urllib.parse.urlsplit(value)
        if (parsed.scheme != "https" or parsed.hostname != "api.worldbank.org"
                or parsed.port not in (None, 443) or parsed.username or parsed.password or parsed.fragment):
            return None
        query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True)
        if len({key for key, _ in query}) != len(query):
            return None
        return urllib.parse.unquote(parsed.path), sorted(query)
    try:
        left, right = parts(actual), parts(expected)
        return left is not None and left == right
    except (ValueError, UnicodeError):
        return False


class SameSourceRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        parsed = urllib.parse.urlsplit(newurl)
        if parsed.scheme != "https" or parsed.hostname != "api.worldbank.org" or parsed.port not in (None, 443) or parsed.username or parsed.password:
            raise SourceError("SOURCE_REDIRECT", "The World Bank request redirected outside its original HTTPS host.")
        return super().redirect_request(request, fp, code, msg, headers, newurl)


def retry_at(header: str | None) -> str | None:
    if not header:
        return None
    try:
        if re.fullmatch(r"[0-9]+", header.strip()):
            value = dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=int(header.strip()))
        else:
            value = email.utils.parsedate_to_datetime(header)
            if value.tzinfo is None:
                value = value.replace(tzinfo=dt.timezone.utc)
        return value.astimezone(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    except (ValueError, TypeError, OverflowError):
        return None


def request_page(url: str, timeout=45) -> tuple[bytes, dict]:
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname != "api.worldbank.org" or not parsed.path.startswith("/v2/") or parsed.username or parsed.password:
        raise SourceError("SOURCE_URL", "Only the original World Bank V2 HTTPS endpoint is supported.")
    opener = urllib.request.build_opener(SameSourceRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    request = urllib.request.Request(url, headers={
        "Accept": "application/json", "Accept-Encoding": "identity",
        "User-Agent": "Starforge-WorldBank/1.0 (+https://github.com/woahwhattheheck/public-commons-sprint-2026)",
    })
    started = utc()
    try:
        response = opener.open(request, timeout=timeout)
    except urllib.error.HTTPError as exc:
        raw = exc.read(MAX_PAGE_BYTES + 1)
        headers = dict(exc.headers.items())
        raise SourceError("SOURCE_HTTP", "World Bank returned HTTP " + str(exc.code) + ".",
                          httpStatus=exc.code, url=url, retryAt=retry_at(exc.headers.get("Retry-After")),
                          responseSha256=digest(raw), responseBytes=len(raw)) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise SourceError("SOURCE_TRANSPORT", "The original World Bank request could not complete.",
                          url=url, detail=str(exc)) from exc
    with response:
        raw = response.read(MAX_PAGE_BYTES + 1)
        if len(raw) > MAX_PAGE_BYTES:
            raise SourceError("SOURCE_SIZE", "The original response exceeds 32 MiB. Choose a smaller source page size.")
        if response.headers.get("Content-Encoding", "identity").lower() not in ("identity", ""):
            raise SourceError("SOURCE_ENCODING", "The source returned an unexpected compressed representation.")
        metadata = {"url": url, "finalUrl": response.geturl(), "status": response.status,
                    "startedAt": started, "receivedAt": utc(), "headers": dict(response.headers.items()),
                    "sha256": digest(raw), "bytes": len(raw)}
    return raw, metadata


def envelope(raw: bytes, expected_page: int, expected: dict | None = None) -> tuple[dict, list]:
    value = parse_source(raw)
    if isinstance(value, list) and value and isinstance(value[0], dict) and "message" in value[0]:
        raise SourceError("SOURCE_API", "The World Bank API rejected the original selection.",
                          sourceMessages=value[0]["message"])
    if not isinstance(value, list) or len(value) != 2 or not isinstance(value[0], dict) or (value[1] is not None and not isinstance(value[1], list)):
        raise SourceError("SOURCE_ENVELOPE", "Expected the original World Bank metadata and record array.")
    meta, rows = value[0], value[1] or []
    required = ("page", "pages", "per_page", "total")
    if any(key not in meta for key in required):
        raise SourceError("SOURCE_PAGINATION", "The original response omits pagination metadata.")
    normalized = {"page": whole(meta["page"], "page", 1),
                  "pages": whole(meta["pages"], "pages"),
                  "perPage": whole(meta["per_page"], "per_page", 1),
                  "total": whole(meta["total"], "total"),
                  "sourceId": None if meta.get("sourceid") is None else str(meta["sourceid"]),
                  "lastUpdated": None if meta.get("lastupdated") is None else str(meta["lastupdated"])}
    if normalized["page"] != expected_page or len(rows) > normalized["perPage"]:
        raise SourceError("SOURCE_PAGE_ID", "The response does not match the requested original page.")
    if normalized["total"] == 0:
        if rows or normalized["pages"] not in (0, 1) or expected_page != 1:
            raise SourceError("SOURCE_PAGINATION", "The empty population has inconsistent original pagination.")
    elif normalized["pages"] != (normalized["total"] + normalized["perPage"] - 1) // normalized["perPage"]:
        raise SourceError("SOURCE_PAGINATION", "The original page count differs from its total and page size.")
    if normalized["total"] and (not rows or expected_page > normalized["pages"]):
        raise SourceError("SOURCE_PAGINATION", "The original continuation ends before its declared population.")
    if expected:
        fields = ("pages", "perPage", "total", "sourceId", "lastUpdated")
        if any(normalized[key] != expected[key] for key in fields):
            raise SourceError("SOURCE_CHANGED", "The source population changed between pages. Retain this capture and start a new capture.",
                              previous={key: expected[key] for key in fields},
                              current={key: normalized[key] for key in fields})
    if any(not isinstance(row, dict) for row in rows):
        raise SourceError("SOURCE_RECORD", "A source record is not a JSON object.")
    return normalized, rows


def normalize_observation(row: dict, spec: dict, page: int, position: int, countries: dict) -> dict:
    country, indicator = row.get("country"), row.get("indicator")
    if not isinstance(country, dict) or not isinstance(indicator, dict):
        raise SourceError("SOURCE_OBSERVATION", "The original observation needs country and indicator identities.")
    country_id = clean_text(country.get("id"), "country id", maximum=20, allow_empty=False)
    indicator_id = clean_text(indicator.get("id"), "indicator id", maximum=96, allow_empty=False)
    iso3 = clean_text(row.get("countryiso3code", ""), "country ISO/WB code", maximum=20)
    period = clean_text(row.get("date"), "period", maximum=40, allow_empty=False)
    if indicator_id.upper() not in spec["indicators"]:
        raise SourceError("SOURCE_OBSERVATION_SCOPE", "An observation belongs to an unselected indicator.")
    if spec["countries"] != ["all"] and country_id.upper() not in spec["countries"] and iso3.upper() not in spec["countries"]:
        raise SourceError("SOURCE_OBSERVATION_SCOPE", "An observation belongs to an unselected country or aggregate.")
    lower, _, upper = spec["date"].partition(":")
    upper = upper or lower
    if len(period) != len(lower) or not lower <= period <= upper:
        raise SourceError("SOURCE_OBSERVATION_SCOPE", "An observation lies outside the selected period.")
    value = row.get("value")
    if value is not None and (not isinstance(value, NumericToken) or not NUMBER.fullmatch(value)):
        raise SourceError("SOURCE_VALUE", "The original observation value must be a JSON number or null.")
    reference = countries.get(country_id.upper()) or countries.get(iso3.upper())
    if reference is None:
        raise SourceError("SOURCE_COUNTRY_METADATA", "No retained country metadata matches the original observation.", country=country_id)
    region = reference.get("region") if isinstance(reference.get("region"), dict) else {}
    key = identity([spec["sourceId"], country_id, iso3, indicator_id, period])
    output = {
        "key": key, "rowId": f"{page}:{position}", "source_id": spec["sourceId"],
        "country_id": country_id, "country_iso3": iso3,
        "country_name": clean_text(country.get("value", ""), "country name"),
        "indicator_id": indicator_id, "indicator_name": clean_text(indicator.get("value", ""), "indicator name"),
        "period": period, "value": None if value is None else str(value),
        "value_state": "missing" if value is None else "present",
        "unit": clean_text(row.get("unit", ""), "unit"),
        "obs_status": clean_text(row.get("obs_status", ""), "observation status"),
        "decimal": str(row.get("decimal", "")),
        "footnote": clean_text(row.get("footnote", "") or "", "footnote", maximum=100000),
        "region": str(region.get("value", "")),
        "aggregate": str(region.get("id", "")) == "NA",
        "source_page": page, "source_row": position,
    }
    output["contentSha256"] = identity({key: value for key, value in output.items()
                                       if key not in ("rowId", "source_page", "source_row")})
    return output

