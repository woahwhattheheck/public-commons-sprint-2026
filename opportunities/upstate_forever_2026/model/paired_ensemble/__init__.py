"""Paired results and native analysis, with dependency-free saved-result transport."""

__all__ = ["EnsembleWorkspace"]


def __getattr__(name):
    """Load the numerical engine only when the native Workspace service is used."""
    if name == "EnsembleWorkspace":
        from .ensemble_workspace import EnsembleWorkspace
        globals()[name] = EnsembleWorkspace
        return EnsembleWorkspace
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def __dir__():
    return sorted(set(globals()) | set(__all__))
