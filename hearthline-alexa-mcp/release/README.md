# Hearthline public release gate

`webmcp-pad` is a private working repository. Amazon Build, Ship, Shape requires the judged project repository to be public and open source. **Do not solve that by flipping this repository public or recursively copying a mutable working tree.**

This directory provides a local, fail-closed export gate for a separately authorized public judge carrier. The production CLI owns both the Hearthline source root and the committed publication manifest: callers may choose only the exact source commit and destination. `--root` and `--manifest` are intentionally disabled so a successful receipt cannot be produced from a caller-substituted allowlist.

The requested source commit must be the checkout's exact current `HEAD`, and it is rechecked throughout publication. The source-root directory generation itself is retained with `O_DIRECTORY|O_NOFOLLOW`; the caller-visible source-root pathname must continue naming that exact inode, so relocating the private tree and recreating its old path fails before publication can proceed. The gate reads the manifest and every exported source from immutable Git objects at that commit, rejects symlink/non-regular Git modes, enforces UTF-8 and byte ceilings, scans release-forbidden filenames and credential/key signatures, and binds the receipt to the exact commit, committed manifest blob, and every exported Git blob. Dirty working-tree bytes cannot alter the candidate, and moving `HEAD` during export fails closed.

The destination boundary is Linux fail-closed. The destination **parent must already exist**. The gate resolves and retains that parent with `O_NOFOLLOW`, rejects the retained private source-root generation, performs a no-clobber `mkdir`, snapshots the created directory identity, and requires the immediately retained directory handle to match that snapshot. Both the caller's lexical parent/final destination and the retained parent/root identities are then revalidated throughout publication. Nested directories are created once, snapshot after `mkdir`, matched to their first retained `O_DIRECTORY|O_NOFOLLOW` handle, and thereafter must reopen as the same recorded inode; preexisting nested directories collide rather than being silently adopted. Files use `O_CREAT|O_EXCL|O_NOFOLLOW`. Payload files are fsynced, then reopened through retained directory custody for exact size, executable-mode, and SHA-256 readback. The complete output tree is checked for unexpected entries before and after the receipt. This prevents the deterministic create→open substitutions the gate can observe, parent rebinding, intermediate-symlink redirection, same-size payload mutation, and silent extra-file injection from producing a successful receipt.

### Failure / cleanup semantics

Once the final destination name has been reserved, the gate never recursively deletes through that pathname. On a post-reservation failure it mutates only the retained destination inode: any written success receipt is invalidated only through its already-retained file descriptor (truncated + fsynced; never unlinked by pathname), `PUBLIC_RELEASE_ABORTED.json` is written and fsynced through retained custody, the root is forced back to mode `0700`, and candidate/parent handles are synced and closed. If the final name was moved, the abort marker follows the retained inode and a foreign replacement at the original name is untouched. If reservation fails before retained child custody exists, the mode-`0700` reservation may intentionally remain for operator inspection rather than being guessed-cleaned by pathname.

`PUBLIC_RELEASE_RECEIPT.json` is written and fsynced last. Its `sourceCommitProvenance` is `CURRENT_HEAD_EXACT_GIT_OBJECT`, `publicationProtocol` is `retained-tree-custody/v4`, and `destinationGenerationProvenance` is `RETAINED_POST_RESERVATION_OBSERVATION_CREATOR_UNAUTHENTICATED`. A successful return proves the final pathname named the retained completed inode at the gate's last visibility check after candidate/parent fsync; it cannot lease that pathname against an external rename after the check. Any later publisher must therefore re-open the caller-visible lexical destination immediately before copying/publishing, require a parseable receipt whose listed bytes still hash/mode-match, require the exact expected tree shape, and reject any `PUBLIC_RELEASE_ABORTED.json` marker. A failed candidate may contain a deliberately zero-length receipt inode alongside the abort marker; that receipt is not authority. A platform without the required Git, `O_NOFOLLOW`/`O_DIRECTORY`, or `/proc/self/fd` semantics fails closed.

Run from `experiments/hearthline-alexa-mcp`:

```sh
mkdir -p /tmp/hearthline-export-parent
node release/public-release.mjs \
  --source-commit "$(git rev-parse HEAD)" \
  --dest /tmp/hearthline-export-parent/hearthline-public
```

Review `PUBLIC_RELEASE_RECEIPT.json` and the exported tree before any public-repository mutation. `submission/**` remains intentionally excluded by the committed allowlist: internal evidence/provenance material is not judge-facing product source.

## Authority boundary

A successful local export means only that the committed allowlisted bytes at the current checkout `HEAD` passed this mechanical gate and the observed retained destination generation passed its final point-in-time visibility check. Linux/Node does not provide this JavaScript gate an atomic `mkdir` operation that returns the newly created directory FD, so the gate deliberately does **not** authenticate which same-UID process created the retained destination generation; creator identity is outside the receipt's authority. It does **not** authorize or prove GitHub publication, repository visibility, Alexa registration, AWS deployment/spend, Devpost submission, competition eligibility, judging, prize, payment, or revenue. Those require separate external receipts and the appropriate owner action.
