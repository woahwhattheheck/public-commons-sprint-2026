# Threat model

RepoAtlas treats the supplied evidence manifest as hostile until admitted.

Closed by validation/tests: duplicate JSON keys, invalid UTF-8, non-finite JSON constants, unknown fields, traversal/absolute paths, duplicate manifest/change/dependency identities, malformed SHA-256, dependency references to unadmitted files, contradictory add/delete/modify hashes, no-op modifications, packet mutation and receipt mutation.

The analyzer is deliberately non-authoritative. It does not read a live repository, run a shell, execute project code, access a network, infer human ownership from Git history, or treat an advertised competition as registration/submission/payment. Those facts must be acquired and retained by a separate authorized evidence lane.

A valid RepoAtlas receipt proves deterministic recomputation from the admitted snapshot; it does **not** prove the snapshot corresponds to a live Git provider generation unless the surrounding caller separately binds that generation.
