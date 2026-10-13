"""Private decision engine; no model execution or external data acquisition."""
__version__ = "0.1.0"
from .schema import Study
from .engine import solve, frontier
from .native import from_experiment
__all__ = ["Study", "solve", "frontier", "from_experiment"]
