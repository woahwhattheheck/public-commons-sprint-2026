# EvidenceForge — Nebius × NVIDIA Global AI Hackathon

**Track target:** Coding and Agentic Engineering  
**State:** public build foundation; **real Nebius provider execution is still required before any competition submission claim**.

EvidenceForge is a coding-agent control plane for teams that want the speed of a reasoning model without giving model text direct production authority. A human declares the files the agent may touch, the exact tests it must run, and a write budget. A Nemotron/NVIDIA model on Nebius Token Factory proposes a JSON plan. EvidenceForge validates that plan, executes it only through an isolated sandbox adapter, and emits a content-addressed receipt that separates **what ran** from **what is approved**.

The product is intentionally useful even when the model is wrong: unknown paths, undeclared tests, arbitrary tool kinds, duplicate JSON keys, path traversal, non-finite JSON, skipped tests, and attempts to smuggle approval fields all fail closed.

## Why this fits the hackathon

The current official rules require a working software application that either calls the Token Factory inference API or runs on Nebius AI Cloud, and uses at least one NVIDIA open-source model. The Coding and Agentic Engineering track asks for coding agents and developer tools. EvidenceForge's provider adapter uses the official OpenAI-compatible Token Factory API at `https://api.tokenfactory.nebius.com/v1/`.

The adapter deliberately **does not hard-code a model ID**. It queries `/v1/models` at runtime, requires the configured `NEBIUS_MODEL` to be present, and requires an NVIDIA/Nemotron model identity. This avoids silently claiming a model that Token Factory has since removed or renamed.

Official competition sources (re-check before submission):
- https://nebiusglobalaihackathon.devpost.com/
- https://nebiusglobalaihackathon.devpost.com/rules
- https://docs.tokenfactory.nebius.com/api-reference/introduction
- https://docs.tokenfactory.nebius.com/api-reference/models/list-models

## Product flow

1. **Human policy:** request JSON defines `allowed_paths`, `required_tests`, and `max_writes`.
2. **Nebius inference:** `provider.generate_plan()` checks live Token Factory model inventory and asks the selected NVIDIA/Nemotron model for a strict JSON plan.
3. **Fail-closed validation:** model output is parsed with duplicate-key and non-finite-number rejection. Only `read`, `write`, and predeclared `test` operations exist.
4. **Sandbox execution:** the included `MemorySandbox` gives a deterministic zero-credential replay. A production competition adapter can bind the same interface to Token Factory Sandboxes / an isolated Nebius runner without changing the authority contract.
5. **Receipt:** every read/write/test is reduced to content hashes and an immutable `evidenceforge-receipt/v1`.
6. **Human approval ceiling:** receipts always state `real_repository_mutation=false` and `human_approval_required=true`. Provider output is evidence, never self-granted authority.

## Run the zero-credential demo

```bash
cd nebius-evidenceforge
python -m evidenceforge.cli demo --out /tmp/evidenceforge-receipt.json
python -m evidenceforge.cli verify /tmp/evidenceforge-receipt.json
python -m unittest discover -s tests -v
python -O -m unittest discover -s tests -v
```

Browser demo:

```bash
python -m evidenceforge.webapp
# open http://127.0.0.1:8080
# machine-readable receipt: http://127.0.0.1:8080/api/demo
```

## Run with Nebius Token Factory

Do this only from an authorized competition/account environment:

```bash
export NEBIUS_API_KEY='...'
export NEBIUS_MODEL='CURRENT_NVIDIA_OR_NEMOTRON_MODEL_ID_FROM_/v1/models'
```

Then call `evidenceforge.provider.generate_plan(request_json)` and feed the returned `content` plus `result.evidence()` into `compile_change(...)`.

**Provider evidence needed before submission readiness:** capture the real Token Factory response ID, configured live NVIDIA model ID, timestamp/run log, and a demo receipt produced from that call. Until then the project state is `PROVIDER_EXECUTION_REQUIRED`, not “Nebius-integrated and tested.”

## Security / authority boundary

EvidenceForge does **not** include an arbitrary host shell executor. The offline adapter cannot run commands at all; it can only return outputs for human-declared test names. A real sandbox adapter must map those names to a preconfigured command table inside the isolated environment. Model output must never supply a shell string.

The model cannot:
- widen `allowed_paths`;
- invent or reorder required tests;
- exceed the write budget;
- deploy, contact third parties, spend money, or mutate a real repository;
- convert its own output or provider metadata into approval.

See `ARCHITECTURE.md` for the trust model and `SUBMISSION.md` for the remaining competition gates.

## License

This project is part of `public-commons-sprint-2026`, whose repository root carries an MIT license. Competition submission should link the repository license visibly and preserve the notice.
