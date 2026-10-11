"""Fused Adam/trust proposals shared by the original L2D candidate families.

Physics, feasibility, budgets and history remain in the supplied dfbench Objective.
The returned function is lazy: its first call and compilation belong after
Objective.start_logging(). No Objective callable is captured by this module.
"""
from __future__ import annotations

import jax
import jax.numpy as jnp
import optax


def build_proposal(learning_rate: float, *, add_noise: bool):
    optimizer = optax.chain(
        optax.clip_by_global_norm(1.0), optax.adam(learning_rate)
    )

    @jax.jit
    def proposal(params, grad, state, key, radius, noise_scale, anchor, pull):
        updates, next_state = optimizer.update(grad, state, params)
        scale = jnp.minimum(1.0, radius / (jnp.linalg.norm(updates) + 1e-12))
        point = params + updates * scale
        if add_noise:
            key, noise_key = jax.random.split(key)
            noise = jax.random.normal(noise_key, params.shape, dtype=params.dtype)
            point = point + noise_scale * radius * noise
        # The caller supplies a finite anchor. A dynamic scalar keeps this one
        # executable when the original restart-pull condition changes.
        point = jnp.where(pull, 0.75 * point + 0.25 * anchor, point)
        return point, next_state, key

    return optimizer, proposal
