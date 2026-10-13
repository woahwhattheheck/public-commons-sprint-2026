"""Eco Science internal data interrogation and guided model workflows."""
from .common import VERSION as __version__


def install_intelligence(*args, **kwargs):
    """Load the optional FastAPI integration only when that host selects it."""
    from .api import install_intelligence as install
    return install(*args, **kwargs)


__all__ = ["install_intelligence", "__version__"]
