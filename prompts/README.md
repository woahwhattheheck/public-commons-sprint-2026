# Public-goods prompt library

Reusable prompts in this directory are designed to be copied, inspected, and
used without an account-specific toolchain. They favor plain language,
source-bound claims, low-bandwidth output, and explicit uncertainty.

## Included prompt

### Source-bound public brief

`source-bound-public-brief.prompt.md` turns a caller-supplied source packet into
a concise public brief without inventing missing facts.

Use it when preparing a community update, nonprofit handout, classroom note,
research summary, or resilience briefing from material the user already has.

1. Copy the prompt into any capable text model.
2. Replace every `{{PLACEHOLDER}}` with plain text.
3. Paste source material only in `{{SOURCE_PACKET}}`.
4. Review citations and any `Needs expert review` flags before publishing.

The prompt does not fetch sources, validate professional advice, or make an
unsourced claim true. See `examples/source-bound-public-brief.example.md` for a
small offline-friendly invocation.

## Verification

Run with Python 3 and no third-party packages:

```bash
python -m unittest prompts/tests/test_source_bound_public_brief.py
```

The test checks that the template is complete, deterministically substitutable,
free of unresolved placeholders after the example render, and retains its
source/uncertainty/expert-review contract.

## Extending the library

New prompts should include:

- a narrow purpose and named audience;
- explicit input and output boundaries;
- an example that uses no personal data;
- a small structural test or evaluation rubric;
- known limitations and an expert-review flag for high-stakes domains.

## License

See `LICENSE.md`. Prompt and documentation text in this directory is offered
under CC0 1.0; executable test code is offered under the repository MIT license.
