"""Report what the schema says about itself, before generating anything.

Two artefacts share every property name in DCAT-US: the JSON key and the RDF
property it stands for. A generator has to reconcile them, and the act of
reconciling exposes places where the schema disagrees with itself. Those
disagreements are recorded here rather than silently resolved.
"""

from __future__ import annotations

from collections import Counter, defaultdict

from .schema import ClassDef, Property, expand


def binding_of(prop: Property) -> tuple[str | None, str | None, str | None]:
    """The (iri, coercion, container) triple a property declares."""
    if prop.iri is None:
        return (None, None, None)
    if prop.range_is_resource:
        coercion = "@id"
    else:
        coercion = prop.declared_datatype
    container = "@set" if prop.is_list else None
    return (prop.iri, coercion, container)


def term_bindings(classes: dict[str, ClassDef]) -> dict[str, dict[str, tuple]]:
    """term -> {owning class -> binding}, bound properties only."""
    out: dict[str, dict[str, tuple]] = defaultdict(dict)
    for cls in classes.values():
        for prop in cls.properties.values():
            if prop.bound:
                out[prop.name][cls.name] = binding_of(prop)
    return dict(out)


def resolve_term(owners: dict[str, tuple]) -> tuple[tuple, dict[str, tuple]]:
    """Split a term into one dominant binding plus per-class overrides.

    Dominance is by count of owning classes, ties broken on the sorted
    binding so a rebuild is byte-identical.
    """
    counts = Counter(owners.values())
    dominant = sorted(counts.items(), key=lambda kv: (-kv[1], str(kv[0])))[0][0]
    overrides = {c: b for c, b in sorted(owners.items()) if b != dominant}
    return dominant, overrides


def audit(classes: dict[str, ClassDef], namespaces: dict[str, str]) -> dict:
    bindings = term_bindings(classes)

    unbound = [
        {"class": cls.name, "property": p.name, "requirementLevel": p.requirement_level,
         "range": p.range, "jsonTypes": list(p.json_types), "ref": p.ref}
        for cls in classes.values()
        for p in cls.properties.values()
        if not p.bound
    ]

    iri_conflicts, shape_conflicts = [], []
    for term, owners in sorted(bindings.items()):
        distinct_iris = {b[0] for b in owners.values()}
        dominant, overrides = resolve_term(owners)
        if len(distinct_iris) > 1:
            iri_conflicts.append({
                "term": term,
                "dominant": {"iri": dominant[0],
                             "classes": sorted(c for c, b in owners.items() if b[0] == dominant[0])},
                "overrides": [{"class": c, "iri": b[0]} for c, b in sorted(overrides.items())
                              if b[0] != dominant[0]],
            })
        elif overrides:
            shape_conflicts.append({
                "term": term,
                "iri": dominant[0],
                "dominant": {"coercion": dominant[1], "container": dominant[2],
                             "classes": sorted(c for c, b in owners.items() if b == dominant)},
                "overrides": [{"class": c, "coercion": b[1], "container": b[2]} for c, b in sorted(overrides.items())],
            })

    unresolvable = []
    for cls in classes.values():
        if cls.rdf_class and expand(cls.rdf_class, namespaces) is None:
            unresolvable.append({"class": cls.name, "curie": cls.rdf_class, "kind": "rdfClass"})
        for p in cls.properties.values():
            if p.iri and expand(p.iri, namespaces) is None:
                unresolvable.append({"class": cls.name, "property": p.name, "curie": p.iri, "kind": "property"})

    missing_default_type = sorted(c.name for c in classes.values() if not c.default_type)

    total_props = sum(len(c.properties) for c in classes.values())
    return {
        "counts": {
            "classes": len(classes),
            "classesWithRdfClass": sum(1 for c in classes.values() if c.rdf_class),
            "properties": total_props,
            "propertiesWithIri": total_props - len(unbound),
            "propertiesWithoutIri": len(unbound),
            "distinctTerms": len(bindings),
            "termsWithIriConflict": len(iri_conflicts),
            "termsWithShapeConflict": len(shape_conflicts),
        },
        "unboundProperties": sorted(unbound, key=lambda d: (d["class"], d["property"])),
        "iriConflicts": iri_conflicts,
        "shapeConflicts": shape_conflicts,
        "unresolvablePrefixes": unresolvable,
        "classesWithoutDefaultType": missing_default_type,
    }
