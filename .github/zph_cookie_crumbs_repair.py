from __future__ import annotations

import os
import subprocess
from pathlib import Path

SRI = "sha384-I45YF+S0YGWIolUyTksLk9TNtTqaDgZg8e6T1OoBoJvvFmphqYNIPZw3Kl0TkZNN"
SHA256 = "09cdbea951b2ed0e11bcbe3aeb1ee9f035f9fb51ed212aca645475ae82688cc3"
URL = "https://cdn.jsdelivr.net/npm/@solana/web3.js@1.98.4/lib/index.iife.min.js"
BRANCH = "zph-n4v8/cookie-crumbs-source-hardening-20260914"


def run(*args: str, cwd: str | None = None) -> str:
    completed = subprocess.run(args, cwd=cwd, check=True, text=True, capture_output=True)
    if completed.stdout:
        print(completed.stdout, end="")
    if completed.stderr:
        print(completed.stderr, end="")
    return completed.stdout.strip()


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one replacement target, found {count}")
    target.write_text(text.replace(old, new, 1))


def apply_runtime_hardening() -> None:
    replace_once(
        "cookie-crumbs/receipt.mjs",
        "export function shortAddress(value, left = 5, right = 5) {",
        """export function parsedTransactionSignedBy(parsedTransaction, walletAddress) {
  const expected = String(walletAddress ?? '').trim();
  if (!expected) return false;
  const accountKeys = parsedTransaction?.transaction?.message?.accountKeys;
  if (!Array.isArray(accountKeys)) return false;

  return accountKeys.some((entry) => {
    if (!entry || entry.signer !== true) return false;
    const key = entry.pubkey ?? entry;
    let address = '';
    try {
      if (typeof key === 'string') address = key;
      else if (typeof key?.toBase58 === 'function') address = key.toBase58();
      else if (typeof key?.toString === 'function') address = key.toString();
    } catch {
      return false;
    }
    return address === expected;
  });
}

export function shortAddress(value, left = 5, right = 5) {""",
    )

    replace_once(
        "cookie-crumbs/app.js",
        "import { composeReceipt, parseReceipt, shortAddress, utf8Bytes, MAX_MEMO_BYTES } from './receipt.mjs';",
        "import { composeReceipt, parseReceipt, parsedTransactionSignedBy, shortAddress, utf8Bytes, MAX_MEMO_BYTES } from './receipt.mjs';",
    )
    replace_once(
        "cookie-crumbs/app.js",
        """  if (!tx) return null;
  for (const instruction of tx.transaction.message.instructions) {""",
        """  if (!tx) return null;
  const walletAddress = state.publicKey?.toBase58?.();
  if (!parsedTransactionSignedBy(tx, walletAddress)) return null;
  for (const instruction of tx.transaction.message.instructions) {""",
    )

    replace_once(
        "cookie-crumbs/index.html",
        '  <script src="https://cdn.jsdelivr.net/npm/@solana/web3.js@1.98.4/lib/index.iife.min.js" defer></script>',
        f'''  <script
    src="{URL}"
    integrity="{SRI}"
    crossorigin="anonymous"
    defer></script>''',
    )

    replace_once(
        "cookie-crumbs/tests/receipt.test.mjs",
        "import { composeReceipt, parseReceipt, utf8Bytes, MAX_MEMO_BYTES, RECEIPT_PREFIX, shortAddress } from '../receipt.mjs';",
        "import { composeReceipt, parseReceipt, parsedTransactionSignedBy, utf8Bytes, MAX_MEMO_BYTES, RECEIPT_PREFIX, shortAddress } from '../receipt.mjs';",
    )
    receipt_tests = Path("cookie-crumbs/tests/receipt.test.mjs")
    receipt_tests.write_text(
        receipt_tests.read_text()
        + """

test('parsedTransactionSignedBy requires exact connected signer metadata', () => {
  const wallet = 'Wallet1111111111111111111111111111111111111';
  const other = 'Other11111111111111111111111111111111111111';
  const tx = (accountKeys) => ({ transaction: { message: { accountKeys } } });

  assert.equal(parsedTransactionSignedBy(tx([{ pubkey: wallet, signer: true }]), wallet), true);
  assert.equal(parsedTransactionSignedBy(tx([{ pubkey: { toBase58: () => wallet }, signer: true }]), wallet), true);
  assert.equal(parsedTransactionSignedBy(tx([{ pubkey: wallet, signer: false }]), wallet), false);
  assert.equal(parsedTransactionSignedBy(tx([
    { pubkey: other, signer: true },
    { pubkey: wallet, signer: false },
  ]), wallet), false);
  assert.equal(parsedTransactionSignedBy(tx([{ toBase58: () => wallet }]), wallet), false);
  assert.equal(parsedTransactionSignedBy(tx([{ pubkey: wallet, signer: true }]), ''), false);
  assert.equal(parsedTransactionSignedBy({ transaction: { message: {} } }, wallet), false);
});
"""
    )

    static_tests = Path("cookie-crumbs/tests/static-contract.test.mjs")
    static_tests.write_text(
        static_tests.read_text()
        + f"""

test('remote executable is exact-version and subresource-integrity bound', () => {{
  const remoteScripts = [...html.matchAll(/<script\\b[^>]*\\bsrc=[\"']https:\\/\\/[^\"']+[\"'][^>]*>/gi)].map((match) => match[0]);
  assert.equal(remoteScripts.length, 1);
  assert.match(remoteScripts[0], /@solana\\/web3\\.js@1\\.98\\.4\\/lib\\/index\\.iife\\.min\\.js/);
  assert.ok(remoteScripts[0].includes('integrity=\"{SRI}\"'));
  assert.ok(remoteScripts[0].includes('crossorigin=\"anonymous\"'));
}});

test('recent receipt attribution requires exact connected signer proof', () => {{
  assert.match(app, /parsedTransactionSignedBy\\(tx, walletAddress\\)/);
  assert.match(app, /if \\(!parsedTransactionSignedBy\\(tx, walletAddress\\)\\) return null/);
}});
"""
    )

    ci = Path(".github/workflows/cookie-crumbs-ci.yml")
    ci_text = ci.read_text()
    needle = """      - name: Static app inventory
        run: |
"""
    insert = f"""      - name: Verify pinned Solana web3 integrity
        shell: bash
        run: |
          set -euo pipefail
          url='{URL}'
          expected_sri='{SRI}'
          expected_sha256='{SHA256}'
          curl --fail --silent --show-error --location \"$url\" --output /tmp/solana-web3.js
          observed_sri=\"sha384-$(openssl dgst -sha384 -binary /tmp/solana-web3.js | openssl base64 -A)\"
          observed_sha256=\"$(sha256sum /tmp/solana-web3.js | cut -d' ' -f1)\"
          test \"$observed_sri\" = \"$expected_sri\"
          test \"$observed_sha256\" = \"$expected_sha256\"
      - name: Static app inventory
        run: |
"""
    if ci_text.count(needle) != 1:
        raise SystemExit(f"cookie-crumbs-ci.yml insertion target drift: {ci_text.count(needle)}")
    ci.write_text(ci_text.replace(needle, insert, 1))


def commit_runtime() -> tuple[str, dict[str, str]]:
    run("node", "--check", "app.js", cwd="cookie-crumbs")
    run("node", "--check", "receipt.mjs", cwd="cookie-crumbs")
    run("node", "--test", "tests/receipt.test.mjs", "tests/static-contract.test.mjs", cwd="cookie-crumbs")
    run("git", "config", "user.name", "ZPH-N4V8")
    run("git", "config", "user.email", "brycembusiness2@gmail.com")
    run(
        "git", "add",
        "cookie-crumbs/app.js",
        "cookie-crumbs/index.html",
        "cookie-crumbs/receipt.mjs",
        "cookie-crumbs/tests/receipt.test.mjs",
        "cookie-crumbs/tests/static-contract.test.mjs",
        ".github/workflows/cookie-crumbs-ci.yml",
    )
    run("git", "diff", "--cached", "--check")
    run("git", "commit", "-m", "Cookie Crumbs: require signer proof and pin Solana web3 SRI")
    runtime_commit = run("git", "rev-parse", "HEAD").splitlines()[-1]
    blobs = {
        "index": run("git", "hash-object", "cookie-crumbs/index.html").splitlines()[-1],
        "app": run("git", "hash-object", "cookie-crumbs/app.js").splitlines()[-1],
        "receipt": run("git", "hash-object", "cookie-crumbs/receipt.mjs").splitlines()[-1],
        "styles": run("git", "hash-object", "cookie-crumbs/styles.css").splitlines()[-1],
    }
    print(f"RUNTIME_COMMIT={runtime_commit}")
    print("RUNTIME_BLOBS=" + " ".join(f"{key}={value}" for key, value in blobs.items()))
    return runtime_commit, blobs


def repin_deployment_contract(runtime_commit: str, blobs: dict[str, str]) -> None:
    verifier = Path("cookie-crumbs/verify-deploy.mjs")
    text = verifier.read_text()
    old_commit = "446b66260e35535b35b3d68becf4c7f3462e60b0"
    if text.count(old_commit) != 1:
        raise SystemExit(f"verify-deploy source commit occurrence drift: {text.count(old_commit)}")
    text = text.replace(old_commit, runtime_commit, 1)
    old_blobs = {
        "af4d1a0ce8ae835092d480c319f2ba2234bf97a4": blobs["index"],
        "31e2ca50c8d02a4f0bd390687337835c45d65d27": blobs["app"],
        "befbf85080201ed458b1555bf77442f85fcfe442": blobs["receipt"],
        "63e8dbc8c6c7cb4efea6dfc2a7135cff435c3d74": blobs["styles"],
    }
    for old, new in old_blobs.items():
        count = text.count(old)
        if count != 1:
            raise SystemExit(f"verify-deploy blob occurrence drift {old}: {count}")
        text = text.replace(old, new, 1)
    marker = "      'src=\"./app.js\"',\n"
    if text.count(marker) != 1:
        raise SystemExit(f"verify-deploy index marker insertion drift: {text.count(marker)}")
    text = text.replace(
        marker,
        marker
        + f"      'src=\"{URL}\"',\n"
        + f"      'integrity=\"{SRI}\"',\n"
        + "      'crossorigin=\"anonymous\"',\n",
        1,
    )
    verifier.write_text(text)

    tests = Path("cookie-crumbs/tests/deploy-contract.test.mjs")
    text = tests.read_text()
    old_fixture = '<!doctype html><title>Cookie Crumbs · test</title><button id="connect-wallet"></button><link href="./styles.css"><script type="module" src="./app.js"></script>'
    new_fixture = old_fixture.replace(
        '<script type="module"',
        f'<script src="{URL}" integrity="{SRI}" crossorigin="anonymous"></script><script type="module"',
    )
    if text.count(old_fixture) != 1:
        raise SystemExit(f"deploy-contract canonical fixture drift: {text.count(old_fixture)}")
    text = text.replace(old_fixture, new_fixture, 1)
    for old, new in old_blobs.items():
        count = text.count(old)
        if count != 1:
            raise SystemExit(f"deploy-contract expected blob occurrence drift {old}: {count}")
        text = text.replace(old, new, 1)
    tests.write_text(text)


def commit_contract_and_push() -> None:
    run("npm", "run", "ci", cwd="cookie-crumbs")
    run("git", "add", "cookie-crumbs/verify-deploy.mjs", "cookie-crumbs/tests/deploy-contract.test.mjs")
    run("git", "diff", "--cached", "--check")
    run("git", "commit", "-m", "Cookie Crumbs: repin deployment verifier to hardened runtime")
    print(run("git", "log", "-4", "--oneline"))
    run("git", "push", "origin", f"HEAD:{BRANCH}")


def main() -> None:
    apply_runtime_hardening()
    runtime_commit, blobs = commit_runtime()
    repin_deployment_contract(runtime_commit, blobs)
    commit_contract_and_push()


if __name__ == "__main__":
    main()
