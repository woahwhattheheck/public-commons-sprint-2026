# EvidenceForge architecture and threat model

## Components

```text
human request
  │ allowed paths / exact tests / write budget
  ▼
Token Factory NVIDIA/Nemotron model ──► untrusted JSON plan
  │                                      │
  │ provider response ID                 ▼
  │                              strict admission gate
  │                                      │
  ▼                                      ▼
provider evidence hash            isolated Sandbox interface
                                         │
                                  read / bounded write /
                                  declared tests only
                                         │
                                         ▼
                               content-addressed receipt
                                         │
                                         ▼
                                  HUMAN APPROVAL
```

`core.py` is deterministic and provider-agnostic. `provider.py` is the live Nebius seam. `MemorySandbox` is an offline replay implementation; it deliberately cannot execute a host shell.

## Threats closed in v1

- **Prompt/tool escalation:** only three operation kinds are admitted after strict exact-key validation.
- **Path escape:** absolute, backslash, NUL, `..`, and non-normalized paths fail closed.
- **Test laundering:** the plan must execute every human-declared test exactly once and in the declared order.
- **Policy rewriting:** request and plan are separately hashed into the receipt.
- **JSON ambiguity:** duplicate keys and NaN/Infinity are rejected.
- **Provider authority confusion:** provider metadata is hashed as evidence only. It cannot set any authority bit.
- **Receipt tampering:** canonical JSON body is SHA-256 bound; verification also re-runs schema/policy invariants instead of trusting the digest alone.
- **Shell injection:** model output contains test names, never executable shell. Production adapters must use a human-configured name→command table inside an isolated runner.
- **Approval confusion:** the receipt hard-codes `real_repository_mutation=false` and `human_approval_required=true`; even a receipt that is re-hashed after flipping authority fails verification.

## Deliberate non-goals

This foundation does not claim to prove model correctness, sandbox isolation, or real Nebius execution. It does not include credentials, deployment automation, repository write authority, or payment/outbound authority. Those boundaries make the demo truthful and give a later Nebius-hosted adapter a small, auditable seam.
