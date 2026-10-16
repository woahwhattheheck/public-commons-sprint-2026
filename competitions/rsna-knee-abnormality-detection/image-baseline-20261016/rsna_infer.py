"""Image-only, offline RSNA inference. No outside assets or fallback predictions.

Run only inside the rules-accepted competition compute environment. The test
CSV, images, study identifiers and output CSV never leave that environment.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import time
from typing import Sequence

LABELS = ("ACL", "MCL", "Medial Meniscus", "Lateral Meniscus", "Medial OA",
          "Lateral OA", "PF OA", "Effusion", "Synovitis", "Baker's", "Contusion", "Fracture")
COLUMNS = ("StudyInstanceUID", *LABELS)
COMPETITION = "rsna-knee-abnormality-detection"
LIMIT_SECONDS = 9 * 60 * 60


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_official_test_ids(path: Path) -> tuple[str, ...]:
    """Preserve official test.csv identity/order; do not invent or trim IDs."""
    ids = []
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        fields = reader.fieldnames or []
        if len(set(fields)) != len(fields) or "StudyInstanceUID" not in fields:
            raise ValueError("Invalid official test.csv header")
        for row in reader:
            if None in row or any(value is None for value in row.values()):
                raise ValueError("Invalid official test.csv row width")
            uid = row["StudyInstanceUID"]
            if not uid or uid != uid.strip():
                raise ValueError("Official test.csv contains an empty or padded study identifier")
            ids.append(uid)
    if not ids or len(ids) != len(set(ids)):
        raise ValueError("Official test.csv must contain nonempty, unique study identifiers")
    return tuple(ids)


def validate_output(path: Path, expected_ids: Sequence[str]) -> int:
    """Exact 13-column schema, exact official identity/order and finite scores."""
    with path.open(encoding="utf-8", newline="") as stream:
        rows = csv.reader(stream)
        if tuple(next(rows, ())) != COLUMNS:
            raise ValueError("Submission header is not the exact 13-column contract")
        count = 0
        for count, row in enumerate(rows, start=1):
            if len(row) != 13 or count > len(expected_ids):
                raise ValueError("Submission row width/count does not match the contract")
            if row[0] != expected_ids[count - 1]:
                raise ValueError("Submission identity/order differs from official test.csv")
            values = [float(value) for value in row[1:]]
            if not all(math.isfinite(value) and 0 <= value <= 1 for value in values):
                raise ValueError("Submission contains invalid probabilities")
        if count != len(expected_ids) or count == 0:
            raise ValueError("Submission does not cover every official test study")
    return count


def require_competition_checkpoint(meta: dict) -> dict:
    """This candidate deliberately excludes all external datasets and weights."""
    if meta.get("format_version") != 1 or tuple(meta.get("labels", ())) != LABELS:
        raise ValueError("Checkpoint format/target order differs from the model contract")
    if meta.get("competition_slug") != COMPETITION:
        raise ValueError("Checkpoint is not bound to this competition")
    if meta.get("external_data_used") is not False or meta.get("external_weights_used") is not False:
        raise ValueError("This runner admits competition-data-only, randomly initialized training")
    if meta.get("training_data_role") != "train_only":
        raise ValueError("Checkpoint lacks a training-only provenance declaration")
    steps = meta.get("optimizer_steps")
    if type(steps) is not int or steps <= 0:
        raise ValueError("Checkpoint has no recorded training optimizer steps")
    data = meta.get("data_config")
    if not isinstance(data, dict) or not all(key in data for key in ("image_size", "slices_per_series", "max_series")):
        raise ValueError("Checkpoint lacks exact image preprocessing configuration")
    return data


def run_inference(*, data_root: str | Path, checkpoint: str | Path,
                  checkpoint_sha256: str, output_dir: str | Path,
                  device: str = "cuda", batch_size: int = 1, workers: int = 2,
                  start_monotonic: float | None = None, reserve_seconds: float = 180,
                  pilot_studies: int = 16, runtime_safety_factor: float = 1.5) -> dict:
    """Process every official test study; failures never become placeholder scores.

    The measured projection is an early warning, not a <=9h certification. The
    actual full Kaggle execution must complete and be read back by its operator.
    """
    started = time.monotonic() if start_monotonic is None else start_monotonic
    now = time.monotonic()
    if not math.isfinite(started) or started > now:
        raise ValueError("Invalid notebook start time")
    if batch_size < 1 or workers < 0 or pilot_studies < 1:
        raise ValueError("Invalid inference batch/worker/pilot configuration")
    if not math.isfinite(reserve_seconds) or not 0 < reserve_seconds < LIMIT_SECONDS:
        raise ValueError("Invalid runtime reserve")
    if not math.isfinite(runtime_safety_factor) or runtime_safety_factor < 1:
        raise ValueError("Runtime safety factor must be at least one")
    deadline = started + LIMIT_SECONDS - reserve_seconds
    def check_budget():
        if time.monotonic() >= deadline:
            raise TimeoutError("Nine-hour runtime budget reached; no final submission produced")
    check_budget()
    import torch
    from torch.utils.data import DataLoader
    import rsna_data
    import rsna_image_model
    source_root = Path(__file__).resolve().parent
    if any(Path(module.__file__).resolve() != source_root / name for module, name in (
        (rsna_data, "rsna_data.py"), (rsna_image_model, "rsna_image_model.py"))):
        raise ValueError("Loaded model/data modules do not belong to this pinned source directory")
    if tuple(rsna_data.LABELS) != LABELS or tuple(rsna_image_model.LABELS) != LABELS:
        raise ValueError("Source modules disagree on target order")
    if device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("GPU inference was requested but no CUDA device is available")
    if device not in ("cpu", "cuda"):
        raise ValueError("Device must be cpu or cuda")
    data_root, checkpoint, output_dir = Path(data_root), Path(checkpoint), Path(output_dir)
    if len(checkpoint_sha256) != 64 or any(c not in "0123456789abcdef" for c in checkpoint_sha256):
        raise ValueError("An exact lowercase checkpoint SHA-256 is required")
    actual_sha = sha256_file(checkpoint)
    if actual_sha != checkpoint_sha256:
        raise ValueError("Checkpoint bytes do not match the selected trained candidate")
    expected_ids = read_official_test_ids(data_root / "test.csv")
    model, meta = rsna_image_model.load_model(checkpoint, device=device)
    data_config = require_competition_checkpoint(meta)
    studies = rsna_data.read_studies(data_root, split="test")
    if tuple(study.study_uid for study in studies) != expected_ids:
        raise ValueError("Dataset identity/order differs from official test.csv")
    dataset = rsna_data.RSNAStudyDataset(data_root, studies, split="test",
        image_size=data_config["image_size"], slices_per_series=data_config["slices_per_series"],
        max_series=data_config["max_series"])
    if dataset.data_config != data_config:
        raise ValueError("Inference preprocessing differs from the trained checkpoint")
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=False, num_workers=workers,
                        collate_fn=rsna_data.collate_studies, pin_memory=(device == "cuda"))
    output_dir.mkdir(parents=True, exist_ok=True)
    final = output_dir / "submission.csv"
    receipt_path = output_dir / "inference_receipt.json"
    partial = output_dir / ("submission.partial-" + actual_sha[:12] + ".csv")
    if final.exists() or receipt_path.exists() or partial.exists():
        raise FileExistsError("Preserve existing inference outputs; use a fresh output directory")
    count, durations, projections = 0, [], []
    inference_started = time.monotonic()
    last_batch_time = inference_started
    try:
        with partial.open("x", encoding="utf-8", newline="") as stream:
            writer = csv.writer(stream, lineterminator="\n")
            writer.writerow(COLUMNS)
            for batch in loader:
                check_budget()
                batch_ids = tuple(batch["study_ids"])
                if not batch_ids or batch_ids != expected_ids[count:count + len(batch_ids)]:
                    raise ValueError("Model batch identity/order differs from official test.csv")
                with torch.inference_mode():
                    probabilities = rsna_image_model.predict_batch(model, batch, device=device)
                    probabilities = probabilities.detach().float().cpu()
                if tuple(probabilities.shape) != (len(batch_ids), 12):
                    raise ValueError("Model output shape must be batch size by twelve")
                if not bool(torch.isfinite(probabilities).all()) or not bool(((probabilities >= 0) & (probabilities <= 1)).all()):
                    raise ValueError("Model produced invalid probabilities; no clipping/fallback applied")
                for uid, scores in zip(batch_ids, probabilities.tolist()):
                    writer.writerow([uid, *(format(score, ".12g") for score in scores)])
                count += len(batch_ids)
                current = time.monotonic()
                durations.append((current - last_batch_time) / len(batch_ids))
                last_batch_time = current
                check_budget()
                if count >= pilot_studies or count == len(expected_ids):
                    elapsed = current - started
                    observed_mean = (current - inference_started) / count
                    ordered = sorted(durations)
                    p95 = ordered[min(len(ordered)-1, math.ceil(.95 * len(ordered))-1)]
                    projected = elapsed + max(observed_mean, p95) * (len(expected_ids)-count) * runtime_safety_factor + reserve_seconds
                    projections.append({"completed_studies": count, "elapsed_seconds": elapsed,
                                        "projected_total_seconds": projected})
                    if projected >= LIMIT_SECONDS:
                        raise TimeoutError("Measured projection exceeds nine-hour budget; profile a faster candidate")
            stream.flush()
            os.fsync(stream.fileno())
        check_budget()
        rows = validate_output(partial, expected_ids)
        elapsed = time.monotonic() - started
        if elapsed >= LIMIT_SECONDS - reserve_seconds:
            raise TimeoutError("Runtime reserve exhausted before finalization")
        receipt = {
            "status": "COMPLETE_LOCAL_INFERENCE_NOT_SUBMITTED", "competition_slug": COMPETITION,
            "rows": rows, "columns": list(COLUMNS), "official_test_csv_sha256": sha256_file(data_root / "test.csv"),
            "checkpoint_sha256": actual_sha, "submission_sha256": sha256_file(partial),
            "source_sha256": {name: sha256_file(source_root / name)
                              for name in ("rsna_infer.py", "rsna_data.py", "rsna_image_model.py")},
            "data_config": data_config, "device": device,
            "device_name": torch.cuda.get_device_name(0) if device == "cuda" else "CPU",
            "torch_version": str(torch.__version__), "batch_size": batch_size, "workers": workers,
            "elapsed_seconds": elapsed, "runtime_limit_seconds": LIMIT_SECONDS,
            "runtime_reserve_seconds": reserve_seconds, "runtime_projections": projections,
            "external_data_used": False, "external_weights_used": False,
            "hosted_api_calls": False, "account_internet_disabled_setting": "operator_must_verify",
        }
        receipt["dependency_versions"] = {}
        for distribution in ("torch", "numpy", "Pillow", "pydicom", "pylibjpeg", "pylibjpeg-libjpeg", "pylibjpeg-openjpeg"):
            try:
                receipt["dependency_versions"][distribution] = importlib.metadata.version(distribution)
            except importlib.metadata.PackageNotFoundError:
                receipt["dependency_versions"][distribution] = None
        with receipt_path.open("x", encoding="utf-8") as stream:
            json.dump(receipt, stream, indent=2, sort_keys=True)
            stream.write("\n")
        # Atomic hard-link creation refuses to overwrite a file that appeared
        # after the initial existence check. The private partial is retained.
        os.link(partial, final)
        return receipt
    except Exception:
        # Never rename an incomplete prediction table to submission.csv and never
        # print identifiers, DICOM paths, reports or checkpoint tensor contents.
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--checkpoint-sha256", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cuda")
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--workers", type=int, default=2)
    args = parser.parse_args()
    result = run_inference(**vars(args))
    print(json.dumps({key: result[key] for key in ("status", "rows", "elapsed_seconds", "checkpoint_sha256", "submission_sha256")}, sort_keys=True))


if __name__ == "__main__":
    main()
