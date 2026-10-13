"""Exercise the original Arches8.1 RDF fixtures; no invented resource or graph."""
import argparse
import json
from pathlib import Path
from arches_source import hash_file, canonical_json
from arches_native_skos import resolve_native_skos

COLLECTION = "05659706-08a2-4342-87b9-98919ecdd8d0"
OTHER = "00000000-0000-0000-0000-000000000005"
EXPECTED = {
    "89ff530a-f350-44f0-ac88-bdd8904eb57e": ("9fa56006-6828-480f-8395-ad5c5a84726b", "Test Concept 1"),
    "6490ac87-ac80-41d7-a135-1119b4cd912d": ("fad6f17d-f7c8-4fa1-b358-e8626571599e", "Test Concept 3"),
    "0fc72a30-2ead-4afd-9e7a-a5067d2cc5c8": ("7949d7b5-6e57-469a-8f38-87aac08e1788", "Test Concept 2")
}
ORIGINAL = {
    "concept_label_test_scheme.xml": {"bytes":1249,"sha256":"69da8828c7abaca62f0d742085898ee80321c75363b2f623db39bea254fb683d"},
    "concept_label_test_collection.xml": {"bytes":1707,"sha256":"688f01d2cfb86e8c39e8beb8030eeb500975a4dec648907379d537a423a0e566"},
    "concept_label_mixed_case.xml": {"bytes":1249,"sha256":"a8b968eb332d96a89c2d6730b6ed349030fd8689d5c78bc9dcd90c8deca4ee86"}
}
def run(root):
    root=Path(root)
    for name,expected in ORIGINAL.items():
        assert hash_file(root/name)==expected, name
    pair=[root/"concept_label_test_scheme.xml",root/"concept_label_test_collection.xml"]
    resolved=resolve_native_skos(pair,collection_ids=[COLLECTION])
    assert not resolved["blocking"],resolved["issues"]
    doc=resolved["documents"][COLLECTION]
    canonical_json(doc)  # Derived context must use the original JSON codec too.
    assert set(doc["concepts"])==set(EXPECTED)
    for cid,(vid,label) in EXPECTED.items():
        assert doc["concepts"][cid]["prefLabels"]=={"en-US":{"id":vid,"value":label}}
    assert set(doc["__native_source"]["collection_membership"][COLLECTION]["members"])=={
        "http://www.archesproject.org/"+x for x in EXPECTED}
    blocked=resolve_native_skos(pair,collection_ids=[OTHER])
    assert blocked["blocking"]
    assert any(x["code"]=="SKOS_CONCEPT_VALUES_MISSING" for x in blocked["issues"])
    mixed=resolve_native_skos([root/"concept_label_mixed_case.xml",pair[1]],collection_ids=[COLLECTION])
    assert not mixed["blocking"],mixed["issues"]
    assert set(mixed["documents"][COLLECTION]["prefLabels"])=={"en-za"}
    assert all(set(c["prefLabels"])=={"en-US"} for c in mixed["documents"][COLLECTION]["concepts"].values())
    assert resolved["source_identity"]!=mixed["source_identity"]
    return {"schema":"commons.arches-native-skos-receiving.v1","complete":True,
        "source_commit":"2127517966462ea024ffb000b2e1fd46bf66d6dd","original_files":ORIGINAL,
        "collection_id":COLLECTION,"concepts":3,"value_bindings":EXPECTED,
        "source_identity":resolved["source_identity"],"mixed_source_identity":mixed["source_identity"],
        "original_languages":{"collection":"en-za","concepts":"en-US"},
        "unrelated_collection_findings":blocked["issues"],
        "scope":"Original native RDF/XML context parser. No customer resource, graph or target import is supplied by this fixture."}
if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixtures",required=True)
    args=parser.parse_args()
    print(json.dumps(run(args.fixtures),ensure_ascii=False,indent=2))
