"""Durable execution and complete result history for the original ECSA app."""
__version__ = "0.2.1"
from .store import RunStore
from .provider import capture_provider, submit_run
from .runner import run_pending
