"""Official-data, image-only RSNA 2026 input pipeline.

Use only inside an authorized competition-data environment. This module never
downloads data, sends reports to a service, or writes images/identifiers. It keeps
reports out of model records. DICOM decoding and torch imports are lazy so the
metadata contract can be used without a GPU. No result here is an official score.
"""
from __future__ import annotations

import csv
import hashlib
import math
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence

import numpy as np

LABELS = (
    "ACL", "MCL", "Medial Meniscus", "Lateral Meniscus", "Medial OA",
    "Lateral OA", "PF OA", "Effusion", "Synovitis", "Baker's", "Contusion", "Fracture",
)
PLANES = ("Sagittal", "Coronal", "Axial")
MISSING_LABELS = {"", "nan", "na", "null", "none"}


class DataContractError(ValueError):
    """A safe error whose message does not include medical identifiers/reports."""


@dataclass(frozen=True)
class SeriesRecord:
    study_uid: str
    series_uid: str
    plane: str
    fluid_sensitive: int
    fat_suppression: int

    @property
    def metadata(self) -> tuple[float, ...]:
        return (*[float(self.plane == plane) for plane in PLANES],
                float(self.fluid_sensitive), float(self.fat_suppression))


@dataclass(frozen=True)
class StudyRecord:
    study_uid: str
    group_id: str
    group_source: str
    labels: tuple[float, ...]
    label_mask: tuple[bool, ...]
    label_weight: tuple[float, ...]
    gold_mask: tuple[bool, ...]
    series: tuple[SeriesRecord, ...]


def _identifier(value: object) -> str:
    # Do not silently repair IDs: the submission must retain official raw keys.
    if (not isinstance(value, str) or not value or value != value.strip()
            or value in {".", ".."}
            or any(not (c.isascii() and (c.isalnum() or c in "._-")) for c in value)):
        raise DataContractError("invalid or empty identifier/path component")
    return value


def _rows(path: Path, required: Sequence[str]):
    try:
        handle = path.open("r", encoding="utf-8-sig", newline="")
    except OSError:
        raise DataContractError("required competition CSV is not readable") from None
    with handle:
        reader = csv.DictReader(handle)
        header = reader.fieldnames or []
        if len(header) != len(set(header)) or not set(required).issubset(header):
            raise DataContractError("competition CSV has missing/duplicate required columns")
        for number, row in enumerate(reader, 2):
            if None in row or any(value is None for value in row.values()):
                raise DataContractError(f"CSV row {number} has an incorrect field count")
            yield row


def _binary(value: str, *, missing: bool = False) -> float | None:
    if missing and value.strip().lower() in MISSING_LABELS:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise DataContractError("expected binary official label or series flag") from None
    if number not in (0.0, 1.0):
        raise DataContractError("official labels/series flags must be 0 or 1")
    return number


def read_studies(
    root: str | Path,
    split: str = "train",
    patient_groups: Mapping[str, str] | None = None,
    weak_labels: Mapping[str, Mapping[str, tuple[float, float]]] | None = None,
) -> list[StudyRecord]:
    """Read official CSVs, retaining all studies and no report text.

    patient_groups must map EVERY study UID to an authorized stable patient key.
    The published CSV schema does not promise such a key; absent a mapping this
    explicitly yields study-only grouping, not a claim of patient independence.
    weak_labels is optional TRAIN-ONLY numeric supervision: uid -> label ->
    (probability, confidence in (0,1]). It must be derived/approved on the
    authorized worker. Observed official labels always take precedence. Unlabeled
    studies are retained, not falsely converted to negative examples.
    """
    if split not in {"train", "test"}:
        raise DataContractError("split must be train or test")
    if split == "test" and (weak_labels is not None or patient_groups is not None):
        raise DataContractError("test loading accepts no supervision or patient mapping")
    base = Path(root)
    studies = []
    seen = set()
    required = ("StudyInstanceUID", *LABELS) if split == "train" else ("StudyInstanceUID",)
    for row in _rows(base / f"{split}.csv", required):
        uid = _identifier(row["StudyInstanceUID"])
        if uid in seen:
            raise DataContractError("duplicate StudyInstanceUID in official study CSV")
        seen.add(uid)
        values, mask, weights, gold = [], [], [], []
        weak = (weak_labels or {}).get(uid, {})
        if set(weak) - set(LABELS):
            raise DataContractError("weak supervision contains an unknown target")
        for label in LABELS:
            observed = _binary(row[label], missing=True) if split == "train" else None
            is_gold = observed is not None
            confidence = 1.0 if is_gold else 0.0
            if observed is None and label in weak:
                try:
                    observed, confidence = map(float, weak[label])
                except (TypeError, ValueError):
                    raise DataContractError("weak label must be (probability, confidence)") from None
                if (not math.isfinite(observed) or not 0 <= observed <= 1
                        or not math.isfinite(confidence) or not 0 < confidence <= 1):
                    raise DataContractError("invalid weak-label probability/confidence")
            values.append(0.0 if observed is None else observed)
            mask.append(observed is not None)
            weights.append(confidence)
            gold.append(is_gold)
        if patient_groups is not None:
            if uid not in patient_groups:
                raise DataContractError("patient mapping must cover every study")
            patient = patient_groups[uid]
            if not isinstance(patient, str) or not patient or patient != patient.strip():
                raise DataContractError("invalid patient grouping key")
            group, source = patient, "patient"
        else:
            group, source = uid, "study"
        studies.append((uid, group, source, tuple(values), tuple(mask), tuple(weights), tuple(gold)))
    if not studies:
        raise DataContractError("official study CSV is empty")
    if weak_labels is not None and set(weak_labels) - seen:
        raise DataContractError("weak supervision contains studies outside this training set")
    if patient_groups is not None and set(patient_groups) != seen:
        raise DataContractError("patient mapping keys must exactly match training studies")
    series_by_study = defaultdict(list)
    seen_series = set()
    for row in _rows(base / f"{split}_series.csv", (
        "StudyInstanceUID", "SeriesInstanceUID", "Anatomical_Plane",
        "Fluid_Sensitive", "Fat_Suppression",
    )):
        uid, sid = _identifier(row["StudyInstanceUID"]), _identifier(row["SeriesInstanceUID"])
        if uid not in seen or sid in seen_series:
            raise DataContractError("unknown study or duplicate SeriesInstanceUID in series CSV")
        seen_series.add(sid)
        plane = row["Anatomical_Plane"]
        if plane not in PLANES:
            raise DataContractError("unknown anatomical plane in official series metadata")
        series_by_study[uid].append(SeriesRecord(
            uid, sid, plane, int(_binary(row["Fluid_Sensitive"])),
            int(_binary(row["Fat_Suppression"])),
        ))
    result = []
    for record in studies:
        series = series_by_study[record[0]]
        if not series:
            raise DataContractError("an official study has no described series")
        # Check directories, but defer actual image reads to the authorized loader.
        for item in series:
            _series_directory(base, split, item)
        result.append(StudyRecord(*record, tuple(sorted(series, key=lambda x: x.series_uid))))
    return result


def _series_directory(root: Path, split: str, series: SeriesRecord) -> Path:
    allowed = (root / f"{split}_series").resolve()
    path = (allowed / _identifier(series.study_uid) / _identifier(series.series_uid)).resolve()
    if not path.is_relative_to(allowed) or not path.is_dir():
        raise DataContractError("required official series directory is absent or escapes root")
    return path


def assign_grouped_folds(
    studies: Sequence[StudyRecord], n_folds: int = 5, seed: int = 2026,
    require_patient_groups: bool = False,
) -> dict[str, int]:
    """Deterministic greedy multilabel balancing of whole patient/study groups.

    Gold positives AND negatives are balanced separately; absent labels do not
    count as negatives. A group's series/slices never cross folds. Weak labels
    do not influence fold selection. Rare targets can remain unscoreable in a
    fold; aggregate_summary reports support rather than inventing an AUC.
    """
    if n_folds < 2 or not studies:
        raise DataContractError("at least two folds and nonempty studies are required")
    sources = {study.group_source for study in studies}
    if sources - {"patient", "study"} or len(sources) != 1:
        raise DataContractError("fold input must have one consistent grouping source")
    if require_patient_groups and sources != {"patient"}:
        raise DataContractError("patient grouping requested but no complete authorized mapping exists")
    if len({s.study_uid for s in studies}) != len(studies):
        raise DataContractError("fold input contains duplicate study identifiers")
    grouped = defaultdict(list)
    for study in studies:
        grouped[study.group_id].append(study)
    if len(grouped) < n_folds:
        raise DataContractError("number of groups is smaller than requested folds")
    keys = sorted(grouped)
    features = {}
    for key, members in grouped.items():
        counts = np.zeros(25, dtype=np.float64)
        for study in members:
            y, m = np.asarray(study.labels), np.asarray(study.gold_mask, dtype=float)
            counts[:12] += y * m
            counts[12:24] += (1 - y) * m
            counts[24] += 1
        features[key] = counts
    total = np.sum(list(features.values()), axis=0)
    scale = np.maximum(total / n_folds, 1.0)
    target = total / n_folds
    tie = lambda key: hashlib.sha256(f"{seed}\0{key}".encode()).digest()
    # Rare annotated groups first, then large groups, with seed-stable tie breaks.
    keys.sort(key=lambda key: (-float(np.sum(features[key][:24] / np.maximum(total[:24], 1))),
                               -features[key][24], tie(key)))
    assigned = np.zeros((n_folds, 25), dtype=np.float64)
    group_counts = np.zeros(n_folds, dtype=np.int64)
    result = {}
    for key in keys:
        vector = features[key]
        candidates = np.flatnonzero(group_counts == 0) if np.any(group_counts == 0) else range(n_folds)
        costs = []
        for fold in candidates:
            before = np.sum(((assigned[fold] - target) / scale) ** 2)
            after = np.sum(((assigned[fold] + vector - target) / scale) ** 2)
            costs.append((float(after - before), assigned[fold, 24], group_counts[fold], int(fold)))
        chosen = min(costs)[-1]
        assigned[chosen] += vector
        group_counts[chosen] += 1
        for study in grouped[key]:
            result[study.study_uid] = chosen
    return result


def training_class_weights(studies: Sequence[StudyRecord], max_weight: float = 20.0) -> np.ndarray:
    """Clipped BCE positive weights, computed from TRAIN observations only.

    Gold and accepted weak supervision contribute confidence-weighted mass.
    A one-class/unsupervised target receives 1 rather than zero/infinite weight.
    Never call this on combined train and validation rows.
    """
    if not studies or not math.isfinite(max_weight) or max_weight < 1:
        raise DataContractError("class weights require nonempty training rows and cap >= 1")
    positive, negative = np.zeros(12), np.zeros(12)
    for study in studies:
        target = np.asarray(study.labels)
        weight = np.asarray(study.label_weight) * np.asarray(study.label_mask)
        positive += target * weight
        negative += (1 - target) * weight
    supported = (positive > 0) & (negative > 0)
    weights = np.ones(12)
    weights[supported] = np.clip(negative[supported] / positive[supported], 1 / max_weight, max_weight)
    return weights.astype(np.float32)


def aggregate_summary(studies: Sequence[StudyRecord], folds: Mapping[str, int] | None = None) -> dict:
    """Return aggregate-only coverage/support, with no IDs, paths, or reports."""
    if not studies:
        raise DataContractError("summary requires nonempty studies")
    result = {
        "studies": len(studies), "series": sum(len(s.series) for s in studies),
        "groups": len({s.group_id for s in studies}),
        "grouping": sorted({s.group_source for s in studies}),
        "fully_unlabeled_studies": sum(not any(s.label_mask) for s in studies),
        "labels": {},
    }
    for i, label in enumerate(LABELS):
        values = [s.labels[i] for s in studies if s.gold_mask[i]]
        positive, negative = sum(v == 1 for v in values), sum(v == 0 for v in values)
        result["labels"][label] = {
            "gold_positive": positive, "gold_negative": negative,
            "gold_missing": len(studies) - len(values),
            "weak_observed": sum(s.label_mask[i] and not s.gold_mask[i] for s in studies),
            "gold_auc_defined": bool(positive and negative),
        }
    if folds is not None:
        if set(folds) != {s.study_uid for s in studies}:
            raise DataContractError("fold assignments do not exactly cover studies")
        seen_groups = {}
        for study in studies:
            fold = folds[study.study_uid]
            if study.group_id in seen_groups and seen_groups[study.group_id] != fold:
                raise DataContractError("group leakage between folds")
            seen_groups[study.group_id] = fold
        result["folds"] = {str(fold): aggregate_summary([s for s in studies if folds[s.study_uid] == fold])
                           for fold in sorted(set(folds.values()))}
    return result


def _ordered_headers(directory: Path, series: SeriesRecord):
    try:
        import pydicom
    except ImportError:
        raise DataContractError("pydicom and appropriate compressed-pixel decoders must be installed offline") from None
    files = sorted(directory.glob("*.dcm"))
    if not files:
        raise DataContractError("official series contains no DICOM slices")
    items = []
    try:
        for path in files:
            if not path.resolve().is_relative_to(directory.resolve()):
                raise DataContractError("DICOM path escapes its official series directory")
            header = pydicom.dcmread(path, stop_before_pixels=True)
            if (str(getattr(header, "StudyInstanceUID", "")) != series.study_uid
                    or str(getattr(header, "SeriesInstanceUID", "")) != series.series_uid):
                raise DataContractError("DICOM study/series keys disagree with official CSV")
            if int(getattr(header, "NumberOfFrames", 1)) != 1:
                raise DataContractError("expected one image slice per official DICOM")
            items.append((path, header))
    except DataContractError:
        raise
    except Exception:
        raise DataContractError("cannot read required DICOM headers") from None
    coordinates = []
    reference = None
    for _, header in items:
        try:
            orientation = np.asarray(header.ImageOrientationPatient, dtype=float)
            position = np.asarray(header.ImagePositionPatient, dtype=float)
            if orientation.shape != (6,) or position.shape != (3,):
                raise ValueError
            normal = np.cross(orientation[:3], orientation[3:])
            norm = float(np.linalg.norm(normal))
            if not np.isfinite(orientation).all() or not np.isfinite(position).all() or norm < 1e-6:
                raise ValueError
            normal /= norm
            if reference is None:
                reference = orientation
            if not np.allclose(orientation, reference, atol=1e-3):
                raise ValueError
            coordinates.append(float(np.dot(position, normal)))
        except (AttributeError, TypeError, ValueError):
            coordinates = []
            break
    if coordinates and len(set(round(v, 5) for v in coordinates)) == len(items):
        order = np.argsort(coordinates, kind="stable")
        policy = "geometry"
    else:
        try:
            instances = [int(header.InstanceNumber) for _, header in items]
            if len(set(instances)) != len(instances):
                raise ValueError
            order = np.argsort(instances, kind="stable")
            policy = "instance_number"
        except (AttributeError, TypeError, ValueError):
            # Lexicographic SOP UID is not physical order. Refuse to invent it.
            raise DataContractError("no unique geometric or InstanceNumber slice order available") from None
    return [items[int(i)] for i in order], policy


def _sample_indices(length: int, count: int, rng: np.random.Generator | None) -> np.ndarray:
    if length <= count:
        return np.arange(length)
    edges = np.linspace(0, length, count + 1).astype(int)
    if rng is None:
        return (edges[:-1] + edges[1:] - 1) // 2
    return np.asarray([rng.integers(start, end) for start, end in zip(edges[:-1], edges[1:])])


def _read_pixels(path: Path):
    import pydicom
    try:
        ds = pydicom.dcmread(path)
        raw = ds.pixel_array
        if raw.ndim != 2 or int(getattr(ds, "SamplesPerPixel", 1)) != 1:
            raise DataContractError("only single-frame monochrome MRI slices are supported")
        valid = np.isfinite(raw)
        if hasattr(ds, "PixelPaddingValue"):
            low = float(ds.PixelPaddingValue)
            high = float(getattr(ds, "PixelPaddingRangeLimit", low))
            valid &= (raw < min(low, high)) | (raw > max(low, high))
        slope, intercept = float(getattr(ds, "RescaleSlope", 1)), float(getattr(ds, "RescaleIntercept", 0))
        if not math.isfinite(slope) or not math.isfinite(intercept) or slope == 0:
            raise DataContractError("invalid DICOM rescale parameters")
        values = raw.astype(np.float32) * slope + intercept
        valid &= np.isfinite(values)
        photo = str(getattr(ds, "PhotometricInterpretation", ""))
        if photo not in {"MONOCHROME1", "MONOCHROME2"}:
            raise DataContractError("unsupported DICOM photometric interpretation")
        if not valid.any():
            raise DataContractError("DICOM slice contains no valid image pixels")
        return values, valid, photo
    except DataContractError:
        raise
    except Exception:
        # Decoder exceptions often embed medical paths and UIDs. Keep logs safe.
        raise DataContractError("DICOM pixel decoding failed; install the matching offline transfer-syntax plugin") from None


def _resize_pad(values: np.ndarray, size: int) -> np.ndarray:
    from PIL import Image
    height, width = values.shape
    scale = size / max(height, width)
    target = (max(1, round(width * scale)), max(1, round(height * scale)))
    image = Image.fromarray(values.astype(np.float32)).resize(target, resample=Image.Resampling.BILINEAR)
    resized = np.asarray(image, dtype=np.float32)
    output = np.zeros((size, size), dtype=np.float32)
    top, left = (size - target[1]) // 2, (size - target[0]) // 2
    output[top:top + target[1], left:left + target[0]] = resized
    return output


def preprocess_series(
    root: str | Path, split: str, series: SeriesRecord, image_size: int = 320,
    slices_per_series: int = 16, rng: np.random.Generator | None = None,
) -> tuple[np.ndarray, str]:
    """Read actual selected DICOM slices -> [D,1,H,W] float32 in [0,1].

    Orders by physical slice coordinate, falling back to unique InstanceNumber.
    Rescale then robust within-series 0.5/99.5 percentile normalization; masks
    padding, honors MONOCHROME1 inversion, preserves in-plane aspect ratio.
    No lateral mirroring, external pretrained asset, or anatomical crop guess.
    Returns actual valid slices only; collate adds explicit masked padding.
    """
    if split not in {"train", "test"} or image_size < 16 or slices_per_series < 1:
        raise DataContractError("invalid preprocessing configuration")
    ordered, policy = _ordered_headers(_series_directory(Path(root), split, series), series)
    indices = _sample_indices(len(ordered), slices_per_series, rng)
    decoded = [_read_pixels(ordered[int(index)][0]) for index in indices]
    photos = {photo for _, _, photo in decoded}
    if len(photos) != 1:
        raise DataContractError("inconsistent photometric interpretation within series")
    # Bounded percentile work: uniformly sample at most 65536 valid pixels/slice.
    pixels = [array[valid][::max(1, int(valid.sum()) // 65536)] for array, valid, _ in decoded]
    low, high = np.percentile(np.concatenate(pixels), [0.5, 99.5])
    if not np.isfinite([low, high]).all() or high <= low:
        raise DataContractError("sampled series has no usable intensity range")
    output = []
    for array, valid, photo in decoded:
        normalized = np.clip((array - low) / (high - low), 0, 1)
        if photo == "MONOCHROME1":
            normalized = 1 - normalized
        normalized[~valid] = 0
        output.append(_resize_pad(normalized, image_size)[None])
    return np.stack(output).astype(np.float32), policy


class RSNAStudyDataset:
    """Map-style lazy image dataset. All studies/series are used by default.

    No disk cache is written. Build any cache only in authorized competition
    storage and retain this preprocessing contract with it. max_series is an
    explicit, disclosed compute ablation; do not call it full-series training.
    training=True enables seed/epoch-keyed stratified slice jitter only. Validation
    and test use fixed bin-center slices; reports never enter returned batches.
    """

    def __init__(self, root: str | Path, studies: Sequence[StudyRecord], split: str = "train",
                 image_size: int = 320, slices_per_series: int = 16,
                 max_series: int | None = None, training: bool = False, seed: int = 2026):
        if (not studies or split not in {"train", "test"} or image_size < 16
                or slices_per_series < 1 or (max_series is not None and max_series < 1)):
            raise DataContractError("invalid study dataset configuration")
        if split == "test" and training:
            raise DataContractError("test dataset cannot enable training sampling")
        self.root, self.studies, self.split = Path(root), tuple(studies), split
        self.image_size, self.slices_per_series = image_size, slices_per_series
        self.max_series, self.training, self.seed, self.epoch = max_series, training, seed, 0

    @property
    def data_config(self) -> dict:
        return {
            "schema_version": 1, "image_size": self.image_size,
            "slices_per_series": self.slices_per_series, "max_series": self.max_series,
            "normalization_percentiles": [0.5, 99.5], "resize": "aspect_preserving_bilinear_zero_pad",
            "order": "geometry_then_unique_instance_number", "inference_sampling": "stratum_center",
            "metadata_order": [*PLANES, "Fluid_Sensitive", "Fat_Suppression"],
            "label_order": list(LABELS), "input_range": [0.0, 1.0],
        }

    def set_epoch(self, epoch: int):
        self.epoch = int(epoch)

    def __len__(self):
        return len(self.studies)

    def _selected_series(self, study: StudyRecord) -> tuple[SeriesRecord, ...]:
        if self.max_series is None or len(study.series) <= self.max_series:
            return study.series
        # Round-robin planes before repeats; fluid-sensitive acquisitions first.
        by_plane = {plane: sorted((s for s in study.series if s.plane == plane),
                                 key=lambda s: (-s.fluid_sensitive, -s.fat_suppression, s.series_uid))
                    for plane in PLANES}
        ranked = []
        while any(by_plane.values()):
            for plane in PLANES:
                if by_plane[plane]:
                    ranked.append(by_plane[plane].pop(0))
        return tuple(ranked[:self.max_series])

    def __getitem__(self, index: int) -> dict:
        study = self.studies[index]
        selected = self._selected_series(study)
        images, ordering = [], []
        for series in selected:
            rng = None
            if self.training:
                key = f"{self.seed}\0{self.epoch}\0{study.study_uid}\0{series.series_uid}".encode()
                rng = np.random.default_rng(int.from_bytes(hashlib.sha256(key).digest()[:8], "big"))
            volume, policy = preprocess_series(self.root, self.split, series, self.image_size,
                                               self.slices_per_series, rng)
            images.append(volume)
            ordering.append(policy)
        return {
            "images": images, "metadata": np.asarray([s.metadata for s in selected], dtype=np.float32),
            "targets": np.asarray(study.labels, dtype=np.float32),
            "target_mask": np.asarray(study.label_mask, dtype=bool),
            "target_weight": np.asarray(study.label_weight, dtype=np.float32),
            "gold_mask": np.asarray(study.gold_mask, dtype=bool),
            "study_id": study.study_uid, "ordering": ordering,
            "series_total": len(study.series), "series_used": len(selected),
        }


def collate_studies(batch: Sequence[dict]) -> dict:
    """Pad only missing bag positions; explicit bool masks accompany all padding."""
    import torch
    if not batch or any(not item["images"] for item in batch):
        raise DataContractError("cannot collate an empty image study")
    series_count = max(len(item["images"]) for item in batch)
    depth = max(image.shape[0] for item in batch for image in item["images"])
    sample_shape = batch[0]["images"][0].shape[1:]
    images = np.zeros((len(batch), series_count, depth, *sample_shape), dtype=np.float32)
    slice_mask = np.zeros((len(batch), series_count, depth), dtype=bool)
    series_mask = np.zeros((len(batch), series_count), dtype=bool)
    metadata = np.zeros((len(batch), series_count, 5), dtype=np.float32)
    for i, item in enumerate(batch):
        for j, image in enumerate(item["images"]):
            if image.shape[1:] != sample_shape or image.shape[0] < 1 or not np.isfinite(image).all():
                raise DataContractError("inconsistent or nonfinite preprocessed images")
            images[i, j, :len(image)] = image
            slice_mask[i, j, :len(image)] = True
            series_mask[i, j] = True
        metadata[i, :len(item["images"])] = item["metadata"]
    result = {"images": torch.from_numpy(images), "slice_mask": torch.from_numpy(slice_mask),
              "series_mask": torch.from_numpy(series_mask), "metadata": torch.from_numpy(metadata),
              "study_ids": [item["study_id"] for item in batch]}
    for key in ("targets", "target_mask", "target_weight", "gold_mask"):
        result[key] = torch.from_numpy(np.stack([item[key] for item in batch]))
    result["order_counts"] = {policy: sum(item["ordering"].count(policy) for item in batch)
                              for policy in ("geometry", "instance_number")}
    result["series_total"] = sum(item["series_total"] for item in batch)
    result["series_used"] = sum(item["series_used"] for item in batch)
    return result
