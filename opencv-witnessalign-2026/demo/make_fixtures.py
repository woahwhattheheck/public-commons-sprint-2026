"""Deterministic synthetic factory board, not real defect accuracy evidence."""
from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np

WIDTH, HEIGHT = 864, 648
MISSING_COMPONENT = (445, 322)


def generate(seed=143) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    board = np.full((HEIGHT, WIDTH, 3), (132, 140, 148), dtype=np.uint8)
    fine_noise = rng.integers(-6, 7, (HEIGHT, WIDTH, 1), dtype=np.int16)
    board = np.uint8(np.clip(board.astype(np.int16) + fine_noise, 0, 255))
    cv2.rectangle(board, (56, 62), (808, 589), (40, 57, 75), 4)
    cv2.putText(board, "WITNESSALIGN REF / 06-26-A", (90, 108),
                cv2.FONT_HERSHEY_SIMPLEX, .8, (12, 12, 12), 2, cv2.LINE_AA)
    # Distinctive alphanumeric labels and fiducial-like corners, not a repetitive grid alone.
    for index, (x, y) in enumerate(((90, 90), (768, 96), (100, 550), (750, 546))):
        cv2.rectangle(board, (x-23,y-20), (x+22,y+20), (235,235,235), -1)
        cv2.line(board, (x-18,y), (x+18,y), (10,10,10), 2)
        cv2.line(board, (x,y-16), (x,y+16), (10,10,10), 2)
        cv2.putText(board, str(index + 1), (x-7,y+8), cv2.FONT_HERSHEY_SIMPLEX, .5,
                    (0,0,0), 2, cv2.LINE_AA)
    for index, (x, y) in enumerate([(200,230),(325,230),(445,322),(575,220),
                                    (207,440),(336,453),(579,438),(720,354)]):
        cv2.circle(board, (x,y), 23, (75,78,82), -1, cv2.LINE_AA)
        cv2.circle(board, (x,y), 17, (208,209,210), -1, cv2.LINE_AA)
        cv2.line(board,(x-11,y-8),(x+11,y+8),(35,35,35),3,cv2.LINE_AA)
        cv2.line(board,(x-11,y+8),(x+11,y-8),(40,40,40),2,cv2.LINE_AA)
        cv2.putText(board, f"R{index+1}", (x+26,y+6),cv2.FONT_HERSHEY_SIMPLEX,
                    .45,(10,10,10),1,cv2.LINE_AA)
    for n in range(250):
        x, y = int(rng.integers(85,780)), int(rng.integers(140,535))
        if abs(x-MISSING_COMPONENT[0]) < 35 and abs(y-MISSING_COMPONENT[1]) < 35:
            continue
        color = (int(rng.integers(50,190)),)*3
        cv2.circle(board,(x,y),int(rng.integers(1,3)),color,-1,cv2.LINE_AA)
    absent = board.copy()
    # Remove only one component; a uniform patch is a deliberately detectable fault.
    cv2.circle(absent, MISSING_COMPONENT, 25, (138,146,154), -1, cv2.LINE_AA)
    def pose(photo: np.ndarray) -> np.ndarray:
        src = np.float32([[0,0],[WIDTH-1,0],[WIDTH-1,HEIGHT-1],[0,HEIGHT-1]])
        dst = np.float32([[14,11],[WIDTH-18,6],[WIDTH-9,HEIGHT-13],[11,HEIGHT-17]])
        h = cv2.getPerspectiveTransform(src,dst)
        shifted=cv2.warpPerspective(photo,h,(WIDTH,HEIGHT),borderMode=cv2.BORDER_CONSTANT,borderValue=(0,0,0))
        exposure = np.clip(shifted.astype(np.int16) + 7,0,255).astype(np.uint8)
        # Never brighten the artificial black photo border.
        exposure[np.all(shifted==0,axis=2)] = 0
        return exposure
    return board, pose(board), pose(absent)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=Path("demo/fixtures"))
    args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    reference, clean, defect=generate()
    for name, img in (("reference",reference),("candidate-clean",clean),("candidate-missing-component",defect)):
        cv2.imwrite(str(args.out/(name+".png")),img)
    print("Three labeled SYNTHETIC photos generated; not real assembly evidence.")


if __name__=="__main__":
    main()
