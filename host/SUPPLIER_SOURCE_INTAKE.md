# Retained supplier XML and workbook intake

This source reader turns one complete retained supplier collection into usable schema and workbook data while preserving every original byte. It uses Python 3.11+ and the standard library. It reads XML/XSD/WSDL, XLSX and UTF-8 supplier HTML; it writes one complete JSON source packet, deterministic gzip, and ordered Base64 frames for a connected reader.

The immediate collection is CharityEngine's eleven original public API/import files. Its existing migration implementation consumes the source output in its original company case. The example catalogue contains only public supplier URLs, filenames and observed byte counts. Company terms, contacts, account credentials and private implementation source do not belong in this public example.

## Receive the retained originals

Use the full existing SOURCE_CATALOGUE.json from the company's original source packet. Its files[] records include filename, bytes, source_url and the exact stable_reference already returned by Notion. Resolve those exact references with the normal notion_get_file_download_urls tool (up to25 per call). Save its complete current tool result as downloads.json in the receiving worker's private directory. It returns files[] records containing reference, url and expiry_time, plus unresolved[].

Run in the already-selected equipped worker's source-reading lifetime:

```sh
python3 -B host/supplier_source_intake.py collect \
  --catalogue /ABSOLUTE/PRIVATE/SOURCE_CATALOGUE.json \
  --downloads /ABSOLUTE/PRIVATE/downloads.json \
  --originals /ABSOLUTE/PRIVATE/charityengine-originals \
  --out /ABSOLUTE/PRIVATE/charityengine-intake
python3 -B host/supplier_source_intake.py inspect \
  --packet /ABSOLUTE/PRIVATE/charityengine-intake/supplier-originals.json.gz
```

Refresh expired signed URLs through the same original file references. The reader downloads only explicitly resolved retained-file URLs; it does not fetch the example's public URLs, follow schema imports or invoke supplier APIs. No new account, provider write, scientific process, customer send or source acquisition is part of this course.

If the eleven originals already exist under their exact catalogue filenames, omit --downloads and read them directly. The public host/examples/charityengine-originals.json also supports this local-original route. A supplied sha256 is checked when present; otherwise the digest is measured from the selected retained bytes. The declared original byte count is always checked. Choosing a local original is the receiving operator's source selection; matching length alone is not an independent proof of a preexisting digest.

Every original is retained in --originals. Existing differing output files are left intact and reported. Use the same directory to resume the same source edition. A later source edition belongs in a different output directory. Downloads are preserved individually, so a failed later file does not discard earlier exact inputs. The final source packet and frames appear only after the complete collection has parsed and its original/member round trip has passed.

## Full output

- supplier-originals.json: every complete original, its byte length and SHA-256, original public URL/stable reference, and full parsed XML or workbook content.
- supplier-originals.json.gz: the same source in deterministic gzip (mtime0).
- SOURCE_TRANSFER.json: whole JSON and gzip identities, ordered frame count, original-file identities and whole collection counts.
- source-frame-0001.txt onward: ordered, ASCII-only Base64 frames of that exact gzip. Default28,000 characters per frame; --frame-characters may change the transport size without altering the source packet.
- original-read-receipt.json: complete measured original-file identities. Signed download access URLs are excluded from the source packet and outputs.

XML records include the complete original bytes and UTF-8 text when applicable, the whole parsed element tree, per-element namespace scope, all top-level schema declarations/imports, WSDL messages/operations/endpoints and the standard schema/WSDL QName references recorded by the reader. A type's full structure remains available even when it is recursive or references another declaration. Unresolved prefixes and external schema locations remain explicit; the reader does not guess their definitions or fetch an unselected dependency.

Workbook records include every ZIP member's complete bytes, length, SHA-256, CRC, compression metadata and parsed XML when applicable. The full workbook, worksheet XML and relationships are preserved. Every cell retains its source address/attributes, raw type, exact lexical cached value, separately resolved shared/inline text, formula text/attributes and full cell XML. All rows, styles, number formats, date-system properties, merges, validations and additional workbook resources remain in the original members. Transitional and Strict OOXML namespaces are supported.

Values stay exact: identifier strings and leading zeros are preserved; numeric and date serial values stay lexical strings with their original style/date-system context. Formula text and a saved cached result remain distinct, and this reader does not recalculate formulas. Rich text preserves original XML while excluding phonetic annotations from the actual cell value. Blank cells with no value remain distinct from numeric zero, false, empty text and a missing cell.

## Return to the existing implementation

Return SOURCE_TRANSFER.json and every numbered frame, or the complete gzip attachment, into the original source-read request. Retain the actual worker/process outcome and complete logs there. The existing source owner and company integrator receive this one result; another worker should first read the original request before issuing a second source read.

For a local consumer receiving frames:

```python
import base64, gzip, hashlib, json
from pathlib import Path
folder = Path("/ABSOLUTE/PRIVATE/received-frames")
meta = json.loads((folder / "SOURCE_TRANSFER.json").read_text())
frames = [folder / ("source-frame-%04d.txt" % i)
          for i in range(1, meta["frames"] + 1)]
encoded = "".join(p.read_text(encoding="ascii").strip() for p in frames)
packed = base64.b64decode(encoded, validate=True)
assert len(packed) == meta["compressed"]["bytes"]
assert hashlib.sha256(packed).hexdigest() == meta["compressed"]["sha256"]
source = gzip.decompress(packed)
assert len(source) == meta["bytes"]
assert hashlib.sha256(source).hexdigest() == meta["sha256"]
packet = json.loads(source)
```

Then read the original Types schema's declaration index for authentication, person/household/organization/relationship requests and contact/transaction response/pagination types. Join WSDL message parts and operation bindings by their full namespace-qualified references. Read each original workbook's actual populated header/sample cells, original instructions and mappings. Keep imported historical transaction semantics distinct from payment-processing operations; the original supplier documentation and selected tenant settings determine the implementation.

The complete source output is input to the existing migration preparation/reconciliation product. That product's actual customer-facing desk, exports, workbook attachments and reopening course still receive their ordinary native operation and visual inspection in the original receiving lifetime. The producing peer must open and view the exact outgoing product and every attachment, operate desktop/narrow workflows where relevant, fix concrete presentation defects, and preserve actual saved results.

## Scope and validation

The source parser checks every original size, every supplied digest, all workbook ZIP CRCs, unambiguous internal relationship/member identity, original-byte and workbook-member round trips, complete gzip recovery and deterministic file reuse. Native receiving of the actual supplier collection establishes the real extracted fields; source review does not substitute for that execution.

DTD/entity declarations are outside this supplier collection contract; schema dependency URLs and workbook external links are retained as data. Workbook parts are read in memory, not extracted into executable paths. This programme installs nothing and executes no supplier workbook, macro, formula or remote schema.
