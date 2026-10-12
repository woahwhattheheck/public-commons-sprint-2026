"""Offsite records-storage invoice reconciliation package."""

from . import _output_custody as _output_custody
from . import engine as engine

_output_custody.bind_error_type(engine.InputError)
engine.write_outputs_exclusive = _output_custody.write_outputs_exclusive
