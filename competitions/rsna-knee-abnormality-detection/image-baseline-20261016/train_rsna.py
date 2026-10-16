"""Train the real image-only RSNA baseline on an existing authorized data host.

No competition download, provider submission, external weights or cloud creation
is performed. Training requires the official mounted data and PyTorch runtime.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
from pathlib import Path
import random
import sys
import time
from datetime import datetime, timezone

import numpy as np

from rsna_data import (
    RSNAStudyDataset, assign_grouped_folds, collate_studies,
    read_studies, training_class_weights,
)
from rsna_metrics import evaluate_predictions

LABELS = ("ACL", "MCL", "Medial Meniscus", "Lateral Meniscus", "Medial OA",
          "Lateral OA", "PF OA", "Effusion", "Synovitis", "Baker's", "Contusion", "Fracture")


COMPETITION = "rsna-knee-abnormality-detection"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def json_atomic(path: Path, payload: dict):
    temporary = path.with_name(path.name + ".partial")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(payload, stream, indent=2, sort_keys=True, allow_nan=False)
        stream.write("\n")
    temporary.replace(path)


def save_checkpoint(path: Path, payload: dict):
    temporary = path.with_name(path.name + ".partial")
    torch.save(payload, temporary)
    temporary.replace(path)


def seed_all(seed: int):
    random.seed(seed)
    np.random.seed(seed % (2 ** 32))
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def worker_seed(_worker_id):
    value = torch.initial_seed() % (2 ** 32)
    np.random.seed(value)
    random.seed(value)


def grouping_fingerprint(studies, folds) -> str:
    # Identifiers are hashed here and retained only in the runtime-local folds.csv.
    rows = sorted((row.study_uid, row.group_id, folds[row.study_uid],
                   list(row.labels), list(row.label_mask), list(row.gold_mask))
                  for row in studies)
    return hashlib.sha256(json.dumps(rows, separators=(",", ":"),
                                     allow_nan=False).encode()).hexdigest()


def data_metadata_hashes(root: Path) -> dict:
    # Only official metadata, not MRI pixels, enter this small manifest.
    return {name: {"sha256": sha256(root / name), "bytes": (root / name).stat().st_size}
            for name in ("train.csv", "train_series.csv")}


def label_coverage(studies, gold_only: bool = False) -> dict:
    coverage = {}
    for index, label in enumerate(LABELS):
        observed = [int(row.labels[index]) for row in studies
                    if (row.gold_mask if gold_only else row.label_mask)[index]]
        coverage[label] = {"observed": len(observed), "positive": sum(observed),
                           "negative": len(observed) - sum(observed)}
    return coverage


def evaluate(model, loader, device, pos_weight, *, deadline=None):
    model.eval()
    targets, predictions, masks, study_ids = [], [], [], []
    loss_numerator = torch.zeros(12, device=device, dtype=torch.float64)
    loss_denominator = torch.zeros(12, device=device, dtype=torch.float64)
    with torch.inference_mode():
        for batch in loader:
            if deadline is not None and time.monotonic() >= deadline:
                raise TimeoutError("validation incomplete at runtime budget; no partial AUC reported")
            logits = model(move_model_inputs(batch, device)).float()
            gold_mask = batch["gold_mask"].to(device)
            target = batch["targets"].to(device)
            # Validation measures only gold labels, never optional weak targets.
            if gold_mask.any():
                safe = torch.where(gold_mask, target, torch.zeros_like(target)).float()
                raw = torch.nn.functional.binary_cross_entropy_with_logits(
                    logits, safe, pos_weight=pos_weight, reduction="none")
                loss_numerator += (raw * gold_mask.float()).sum(dim=0).double()
                loss_denominator += gold_mask.sum(dim=0).double()
            targets.extend(target.cpu().tolist())
            predictions.extend(torch.sigmoid(logits).cpu().tolist())
            masks.extend(gold_mask.cpu().tolist())
            study_ids.extend(batch["study_ids"])
    metrics = evaluate_predictions(targets, predictions, mask=masks)
    observed = loss_denominator > 0
    metrics["validation_loss"] = (float((loss_numerator[observed] / loss_denominator[observed]).mean())
                                  if observed.any() else None)
    metrics["studies"] = len(study_ids)
    metrics["gold_labels_only"] = True
    return metrics, study_ids, targets, predictions, masks


def write_predictions(path, ids, targets, predictions, masks):
    # Remains on authorized compute: do not post this file or its UIDs to Slack.
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["StudyInstanceUID", *LABELS,
                         *[f"target:{label}" for label in LABELS],
                         *[f"gold_mask:{label}" for label in LABELS]])
        for uid, target, scores, mask in zip(ids, targets, predictions, masks):
            writer.writerow([uid, *scores, *target, *[int(value) for value in mask]])


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--operation-id", required=True)
    parser.add_argument("--official-data-confirmed", action="store_true",
                        help="operator confirms this is the authorized official competition mount")
    parser.add_argument("--patient-groups", type=Path)
    parser.add_argument("--require-patient-groups", action="store_true")
    parser.add_argument("--fold", type=int, default=0)
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--seed", type=int, default=20261015)
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--accumulation-steps", type=int, default=8)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--image-size", type=int, default=320)
    parser.add_argument("--slices-per-series", type=int, default=16)
    parser.add_argument("--max-series", type=int)
    parser.add_argument("--width", type=int, default=32)
    parser.add_argument("--feature-dim", type=int, default=256)
    parser.add_argument("--encoder-chunk-size", type=int, default=32)
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--max-pos-weight", type=float, default=20.0)
    parser.add_argument("--checkpoint-every-steps", type=int, default=100)
    parser.add_argument("--max-runtime-seconds", type=int, default=28800,
                        help="hard cooperative budget including validation; default eight hours")
    parser.add_argument("--validation-reserve-seconds", type=int, default=1800)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--no-amp", action="store_true")
    parser.add_argument("--resume", type=Path)
    return parser.parse_args()


def train(args) -> int:
    # Keep --help/source inspection usable without installing a GPU stack.
    global torch, DataLoader, KneeImageMIL, ModelConfig, checkpoint_payload
    global masked_bce_loss, move_model_inputs
    import torch
    from torch.utils.data import DataLoader
    from rsna_image_model import (KneeImageMIL, ModelConfig, checkpoint_payload,
                                  masked_bce_loss, move_model_inputs)
    if not args.official_data_confirmed:
        raise ValueError("official mounted competition data must be confirmed; no download is performed")
    if not args.data_root.is_dir():
        raise FileNotFoundError("official data mount is unavailable")
    if args.device.startswith("cuda") and not torch.cuda.is_available():
        raise RuntimeError("requested CUDA runtime is unavailable; no new compute is created")
    if not 0 <= args.fold < args.folds or args.folds < 2:
        raise ValueError("invalid grouped fold selection")
    if min(args.epochs, args.batch_size, args.accumulation_steps, args.image_size,
           args.slices_per_series, args.max_runtime_seconds, args.checkpoint_every_steps) < 1:
        raise ValueError("epochs, batch/image sizes, accumulation and runtime must be positive")
    if not 0 <= args.validation_reserve_seconds < args.max_runtime_seconds:
        raise ValueError("validation reserve must be less than total runtime")
    if args.workers < 0 or args.learning_rate <= 0 or args.weight_decay < 0:
        raise ValueError("invalid worker or optimizer configuration")
    if args.output.exists() and any(args.output.iterdir()) and args.resume is None:
        raise ValueError("output already contains files: resume the existing run or use a new run directory")
    args.output.mkdir(parents=True, exist_ok=True)
    seed_all(args.seed)
    started = time.monotonic()
    deadline = started + args.max_runtime_seconds
    train_deadline = deadline - args.validation_reserve_seconds
    device = torch.device(args.device)
    use_amp = device.type == "cuda" and not args.no_amp
    patient_groups = None
    if args.patient_groups:
        with args.patient_groups.open(encoding="utf-8") as stream:
            patient_groups = json.load(stream)
        if not isinstance(patient_groups, dict):
            raise ValueError("patient-groups must be a JSON study-to-patient mapping")
    studies = read_studies(args.data_root, split="train", patient_groups=patient_groups)
    folds = assign_grouped_folds(studies, n_folds=args.folds, seed=args.seed,
                                 require_patient_groups=args.require_patient_groups)
    train_rows = [row for row in studies if folds[row.study_uid] != args.fold]
    valid_rows = [row for row in studies if folds[row.study_uid] == args.fold]
    if not train_rows or not valid_rows:
        raise ValueError("grouped split produced empty train or validation partition")
    train_groups = {row.group_id for row in train_rows}
    valid_groups = {row.group_id for row in valid_rows}
    if train_groups & valid_groups:
        raise ValueError("group leakage between train and validation")
    train_partition_size, validation_partition_size = len(train_rows), len(valid_rows)
    # Fully unlabeled studies contribute no supervised gradient or gold metric.
    # Preserve their fold assignments, but do not waste the MRI decoding budget.
    train_rows = [row for row in train_rows if any(row.label_mask)]
    valid_rows = [row for row in valid_rows if any(row.gold_mask)]
    if not train_rows or not valid_rows:
        raise ValueError("grouped split lacks supervised train or gold-validation studies")
    missing_training = [label for label, counts in label_coverage(train_rows).items()
                        if not counts["positive"] or not counts["negative"]]
    if missing_training:
        raise ValueError("training fold lacks positive/negative labels: " + ", ".join(missing_training))
    dataset_args = {"image_size": args.image_size, "slices_per_series": args.slices_per_series,
                    "max_series": args.max_series, "seed": args.seed}
    train_dataset = RSNAStudyDataset(args.data_root, train_rows, split="train", training=True, **dataset_args)
    validation_dataset = RSNAStudyDataset(args.data_root, valid_rows, split="train", training=False, **dataset_args)
    data_config = validation_dataset.data_config
    generator = torch.Generator()
    loader_config = {"batch_size": args.batch_size, "num_workers": args.workers,
                     "collate_fn": collate_studies, "pin_memory": device.type == "cuda",
                     "worker_init_fn": worker_seed, "persistent_workers": False}
    train_loader = DataLoader(train_dataset, shuffle=True, generator=generator, **loader_config)
    validation_loader = DataLoader(validation_dataset, shuffle=False, **loader_config)
    pos_weight = torch.as_tensor(training_class_weights(train_rows, max_weight=args.max_pos_weight),
                                 device=device, dtype=torch.float32)
    model = KneeImageMIL(ModelConfig(width=args.width, feature_dim=args.feature_dim,
                                    encoder_chunk_size=args.encoder_chunk_size)).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate,
                                  weight_decay=args.weight_decay)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)
    scaler = torch.amp.GradScaler("cuda", enabled=use_amp)
    source_dir = Path(__file__).resolve().parent
    sources = {name: sha256(source_dir / name) for name in
               ("train_rsna.py", "rsna_image_model.py", "rsna_data.py", "rsna_metrics.py")}
    fingerprint = grouping_fingerprint(studies, folds)
    provenance = {
        "operation_id": args.operation_id, "competition_slug": COMPETITION,
        "external_data_used": False, "external_weights_used": False,
        "training_data_role": "train_only", "image_only_inference": True,
        "data_config": data_config, "source_sha256": sources,
        "metadata_files": data_metadata_hashes(args.data_root),
        "split_fingerprint": fingerprint, "fold": args.fold, "folds": args.folds,
        "seed": args.seed, "train_studies": len(train_rows), "validation_studies": len(valid_rows),
        "train_partition_studies": train_partition_size,
        "validation_partition_studies": validation_partition_size,
        "supervision": "official_observed_labels_only",
        "group_sources": sorted({row.group_source for row in studies}),
        "patient_disjointness_verified": all(row.group_source == "patient" for row in studies),
        "study_disjointness_verified": True, "group_overlap": 0,
        "train_label_coverage": label_coverage(train_rows),
        "validation_gold_coverage": label_coverage(valid_rows, gold_only=True),
        "pos_weight": pos_weight.cpu().tolist(), "device": str(device),
        "torch_version": str(torch.__version__), "started_at": now(),
        "status": "TRAINING", "optimizer_steps": 0,
    }
    with (args.output / "folds.csv").open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["StudyInstanceUID", "group_id", "group_source", "fold"])
        for row in studies:
            writer.writerow([row.study_uid, row.group_id, row.group_source, folds[row.study_uid]])
    start_epoch, optimizer_steps, best_value, best_criterion = 0, 0, -math.inf, None
    if args.resume:
        saved = torch.load(args.resume, map_location=device, weights_only=True)
        for key in ("competition_slug", "split_fingerprint", "source_sha256", "data_config"):
            if saved.get(key) != provenance[key]:
                raise ValueError("resume source/data mismatch: " + key)
        if saved.get("operation_id") != args.operation_id:
            raise ValueError("resume operation ID differs from original run")
        model.load_state_dict(saved["model_state"], strict=True)
        optimizer.load_state_dict(saved["optimizer_state"])
        scheduler.load_state_dict(saved["scheduler_state"])
        scaler.load_state_dict(saved["scaler_state"])
        start_epoch, optimizer_steps = saved["epoch"] + 1, saved["optimizer_steps"]
        best_value = saved.get("best_value")
        best_value = float(best_value) if best_value is not None else -math.inf
        best_criterion = saved.get("best_criterion")
        provenance["resumed_from_sha256"] = sha256(args.resume)
        provenance["resumed_after_partial_epoch"] = not saved.get("epoch_complete", False)
    json_atomic(args.output / "run_manifest.json", provenance)
    def emit(event):
        event = {"at": now(), **event}
        text = json.dumps(event, allow_nan=False)
        with (args.output / "training_log.jsonl").open("a", encoding="utf-8") as stream:
            stream.write(text + "\n")
        print(text, flush=True)
    emit({key: provenance[key] for key in
          ("operation_id", "train_studies", "validation_studies", "group_sources", "device")})
    stop_reason = "epochs_completed"
    try:
        for epoch in range(start_epoch, args.epochs):
            if time.monotonic() >= train_deadline:
                stop_reason = "training_time_budget"
                break
            seed_all(args.seed + epoch)
            generator.manual_seed(args.seed + epoch)
            train_dataset.set_epoch(epoch)
            model.train()
            optimizer.zero_grad(set_to_none=True)
            train_loss_sum, batches_seen, window_count = 0.0, 0, 0
            epoch_complete = True
            for batch_index, batch in enumerate(train_loader):
                if time.monotonic() >= train_deadline:
                    epoch_complete = False
                    stop_reason = "training_time_budget"
                    break
                if not batch["target_mask"].any():
                    continue
                with torch.autocast(device_type=device.type, dtype=torch.float16, enabled=use_amp):
                    logits = model(move_model_inputs(batch, device))
                    loss = masked_bce_loss(logits, batch["targets"].to(device),
                                           batch["target_mask"].to(device), pos_weight,
                                           batch["target_weight"].to(device))
                if not torch.isfinite(loss):
                    raise RuntimeError("non-finite training loss")
                scaler.scale(loss / args.accumulation_steps).backward()
                window_count += 1
                batches_seen += 1
                train_loss_sum += float(loss.detach())
                end_window = window_count == args.accumulation_steps or batch_index + 1 == len(train_loader)
                if end_window:
                    # Correct the final short accumulation window's effective LR.
                    scaler.unscale_(optimizer)
                    if window_count != args.accumulation_steps:
                        for parameter in model.parameters():
                            if parameter.grad is not None:
                                parameter.grad.mul_(args.accumulation_steps / window_count)
                    norm = torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0, error_if_nonfinite=True)
                    scaler.step(optimizer)
                    scaler.update()
                    optimizer.zero_grad(set_to_none=True)
                    window_count = 0
                    optimizer_steps += 1
                    if optimizer_steps % args.checkpoint_every_steps == 0:
                        partial_progress = {**provenance, "optimizer_steps": optimizer_steps,
                            "epoch": epoch, "epoch_complete": False, "validation": None,
                            "best_value": best_value if math.isfinite(best_value) else None,
                            "best_criterion": best_criterion, "saved_at": now()}
                        save_checkpoint(args.output / "last.pt", checkpoint_payload(model,
                            **partial_progress, optimizer_state=optimizer.state_dict(),
                            scheduler_state=scheduler.state_dict(), scaler_state=scaler.state_dict()))
                if batches_seen % 25 == 0:
                    emit({"epoch": epoch, "batches": batches_seen,
                                      "optimizer_steps": optimizer_steps,
                                      "mean_train_loss": train_loss_sum / batches_seen,
                                      "elapsed_seconds": round(time.monotonic() - started, 2)})
            if window_count:
                scaler.unscale_(optimizer)
                for parameter in model.parameters():
                    if parameter.grad is not None:
                        parameter.grad.mul_(args.accumulation_steps / window_count)
                torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0, error_if_nonfinite=True)
                scaler.step(optimizer)
                scaler.update()
                optimizer.zero_grad(set_to_none=True)
                optimizer_steps += 1
            if not optimizer_steps:
                raise RuntimeError("no optimizer update was completed; no trained checkpoint exists")
            scheduler.step()
            # Save real learned state before validation so timeout cannot erase work.
            progress = {**provenance, "optimizer_steps": optimizer_steps, "epoch": epoch,
                        "epoch_complete": epoch_complete, "validation": None,
                        "best_value": best_value if math.isfinite(best_value) else None,
                        "best_criterion": best_criterion, "saved_at": now()}
            state = checkpoint_payload(model, **progress, optimizer_state=optimizer.state_dict(),
                                       scheduler_state=scheduler.state_dict(), scaler_state=scaler.state_dict())
            save_checkpoint(args.output / "last.pt", state)
            metrics, ids, targets, scores, masks = evaluate(model, validation_loader, device, pos_weight,
                                                           deadline=deadline)
            strict_auc = metrics["macro_auc"]
            if strict_auc is not None:
                criterion, value = "macro_auc_all_12_gold_labels", float(strict_auc)
            elif metrics["validation_loss"] is not None:
                criterion, value = "negative_gold_validation_loss_undefined_12_label_auc", -metrics["validation_loss"]
            else:
                raise ValueError("validation contains no observed gold labels")
            if best_criterion is not None and criterion != best_criterion:
                raise ValueError("checkpoint-selection metric changed during the same run")
            improved = value > best_value
            if improved:
                best_value, best_criterion = value, criterion
            progress.update(validation=metrics, best_value=best_value, best_criterion=best_criterion,
                            elapsed_seconds=time.monotonic() - started)
            state = checkpoint_payload(model, **progress, optimizer_state=optimizer.state_dict(),
                                       scheduler_state=scheduler.state_dict(), scaler_state=scaler.state_dict())
            save_checkpoint(args.output / "last.pt", state)
            if improved:
                # Inference artifact excludes optimizer/scaler state.
                best = args.output / "best.pt"
                save_checkpoint(best, checkpoint_payload(model, **progress))
                write_predictions(args.output / "validation_predictions.csv", ids, targets, scores, masks)
                json_atomic(args.output / "selected_model.json", {
                    "checkpoint_filename": best.name, "checkpoint_sha256": sha256(best),
                    "checkpoint_bytes": best.stat().st_size, "epoch": epoch,
                    "optimizer_steps": optimizer_steps, "criterion": criterion,
                    "criterion_value": value, "validation": metrics,
                    "operation_id": args.operation_id, "source_sha256": sources})
            event = {"epoch": epoch, "epoch_complete": epoch_complete, "optimizer_steps": optimizer_steps,
                     "train_loss": train_loss_sum / batches_seen if batches_seen else None,
                     "validation": metrics, "selected": improved, "elapsed_seconds": time.monotonic() - started}
            with (args.output / "epochs.jsonl").open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(event, allow_nan=False) + "\n")
            emit(event)
            provenance.update(optimizer_steps=optimizer_steps, last_epoch=epoch, last_validation=metrics)
            json_atomic(args.output / "run_manifest.json", provenance)
            if not epoch_complete:
                break
        if not (args.output / "selected_model.json").exists():
            raise RuntimeError("no fully validated checkpoint was selected")
        provenance.update(status="COMPLETED", stop_reason=stop_reason, finished_at=now(),
                          elapsed_seconds=time.monotonic() - started)
        provenance["artifacts"] = {name: {"sha256": sha256(args.output / name),
                                         "bytes": (args.output / name).stat().st_size}
                                   for name in ("best.pt", "last.pt", "selected_model.json", "epochs.jsonl",
                                                "folds.csv", "validation_predictions.csv")
                                   if (args.output / name).exists()}
        json_atomic(args.output / "run_manifest.json", provenance)
        emit({"status": "COMPLETED", "optimizer_steps": optimizer_steps,
                          "stop_reason": stop_reason, "best_criterion": best_criterion,
                          "best_value": best_value})
        provenance["artifacts"]["training_log.jsonl"] = {
            "sha256": sha256(args.output / "training_log.jsonl"),
            "bytes": (args.output / "training_log.jsonl").stat().st_size}
        json_atomic(args.output / "run_manifest.json", provenance)
        return 0
    except BaseException as error:
        provenance.update(status="FAILED_OR_INTERRUPTED", optimizer_steps=optimizer_steps,
                          error_type=type(error).__name__, error=str(error), finished_at=now(),
                          elapsed_seconds=time.monotonic() - started)
        json_atomic(args.output / "run_manifest.json", provenance)
        raise


def main():
    args = arguments()
    try:
        return train(args)
    except Exception as error:
        print(f"RSNA training failed: {type(error).__name__}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
