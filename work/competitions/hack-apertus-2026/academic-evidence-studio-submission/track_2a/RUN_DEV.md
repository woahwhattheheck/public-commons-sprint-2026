# Resume the genuine OST Task B evaluation

`main.py` remains the organizer prediction entrypoint. `run_dev.py` is an optional Linux development driver calling the same `predict_case` implementation. It preserves completed predictions across a later provider error so the genuine 1,488-case full/selected comparison can resume.

This change also replaces nonbreaking whitespace accidentally present in the published Python indentation of `main.py` and `evaluate_dev.py` with normal spaces. The previous exact predictor blob `002921161acda210539cb82c9271ff22ea13977c` failed to import at line 21 with `SyntaxError: invalid non-printable character U+00A0`; the evaluator blob `ecad1b814fce875b7cff64056dd7ef2b7f5d0141` had the same nonbreaking whitespace. This normalization retains their logic.

Configure the existing authorized provider with runtime environment variables. Never write an API key into a command, result, or checkpoint. CSCS/Hugging Face-style mixed-case model IDs and Public AI's documented lowercase `swiss-ai/apertus-v1.5-8b` are accepted. The configured identifier is transmitted unchanged; another model family is rejected. For Public AI, explicitly use its lowercase model ID and `BASE_URL=https://api.publicai.co/v1`; do not assume the mixed-case default is a provider alias. Provider reference: <https://platform.publicai.co/docs>.

Reuse the already prepared original cases/gold files. Use different checkpoint directories for each arm:

```sh
python run_dev.py --input /WORK/ost-dev-cases.jsonl --output /WORK/full.jsonl --checkpoint-dir /WORK/full-checkpoint --strategy full
python run_dev.py --input /WORK/ost-dev-cases.jsonl --output /WORK/selected.jsonl --checkpoint-dir /WORK/selected-checkpoint --strategy selected
python evaluate_dev.py --gold /WORK/ost-dev-gold.jsonl --predictions full=/WORK/full.jsonl --predictions selected=/WORK/selected.jsonl --output /WORK/comparison.json
```

Rerun the same command after resolving a provider failure. Successful per-case files are synced and atomically committed. They are reused without another model call. The manifest binds exact predictor and driver source, input bytes, model identifier, endpoint, strategy, context limit, and timeout. A changed binding requires a new checkpoint directory; results from different arms or revisions are never silently mixed. A process lock prevents two runners using the same directory concurrently.

No retry occurs within one invocation. An interrupted request, or a response received just before an uncommitted process crash, may have consumed provider usage without a saved prediction; resuming requests that unfinished case again. This is not an exactly-once remote-call guarantee. A complete previous output remains untouched on failure. `CHECKPOINT/predictions.partial.jsonl` then contains the completed prefix and can be evaluated with the original full gold denominator. It is partial development output, not a finished submission. Only successful completion replaces `--output`.

Task A PDFs continue through `main.py`; this driver accepts only Task B embedded reference text so its manifest covers the complete input source. It neither downloads data nor creates accounts, executes submissions, launches Actions, or substitutes labels. Accepted PR663/PR664 behavior and authorship are retained.

Focused offline change check (no model call): `python -m unittest -q test_run_dev_resume.py`. This checks interrupted execution/resume, unchanged output on failure, configuration binding, and the documented lowercase model identifier. It is not a benchmark score.
