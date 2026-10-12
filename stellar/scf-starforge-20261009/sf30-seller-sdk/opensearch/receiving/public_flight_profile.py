# MIT. Exact public-flight request policy for the original OpenSearch bridge.
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import re
import threading
import time
from urllib.parse import parse_qsl, urlsplit

PROFILE_ID = "opensearch-public-flights-us-zero-v1"
ORIGIN = "https://playground.opensearch.org"
INDEX = "opensearch_dashboards_sample_data_flights"
FIELDS = ["FlightNum", "Origin", "Dest", "OriginCountry", "DestCountry",
          "AvgTicketPrice", "timestamp", "FlightDelay", "Cancelled"]
QUERY = {"bool": {"filter": [
    {"term": {"OriginCountry": "US"}},
    {"range": {"AvgTicketPrice": {"gte": 0}}},
]}}
SORT = [{"timestamp": "asc"}, {"FlightNum": "asc"},
        {"_index": "asc"}, {"_shard_doc": "asc"}]
FLAGS = {"allow_no_indices": "false", "ignore_unavailable": "false"}
KEEP_ALIVE = "45s"
CAT_PATH = "/_cat/indices/" + INDEX + "?format=json&h=index,docs.count&bytes=b"


class PublicFlightPolicyError(ValueError):
    """A request or response violated the fixed public-flight contract."""


def need(condition, message):
    if not condition:
        raise PublicFlightPolicyError(message)


def exact_keys(value, keys, optional=()):
    need(type(value) is dict and set(value).issubset(set(keys) | set(optional))
         and set(keys).issubset(value), "PUBLIC_FLIGHT_BODY_FIELDS")


def duplicate_free(pairs):
    result = {}
    for key, value in pairs:
        need(key not in result, "PUBLIC_FLIGHT_DUPLICATE_JSON_FIELD")
        result[key] = value
    return result


def json_body(body):
    need(isinstance(body, bytes) and 0 < len(body) <= 131072,
         "PUBLIC_FLIGHT_BODY_SIZE")
    try:
        return json.loads(body.decode("utf-8"), object_pairs_hook=duplicate_free,
                          parse_constant=lambda _: need(False, "PUBLIC_FLIGHT_JSON_NUMBER"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise PublicFlightPolicyError("PUBLIC_FLIGHT_JSON_REQUIRED") from error


def timeout(value):
    need(type(value) is str and re.fullmatch(r"[1-9][0-9]{0,4}ms", value)
         and int(value[:-2]) <= 30000, "PUBLIC_FLIGHT_TIMEOUT")


def opaque_id(value):
    need(type(value) is str and 0 < len(value) <= 65536
         and not re.search(r"[\x00-\x20\x7f]", value), "PUBLIC_FLIGHT_PIT_ID")
    return value


def cursor(value):
    need(type(value) is list and len(value) == 4
         and type(value[0]) is int
         and type(value[1]) is str and 0 < len(value[1]) <= 128
         and value[2] == INDEX
         and type(value[3]) is int, "PUBLIC_FLIGHT_CURSOR_SHAPE")
    return value


@dataclass
class Permit:
    kind: str
    request_sha256: str
    pit_id: str | None = None
    state: dict | None = None
    body: dict | None = None
    closed: bool = False


class PublicFlightProfile:
    """Permit exact public inputs and only provider-issued continuation values."""

    def __init__(self):
        self.lock = threading.Lock()
        self.pits = {}
        self.pending_creates = 0
        self.created = 0

    def describe(self):
        return {
            "schema": "stellar-forge.opensearch-public-egress.v1",
            "profile": PROFILE_ID,
            "origin": ORIGIN,
            "index": INDEX,
            "query": QUERY,
            "fields": FIELDS,
            "sort": SORT,
            "probe": {"country": "US", "minimum_price": 0},
            "capture": {"pageSizes": [2, 3], "retainedHitLimits": [6, 7],
                        "keepAlive": KEEP_ALIVE},
            "credentials": "anonymous-public-session-only",
            "continuations": "upstream-issued-pit-and-last-hit-sort",
            "sourceUrls": [
                "https://docs.opensearch.org/latest/getting-started/analyze-data/",
                "https://docs.opensearch.org/latest/dashboards/getting-started/data-setup/",
                "https://opensearch.org/blog/opensearch-playground/",
            ],
        }

    def begin(self, method, path, body=None):
        """Validate before constructing or opening the upstream request."""
        need(type(path) is str and len(path) <= 4096, "PUBLIC_FLIGHT_PATH")
        parsed = urlsplit(path)
        need(not parsed.scheme and not parsed.netloc and not parsed.fragment
             and parsed.path.startswith("/") and "%" not in parsed.path
             and "\\" not in parsed.path, "PUBLIC_FLIGHT_PATH")
        try:
            pairs = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True)
        except ValueError as error:
            raise PublicFlightPolicyError("PUBLIC_FLIGHT_QUERY_FIELDS") from error
        need(len(pairs) == len({key for key, _ in pairs}), "PUBLIC_FLIGHT_QUERY_FIELDS")
        params = dict(pairs)
        route = parsed.path
        sha = hashlib.sha256(body or b"").hexdigest()
        if method == "GET":
            need(body in (None, b""), "PUBLIC_FLIGHT_METADATA_BODY")
            if route == "/":
                need(not params, "PUBLIC_FLIGHT_ROOT_PARAMETERS")
            elif route == "/_cat/indices/" + INDEX:
                need(params == {"format": "json", "h": "index,docs.count", "bytes": "b"},
                     "PUBLIC_FLIGHT_INDEX_PARAMETERS")
            elif route == "/" + INDEX + "/_mapping":
                need(params in ({}, FLAGS), "PUBLIC_FLIGHT_MAPPING_PARAMETERS")
            elif route == "/" + INDEX + "/_field_caps":
                need(params == {**FLAGS, "include_unmapped": "true",
                                "fields": ",".join(FIELDS)},
                     "PUBLIC_FLIGHT_FIELDS_PARAMETERS")
            else:
                raise PublicFlightPolicyError("PUBLIC_FLIGHT_METADATA_ROUTE")
            return Permit("metadata", sha)
        if method == "POST" and route == "/" + INDEX + "/_search":
            need(params == {**FLAGS, "allow_partial_search_results": "false"},
                 "PUBLIC_FLIGHT_PROBE_PARAMETERS")
            value = json_body(body)
            exact_keys(value, ("query", "size", "_source", "track_total_hits", "timeout"))
            need(value["query"] == QUERY
                 and type(value["query"]["bool"]["filter"][1]["range"]["AvgTicketPrice"]["gte"]) is int
                 and type(value["size"]) is int
                 and value["size"] == 0 and value["_source"] is False
                 and type(value["track_total_hits"]) is int
                 and value["track_total_hits"] == 1, "PUBLIC_FLIGHT_PROBE")
            timeout(value["timeout"])
            return Permit("probe", sha)
        if method == "POST" and route == "/" + INDEX + "/_search/point_in_time":
            need(params == {**FLAGS, "keep_alive": KEEP_ALIVE,
                            "allow_partial_pit_creation": "false"},
                 "PUBLIC_FLIGHT_CREATE_PARAMETERS")
            need(body in (None, b""), "PUBLIC_FLIGHT_CREATE_BODY")
            with self.lock:
                self._prune()
                need(len({id(state) for state in self.pits.values()})
                     + self.pending_creates < 4 and self.created < 128,
                     "PUBLIC_FLIGHT_SNAPSHOT_CAPACITY")
                self.pending_creates += 1
                self.created += 1
            return Permit("create", sha)
        if method == "POST" and route == "/_search":
            need(params == {"allow_partial_search_results": "false"},
                 "PUBLIC_FLIGHT_SEARCH_PARAMETERS")
            value = json_body(body)
            exact_keys(value, ("query", "pit", "sort", "size", "track_total_hits",
                               "_source", "timeout"), ("search_after",))
            need(value["query"] == QUERY
                 and type(value["query"]["bool"]["filter"][1]["range"]["AvgTicketPrice"]["gte"]) is int
                 and value["sort"] == SORT
                 and value["_source"] == {"includes": FIELDS},
                 "PUBLIC_FLIGHT_FIXED_SEARCH")
            exact_keys(value["pit"], ("id", "keep_alive"))
            pit = opaque_id(value["pit"]["id"])
            need(value["pit"]["keep_alive"] == KEEP_ALIVE, "PUBLIC_FLIGHT_KEEP_ALIVE")
            need(type(value["size"]) is int and 1 <= value["size"] <= 3
                 and type(value["track_total_hits"]) is int
                 and value["track_total_hits"] in (7, 8), "PUBLIC_FLIGHT_SEARCH_BUDGET")
            timeout(value["timeout"])
            with self.lock:
                state = self.pits.get(pit)
                need(state is not None and state["current"] == pit
                     and state["expires"] > time.monotonic()
                     and not state["busy"] and not state["failed"],
                     "PUBLIC_FLIGHT_OWNED_PIT_REQUIRED")
                if state["cursor"] is None:
                    need("search_after" not in value and value["size"] in (2, 3),
                         "PUBLIC_FLIGHT_FIRST_PAGE")
                else:
                    need("search_after" in value
                         and cursor(value["search_after"]) == state["cursor"],
                         "PUBLIC_FLIGHT_OBSERVED_CURSOR_REQUIRED")
                    need(value["track_total_hits"] == state["limit"]
                         and value["size"] == min(state["page_size"],
                                                state["limit"] - state["hits"]),
                         "PUBLIC_FLIGHT_PAGE_BUDGET")
                need(state["pages"] < 8, "PUBLIC_FLIGHT_PAGE_LIMIT")
                state["busy"] = True
            return Permit("search", sha, pit, state, value)
        if method == "DELETE" and route == "/_search/point_in_time":
            need(not params, "PUBLIC_FLIGHT_DELETE_PARAMETERS")
            value = json_body(body)
            exact_keys(value, ("pit_id",))
            need(type(value["pit_id"]) is list and len(value["pit_id"]) == 1,
                 "PUBLIC_FLIGHT_SINGLE_SNAPSHOT_RELEASE")
            pit = opaque_id(value["pit_id"][0])
            with self.lock:
                state = self.pits.get(pit)
                need(state is not None and not state["busy"],
                     "PUBLIC_FLIGHT_OWNED_RELEASE_REQUIRED")
                state["busy"] = True
            return Permit("delete", sha, pit, state, value)
        raise PublicFlightPolicyError("PUBLIC_FLIGHT_ROUTE_REJECTED")

    def _prune(self):
        expired = [key for key, value in self.pits.items()
                   if not value["busy"] and value["expires"] + 60 < time.monotonic()]
        for key in expired:
            del self.pits[key]

    def observe(self, permit, status, raw):
        """Accept continuation state only from this exact upstream response."""
        if permit.kind in ("metadata", "probe") or status != 200:
            return
        value = json_body(raw)
        with self.lock:
            if permit.kind == "create":
                pit = opaque_id(value.get("pit_id"))
                need(pit not in self.pits, "PUBLIC_FLIGHT_DUPLICATE_UPSTREAM_PIT")
                self.pits[pit] = {
                    "current": pit, "expires": time.monotonic() + 45,
                    "cursor": None, "busy": False, "failed": False,
                    "limit": None, "page_size": None, "hits": 0, "pages": 0,
                }
            elif permit.kind == "search":
                state = permit.state
                hit_block = value.get("hits")
                need(type(hit_block) is dict and type(hit_block.get("hits")) is list,
                     "PUBLIC_FLIGHT_UPSTREAM_HITS")
                hits = hit_block["hits"]
                need(len(hits) <= permit.body["size"], "PUBLIC_FLIGHT_UPSTREAM_PAGE_SIZE")
                for hit in hits:
                    need(type(hit) is dict and hit.get("_index") == INDEX,
                         "PUBLIC_FLIGHT_UPSTREAM_INDEX")
                    cursor(hit.get("sort"))
                updated = opaque_id(value.get("pit_id", permit.pit_id))
                need(updated == permit.pit_id or updated not in self.pits,
                     "PUBLIC_FLIGHT_UPSTREAM_PIT_COLLISION")
                state["limit"] = permit.body["track_total_hits"]
                if state["page_size"] is None:
                    state["page_size"] = permit.body["size"]
                state["hits"] += len(hits)
                state["pages"] += 1
                need(state["hits"] <= state["limit"], "PUBLIC_FLIGHT_UPSTREAM_HIT_LIMIT")
                state["cursor"] = hits[-1]["sort"] if hits else state["cursor"]
                state["expires"] = time.monotonic() + 45
                state["current"] = updated
                self.pits[updated] = state
                if updated != permit.pit_id:
                    del self.pits[permit.pit_id]
            elif permit.kind == "delete":
                pits = value.get("pits")
                if type(pits) is list and any(type(item) is dict
                        and item.get("pit_id") == permit.pit_id
                        and item.get("successful") is True for item in pits):
                    for key, state in list(self.pits.items()):
                        if state is permit.state:
                            del self.pits[key]

    def finish(self, permit, failed=False):
        with self.lock:
            if permit.closed:
                return
            permit.closed = True
            if permit.kind == "create":
                self.pending_creates -= 1
            if permit.state is not None:
                permit.state["busy"] = False
                if failed and permit.kind == "search":
                    permit.state["failed"] = True

