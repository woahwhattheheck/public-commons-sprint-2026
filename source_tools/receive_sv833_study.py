#!/usr/bin/env python3
"""Receive the original SV-833 study through the maintained native workflow."""
from __future__ import annotations

if __package__:
    from .receive_original_study import main as receive_original_study, file_identity, continue_saved_review
else:
    from receive_original_study import main as receive_original_study, file_identity, continue_saved_review


def main(argv=None):
    return receive_original_study(argv, profile="sv833")


if __name__ == "__main__":
    main()
