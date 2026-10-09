# Agenthon Track 4 — published image delivery

## Runnable, anonymously accessible image

```text
ghcr.io/woahwhattheheck/agenthon-t4-grounded-finance@sha256:76a1a7c9f1e64851d9d18995373bc48d39c4a47b4aa96b3f24fde54e38d66cb5
```

The image was built and pushed by the original repository account on 2026-10-09. A pull using an empty, explicitly separate Docker configuration exited **0**. An independent authenticated package metadata read returned **visibility: public**, package ID `15733767`, linked to this repository. No registry credential belongs in a competition descriptor.

[Successful build, execution and publication](https://github.com/woahwhattheheck/public-commons-sprint-2026/actions/runs/37892880593)

[Portable image archive, logs and machine-readable receipts](https://github.com/woahwhattheheck/public-commons-sprint-2026/actions/runs/37892880593/artifacts/11599496152)

## Exact source and provenance

- Candidate: `agenthon-t4-grounded-finance/` at `cc8076bc354cece703dc7d4428d09503e5f56c73`.
- Official public unit: `Agenthon-2026/track4-analysis-public@458bc07efc05983de342ccb371e2b3cd793d621f`, `units/t4-EXAMPLE-eps-beat`.
- Official shared toolkit: tag `v2.5.1`, resolved commit `50fb2dc2b39c70f4cf81fcd269943782eddfaed0`.
- Delivery workflow commit: `67d3ec36e55ae5cb73a7963ee0d6be4d82facf7d`.
- Platform: Linux/amd64. Image size: 118331183 bytes. Required `qfbench2.interface_version=2.0` label is present; no `VOLUME` is declared or inherited.
- Image configuration ID: `sha256:e1ca4917d33719f096af99870103c325044c2954daa6ca12dea0c4725dde75ef`.
- Effective Dockerfile adds the repository's existing MIT license to `/app/LICENSE` and provenance labels. Solver source is unchanged. `Dockerfile.effective` is in the evidence archive.

## Executed public-unit result

The built image ran the organizer's actual `analyze` command against the public exemplar with `--network=none`, a read-only root filesystem, read-only input, dropped capabilities and the output directory owner's UID/GID. It wrote `/output/answer.json` and exited successfully. The answer passed the official analysis JSON schema and exactly matched the task's entity roster.

```bash
IMAGE=ghcr.io/woahwhattheheck/agenthon-t4-grounded-finance@sha256:76a1a7c9f1e64851d9d18995373bc48d39c4a47b4aa96b3f24fde54e38d66cb5
# UNIT and OUT must be absolute paths; OUT must exist and be writable by this user.
docker run --rm --network=none --read-only --cap-drop=ALL \
  --user "$(id -u):$(id -g)" --security-opt no-new-privileges \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m -e PYTHONDONTWRITEBYTECODE=1 \
  -v "$UNIT:/input:ro" -v "$OUT:/output:rw" \
  "$IMAGE" analyze --offline --task /input/task.json \
  --corpus /input/corpus --out /output/answer.json
```

This is a **runtime and schema result**, not a prediction-quality score, House-model execution, NLI result, or competition submission. The single-entity public exemplar does not establish multi-entity manifest-affinity correctness. Later solver changes require a new source-specific image; do not relabel this digest as containing changes after the pinned commit.

## Integrity

| Artifact | SHA-256 |
|---|---|
| Evidence ZIP | `e6fc047bb3166bd31bc84bac151f989e9245fa53fbb43bb22e0cf0ba60c66f64` |
| `agenthon-t4-image.tar.gz` inside ZIP | `9691e93b8a2bc3fd817f9e94370a85ef038bf7e331fea32f379fc6928e77c09b` |
| Public-unit answer | `8ce5638f0630decbbd25e335eb23c1f5e725cb33f054a68430a1f582a8780530` |
| Official analysis schema | `8a997f21a929f09596db805430839b281548ad0babab29bd1f3daa8456d38049` |

The image archive can be loaded using `gzip -dc agenthon-t4-image.tar.gz | docker load`. The Actions artifact expires on 2026-10-16; the public registry digest is the delivery reference.

## Remaining submission action

Use the current official toolkit and the existing team's private registration state to construct and validate the descriptor and submission ZIP. Keep the Team Key and submission proof private. Do not invent a team ID, descriptor digest, model execution record, or registration receipt. This delivery has not registered a team, uploaded to CodaBench, or asserted a prize, ranking or payment.

The first delivery attempt's public-unit step failed because its output directory owner did not match the capability-restricted container user. The successful run fixes the runner UID/GID mapping; it does not silently alter the agent to suppress that failure.
