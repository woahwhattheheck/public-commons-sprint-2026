"""Paired-raster computation and portable receiving of retained results.

Saved-result storage, receiving and source capture use the standard library and
shared filesystem layer. Load the scientific Workspace only when requested so
those operations also work with the packaged bootstrap Python.
"""

__all__ = ["EnsembleWorkspace"]


def __getattr__(name):
    if name == "EnsembleWorkspace":
        from .ensemble_workspace import EnsembleWorkspace
        globals()[name] = EnsembleWorkspace
        return EnsembleWorkspace
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def __dir__():
    return sorted(set(globals()) | set(__all__))
