"""Purchased-result publication on the original Stellar Forge buyer warehouse."""

__all__ = ["VgiService"]


def __getattr__(name):
    if name == "VgiService":
        from .model import VgiService
        return VgiService
    raise AttributeError(name)
