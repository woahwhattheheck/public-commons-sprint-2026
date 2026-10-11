<?php
/** Native WordPress controls for the metadata retained by a reviewed migration. */
if (!defined('ABSPATH')) { exit; }

function csktm_editor_types() {
    return array('page', 'post', 'cskt_project', 'cskt_document', 'cskt_notice');
}
function csktm_editor_field($id, $label, $name, $value, $options = array()) {
    $type = $options['type'] ?? 'text';
    echo '<p><label for="' . esc_attr($id) . '"><strong>' . esc_html($label) . '</strong></label><br>';
    if ($type === 'textarea') {
        echo '<textarea class="widefat ' . esc_attr($options['class'] ?? '') . '" id="' . esc_attr($id) . '" name="' . esc_attr($name) . '" rows="' . (int)($options['rows'] ?? 3) . '"' . (!empty($options['required']) ? ' required' : '') . '>' . esc_textarea($value) . '</textarea>';
    } else {
        echo '<input class="widefat ' . esc_attr($options['class'] ?? '') . '" id="' . esc_attr($id) . '" name="' . esc_attr($name) . '" type="' . esc_attr($type) . '" value="' . esc_attr($value) . '"' . (!empty($options['required']) ? ' required' : '') . (!empty($options['placeholder']) ? ' placeholder="' . esc_attr($options['placeholder']) . '"' : '') . '>';
    }
    if (!empty($options['help'])) {
        echo '<span class="description">' . esc_html($options['help']) . '</span>';
    }
    echo '</p>';
}
function csktm_editor_gis_row($key, $value = array()) {
    $prefix = 'csktm_details[gis][' . $key . ']';
    $id = 'csktm-gis-' . $key . '-';
    echo '<fieldset class="csktm-gis-row"><legend><strong>Map resource</strong></legend>';
    csktm_editor_field($id . 'id', 'ArcGIS item ID', $prefix . '[itemId]', $value['itemId'] ?? '', array('class'=>'csktm-gis-id', 'required'=>true, 'help'=>'The original 32-character ArcGIS item ID.'));
    csktm_editor_field($id . 'url', 'Map URL', $prefix . '[url]', $value['url'] ?? '', array('type'=>'url', 'class'=>'csktm-gis-url', 'required'=>true));
    csktm_editor_field($id . 'title', 'Map title', $prefix . '[title]', $value['title'] ?? '', array('class'=>'csktm-gis-title', 'required'=>true));
    csktm_editor_field($id . 'description', 'Map introduction', $prefix . '[description]', $value['description'] ?? '', array('type'=>'textarea', 'class'=>'csktm-gis-description'));
    csktm_editor_field($id . 'fallback', 'Map text equivalent', $prefix . '[fallbackHtml]', $value['fallbackHtml'] ?? '', array('type'=>'textarea', 'class'=>'csktm-gis-fallback', 'rows'=>6, 'required'=>true, 'help'=>'Describe the information and project context the map communicates. Paragraphs, headings, lists and links are supported.'));
    echo '<p><button type="button" class="button csktm-gis-remove">Remove this map</button></p></fieldset>';
}
function csktm_editor_box($post) {
    $document = csktm_meta_json($post->ID, '_cskt_document');
    $notice = csktm_meta_json($post->ID, '_cskt_notice');
    $gis = csktm_meta_json($post->ID, '_cskt_gis');
    $document = is_array($document) ? $document : array();
    $notice = is_array($notice) ? $notice : array();
    $gis = is_array($gis) ? $gis : array();
    $document_required = $post->post_type === 'cskt_document';
    $notice_required = $post->post_type === 'cskt_notice';
    $has_document = $document_required || !empty($document);
    $has_notice = $notice_required || !empty($notice);
    wp_nonce_field('csktm_editor_' . $post->ID, 'csktm_editor_nonce');
    echo '<div id="csktm-editor"><p>Update these details with the normal WordPress Save or Update button. WordPress revisions retain document, map, notice and archive changes.</p>';
    echo '<p><label><input id="csktm-archive" type="checkbox" name="csktm_details[archive]" value="1"' . checked(get_post_meta($post->ID, '_cskt_archive', true), '1', false) . '> Mark this resource as archived</label><br><span class="description">Archived content stays available with a visible historical-resource notice.</span></p>';

    echo '<h3>Document</h3><p><label><input id="csktm-document-enabled" data-csktm-toggle="csktm-document-fields" type="checkbox" name="csktm_details[documentEnabled]" value="1"' . checked($has_document, true, false) . ($document_required ? ' disabled' : '') . '> Include a downloadable document</label></p>';
    if ($document_required) { echo '<input type="hidden" name="csktm_details[documentEnabled]" value="1">'; }
    echo '<fieldset id="csktm-document-fields"' . (!$has_document ? ' disabled' : '') . '>';
    echo '<input id="csktm-document-attachment" type="hidden" name="csktm_details[document][attachmentId]" value="' . (int)($document['attachmentId'] ?? 0) . '">';
    echo '<p><button type="button" class="button" id="csktm-document-choose">Choose or upload file</button> <span id="csktm-document-file" role="status">';
    if (!empty($document['nativeUrl'])) {
        echo '<a href="' . esc_url($document['nativeUrl']) . '" target="_blank" rel="noopener">' . esc_html($document['downloadName'] ?? wp_basename($document['nativeUrl'])) . '</a>';
        if (isset($document['bytes'])) { echo ' (' . esc_html(size_format((int)$document['bytes'], 1)) . ')'; }
    } else {
        echo 'No file selected';
    }
    echo '</span></p>';
    csktm_editor_field('csktm-document-version', 'Version label', 'csktm_details[document][versionLabel]', $document['versionLabel'] ?? 'Original', array('required'=>true, 'help'=>'For example, Adopted October 2026.'));
    csktm_editor_field('csktm-document-family', 'Document family', 'csktm_details[document][familyId]', $document['familyId'] ?? ('native:' . $post->ID), array('required'=>true, 'help'=>'Use the same family for editions of the same document.'));
    csktm_editor_field('csktm-document-name', 'Download filename', 'csktm_details[document][downloadName]', $document['downloadName'] ?? '', array('required'=>true));
    csktm_editor_field('csktm-document-description', 'Document description', 'csktm_details[document][description]', $document['description'] ?? '', array('type'=>'textarea'));
    csktm_editor_field('csktm-document-alt', 'File alternative text', 'csktm_details[document][altText]', $document['altText'] ?? '', array('type'=>'textarea', 'help'=>'Describe meaningful visual information when the selected file is an image.'));
    echo '<p class="description">Selecting a replacement keeps the earlier attachment and the document revision that used it. The migrated source identity remains in the release history.</p></fieldset>';

    echo '<h3>Maps</h3><div id="csktm-gis-list" data-next="' . count($gis) . '">';
    foreach (array_values($gis) as $key=>$value) { csktm_editor_gis_row($key, $value); }
    echo '</div><p><button type="button" class="button" id="csktm-gis-add">Add map resource</button></p><template id="csktm-gis-template">';
    csktm_editor_gis_row('__INDEX__');
    echo '</template>';

    echo '<h3>Notice</h3><p><label><input id="csktm-notice-enabled" data-csktm-toggle="csktm-notice-fields" type="checkbox" name="csktm_details[noticeEnabled]" value="1"' . checked($has_notice, true, false) . ($notice_required ? ' disabled' : '') . '> Include notice details</label></p>';
    if ($notice_required) { echo '<input type="hidden" name="csktm_details[noticeEnabled]" value="1">'; }
    echo '<fieldset id="csktm-notice-fields"' . (!$has_notice ? ' disabled' : '') . '><p><label for="csktm-notice-type"><strong>Notice type</strong></label><br><select id="csktm-notice-type" name="csktm_details[notice][type]">';
    foreach (array('general'=>'General', 'meeting'=>'Meeting', 'emergency'=>'Emergency', 'news'=>'News') as $key=>$label) {
        echo '<option value="' . esc_attr($key) . '"' . selected($notice['type'] ?? 'general', $key, false) . '>' . esc_html($label) . '</option>';
    }
    echo '</select></p>';
    foreach (array('startsAt'=>'Starts', 'endsAt'=>'Ends') as $key=>$label) {
        csktm_editor_field('csktm-notice-' . $key, $label, 'csktm_details[notice][' . $key . ']', $notice[$key] ?? '', array('placeholder'=>'2026-10-29T16:30:00-06:00', 'help'=>'Use a complete date and time with UTC offset, or leave blank. The public page displays the site time zone.'));
    }
    csktm_editor_field('csktm-notice-location', 'Location', 'csktm_details[notice][location]', $notice['location'] ?? '');
    echo '</fieldset><p id="csktm-editor-message" role="status" aria-live="polite"></p><input type="hidden" name="csktm_details[present]" value="1"><input type="hidden" name="csktm_editor_complete" value="1"></div>';
}
add_action('add_meta_boxes', function($type, $post) {
    if (in_array($type, csktm_editor_types(), true) && current_user_can('edit_post', $post->ID)) {
        add_meta_box('csktm-content-details', 'Content details', 'csktm_editor_box', $type, 'normal', 'default', array('__block_editor_compatible_meta_box'=>true));
    }
}, 10, 2);
add_action('admin_enqueue_scripts', function() {
    $screen = get_current_screen();
    if (!$screen || $screen->base !== 'post' || !in_array($screen->post_type, csktm_editor_types(), true)) { return; }
    wp_enqueue_media(array('post'=>get_the_ID()));
    wp_enqueue_script('csktm-editor', plugins_url('editor.js', __FILE__), array('media-views'), CSKTM_VERSION, true);
    wp_register_style('csktm-editor', false, array(), CSKTM_VERSION);
    wp_enqueue_style('csktm-editor');
    wp_add_inline_style('csktm-editor', '#csktm-editor fieldset{min-width:0}#csktm-editor .csktm-gis-row{border:1px solid #b8b8b8;padding:12px;margin:16px 0}#csktm-editor .csktm-gis-row legend{padding:0 5px}#csktm-editor fieldset:disabled{opacity:.6}#csktm-editor .description{display:block;margin-top:4px}#csktm-editor textarea{resize:vertical}#csktm-editor h3{border-top:1px solid #ccc;padding-top:16px}#csktm-document-file{overflow-wrap:anywhere;margin-left:8px}');
});
function csktm_editor_text($value, $label, $max, $required = false, $paragraph = false) {
    if (!is_string($value)) { csktm_fail('invalid_staff_field', $label . ' must be text.'); }
    $value = $paragraph ? sanitize_textarea_field($value) : sanitize_text_field($value);
    if (strlen($value) > $max || ($required && trim($value) === '')) {
        csktm_fail('invalid_staff_field', $label . ' needs ' . ($required ? 'nonempty text and ' : '') . 'at most ' . $max . ' bytes.');
    }
    return $value;
}
function csktm_editor_date($value, $label) {
    $value = csktm_editor_text($value, $label, 40);
    if ($value === '') { return ''; }
    if (!preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/D', $value)) {
        csktm_fail('invalid_notice_date', $label . ' needs a complete date and time with UTC offset.');
    }
    $format = str_contains($value, '.') ? '!Y-m-d\TH:i:s.uP' : '!Y-m-d\TH:i:sP';
    $date = DateTimeImmutable::createFromFormat($format, str_ends_with($value, 'Z') ? substr($value, 0, -1) . '+00:00' : $value);
    $errors = DateTimeImmutable::getLastErrors();
    if (!$date || ($errors && ($errors['warning_count'] || $errors['error_count']))) {
        csktm_fail('invalid_notice_date', $label . ' is not a valid calendar date and time.');
    }
    return $value;
}
function csktm_editor_values($post_id, $input) {
    $document = null;
    if (!empty($input['documentEnabled']) || get_post_type($post_id) === 'cskt_document') {
        $fields = $input['document'] ?? null;
        if (!is_array($fields)) { csktm_fail('document_required', 'Choose a document file and complete its version details.'); }
        $attachment_id = filter_var($fields['attachmentId'] ?? null, FILTER_VALIDATE_INT, array('options'=>array('min_range'=>1)));
        $attachment = $attachment_id ? get_post($attachment_id) : null;
        if (!$attachment || $attachment->post_type !== 'attachment' || !current_user_can('read_post', $attachment_id)) {
            csktm_fail('document_attachment_required', 'Choose a readable file from the WordPress media library.');
        }
        $previous = csktm_meta_json($post_id, '_cskt_document');
        if ((int)($previous['attachmentId'] ?? 0) !== $attachment_id && !current_user_can('upload_files')) {
            csktm_fail('document_attachment_forbidden', 'Your WordPress role needs media access to select a replacement file.', 403);
        }
        $path = get_attached_file($attachment_id);
        if (!is_string($path) || !is_file($path) || !is_readable($path)) {
            csktm_fail('document_file_unavailable', 'The selected attachment file must be available on the WordPress host.');
        }
        $url = wp_get_attachment_url($attachment_id);
        $bytes = filesize($path);
        $sha256 = hash_file('sha256', $path);
        if (!$url || $bytes === false || !$sha256) { csktm_fail('document_file_unavailable', 'WordPress could not read the selected original file.'); }
        $document = is_array($previous) ? $previous : array('sourceUrl'=>$url, 'sourceMediaId'=>null);
        $document['attachmentId'] = $attachment_id;
        $document['nativeUrl'] = $url;
        $document['bytes'] = $bytes;
        $document['sha256'] = $sha256;
        $document['mimeType'] = get_post_mime_type($attachment_id) ?: 'application/octet-stream';
        $document['responseContentType'] = $document['mimeType'];
        $document['versionLabel'] = csktm_editor_text($fields['versionLabel'] ?? '', 'Version label', 160, true);
        $document['familyId'] = csktm_editor_text($fields['familyId'] ?? '', 'Document family', 160, true);
        $name = csktm_editor_text($fields['downloadName'] ?? '', 'Download filename', 300, true);
        if (preg_match('/[\/\\\\\x00-\x1f]/', $name) || $name === '.' || $name === '..') {
            csktm_fail('invalid_download_filename', 'The download filename must be a single filename.');
        }
        $document['downloadName'] = $name;
        $document['description'] = csktm_editor_text($fields['description'] ?? '', 'Document description', 10000, false, true);
        $document['altText'] = csktm_editor_text($fields['altText'] ?? '', 'File alternative text', 3000, false, true);
    }
    $items = $input['gis'] ?? array();
    if (!is_array($items) || count($items) > 30) { csktm_fail('invalid_gis', 'Use at most thirty map resources.'); }
    $gis = array();
    $seen = array();
    foreach ($items as $fields) {
        if (!is_array($fields)) { csktm_fail('invalid_gis', 'Complete each map resource.'); }
        $id = strtolower(csktm_editor_text($fields['itemId'] ?? '', 'ArcGIS item ID', 32, true));
        $url = csktm_editor_text($fields['url'] ?? '', 'Map URL', 2000, true);
        $parts = wp_parse_url($url);
        if (!preg_match('/^[a-f0-9]{32}$/D', $id) || isset($seen[$id]) || !is_array($parts) || ($parts['scheme'] ?? '') !== 'https' || isset($parts['user']) || isset($parts['pass']) || !preg_match('/(^|\.)(arcgis\.com|arcg\.is)$/iD', $parts['host'] ?? '')) {
            csktm_fail('invalid_gis', 'Each map needs a distinct ArcGIS item ID and a complete HTTPS ArcGIS URL.');
        }
        $raw_fallback = $fields['fallbackHtml'] ?? '';
        if (!is_string($raw_fallback) || strlen($raw_fallback) > 100000) { csktm_fail('invalid_gis', 'The map text equivalent exceeds 100,000 bytes.'); }
        $fallback = wp_kses_post($raw_fallback);
        if (trim(wp_strip_all_tags($fallback)) === '') { csktm_fail('map_description_required', 'Describe the map information in its text equivalent.'); }
        $gis[] = array('itemId'=>$id, 'url'=>$url, 'title'=>csktm_editor_text($fields['title'] ?? '', 'Map title', 500, true), 'description'=>csktm_editor_text($fields['description'] ?? '', 'Map introduction', 10000, false, true), 'fallbackHtml'=>$fallback);
        $seen[$id] = true;
    }
    $notice = null;
    if (!empty($input['noticeEnabled']) || get_post_type($post_id) === 'cskt_notice') {
        $fields = $input['notice'] ?? null;
        if (!is_array($fields) || !in_array($fields['type'] ?? '', array('general','meeting','emergency','news'), true)) { csktm_fail('invalid_notice', 'Choose a notice type.'); }
        $notice = array('type'=>$fields['type'], 'startsAt'=>csktm_editor_date($fields['startsAt'] ?? '', 'Starts'), 'endsAt'=>csktm_editor_date($fields['endsAt'] ?? '', 'Ends'), 'location'=>csktm_editor_text($fields['location'] ?? '', 'Location', 1000));
        if ($notice['startsAt'] && $notice['endsAt'] && strtotime($notice['startsAt']) >= strtotime($notice['endsAt'])) {
            csktm_fail('invalid_notice_range', 'The notice end must be later than its start.');
        }
    }
    return array('_cskt_document'=>csktm_json($document), '_cskt_gis'=>csktm_json($gis), '_cskt_notice'=>csktm_json($notice), '_cskt_archive'=>!empty($input['archive']) ? '1' : '0');
}
add_action('save_post', function($post_id, $post) {
    if (!in_array($post->post_type, csktm_editor_types(), true) || wp_is_post_revision($post_id) || wp_is_post_autosave($post_id) || (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) || !isset($_POST['csktm_editor_nonce'])) { return; }
    if (!current_user_can('edit_post', $post_id) || !is_string($_POST['csktm_editor_nonce']) || !wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['csktm_editor_nonce'])), 'csktm_editor_' . $post_id)) {
        wp_die(esc_html('Your WordPress editing session has expired. Reload the editor and save again.'), 'Content details', array('response'=>403, 'back_link'=>true));
    }
    try {
        if (($_POST['csktm_editor_complete'] ?? '') !== '1' || !is_array($_POST['csktm_details'] ?? null)) { csktm_fail('incomplete_staff_form', 'The complete content details form did not reach WordPress. Return to the editor and save again.'); }
        $input = wp_unslash($_POST['csktm_details']);
        csktm_transaction(function() use ($post_id, $input) {
            csktm_lock_post($post_id);
            $values = csktm_editor_values($post_id, $input);
            foreach ($values as $key=>$value) {
                if (get_post_meta($post_id, $key, true) !== $value && !update_post_meta($post_id, $key, wp_slash($value))) {
                    csktm_fail('staff_details_write_failed', 'WordPress could not retain the updated content details.', 500);
                }
            }
            clean_post_cache($post_id);
            wp_save_post_revision($post_id);
        });
    } catch (Throwable $error) {
        clean_post_cache($post_id);
        wp_die(esc_html('The document, map, notice and archive fields were not saved. ' . $error->getMessage()), 'Content details', array('response'=>$error instanceof CSKTM_Problem ? $error->status : 500, 'back_link'=>true));
    }
}, 20, 2);

