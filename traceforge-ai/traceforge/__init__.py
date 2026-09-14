"""TraceForge AI: evidence-grounded incident analysis."""

from .core import EvidenceDocument, TraceForgeError, analyze, verify_receipt
from .model import DemoModel, OpenAICompatibleModel

__all__ = ["EvidenceDocument", "TraceForgeError", "analyze", "verify_receipt", "DemoModel", "OpenAICompatibleModel"]
__version__ = "0.1.0"
