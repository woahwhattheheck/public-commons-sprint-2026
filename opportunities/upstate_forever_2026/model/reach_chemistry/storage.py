"""Variable-volume transport inside the original reach chemistry engine.

State remains conserved-basis kg. Water volume follows the declared phase
flows exactly. Only inverse-volume transport/removal coefficients vary within
a phase; loads and ordinary first-order coefficients keep their original units.
"""
from __future__ import annotations
import numpy as np
from scipy import sparse
from scipy.integrate import solve_ivp

RTOL = 1e-10
ATOL = 1e-12


def split_operator(project, operator):
    """Separate constant chemical reactions from inverse-volume processes."""
    rows, columns, values = [], [], []
    for reaction in operator.reactions:
        if reaction.get("volume_scaling") == "inverse":
            continue
        source, rate = reaction["source_index"], reaction["rate_day"]
        rows.append(source); columns.append(source); values.append(-rate)
        for species, fraction in reaction["products"].items():
            rows.append(project.index(reaction["reach"], species))
            columns.append(source); values.append(rate * fraction)
    constant = sparse.coo_matrix((values, (rows, columns)),
                                 shape=(project.n, project.n)).tocsc()
    return constant, (operator.A - constant).tocsc()


def volume_ratio(project, day):
    return project.state_volumes / project.state_volumes_at(day)


def matrix_at(project, constant, scaled, day):
    return (constant + scaled @ sparse.diags(volume_ratio(project, day), format="csc")).tocsc()


def integrate_linear(operator_at, forcing, state, start, end, *, cancelled=None):
    """Integrate a sparse time-dependent linear system and its declared ledgers.

    Radau receives the exact sparse Jacobian. Relative/absolute controls apply
    to every integrated state and ledger, and the original conservation check
    remains independent. Accepted endpoint values are never clipped.
    """
    cached_time, cached_operator = None, None
    def operator(day):
        nonlocal cached_time, cached_operator
        if cancelled is not None and cancelled():
            from .solver import Cancelled
            raise Cancelled("variable-storage reach chemistry run cancelled")
        if cached_time != day:
            cached_operator = operator_at(day)
            cached_time = day
        return cached_operator
    solved = solve_ivp(lambda day, value: operator(day) @ value + forcing,
                       (start, end), state, method="Radau",
                       jac=lambda day, value: operator(day),
                       rtol=RTOL, atol=ATOL, t_eval=[end])
    if (not solved.success or solved.t.size != 1 or solved.t[-1] != end
            or not np.isfinite(solved.y).all()):
        raise ArithmeticError("variable-storage integration failed: " + solved.message)
    return np.asarray(solved.y[:, -1]), {
        "from_day": float(start), "until_day": float(end),
        "method": "SciPy Radau with exact sparse Jacobian",
        "rtol": RTOL, "atol": ATOL, "function_evaluations": int(solved.nfev),
        "jacobian_evaluations": int(solved.njev), "lu_decompositions": int(solved.nlu)}


def propagate_storage(project, operator, forcing, mass, start, end, *, cancelled=None):
    """Advance mass, integral mass, and integral volume-scaled mass together."""
    n = project.n
    constant, scaled = split_operator(project, operator)
    initial_ratio = volume_ratio(project, start)
    if np.array_equal(project.state_volumes_at(start), project.state_volumes_at(end)):
        # A period with unchanged storage has a constant operator even when
        # earlier phases changed its volume. Reuse the original exact propagator.
        from .solver import propagate
        current = (constant + scaled @ sparse.diags(initial_ratio, format="csc")).tocsc()
        final, integral = propagate(current, forcing, mass, end-start)
        return final, integral, initial_ratio*integral, {
            "from_day": float(start), "until_day": float(end),
            "method": "original sparse augmented matrix exponential at constant period storage"}
    zero = sparse.csc_matrix((n, n))
    unit = sparse.eye(n, format="csc")
    def augmented(day):
        ratio = sparse.diags(volume_ratio(project, day), format="csc")
        current = (constant + scaled @ ratio).tocsc()
        return sparse.bmat([[current, zero, zero],
                            [unit, zero, zero],
                            [ratio, zero, zero]], format="csc")
    value, diagnostics = integrate_linear(
        augmented, np.r_[forcing, np.zeros(2*n)], np.r_[mass, np.zeros(2*n)],
        start, end, cancelled=cancelled)
    return value[:n], value[n:2*n], value[2*n:3*n], diagnostics
