# Community Evidence Packet Workbench

Portable, browser-local workbench for assembling a community evidence packet and exporting it as HTML, Markdown, JSON, ZIP, copy, print, RO-Crate 1.2 metadata layout, or RFC 8493 BagIt layout.

WACZ files are accepted only as opaque recognized attachments. This workbench does not unpack, replay, or validate WARC/WACZ contents.

## What this is

- Editable source under `src/`
- Reproducible static build at `dist/index.html`

After the page has loaded, work stays in the browser. There is no backend, account, authorization, permission gate, telemetry, runtime network, remote fetch, or code execution in this app.

## Honest limits

- SHA-256 values are local byte-identity digests of the bytes read in that session. They are not authenticity, chain-of-custody, legal validity, or truth.
- Empty and incomplete packets export on purpose. Missing fields are labeled.
- Size notices are advisory. They do not block export.
- RO-Crate 1.2 and RFC 8493 BagIt names describe the layout this exporter writes. That is grounding, not certification or a validator result.
- WCAG 2.2 AA is an engineering target. This delivery did not run physical assistive-technology measurement and does not claim conformance.

See `LIMITATIONS.md`.

## Use

Open `dist/index.html` in a browser (`file://` or any static host). During editing, serve the workbench root so `src/ui/app.js` can import `src/core/*`.

```bash
node scripts/build.js
```

No package install is required. Node 18+ is enough for the static build.

## Pending imports

File, pasted-text, and JSON imports stay bound to the packet generation that started them.

- Clear, or a newer file, text, or JSON import, cancels older pending reads. A cancelled read does not add items and does not replace the packet.
- Files chosen together are staged as one batch. If a read fails, none of that batch is added and items already in the packet stay.
- Edits made while a JSON import is still reading are kept. That import is cancelled instead of overwriting the packet. A newer JSON import can replace the packet only if it is still the current generation and nothing was edited during its read.

## Restore file attachments after JSON import

JSON keeps item metadata and pasted text, but does not embed ordinary file
payloads. After importing a saved packet JSON, use **Attach original file** on
each item whose payload is unavailable. The selected local file must match the
recorded byte count and SHA-256 before its bytes are attached. Its local filename
can differ; the packet keeps the original item ID, name, archive path, caption,
role, provenance, and unknown metadata.

A mismatch or read failure leaves the item unchanged. Clear, another import, or
removing the item while its file is being read prevents that read from attaching
to a different packet or item. A newer attachment selection cancels older
pending imports too. Metadata edits made to the same item while its bytes are
being read stay in place.

Once every missing file is attached, ZIP, RO-Crate, and BagIt export can use the
local bytes again. The match establishes byte identity with the imported
metadata, not authenticity. JSON exports still omit file bytes, so retain the
original files or a package export when saving your work.

## Layout

```
src/core/     packet model, hash, escape, paths, zip, exporters
src/ui/       editable page, CSS, app wiring
scripts/      reproducible static build
dist/         self-contained page after build
```

## License

MIT, same as the parent Public Commons Sprint 2026 repository unless a file says otherwise.
