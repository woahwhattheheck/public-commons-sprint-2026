// MIT. Whole saved operator workspace handover in the original browser.
export function connectPortable({ api, run, notice, hasEdits }) {
  const $ = id => document.getElementById(id);
  let review = null;
  const requireSaved = () => {
    if (hasEdits()) throw new Error('Save your draft before including it in the whole workspace handover.');
  };
  function show(selected, id) {
    $('portable-result').hidden = false;
    $('portable-archive').href = '/api/portable/exports/' + id + '/archive';
    $('portable-manifest').href = '/api/portable/exports/' + id + '/manifest';
    $('portable-result-scope').textContent = 'Revision ' + selected.revision + ' · ' +
      selected.revisions + ' saved revisions · ' + selected.editions + ' imported editions · ' +
      Number(selected.archive.bytes).toLocaleString() + ' archive bytes';
    $('portable-digest').textContent = selected.archive.sha256;
    $('portable-receive').textContent =
      'starforge sec-edgar-workspace receive --archive sec-edgar-workspace.zip --sha256 ' +
      selected.archive.sha256 + ' --out ./received-sec-workspace\n' +
      'starforge sec-edgar-workspace open --root ./received-sec-workspace';
  }
  $('portable-review').addEventListener('click', () => run('Reviewing the complete saved workspace…', async () => {
    requireSaved();
    review = await api('/api/portable/review');
    $('portable-scope').textContent = 'Revision ' + review.revision + ' · ' + review.revisions +
      ' saved revisions · ' + review.editions + ' imported editions · ' + review.captures +
      ' original captures · ' + Number(review.bytes).toLocaleString() + ' source bytes';
    $('portable-export-id').value = 'workspace-' + review.revision + '-' + review.reviewSha256.slice(0, 16);
    $('portable-export').disabled = false;
    notice('The whole saved workspace is ready to export.');
  }));
  $('portable-export').addEventListener('click', () => run('Saving the complete portable workspace…', async () => {
    requireSaved();
    if (!review) throw new Error('Review the complete saved workspace first.');
    const id = $('portable-export-id').value.trim();
    const result = await api('/api/portable/export', { method: 'POST',
      json: { exportId: id, expectedReviewSha256: review.reviewSha256 } });
    show(result, id);
    notice('Complete workspace saved. Download its ZIP and reopen the same workspace on the receiving machine.');
  }));
  $('portable-reopen').addEventListener('click', () => run('Opening the retained export…', async () => {
    const id = $('portable-export-id').value.trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) throw new Error('Enter the original export name.');
    show(await api('/api/portable/exports/' + id + '/status'), id);
    notice('The original complete export is ready to download.');
  }));
}
