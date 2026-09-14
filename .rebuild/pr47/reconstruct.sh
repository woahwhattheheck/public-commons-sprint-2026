#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"
product="agents/mcp-streamable-http-conformance"

decode_parts() {
  local source_dir="$1"
  local target="$2"
  mkdir -p "$(dirname "$target")"
  cat "$source_dir"/*.b64 | tr -d '\n\r ' | base64 --decode > "$target"
}

decode_parts .rebuild/pr47/probe "$product/src/probe.mjs"
decode_parts .rebuild/pr47/test-cli "$product/test/cli.test.mjs"
decode_parts .rebuild/pr47/test-probe "$product/test/probe.test.mjs"
decode_parts .rebuild/pr47/closure "$product/test/transport-security-closure.test.mjs"

check_blob() {
  local expected="$1"
  local path="$2"
  local actual
  actual="$(git hash-object "$path")"
  if [[ "$actual" != "$expected" ]]; then
    echo "blob mismatch: $path expected=$expected actual=$actual" >&2
    exit 1
  fi
}

check_blob bc52c583c233767f7f8bc7a62a4af5f668bb476f "$product/README.md"
check_blob ce7eb1f2e4522ab7fe2326948950f1e7895ac0cc "$product/SECURITY.md"
check_blob dcd4aee90ac525a70aec39e1749b9602df4c595a "$product/src/cli.mjs"
check_blob 1384f408659855eb53e085183316e2de23ac6c55 "$product/src/http-client.mjs"
check_blob 7a4250367b9c8c77e4e47dee9e546a87dfcc54b6 "$product/src/probe.mjs"
check_blob 94803e9c604663a5cd647a934f3174102d712c6c "$product/test/cli.test.mjs"
check_blob 0abe42cb0c054d7d3c6408dd7512c078a1382d3e "$product/test/probe.test.mjs"
check_blob c5e24fd2a7d276e9b20987be31b50b7dfba4b679 "$product/test/transport-security-closure.test.mjs"

cd "$product"
npm ci --ignore-scripts
npm run check
npm test
cd "$root"

rm -rf .rebuild/pr47
rm -f .github/workflows/pr47-exact-repair-reconstruct.yml
