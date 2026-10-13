"""Generate the JSON-LD context from the JSON Schema.

The context is derived, never hand-edited. Every term maps to an IRI the
schema already declared, so the schema stays the single source of truth and
the two artefacts cannot drift apart.
"""

from __future__ import annotations

from .audit import binding_of, resolve_term, term_bindings
from .schema import ClassDef

DECLARED = "declared"
OBSERVED = "observed"


def _term_definition(binding: tuple, lenient_terms: set[str] | None, term: str) -> dict | str:
    iri, coercion, container = binding
    if lenient_terms and term in lenient_terms and coercion == "@id":
        coercion = None
    definition: dict = {"@id": iri}
    if coercion:
        definition["@type"] = coercion
    if container:
        definition["@container"] = container
    if list(definition) == ["@id"]:
        return iri
    return definition


def build_context(
    classes: dict[str, ClassDef],
    namespaces: dict[str, str],
    lenient_terms: set[str] | None = None,
) -> dict:
    ctx: dict = {"@version": 1.1}
    ctx.update({prefix: iri for prefix, iri in sorted(namespaces.items())})

    scoped: dict[str, dict] = {name: {} for name in classes}
    bindings = term_bindings(classes)
    terms: dict[str, object] = {}

    for term, owners in sorted(bindings.items()):
        dominant, overrides = resolve_term(owners)
        terms[term] = _term_definition(dominant, lenient_terms, term)
        for cls_name, binding in overrides.items():
            scoped[cls_name][term] = _term_definition(binding, lenient_terms, term)

    for cls in sorted(classes.values(), key=lambda c: c.name):
        if not cls.rdf_class:
            continue
        if scoped[cls.name]:
            ctx[cls.name] = {"@id": cls.rdf_class, "@context": dict(sorted(scoped[cls.name].items()))}
        else:
            ctx[cls.name] = cls.rdf_class

    ctx.update(dict(sorted(terms.items())))
    return {"@context": ctx}


def context_stats(context: dict) -> dict:
    ctx = context["@context"]
    scoped = {k: v for k, v in ctx.items() if isinstance(v, dict) and "@context" in v}
    return {
        "terms": sum(1 for k in ctx if not k.startswith("@")),
        "typeScopedClasses": sorted(scoped),
        "scopedOverrides": sum(len(v["@context"]) for v in scoped.values()),
        "idCoerced": sum(1 for v in ctx.values() if isinstance(v, dict) and v.get("@type") == "@id"),
        "datatypeCoerced": sum(
            1 for v in ctx.values()
            if isinstance(v, dict) and isinstance(v.get("@type"), str) and v["@type"].startswith("xsd:")
        ),
        "setContainers": sum(1 for v in ctx.values() if isinstance(v, dict) and v.get("@container") == "@set"),
    }
