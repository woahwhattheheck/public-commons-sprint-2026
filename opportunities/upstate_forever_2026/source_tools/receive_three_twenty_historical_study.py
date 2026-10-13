#!/usr/bin/env python3
"""Receive the unchanged historical Three/Twenty cohort through the shared course."""
from __future__ import annotations

try:
    from . import receive_original_study as course
except ImportError:
    import receive_original_study as course

PROFILE = {
    "module": "three_twenty_historical_observations",
    "site_id": "SV-833",
    "title": "Three and Twenty Creek original historical observations, 2021–2025",
    "results": 1502, "activities": 120, "limits": 1492, "measurements": 1501,
    "parameter": "Escherichia coli", "year": 2023,
}


def main(argv=None):
    prior = course.PROFILES.get("three_twenty_historical")
    if prior is not None and prior != PROFILE:
        raise ValueError("The installed historical receiving profile differs from this source edition.")
    course.PROFILES["three_twenty_historical"] = dict(PROFILE)
    return course.main(argv, profile="three_twenty_historical")


if __name__ == "__main__":
    main()
