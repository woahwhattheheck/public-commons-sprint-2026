# Limitations (honest)

This file is part of the workbench. It is not a certificate.

- No physical screen-reader, keyboard-only, or switch-access session was measured for this delivery. WCAG 2.2 AA is an engineering target.
- SHA-256 is computed locally from bytes in memory. It does not prove origin, consent, or accuracy.
- Import escaping prevents markup injection in generated HTML/Markdown snapshots. It is not a general-purpose sanitizer for every future consumer.
- ZIP writing uses the STORE method only. Archives are containers, not PKWARE-certified products.
- RO-Crate 1.2 context IRIs are recorded as strings. The workbench does not fetch them.
- BagIt files follow RFC 8493 layout fields used here. No bag validator was run against an external suite.
- WACZ attachments are opaque. A `.wacz` suffix is recognition, not validation.
- Copy uses the browser clipboard when present, otherwise a local textarea. That is not a network call.
- Object URLs created for downloads are revoked after click. They are not remote fetches.
- Tests are deterministic Node assertions. They are not accessibility certification, security certification, or legal readiness.
