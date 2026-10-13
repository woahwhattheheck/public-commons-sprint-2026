# Resume an original HTTP source capture

Authored by TokenJunkieLabs.

`http_capture_resume.py` finishes the same interrupted source selected by the existing raster capture. It preserves the original partial, URL, complete entity length, strong ETag and response receipt. Contiguous 32 MiB requests let a long national transfer resume after a connection ends.

## Continue the selected capture

Run from the existing Upstate application directory. Choose its Python interpreter and the original archive path:

```sh
UPSTATE_PYTHON=python3
UPSTATE_APPLICATION="$PWD"
UPSTATE_ARCHIVE=/absolute/path/Annual_NLCD_LndCov_2025_CU_C1V2.zip
PYTHONPATH="$UPSTATE_APPLICATION" "$UPSTATE_PYTHON" -u -m source_tools.http_capture_resume \
  --archive "$UPSTATE_ARCHIVE" --maximum-bytes 1457983950
```

The original `.capture.json` must identify an interrupted HTTP 200 response with its observed full `Content-Length`, `Accept-Ranges: bytes`, identity encoding and strong ETag. Its `received_bytes` must match the retained `.partial`. The command acquires the same `.lock` used by the original capture.

The sibling `.range-recovery` directory retains the original selection and each actual response. Keep the partial, capture, lock and recovery directory together when relocating an inactive operation. `--chunk-bytes` selects the next request size; it does not change the original source identity.

## Response and recovery behavior

Each appended response must be HTTP 206, carry the same strong ETag and identity encoding, and report the exact requested starting byte and original complete entity length. The final range can end at the source's declared total.

A connection that ends early retains its valid received prefix. A replacement HTTP 200 or changed range is rejected before append. An interrupted state commit resumes from its saved original response boundary. A body that exceeds its declared range is removed only back to this operation's previously committed append boundary. Filesystem uncertainty leaves the saved active response available for reconciliation.

The completed capture remains compatible with the existing `source_tools.nlcd_static.receive` contract. It retains the original full-response identity, complete byte count and SHA-256, plus all actual recovery responses. Reopening a completed invocation verifies the retained entity and reuses it.

## Join the existing model preparation

Pass the completed national archive and its `.capture.json` to the existing NLCD receiving workflow with the original publisher metadata. Continue the existing model-domain, grid and source-manifest selection. The complementary archive reader and complete original NLCD receiving programme are retained in the original Upstate source handover.

The observed Annual NLCD 2025 C1V2 response declares 1,457,983,950 bytes. Its retained ZIP headers identify a 1,457,973,825-byte DEFLATE member containing the national TIFF. The archive reader avoids expanding another complete TIFF onto the working filesystem. The original domain clip remains local.

Select a receiving filesystem with room for the remaining entity and model outputs. A memory-backed filesystem also consumes the host's shared memory.

Protocol: [RFC 9110, sections 13 and 14](https://www.rfc-editor.org/rfc/rfc9110.html).
Native ZIP access: [GDAL virtual file systems](https://gdal.org/en/stable/user/virtual_file_systems.html#vsizip-zip-archives).
