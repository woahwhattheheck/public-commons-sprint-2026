/* Native WordPress media selection for complete opportunity attachment lists. */
(function () {
  'use strict';

  // Native block-editor metabox saves retain the same DOM. Confirm only the exact
  // accepted submitted values before advancing its next-save conflict fingerprint.
  if (window.wp && window.wp.apiFetch) {
    window.wp.apiFetch.use(async function (options, next) {
      const body = options.body;
      if (String(options.method || '').toUpperCase() !== 'POST' || !(body instanceof FormData) || !body.has('cskt_site_nonce')) {
        return next(options);
      }
      const postId = Number(body.get('post_ID'));
      const details = {};
      for (const [key, value] of body.entries()) {
        const match = /^cskt_site_details\[([A-Za-z]+)\]$/.exec(key);
        if (match) details[match[1]] = value;
      }
      const submitted = { postId, nonce: body.get('cskt_site_nonce'), details, archived: body.get('cskt_site_archived') === '1' };
      const expected = body.get('cskt_site_expected');
      const response = await next(options);
      try {
        const receipt = await window.wp.apiFetch({ path: '/cskt-site/v1/editor-confirmation', method: 'POST', data: submitted });
        if (!receipt || receipt.confirmed !== true || receipt.postId !== postId || !/^[0-9a-f]{64}$/.test(receipt.fingerprint)) {
          throw new Error('WordPress did not return the accepted public-detail fingerprint.');
        }
        const input = document.querySelector('input[name="cskt_site_expected"]');
        if (input && input.value === expected) input.value = receipt.fingerprint;
      } catch (error) {
        const box = document.querySelector('.cskt-site-editor');
        if (box) {
          let notice = box.querySelector('[data-cskt-site-confirmation-error]');
          if (!notice) {
            notice = document.createElement('p'); notice.dataset.csktSiteConfirmationError = '';
            notice.setAttribute('role', 'alert'); box.prepend(notice);
          }
          notice.textContent = 'The native save returned, but its public fields could not be confirmed. Reload to review the saved record before another edit. ' + (error.message || '');
        }
        throw error;
      }
      return response;
    });
  }
  document.addEventListener('click', function (event) {
    const remove = event.target.closest('[data-cskt-site-remove]');
    if (remove) {
      const root = remove.closest('.cskt-site-media');
      const input = root.querySelector('[data-cskt-site-files]');
      const ids = JSON.parse(input.value);
      input.value = JSON.stringify(ids.filter(id => id !== Number(remove.dataset.csktSiteRemove)));
      remove.closest('li').remove();
      input.dispatchEvent(new Event('change', { bubbles: true }));
      root.querySelector('[data-cskt-site-media-status]').textContent = 'File removed from this opportunity. Save the native post to retain this change.';
      return;
    }
    const picker = event.target.closest('[data-cskt-site-pick-files]');
    if (!picker) return;
    const root = picker.closest('.cskt-site-media');
    const status = root.querySelector('[data-cskt-site-media-status]');
    if (!window.wp || !window.wp.media) {
      status.textContent = 'The native WordPress media library is unavailable. Reload the editor.';
      return;
    }
    const input = root.querySelector('[data-cskt-site-files]');
    const original = JSON.parse(input.value);
    const frame = window.wp.media({ title: 'Choose opportunity files', button: { text: 'Use selected files' }, multiple: true });
    frame.on('open', function () {
      const selection = frame.state().get('selection');
      original.forEach(id => { const item = window.wp.media.attachment(id); item.fetch(); selection.add(item); });
    });
    frame.on('select', function () {
      const files = frame.state().get('selection').toJSON();
      if (files.length > 40) { status.textContent = 'Choose at most forty files. The previous selection is preserved.'; return; }
      const list = root.querySelector('[data-cskt-site-file-list]');
      const ids = files.map(file => Number(file.id));
      if (ids.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(ids).size !== ids.length) {
        status.textContent = 'The media selection did not contain distinct native file IDs. The previous selection is preserved.';
        return;
      }
      list.replaceChildren();
      for (const file of files) {
        const li = document.createElement('li'); li.dataset.csktSiteFile = String(file.id);
        const label = document.createElement('span'); label.textContent = file.title || file.filename || ('Attachment #' + file.id);
        const button = document.createElement('button'); button.type = 'button'; button.className = 'button-link-delete';
        button.dataset.csktSiteRemove = String(file.id); button.textContent = 'Remove file';
        li.append(label, document.createTextNode(' '), button); list.append(li);
      }
      input.value = JSON.stringify(ids); input.dispatchEvent(new Event('change', { bubbles: true }));
      status.textContent = 'Selected ' + files.length + ' files. Save the native post to retain this complete selection.';
    });
    frame.open();
  });
})();
