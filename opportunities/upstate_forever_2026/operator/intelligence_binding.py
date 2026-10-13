"""Construct the current typed Investigations host for existing registry receivers."""
from __future__ import annotations

from intelligence import IntelligenceFeature


def create(operator, fault):
    """Reuse the original native gateway and all installed current source providers."""
    return IntelligenceFeature(operator, fault)
