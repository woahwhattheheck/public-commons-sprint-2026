/* Native WordPress media selection and repeatable content-detail fields. */
(function () {
    'use strict';
    function ready() {
        const root = document.getElementById('csktm-editor');
        if (!root) return;
        const message = root.querySelector('#csktm-editor-message');
        const announce = text => { message.textContent = text; };
        const changed = input => {
            input.dispatchEvent(new Event('input', {bubbles: true}));
            input.dispatchEvent(new Event('change', {bubbles: true}));
        };
        root.querySelectorAll('[data-csktm-toggle]').forEach(input => {
            input.addEventListener('change', () => {
                document.getElementById(input.dataset.csktmToggle).disabled = !input.checked;
            });
        });
        const list = root.querySelector('#csktm-gis-list');
        const template = root.querySelector('#csktm-gis-template');
        root.querySelector('#csktm-gis-add').addEventListener('click', () => {
            if (list.querySelectorAll('.csktm-gis-row').length >= 30) {
                announce('This resource already has thirty maps.');
                return;
            }
            const key = Number(list.dataset.next || 0);
            list.dataset.next = String(key + 1);
            const holder = document.createElement('template');
            holder.innerHTML = template.innerHTML.replaceAll('__INDEX__', String(key));
            const row = holder.content.firstElementChild;
            list.appendChild(row);
            const field = row.querySelector('.csktm-gis-id');
            changed(field);
            field.focus();
            announce('Map resource added. Complete its item ID, URL, title and text equivalent.');
        });
        list.addEventListener('click', event => {
            const button = event.target.closest('.csktm-gis-remove');
            if (!button) return;
            button.closest('.csktm-gis-row').remove();
            changed(root.querySelector('#csktm-archive'));
            root.querySelector('#csktm-gis-add').focus();
            announce('Map removed from this draft. Save or Update to publish the change.');
        });
        let media;
        root.querySelector('#csktm-document-choose').addEventListener('click', () => {
            if (!window.wp || !wp.media) {
                announce('The WordPress media library is still loading. Try again.');
                return;
            }
            if (!media) {
                media = wp.media({
                    title: 'Choose document file',
                    button: {text: 'Use this file'},
                    multiple: false
                });
                media.on('select', () => {
                    const file = media.state().get('selection').first().toJSON();
                    const attachment = root.querySelector('#csktm-document-attachment');
                    attachment.value = String(file.id);
                    const name = root.querySelector('#csktm-document-name');
                    name.value = file.filename || file.name || 'document';
                    const alt = root.querySelector('#csktm-document-alt');
                    if (!alt.value && file.alt) alt.value = file.alt;
                    const status = root.querySelector('#csktm-document-file');
                    status.replaceChildren();
                    const link = document.createElement('a');
                    link.href = file.url;
                    link.target = '_blank';
                    link.rel = 'noopener';
                    link.textContent = file.filename || file.title || 'Selected file';
                    status.append(link);
                    if (file.filesizeHumanReadable) status.append(document.createTextNode(' (' + file.filesizeHumanReadable + ')'));
                    [attachment, name, alt].forEach(changed);
                    announce('File selected. Update the version label and save the resource.');
                });
            }
            media.open();
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, {once:true});
    else ready();
}());

