"""Shared Tethys app namespace; preserve other installed portal applications."""
from pkgutil import extend_path
__path__ = extend_path(__path__, __name__)
