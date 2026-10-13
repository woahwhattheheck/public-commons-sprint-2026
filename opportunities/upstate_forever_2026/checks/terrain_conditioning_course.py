"""Focused numerical spill/NoData check; no model reruns or repository sweep."""
from pathlib import Path
import tempfile
import numpy as np
from source_tools.terrain_conditioning import boundary_seeds, flood


def main():
    z = np.full((7, 7), 9.0)
    z[1:6, 1:6] = 1
    z[0, 3] = 4
    valid = np.ones(z.shape, bool)
    expected = z.copy()
    expected[1:6, 1:6] = 4
    with tempfile.TemporaryDirectory() as directory:
        seeds = boundary_seeds(valid, 'edge-and-nodata')
        python, _ = flood(z, valid, seeds, Path(directory), engine='python')
        actual, engine = flood(z, valid, seeds, Path(directory), engine='auto')
        np.testing.assert_array_equal(python, expected)
        np.testing.assert_array_equal(actual, expected)
        valid[3, 3] = False
        z[3, 3] = -9999
        python, _ = flood(z, valid, boundary_seeds(valid, 'edge-and-nodata'), Path(directory), engine='python')
        actual, _ = flood(z, valid, boundary_seeds(valid, 'edge-and-nodata'), Path(directory), engine='auto')
        np.testing.assert_array_equal(actual, python)
        assert actual[3, 3] == -9999
        island = np.zeros((7, 7), bool)
        island[2:5, 2:5] = True
        try:
            flood(z, island, boundary_seeds(island, 'outer-edge-only'), Path(directory), engine='python')
        except ValueError:
            pass
        else:
            raise AssertionError('An outlet-free valid island must remain explicit')
        print('Spill elevation, compiled/Python agreement, NoData and outlet-free island: passed (' + engine + ')')


if __name__ == '__main__':
    main()
