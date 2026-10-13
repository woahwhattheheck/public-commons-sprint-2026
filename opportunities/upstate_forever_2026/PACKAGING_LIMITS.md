# Package complete retained scientific cohorts

The original delivery packager now accepts complete explicitly listed scenario
assets through one shared set of source budgets. The default budget is 25,000
references, 16 GiB per member, 256 GiB of captured members, a 16 MiB delivery
manifest, and a 64 MiB package inventory. A reference count is a file count, not
a scenario count. Existing required raster, metadata, map and report references
are included in that count. The retained manifest and generated audit add at
most two captured members.

These defaults accommodate thousands of ordinary small metadata members and
hundreds of regional raster assets. Actual coverage, raster dimensions and
compression determine each job's size. Larger scientific cohorts use explicit
caller-selected limits. Source capture and verification use the same controls;
neither reads a larger authorization from the package being verified.

## Use the existing operation

The original two-positional-argument APIs remain valid:

~~~python
package_delivery.pack(manifest_path, output_directory)
package_delivery.verify(output_directory)
~~~

A caller can provide a partial dictionary of overrides. Unknown fields,
booleans, zero, negative and noninteger values are rejected:

~~~python
limits = {
    "max_references": 60000,
    "max_file_bytes": 34359738368,
    "max_total_bytes": 1099511627776,
    "max_manifest_bytes": 33554432,
    "max_index_bytes": 134217728,
}
package_delivery.pack(manifest_path, output_directory, limits=limits)
package_delivery.verify(output_directory, limits=limits)
~~~

The direct capture APIs accept the same keyword:
`delivery_snapshot.capture_delivery(..., limits=limits)` and
`delivery_snapshot.verify_capture(..., limits=limits)`.
The inventory records the effective `captureLimits`, original
`declaredReferenceCount` and `capturedSourceBytes`. Its original schema and
artifact identities remain intact. Recorded limits are provenance; verification
uses the selected caller budget, including when the file declares larger limits.
Verification also checks the captured manifest size and the retained declared
reference count against the caller's selected budgets. Old package-v1 inventories
without the new count field remain readable.

The original CLI exposes the same options on both subcommands:

~~~bash
python -B package_delivery.py pack delivery.json /actual/output \
  --max-references 60000 --max-file-bytes 34359738368 \
  --max-total-bytes 1099511627776 \
  --max-manifest-bytes 33554432 --max-index-bytes 134217728
python -B package_delivery.py verify /actual/output \
  --max-references 60000 --max-file-bytes 34359738368 \
  --max-total-bytes 1099511627776 \
  --max-manifest-bytes 33554432 --max-index-bytes 134217728
~~~

Install both original Python modules from the same edition. Restart an existing
long-running operator process after the normal source update so its imported
root delivery_snapshot module matches package_delivery.

## Complete source capture

Only declared relative paths are read. No folder enumeration, scenario sampling
or asset truncation is introduced. Duplicate references share one retained
member and retain all roles. Paths retain existing traversal, symlink,
case-collision, regular-file and concurrent-source-change checks.

All unique source sizes are checked against the selected member and total
budgets before creating the output directory. Capture and verification copy/hash
in 1 MiB chunks, so a larger per-file allowance does not read a raster into RAM.
The inventory fingerprint and JSON writer also stream encoded chunks; they
preserve the original canonical hash algorithm and JSON formatting.

The original technical audit, TIFF container checks and declared companion
checks still run. Audit bytes count toward the final captured-member total.
The readable handoff and package inventory include the complete cohort. The
handoff renderer has no 200- or 256-member cap. Its HTML grows with the selected
inventory, so the JSON inventory remains useful for very large native GIS jobs.

The manifest and inventory byte caps independently bound JSON parsing. Source
and inventory limits do not promise available disk capacity: actual filesystem
writes can fail. A failed operation retains its partial directory for inspection
without a completed package result. Use the existing native delivery retry path
after resolving the specific source or capacity error.

## Retained-analysis integration

The original native delivery API still calls pack(manifest, directory) and then
verify(directory), so the larger defaults are adopted without changing scientific
selection or results. For a job beyond those defaults, its caller passes the same
limits dictionary to both operations. The retained-analysis asset list remains
the original immutable cohort: its complete rasters, vector layers, tables and
binding artifact are captured.

The separate source_scenario_analysis manifest binding points to its retained
delivery-binding.json. That keeps the manifest compact while retaining complete
selected scenarios, source areas and original provenance in an explicitly listed
artifact. The packager neither regenerates nor changes those scientific outputs.

## Focused native verification

Use an existing Python receiver and the exact two source modules. A useful
packaging check creates more than 256 explicitly listed small members in a
temporary source directory, calls the original capture API, verifies every
retained member and compares its inventory fingerprint with the prior canonical
JSON formula. Repeating with a lower selected reference or total-byte budget
must fail before creating an output directory. A package created with an explicit
larger budget must still fail when verification selects a smaller budget; changing
captureLimits inside JSON cannot relax that caller-selected budget.

This is a packaging exercise: its small byte fixtures are not ecosystem model
outputs. Actual regional science continues through the original source, InVEST,
scenario, receiving-water and delivery operations.


## Final delivery ZIP and receiving

The original `model.delivery_archive.package_archive` carrier uses the same
`max_index_bytes` metadata budget as the audited package: 64 MiB by default.
This replaces its smaller 16 MiB transfer-inventory ceiling. The complete
explicit inventory is encoded and checked before any large raster member is
copied, then streamed into `transfer.json`. Source members still stream in
1 MiB chunks, and the writer retains their exact byte counts and SHA-256
identities. A changing source, write failure, or metadata limit failure
propagates and removes only the operation's pending ZIP.

The existing three-argument call remains valid. A caller that selected a
different metadata budget passes it to both wrapping and receiving:

```python
from model.delivery_archive import package_archive, inspect_archive

policy = {"max_index_bytes": 96 * 1024 ** 2}
carrier = package_archive(
    delivery_directory, original_package_directory, original_package,
    limits=policy,
)
inventory = inspect_archive(
    delivery_directory / carrier["path"],
    expected_package_sha256=original_package["packageSha256"],
    limits=policy,
)
```

The transfer inventory records its writer's selected metadata budget for
provenance. That stored value never changes the receiver's selected policy.
Receiving checks both the ZIP member's declared size and a bounded metadata
read, rejects duplicate JSON keys, and verifies every original member's
size and hash. Reusing an existing carrier and the writer's post-write reopen
use the same explicitly selected policy.

Capture reference/member/total limits apply to the original audited package
through `package_delivery.pack` and `package_delivery.verify`. The carrier
retains that complete inventory and adds the original verification tools,
package index, handoff view, and transfer manifest; those additions do not
redefine the scientific cohort or introduce a second scenario-count ceiling.
Newly built carriers include this guide in their tools directory. Keep the
merged delivery_snapshot.py and package_delivery.py beside the original
application model package when installing this archive successor; its metadata
policy imports that same retained capture_limits implementation. After
extraction, the original
`tools/package_delivery.py verify PACKAGE_ROOT` command accepts the same
capture-policy flags described above.

Workspace backup is a separate archive with a maintained application inventory
and an existing 64 MiB `ARCHIVE.json` limit. Its current metadata ceiling
already matches the default delivery-transfer ceiling. Its owner maintains
application-file inclusion independently; the final delivery ZIP always
includes this guide with its original verifier. A custom delivery transfer
budget does not implicitly change the separate workspace archive policy.
