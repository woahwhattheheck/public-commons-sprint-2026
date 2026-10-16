"""Competition-data-only, image-only hierarchical MIL for RSNA Knee 2026.

This module does not download data or weights. It is a trainable model, not a
pretrained model: useful predictions require an actually trained checkpoint.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Mapping

import torch
from torch import Tensor, nn
from torch.nn import functional as F
from torch.utils.checkpoint import checkpoint


LABELS = (
    "ACL", "MCL", "Medial Meniscus", "Lateral Meniscus", "Medial OA",
    "Lateral OA", "PF OA", "Effusion", "Synovitis", "Baker's",
    "Contusion", "Fracture",
)
FORMAT_VERSION = 1


@dataclass(frozen=True)
class ModelConfig:
    width: int = 32
    feature_dim: int = 256
    attention_dim: int = 128
    dropout: float = 0.2
    encoder_chunk_size: int = 32
    gradient_checkpointing: bool = True

    def __post_init__(self):
        if min(self.width, self.feature_dim, self.attention_dim,
               self.encoder_chunk_size) < 1:
            raise ValueError("model dimensions and encoder_chunk_size must be positive")
        if not 0 <= self.dropout < 1:
            raise ValueError("dropout must be in [0,1)")


def _normalization(channels: int) -> nn.GroupNorm:
    groups = min(8, channels)
    while channels % groups:
        groups -= 1
    return nn.GroupNorm(groups, channels)


class ResidualBlock(nn.Module):
    def __init__(self, in_channels: int, out_channels: int, stride: int = 1):
        super().__init__()
        self.body = nn.Sequential(
            nn.Conv2d(in_channels, out_channels, 3, stride, 1, bias=False),
            _normalization(out_channels), nn.SiLU(inplace=False),
            nn.Conv2d(out_channels, out_channels, 3, 1, 1, bias=False),
            _normalization(out_channels),
        )
        self.shortcut = (
            nn.Identity() if stride == 1 and in_channels == out_channels else
            nn.Sequential(nn.Conv2d(in_channels, out_channels, 1, stride, bias=False),
                          _normalization(out_channels))
        )

    def forward(self, images: Tensor) -> Tensor:
        return F.silu(self.body(images) + self.shortcut(images))


class SliceEncoder(nn.Module):
    """Single-channel residual CNN; all parameters initialized from scratch."""

    def __init__(self, config: ModelConfig):
        super().__init__()
        w = config.width
        self.network = nn.Sequential(
            nn.Conv2d(1, w, 7, 2, 3, bias=False), _normalization(w),
            nn.SiLU(inplace=False), nn.MaxPool2d(3, 2, 1),
            ResidualBlock(w, w), ResidualBlock(w, w),
            ResidualBlock(w, 2 * w, 2), ResidualBlock(2 * w, 2 * w),
            ResidualBlock(2 * w, 4 * w, 2), ResidualBlock(4 * w, 4 * w),
            ResidualBlock(4 * w, 8 * w, 2), ResidualBlock(8 * w, 8 * w),
            nn.AdaptiveAvgPool2d(1), nn.Flatten(),
            nn.Linear(8 * w, config.feature_dim), nn.LayerNorm(config.feature_dim),
        )

    def forward(self, images: Tensor) -> Tensor:
        return self.network(images)


def masked_softmax(logits: Tensor, mask: Tensor, dim: int) -> Tensor:
    """Empty padded bags receive exactly zero attention, never NaNs."""
    mask = mask.to(dtype=torch.bool)
    logits = logits.float().masked_fill(~mask, torch.finfo(torch.float32).min)
    weights = torch.softmax(logits, dim=dim) * mask.to(torch.float32)
    return weights / weights.sum(dim=dim, keepdim=True).clamp_min(1e-12)


class KneeImageMIL(nn.Module):
    """Finding-specific attention over slices, then over MRI series.

    Input images are [batch,series,slice,1,height,width]. DICOM plane/sequence
    metadata is [batch,series,5]; no report, target, UID or patient information
    enters the model. Padded slices are never passed through the encoder.
    """

    def __init__(self, config: ModelConfig | None = None):
        super().__init__()
        self.config = config or ModelConfig()
        f, a = self.config.feature_dim, self.config.attention_dim
        self.encoder = SliceEncoder(self.config)
        self.position = nn.Sequential(nn.Linear(4, f), nn.Tanh())
        self.metadata_embedding = nn.Sequential(nn.Linear(5, f), nn.Tanh())
        self.slice_tanh = nn.Linear(f, a)
        self.slice_gate = nn.Linear(f, a)
        self.slice_score = nn.Linear(a, len(LABELS), bias=False)
        self.series_tanh = nn.Linear(f, a)
        self.series_gate = nn.Linear(f, a)
        self.series_score = nn.Parameter(torch.empty(len(LABELS), a))
        self.classifier_weight = nn.Parameter(torch.empty(len(LABELS), f))
        self.classifier_bias = nn.Parameter(torch.zeros(len(LABELS)))
        self.dropout = nn.Dropout(self.config.dropout)
        nn.init.xavier_uniform_(self.series_score)
        nn.init.xavier_uniform_(self.classifier_weight)

    def _encode(self, images: Tensor) -> Tensor:
        encoded = []
        for chunk in images.split(self.config.encoder_chunk_size):
            if self.training and self.config.gradient_checkpointing:
                encoded.append(checkpoint(self.encoder, chunk, use_reentrant=False))
            else:
                encoded.append(self.encoder(chunk))
        return torch.cat(encoded, dim=0)

    def forward(self, batch: Mapping[str, Tensor]) -> Tensor:
        images = batch["images"]
        slice_mask = batch["slice_mask"].bool()
        series_mask = batch["series_mask"].bool()
        metadata = batch["metadata"]
        if images.ndim != 6 or images.shape[3] != 1:
            raise ValueError("images must be [B,S,D,1,H,W]")
        b, s, d = images.shape[:3]
        if slice_mask.shape != (b, s, d) or series_mask.shape != (b, s):
            raise ValueError("slice/series mask shape mismatch")
        if metadata.shape != (b, s, 5):
            raise ValueError("metadata must be [B,S,5]")
        active = slice_mask & series_mask.unsqueeze(-1)
        actual_series = active.any(dim=-1)
        if not actual_series.any(dim=-1).all():
            raise ValueError("each study must contain at least one decoded image")
        if not torch.isfinite(metadata).all():
            raise ValueError("non-finite MRI metadata")
        flat_images = images.reshape(b * s * d, *images.shape[3:])
        valid_index = active.reshape(-1).nonzero(as_tuple=False).flatten()
        selected = flat_images.index_select(0, valid_index)
        if not torch.isfinite(selected).all():
            raise ValueError("non-finite decoded MRI pixels")
        valid_features = self._encode(selected)
        features = valid_features.new_zeros((b * s * d, self.config.feature_dim))
        features = features.index_copy(0, valid_index, valid_features).view(b, s, d, -1)
        # Relative slice order, not study identity; padded series remain masked.
        rank = active.cumsum(dim=-1).to(features.dtype) - 1
        denom = (active.sum(dim=-1, keepdim=True) - 1).clamp_min(1)
        position = 2 * rank / denom - 1
        positional = torch.stack((position, position.square(),
                                  torch.sin(torch.pi * position),
                                  torch.cos(torch.pi * position)), dim=-1)
        features = features + self.position(positional)
        gated = torch.tanh(self.slice_tanh(features)) * torch.sigmoid(self.slice_gate(features))
        attention = masked_softmax(self.slice_score(gated), active.unsqueeze(-1), dim=2)
        # [B,S,L,F]: each finding attends to different evidence slices.
        series_features = torch.einsum("bsdl,bsdf->bslf", attention.to(features.dtype), features)
        series_features = series_features + self.metadata_embedding(metadata.to(features.dtype)).unsqueeze(2)
        gated_series = torch.tanh(self.series_tanh(series_features)) * torch.sigmoid(self.series_gate(series_features))
        series_logits = torch.einsum("bsla,la->bsl", gated_series, self.series_score)
        series_attention = masked_softmax(series_logits, actual_series.unsqueeze(-1), dim=1)
        study_features = torch.einsum("bsl,bslf->blf", series_attention.to(features.dtype), series_features)
        return torch.einsum("blf,lf->bl", self.dropout(study_features), self.classifier_weight) + self.classifier_bias


def masked_bce_loss(logits: Tensor, targets: Tensor, mask: Tensor,
                    pos_weight: Tensor | None = None,
                    confidence: Tensor | None = None) -> Tensor:
    """Macro-label BCE: missing targets have zero loss and zero gradient.

    Optional confidence weights support explicitly admitted weak training labels;
    validation must use the separate gold mask. Positive weights come from the
    training fold only. Gold targets are binary; admitted weak targets may be
    soft probabilities in [0,1].
    """
    if logits.shape != targets.shape or logits.shape != mask.shape:
        raise ValueError("logits, targets and mask must have identical [B,12] shape")
    observed = mask.bool()
    if not observed.any():
        raise ValueError("batch has no observed targets")
    if not torch.isfinite(targets[observed]).all() or not ((targets[observed] >= 0) & (targets[observed] <= 1)).all():
        raise ValueError("observed targets must be finite probabilities in [0,1]")
    safe_targets = torch.where(observed, targets, torch.zeros_like(targets)).float()
    weights = observed.float()
    if confidence is not None:
        if confidence.shape != logits.shape or not torch.isfinite(confidence).all():
            raise ValueError("invalid target confidence shape/value")
        if not ((confidence >= 0) & (confidence <= 1)).all():
            raise ValueError("target confidence must be in [0,1]")
        weights = weights * confidence.float()
    raw = F.binary_cross_entropy_with_logits(logits.float(), safe_targets,
                                             pos_weight=pos_weight, reduction="none")
    denominators = weights.sum(dim=0)
    present = denominators > 0
    if not present.any():
        raise ValueError("batch has no positive-confidence observed targets")
    return ((raw * weights).sum(dim=0)[present] / denominators[present]).mean()


def move_model_inputs(batch: Mapping, device: str | torch.device) -> dict[str, Tensor]:
    return {key: batch[key].to(device, non_blocking=True)
            for key in ("images", "slice_mask", "series_mask", "metadata")}


@torch.inference_mode()
def predict_batch(model: KneeImageMIL, batch: Mapping,
                  device: str | torch.device = "cpu") -> Tensor:
    model.eval()
    probabilities = torch.sigmoid(model(move_model_inputs(batch, device)).float())
    if not torch.isfinite(probabilities).all():
        raise RuntimeError("model produced non-finite probabilities")
    return probabilities


def load_model(checkpoint_path: str | Path, device: str | torch.device = "cpu"):
    """Load our state-dict-only checkpoint without enabling arbitrary unpickling."""
    saved = torch.load(Path(checkpoint_path), map_location="cpu", weights_only=True)
    if saved.get("format_version") != FORMAT_VERSION or tuple(saved.get("labels", ())) != LABELS:
        raise ValueError("checkpoint format or 12-label order does not match this model")
    if saved.get("architecture") != "KneeImageMIL":
        raise ValueError("unsupported checkpoint architecture")
    model = KneeImageMIL(ModelConfig(**saved["model_config"]))
    model.load_state_dict(saved["model_state"], strict=True)
    model.to(device).eval()
    metadata = {key: value for key, value in saved.items()
                if key not in {"model_state", "optimizer_state", "scheduler_state", "scaler_state"}}
    return model, metadata


def checkpoint_payload(model: KneeImageMIL, **metadata) -> dict:
    return {**metadata, "format_version": FORMAT_VERSION, "architecture": "KneeImageMIL",
            "model_config": asdict(model.config), "labels": list(LABELS),
            "model_state": model.state_dict()}
