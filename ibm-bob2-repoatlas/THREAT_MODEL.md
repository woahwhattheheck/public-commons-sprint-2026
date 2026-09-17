# Threat model

RepoAtlas treats the supplied evidence manifest as hostile until admitted.

Closed by validation/tests: duplicate JSON keys, invalid UTF-8, non-finite JSON constants, excessive JSON nesting that would otherwise escape as interpreter recursion, unknown fields, traversal/absolute paths, duplicate manifest/change/dependency identities, malformed SHA-256, dependency references to unadmitted files, contradictory add/delete/modify hash shapes, no-op modifications, admitted-file/change digest disagreement, Unicode-scalar failures, packet mutation and receipt mutation.

Both supported ingress forms are bounded before expensive traversal. Byte-mode parsing rejects input above the retained 200,000-byte ceiling. Public object-mode `compile_packet(raw)` independently preflights every repeated structure: the retained analyzer already caps files at 5,000 and dependency edges at 20,000; the source-only facade additionally caps changes at 5,000, ADR rows at 5,000, runbook rows at 5,000, each file's `tests` references at 5,000, and each ADR/runbook `covers` list at 5,000. Exact-limit positives and over-limit fail-closed predecessors run under both normal and optimized Python.

The source-only generation accepts only all-false IBM/lablab provider state. Caller-authored `true` values for Bob execution, registration, submission or published tracks fail closed until a separately source-bound provider-evidence successor exists. Ordinary parent-package initialization also retires the legacy `_core_source_v1` module's direct `compile_packet`/`verify_bundle` names, so a normal private-submodule import does not bypass that rule.

That import sealing is **cooperative Python-runtime API hardening**, not hostile same-interpreter or source-file tamper resistance. Code already able to rewrite package source, replace import machinery, reload implementation files deliberately, or inspect/mutate live function closure cells is outside this carrier's integrity claim and requires an isolated/source-verified execution boundary not provided here.

The analyzer is deliberately non-authoritative. It does not read a live repository, run a shell, execute project code, access a network, infer human ownership from Git history, or treat an advertised competition as registration/submission/payment. Those facts must be acquired and retained by a separate authorized evidence lane.

For a changed path that is present in the admitted file manifest, the manifest digest must match the change image it describes: added/modified paths bind the post-image SHA-256, while deleted paths bind the pre-image SHA-256. A missing manifest row remains an explicit analyzer finding; a present-but-contradictory row is rejected.

A valid RepoAtlas receipt proves deterministic recomputation from the admitted snapshot; it does **not** prove the snapshot corresponds to a live Git provider generation unless the surrounding caller separately binds that generation.
