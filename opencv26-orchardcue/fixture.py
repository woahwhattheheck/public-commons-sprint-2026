#!/usr/bin/env python3
"""Entirely synthetic orchard-card demo. No external images or model weights."""
from pathlib import Path
import cv2
import numpy as np


def synthetic(*, marker=True, glare=False, blur=False):
    w, h = 960, 640
    canvas = np.full((h, w, 3), (39, 91, 44), dtype=np.uint8)
    rng = np.random.default_rng(17)
    # Six independent red fruit-like circles, with fixed, documented geometry.
    circles = [(240,150,34),(390,175,30),(555,150,35),(260,340,38),(455,355,32),(670,320,36)]
    for cx, cy, radius in circles:
        cv2.circle(canvas, (cx,cy), radius, (28, 31, 203), -1, cv2.LINE_AA)
        cv2.circle(canvas, (cx-7,cy-9), 5, (65, 70, 235), -1, cv2.LINE_AA)
    if marker:
        dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
        tag = cv2.aruco.generateImageMarker(dictionary, 23, 105)
        canvas[35:160, 35:160] = (255,255,255)
        canvas[45:150, 45:150] = cv2.cvtColor(tag, cv2.COLOR_GRAY2BGR)
    if glare:
        # Broad camera hot spot, not an apple; forces retake before review.
        cv2.circle(canvas, (780, 440), 150, (255,255,255), -1)
    if blur:
        canvas = cv2.GaussianBlur(canvas, (49,49), 16)
    return canvas


def write(path: Path, **kwargs):
    path.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(path), synthetic(**kwargs)):
        raise RuntimeError('failed to save generated synthetic fixture')


if __name__ == '__main__':
    folder = Path('demo-inputs')
    for name, kwargs in [('good', {}), ('blur', {'blur':True}),
                         ('glare', {'glare':True}), ('no-marker', {'marker':False})]:
        write(folder / (name+'.png'), **kwargs)
    print('wrote generated synthetic demo-inputs/*.png')
