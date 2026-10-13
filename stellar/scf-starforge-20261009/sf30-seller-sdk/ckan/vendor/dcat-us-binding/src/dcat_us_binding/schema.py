"""Read the DCAT-US 3.0 JSON Schema as the single source of truth.

Nothing in this module invents RDF. Every IRI it returns was already written
into the schema by the DCAT-US maintainers, in the `_oldDocs` blocks that were
carried over when the SHACL definition was retired.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

# Ranges are prose in places, so a declared range is matched by prefix.
LITERAL_RANGE_PREFIXES = ("rdfs:Literal", "xsd:")
ANY_RESOURCE_RANGES = {"rdfs:Resource"}


@dataclass(frozen=True)
class Property:
    name: str
    owner: str
    iri: str | None
    range: str | None
    requirement_level: str | None
    json_types: tuple[str, ...]
    is_list: bool
    ref: str | None
    title: str | None
    description: str | None

    @property
    def bound(self) -> bool:
        return self.iri is not None

    @property
    def range_is_literal(self) -> bool:
        if not self.range:
            return False
        return self.range.startswith(LITERAL_RANGE_PREFIXES)

    @property
    def range_is_resource(self) -> bool:
        if not self.range:
            return False
        return not self.range_is_literal

    @property
    def declared_datatype(self) -> str | None:
        """A single xsd datatype, only when the schema names exactly one.

        `rdfs:Literal (typed as xsd:date, xsd:dateTime, xsd:gYear or
        xsd:gYearMonth)` names four and is deliberately not coerced.
        """
        if not self.range:
            return None
        hits = sorted({t for t in _xsd_tokens(self.range)})
        if len(hits) == 1:
            return hits[0]
        return None


def _xsd_tokens(text: str) -> list[str]:
    out, cursor = [], 0
    while True:
        i = text.find("xsd:", cursor)
        if i == -1:
            return out
        j = i + 4
        while j < len(text) and (text[j].isalnum() or text[j] in "_-"):
            j += 1
        out.append(text[i:j])
        cursor = j


@dataclass(frozen=True)
class ClassDef:
    name: str
    rdf_class: str | None
    title: str | None
    description: str | None
    required: tuple[str, ...]
    default_type: str | None
    properties: dict[str, Property] = field(default_factory=dict)


def _walk_ref(node: dict) -> str | None:
    """Find the definition a property points at, through arrays and anyOf."""
    if not isinstance(node, dict):
        return None
    if "$ref" in node:
        return str(node["$ref"]).rstrip("/").split("/")[-1]
    for key in ("items", "contains"):
        if key in node:
            found = _walk_ref(node[key])
            if found:
                return found
    for key in ("anyOf", "oneOf", "allOf"):
        for branch in node.get(key, []):
            found = _walk_ref(branch)
            if found:
                return found
    return None


def _json_types(node: dict) -> tuple[tuple[str, ...], bool]:
    raw = node.get("type")
    types: list[str] = []
    if isinstance(raw, str):
        types = [raw]
    elif isinstance(raw, list):
        types = [t for t in raw if isinstance(t, str)]
    is_list = "array" in types
    if not types:
        for key in ("anyOf", "oneOf"):
            for branch in node.get(key, []):
                sub, sub_list = _json_types(branch)
                types.extend(sub)
                is_list = is_list or sub_list
    return tuple(dict.fromkeys(t for t in types if t != "null")), is_list


def _property_blocks(raw: dict) -> tuple[dict, tuple[str, ...]]:
    """Collect declared properties, including those inside anyOf/oneOf branches.

    Concept and Identifier accept either a bare string or an object, so their
    properties live one level down in `anyOf`. Reading only the top level
    silently drops the two most frequently instantiated classes in the
    example corpus.
    """
    props: dict = dict(raw.get("properties") or {})
    required: list[str] = list(raw.get("required") or ())
    for key in ("anyOf", "oneOf", "allOf"):
        for branch in raw.get(key, []):
            if not isinstance(branch, dict):
                continue
            for prop_name, node in (branch.get("properties") or {}).items():
                props.setdefault(prop_name, node)
            required.extend(branch.get("required") or ())
    return props, tuple(dict.fromkeys(required))


def load_classes(definitions_dir: Path) -> dict[str, ClassDef]:
    classes: dict[str, ClassDef] = {}
    for path in sorted(Path(definitions_dir).glob("*.json")):
        raw = json.loads(path.read_text())
        name = path.stem
        old = raw.get("_oldDocs") or {}
        declared, required = _property_blocks(raw)
        props: dict[str, Property] = {}
        for prop_name, node in declared.items():
            if prop_name.startswith("@"):
                continue
            prop_old = node.get("_oldDocs") or {}
            json_types, is_list = _json_types(node)
            props[prop_name] = Property(
                name=prop_name,
                owner=name,
                iri=prop_old.get("uri"),
                range=prop_old.get("range"),
                requirement_level=node.get("requirementLevel"),
                json_types=json_types,
                is_list=is_list,
                ref=_walk_ref(node),
                title=node.get("title"),
                description=node.get("description"),
            )
        type_node = declared.get("@type") or {}
        classes[name] = ClassDef(
            name=name,
            rdf_class=old.get("rdfClass"),
            title=raw.get("title"),
            description=raw.get("description"),
            required=required,
            default_type=type_node.get("default"),
            properties=props,
        )
    return classes


def load_namespaces(path: Path) -> dict[str, str]:
    raw = json.loads(Path(path).read_text())
    return {k: v["iri"] for k, v in raw["prefixes"].items()}


def load_namespace_records(path: Path) -> dict[str, dict]:
    return json.loads(Path(path).read_text())["prefixes"]


def expand(curie: str, namespaces: dict[str, str]) -> str | None:
    """Expand a prefixed name. Returns None when the prefix is not declared."""
    if not curie or "://" in curie:
        return curie or None
    if ":" not in curie:
        return None
    prefix, local = curie.split(":", 1)
    base = namespaces.get(prefix)
    return f"{base}{local}" if base else None
