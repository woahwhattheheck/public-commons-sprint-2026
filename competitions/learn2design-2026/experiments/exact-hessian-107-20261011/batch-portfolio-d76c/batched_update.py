"""Independent Adam/trust updates for a batch of original Objective lanes.

The function is compiled on its first optimization-time call. Physics and
Objective logging are outside this module.
"""
from __future__ import annotations

import jax
import jax.numpy as jnp
import optax


def build_update(coord_clip: float):
    optimizer = optax.chain(optax.clip_by_global_norm(1.0), optax.adam(1.0))

    def one(params, grad, state, key, radius, noise_scale, rate, anchor, pull):
        grad = jnp.where(jnp.isfinite(grad), grad, 0.0)
        updates, next_state = optimizer.update(grad, state, params)
        updates = updates * rate
        updates = updates * jnp.minimum(
            1.0, radius / (jnp.linalg.norm(updates) + 1e-12))
        key, noise_key = jax.random.split(key)
        noise = jax.random.normal(noise_key, params.shape, dtype=params.dtype)
        point = params + updates + noise_scale * radius * noise
        point = jnp.where(pull, 0.75 * point + 0.25 * anchor, point)
        point = jnp.clip(point, -coord_clip, coord_clip)
        return point, next_state, key

    return optimizer, jax.jit(jax.vmap(one))
