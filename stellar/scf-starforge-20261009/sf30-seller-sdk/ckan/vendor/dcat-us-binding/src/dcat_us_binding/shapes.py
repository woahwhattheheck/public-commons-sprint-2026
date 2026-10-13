"""Generate SHACL shapes from the same JSON Schema the context comes from.

This is the whole argument for generation in one file. The shapes and the
context are two projections of one source, so they cannot contradict each
other. The question 'which of the two artefacts is authoritative' stops
being answerable, because neither is: the schema is.
"""

from __future__ import annotations

from .schema import ClassDef, Property

SHAPES_PREFIX = "shp"
LITERAL_RANGES = {"rdfs:Literal"}
ANY_RESOURCE = {"rdfs:Resource"}


def _range_head(range_text: str | None) -> str | None:
    """The CURIE at the front of a range, ignoring any prose after it."""
    if not range_text:
        return None
    head = range_text.strip().split()[0].strip("(),.")
    return head if ":" in head else None


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\r", "")


def _constraints(prop: Property, known_classes: set[str]) -> list[str]:
    out = [f"sh:path {prop.iri}"]
    if prop.title:
        out.append(f'sh:name "{_escape(prop.title)}"')
    if prop.description:
        out.append(f'sh:description "{_escape(prop.description)}"')

    head = _range_head(prop.range)
    datatype = prop.declared_datatype

    if prop.range_is_resource:
        if head in ANY_RESOURCE or head is None:
            out.append("sh:nodeKind sh:IRI")
        elif head in known_classes or (head and head.split(":")[-1][:1].isupper()):
            out.append("sh:nodeKind sh:BlankNodeOrIRI")
            out.append(f"sh:class {head}")
        else:
            out.append("sh:nodeKind sh:BlankNodeOrIRI")
    elif datatype:
        out.append(f"sh:datatype {datatype}")
    else:
        out.append("sh:nodeKind sh:Literal")

    if prop.requirement_level == "Mandatory":
        out.append("sh:minCount 1")
    if not prop.is_list:
        out.append("sh:maxCount 1")
    if prop.requirement_level:
        out.append(f'sh:severity {"sh:Violation" if prop.requirement_level == "Mandatory" else "sh:Warning"}')
    return out


def build_shapes(classes: dict[str, ClassDef], namespaces: dict[str, str], shapes_base: str) -> str:
    known = {c.rdf_class for c in classes.values() if c.rdf_class}
    lines: list[str] = []
    for prefix, iri in sorted(namespaces.items()):
        lines.append(f"@prefix {prefix}: <{iri}> .")
    lines.append(f"@prefix {SHAPES_PREFIX}: <{shapes_base}> .")
    lines.append("@prefix sh: <http://www.w3.org/ns/shacl#> .")
    lines.append("")
    lines.append(f"<{shapes_base.rstrip('#')}>")
    lines.append("    a <http://www.w3.org/2002/07/owl#Ontology> ;")
    lines.append('    <http://purl.org/dc/terms/title> "DCAT-US 3.0 generated SHACL shapes" ;')
    lines.append(
        '    <http://purl.org/dc/terms/description> "Generated from the DCAT-US 3.0 JSON Schema '
        'definitions. Do not edit by hand: edit the schema and regenerate." .'
    )
    lines.append("")

    for cls in sorted(classes.values(), key=lambda c: c.name):
        if not cls.rdf_class:
            continue
        bound = [p for p in cls.properties.values() if p.bound]
        if not bound:
            continue
        lines.append(f"{SHAPES_PREFIX}:{cls.name}Shape")
        lines.append("    a sh:NodeShape ;")
        lines.append(f"    sh:targetClass {cls.rdf_class} ;")
        if cls.title:
            lines.append(f'    sh:name "{_escape(cls.title)}" ;')
        if cls.description:
            lines.append(f'    sh:description "{_escape(cls.description)}" ;')
        for index, prop in enumerate(sorted(bound, key=lambda p: p.name)):
            body = " ;\n        ".join(_constraints(prop, known))
            terminator = " ;" if index < len(bound) - 1 else " ."
            lines.append(f"    sh:property [\n        {body} ;\n    ]{terminator}")
        lines.append("")
    return "\n".join(lines) + "\n"
