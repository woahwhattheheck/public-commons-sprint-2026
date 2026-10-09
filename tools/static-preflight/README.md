# Static configuration preflight

An opt-in, standard-library-only inspection before running an unfamiliar
repository's install, lint, build or test commands. The utility reads explicitly
supplied files as data. It does not import inspected JavaScript, install
packages, fetch remote payloads, or change source files.

```sh
python tools/static-preflight/static_config_preflight.py /path/to/eslint.config.js
```

Run the scanner from a trusted checkout outside the untrusted repository. For a
historical source, extract the desired Git blob to a plain text file and scan
that file; do not execute the configuration to discover what it does.

## Findings and exit status

- `KNOWN_RISK`: exact Git blob identity of the Sampled configuration observed at
  commit `08a2d1db8317e1620ead99f8eb7bdfe1e002aef0`. That source contains an
  obfuscated remote-response loader with `eval` and detached process spawning.
  Recorded blob: `7da565bcb57517fa1c3adc1c824b7e105dae2699`.
- `REVIEW`: a line combines at least 2,000 characters, 16 quoted hex literals,
  and an `eval`, `spawn` or child-process marker. No single `createRequire`
  import, long line, or encoded string is sufficient.
- `NO_MATCH`: neither selected condition was found. **This is not a security
  clearance.** The detector does not identify every obfuscator or malicious
  install hook. It intentionally does not attempt full JavaScript parsing;
  comments and strings can produce a review finding.

JSON goes to stdout, with paths, line numbers, hashes and indicator counts but
no source snippets. Exit 0 means no selected match, 1 means review is needed,
and 2 means an input/usage error. Every requested file is considered; errors
win over review findings in the overall exit status. Inputs are limited to 64
explicit regular UTF-8 text files, each at most 1 MiB. Final-component symlinks
and special files are refused. Ancestor directories must also be trusted.

This is an inspection aid, not a mandatory publication gate. It neither
quarantines files nor changes repository settings. Review a match, preserve
source provenance, and select a trusted version before executing repository
code. A source finding is not proof that a runner executed the code or exposed
credentials. SHA-1 identifies Git blobs here; it is not an authenticity proof.

## Focused checks

```sh
python -m unittest discover -s tools/static-preflight -p 'test_*.py' -v
```

Three contracts exercise known-identity classification, legitimate
`createRequire` compatibility, the composite signal and absence of source text
in output, and CLI/error behavior. All fixtures are inert byte strings. The
real source can be checked as data without running it.

Source provenance:
https://github.com/woahwhattheheck/sampled/commit/08a2d1db8317e1620ead99f8eb7bdfe1e002aef0

Reviewed restoration in the existing original-author source:
https://github.com/woahwhattheheck/sampled/pull/1
