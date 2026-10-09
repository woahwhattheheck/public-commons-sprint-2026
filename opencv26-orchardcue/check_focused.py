"""One focused synthetic acceptance check: quality gate and operator invariants."""
import hashlib
import cv2
from engine import analyze
from fixture import synthetic


def run():
    base = synthetic()
    good, _ = analyze(base, raw_sha256=hashlib.sha256(base.tobytes()).hexdigest())
    assert good['candidate_count'] == 6, good
    assert good['reference_marker'] and good['reference_marker']['id'] == 23, good
    assert good['decision']['action'] == 'READY_FOR_OPERATOR_REVIEW', good
    assert all(c['approx_diameter_mm'] > 0 for c in good['red_candidates'])
    bad_blur, _ = analyze(synthetic(blur=True), raw_sha256='synthetic-blur')
    assert bad_blur['decision']['action'] == 'RETAKE_REQUIRED', bad_blur
    no_ref, _ = analyze(synthetic(marker=False), raw_sha256='synthetic-no-marker')
    assert no_ref['decision']['action'] == 'HUMAN_REVIEW_REQUIRED', no_ref
    assert all('approx_diameter_mm' not in c for c in no_ref['red_candidates'])
    glare, _ = analyze(synthetic(glare=True), raw_sha256='synthetic-glare')
    assert glare['decision']['action'] == 'RETAKE_REQUIRED', glare
    assert all(report['decision']['human_confirmation_required'] for report in (good,bad_blur,no_ref,glare))
    print('PASS focused synthetic acceptance: six candidates, valid marker, blur/glare retake, missing-marker review, operator gate')


if __name__ == '__main__':
    run()
