# Community Evidence Packet Workbench

Portable, browser-local workbench for assembling a community evidence packet and exporting it as HTML, Markdown, JSON, ZIP, copy, print, RO-Crate 1.2 metadata layout, or RFC 8493 BagIt layout.

WACZ files are accepted only as opaque recognized attachments. This workbench does not unpack, replay, or validate WARC/WACZ contents.

## What this is

- Editable source under `src/`
- Deterministic tests under `tests/`
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
node --test tests/*.test.js
node scripts/build.js
```

No package install is required. Node 18+ is enough for tests and the static build.

## Layout

```
src/core/     packet model, hash, escape, paths, zip, exporters
src/ui/       editable page, CSS, app wiring
scripts/      reproducible static build
tests/        deterministic Node tests
dist/         self-contained page after build
```

## License

MIT, same as the parent Public Commons Sprint 2026 repository unless a file says otherwise.
