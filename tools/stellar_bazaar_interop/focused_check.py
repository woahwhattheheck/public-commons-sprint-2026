#!/usr/bin/env python3
"""One local parser check using the published canonical x402 Bazaar docs fixture.

Negative modifications below are unit-level software diagnostics, NOT live simulations.
"""
from pathlib import Path
import json
import tempfile
import bazaar_interop as module
from bazaar_interop import (census, decode_extension_responses, CensusError,
                            _external_https_endpoint, _load_snapshot, _page_url)

source = Path(__file__).with_name("official_bazaar_resource.json")
original = json.loads(source.read_text())
assert original["resource"] == "https://api.example.com/x402/weather"
assert original["accepts"][0]["network"] == "eip155:8453"  # published example is Base
result = census([_load_snapshot(str(source))])
assert result["summary"]["unique_resource_identities"] == 1
assert result["summary"]["rejected_records"] == 0
assert result["resources"][0]["observations"][0]["payment_terms"][0]["amount"] == "200"
assert decode_extension_responses("eyJiYXphYXIiOnsic3RhdHVzIjoic3VjY2VzcyJ9fQ==")["bazaar"]["status"] == "success"
try:
    decode_extension_responses("totally-not-a-base64-header!!!")
except CensusError as exc:
    assert str(exc) == "header_invalid_base64"
else:
    raise AssertionError("invalid header accepted")
# Targeted software diagnostics: duplicate same published fixture is NOT price conflict;
# a changed term must be reported, never silently overwritten or counted as consensus.
s1 = {"provider":"orig","raw_sha256":"upstream","data":{"items":[original]}}
s2 = {"provider":"copy","raw_sha256":"upstream-copy","data":{"resources":[original]}}
coherent = census([s1,s2])
assert coherent["summary"]["cross_facilitator_identities"] == 1
assert coherent["summary"]["conflicting_payment_identity_count"] == 0
modified = json.loads(json.dumps(original))
modified["accepts"][0]["payTo"] = "another_unverified_payto_unit_fixture"
s2["data"]["resources"] = [modified]
conflict = census([s1,s2])
assert conflict["summary"]["conflicting_payment_identity_count"] == 1
assert len(conflict["resources"][0]["observations"]) == 2

# Pure transport-addressing checks. Patch DNS only so no network request occurs.
original_getaddrinfo = module.socket.getaddrinfo
module.socket.getaddrinfo = lambda *args, **kwargs: [
    (module.socket.AF_INET, module.socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))
]
try:
    assert _external_https_endpoint("https://facilitator.example") == \
        "https://facilitator.example/discovery/resources"
    assert _external_https_endpoint("https://api.example/platform/v2/x402") == \
        "https://api.example/platform/v2/x402/discovery/resources"
    filtered = _external_https_endpoint(
        "https://facilitator.example/discovery/resources?network=stellar%3Atestnet&limit=2&offset=9"
    )
    assert _page_url(filtered, page_size=100, offset=200) == \
        "https://facilitator.example/discovery/resources?network=stellar%3Atestnet&limit=100&offset=200"
    for refused in (
        "https://user@example.com/discovery/resources",
        "https://example.com/a/%2e%2e/private",
        "https://example.com/discovery/resources#fragment",
        "https://example.com:444/discovery/resources",
    ):
        try:
            _external_https_endpoint(refused)
        except CensusError:
            pass
        else:
            raise AssertionError(f"unsafe provider endpoint accepted: {refused}")
finally:
    module.socket.getaddrinfo = original_getaddrinfo

print("PASS: original x402 Bazaar fixture/header parsed; independent observations and changed-payTo conflict preserved; safe provider base paths and static filters retained with pagination override. No network/payment performed.")
