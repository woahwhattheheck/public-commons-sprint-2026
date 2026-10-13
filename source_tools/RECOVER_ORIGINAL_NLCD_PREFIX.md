# Continue the original NLCD capture on the receiving host

The existing original capture retained 218,248,092 bytes of the national
1,457,983,950-byte archive. The complete handoff preserves those bytes' SHA256,
the original strong ETag, capture receipt, range journal, archive reader and
regional receiving programme.

Use the already transferred original prefix when it is available. When the
original host cannot transfer it, recover that exact public byte interval on
the same selected receiving host:

~~~sh
python -B source_tools/recover_original_nlcd_prefix.py \
  /actual/Upstate_Original_NLCD_Prefix_Continuation.json \
  --root /actual/original-nlcd-receiving
~~~

This command accepts only the retained complete handoff edition, whose SHA256
is 7fecf93725718e268e6f911abe456e5d9016aed52acced1b0c20310964ede7bb.
It receives bytes 0–218248091 from the same public national archive, in bounded
32 MiB ranges. Every response must have HTTP 206, the exact Content-Range and
original strong ETag. The full recovered prefix must match the existing
2d1b6efed9193ffbb5dd9499567fef15c8e13de31c275506a421c110c465c25e
SHA256 before it becomes the original partial file.

The command shares the original capture lock and the adopter's lock. An
interrupted response retains its exact append position and source binding.
A later invocation reconciles a recorded in-flight response before requesting
the remaining bytes. An overlong response is removed back to that response's
starting position. A replacement HTTP 200 is never appended. The complete
source prefix is checked before adoption.

Select a persistent receiving directory with room for the original national
archive, local preparation and final package. The prefix operation itself
requires only its remaining bytes plus a 64 MiB filesystem reserve and streams
through a 1 MiB buffer. A memory-backed filesystem still consumes host memory.

## Adopt and continue the same operation

The complete handoff already contains adopt_original_nlcd_prefix.py and the
unchanged original receiving programme. Materialize its files[].content_base64
source bodies with their recorded byte counts and SHA256 checks. Use the
existing receiving source and original authenticated domain materialization.

After ORIGINAL_PREFIX_RESTORED, invoke its retained adopter:

~~~sh
python -B /actual/adopt_original_nlcd_prefix.py \
  /actual/Upstate_Original_NLCD_Prefix_Continuation.json \
  --prefix /actual/original-nlcd-receiving/inputs/Annual_NLCD_LndCov_2025_CU_C1V2.zip.partial \
  --root /actual/original-nlcd-receiving \
  --execute \
  --domain-archive /actual/dbc61-upstate-model-domain-20261012.zip
~~~

The original partial path is already the adopter's destination, so adoption
reuses those bytes. The original continuation resumes at byte 218248092 with
its existing request state. When the entity is complete, the unchanged regional
receiver prepares the original 217-feature domain with its 1,000 m buffer and
archive-backed raster reading. Use its existing --save-library option when
preserving the complete final native package.

The prefix restoration journal is original-prefix-byte-recovery under the
same receiving root. Preserve it with PREFIX_ADOPTION.json, original capture
receipt, range journal and final regional result. If an already-adopted capture
has progressed, the helper directs the operator to that existing receiver.

Authored by TokenJunkieLabs.
