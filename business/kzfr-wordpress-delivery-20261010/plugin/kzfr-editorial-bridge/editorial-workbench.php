<?php
/** Reviewed CSV migration into the existing station content model. */
if (!defined('ABSPATH')) { exit; }

function kzfr_bridge_import_menu() {
    add_management_page('Station content import', 'Station content import', 'manage_options', 'kzfr-content-import', 'kzfr_bridge_import_page');
}
add_action('admin_menu', 'kzfr_bridge_import_menu');

/** CSV stays in memory/transient storage; uploads are never added to public media. */
function kzfr_bridge_parse_csv($bytes) {
    if (!is_string($bytes) || strlen($bytes) > 1048576 || strpos($bytes, "\0") !== false || !preg_match('//u', $bytes)) {
        return new WP_Error('csv_encoding', 'Choose a UTF-8 CSV file no larger than 1 MiB.');
    }
    $stream = fopen('php://temp', 'r+');
    fwrite($stream, preg_replace('/^\xEF\xBB\xBF/', '', $bytes));
    rewind($stream);
    $header = fgetcsv($stream, 0, ',', '"', '');
    $expected = array('source_id', 'type', 'title', 'content', 'excerpt', 'genre', 'creek_url', 'event_date', 'website');
    if (!is_array($header) || count($header) !== count($expected) || array_diff($expected, $header) || count(array_unique($header)) !== count($header)) {
        fclose($stream);
        return new WP_Error('csv_header', 'The header must contain each documented column exactly once.');
    }
    $rows = array(); $seen = array(); $record = 1;
    $types = array('program' => 'kzfr_program', 'event' => 'kzfr_event', 'underwriter' => 'kzfr_underwriter');
    while (($cells = fgetcsv($stream, 0, ',', '"', '')) !== false) {
        ++$record;
        if ($cells === array(null)) { continue; }
        if (count($rows) >= 500) { fclose($stream); return new WP_Error('csv_count', 'Import at most 500 records at a time.'); }
        if (count($cells) !== count($header)) { fclose($stream); return new WP_Error('csv_columns', 'CSV record ' . $record . ' has the wrong number of columns.'); }
        $data = array_combine($header, $cells); $errors = array();
        foreach ($data as &$value) { $value = trim($value); } unset($value);
        $source = $data['source_id']; $type = $types[$data['type']] ?? '';
        if (!preg_match('/^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,159}$/D', $source)) { $errors[] = 'Source ID must be a stable identifier (1–160 letters, numbers, dot, underscore, colon, slash or hyphen).'; }
        if (isset($seen[$source])) { $errors[] = 'Source ID appears more than once in this file.'; }
        $seen[$source] = true;
        if (!$type) { $errors[] = 'Type must be program, event or underwriter.'; }
        $title = sanitize_text_field($data['title']);
        if ($title === '' || strlen($title) > 250) { $errors[] = 'A title of no more than 250 bytes is required.'; }
        $meta = array();
        if ($type) {
            $field = kzfr_bridge_editor_field($type);
            $column = array('kzfr_program' => 'creek_url', 'kzfr_event' => 'event_date', 'kzfr_underwriter' => 'website')[$type];
            $raw = $data[$column]; $clean = call_user_func($field[3], $raw);
            if (($raw !== '' && $clean === '') || ($type === 'kzfr_event' && $clean === '')) { $errors[] = $field[1] . ' is missing or invalid.'; }
            $meta[$field[0]] = $clean;
            foreach (array('creek_url', 'event_date', 'website') as $other) {
                if ($other !== $column && $data[$other] !== '') { $errors[] = $other . ' does not belong to this record type.'; }
            }
        }
        if ($type !== 'kzfr_program' && $data['genre'] !== '') { $errors[] = 'Only programs have genres.'; }
        $rows[] = array('record' => $record, 'source_id' => $source, 'post_type' => $type, 'title' => $title,
            'content' => wp_kses_post($data['content']), 'excerpt' => sanitize_textarea_field($data['excerpt']),
            'genre' => sanitize_text_field($data['genre']), 'meta' => $meta, 'errors' => $errors);
    }
    fclose($stream);
    if (!$rows) { return new WP_Error('csv_empty', 'The CSV contains no content rows.'); }
    return $rows;
}

function kzfr_bridge_existing_source($source_id) {
    $posts = get_posts(array('post_type' => array('kzfr_program', 'kzfr_event', 'kzfr_underwriter'),
        'post_status' => array_keys(get_post_stati()), 'numberposts' => 1, 'fields' => 'ids',
        'meta_key' => '_kzfr_source_id', 'meta_value' => $source_id, 'suppress_filters' => true));
    return $posts ? (int) $posts[0] : 0;
}

/** Create new drafts only. Existing source IDs, including trash, remain untouched. */
function kzfr_bridge_import_rows($rows, $selection) {
    if (!current_user_can('manage_options')) { return new WP_Error('permission', 'Only site administrators can import station content.'); }
    $lock = 'kzfr_bridge_content_import_lock';
    $lock_token = wp_generate_uuid4();
    if (!add_option($lock, $lock_token, '', false)) { return new WP_Error('import_busy', 'An import is already running. If a previous request stopped, ask the site administrator to clear the kzfr_bridge_content_import_lock option.'); }
    $release = function () use ($lock, $lock_token) {
        if (get_option($lock) === $lock_token) { delete_option($lock); }
    };
    register_shutdown_function($release);
    $results = array();
    try {
        foreach ($rows as $index => $row) {
            if (!in_array((string) $index, $selection, true) || $row['errors']) { continue; }
            $existing = kzfr_bridge_existing_source($row['source_id']);
            if ($existing) { $results[] = array('source_id' => $row['source_id'], 'status' => 'Already imported; unchanged', 'post_id' => $existing); continue; }
            $id = wp_insert_post(wp_slash(array('post_type' => $row['post_type'], 'post_status' => 'draft',
                'post_title' => $row['title'], 'post_content' => $row['content'], 'post_excerpt' => $row['excerpt'],
                'meta_input' => array_merge($row['meta'], array('_kzfr_source_id' => $row['source_id'])))), true);
            if (is_wp_error($id)) { $results[] = array('source_id' => $row['source_id'], 'status' => $id->get_error_message(), 'post_id' => 0); continue; }
            if (get_post_meta($id, '_kzfr_source_id', true) !== $row['source_id']) {
                wp_delete_post($id, true);
                $results[] = array('source_id' => $row['source_id'], 'status' => 'Source ID could not be saved; draft removed', 'post_id' => 0); continue;
            }
            $status = 'Draft created';
            if ($row['post_type'] === 'kzfr_program' && $row['genre'] !== '') {
                $terms = wp_set_object_terms($id, $row['genre'], 'kzfr_genre', false);
                if (is_wp_error($terms)) { $status .= '; assign its genre in the editor'; }
            }
            $results[] = array('source_id' => $row['source_id'], 'status' => $status, 'post_id' => (int) $id);
        }
    } finally { $release(); }
    return $results;
}

function kzfr_bridge_import_page() {
    if (!current_user_can('manage_options')) { wp_die('You cannot import station content.'); }
    $user_id = get_current_user_id(); $preview = null; $token = ''; $error = ''; $results = null;
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        check_admin_referer('kzfr_content_import');
        $action = isset($_POST['kzfr_import_action']) && is_string($_POST['kzfr_import_action']) ? $_POST['kzfr_import_action'] : '';
        if ($action === 'preview') {
            $upload = $_FILES['kzfr_csv'] ?? array();
            if (!isset($upload['error'], $upload['tmp_name'], $upload['size']) || $upload['error'] !== UPLOAD_ERR_OK || !is_string($upload['tmp_name']) || $upload['size'] > 1048576 || !is_uploaded_file($upload['tmp_name'])) {
                $error = 'Upload a UTF-8 CSV file no larger than 1 MiB.';
            } else {
                $rows = kzfr_bridge_parse_csv(file_get_contents($upload['tmp_name']));
                if (is_wp_error($rows)) { $error = $rows->get_error_message(); }
                else {
                    $token = wp_generate_password(32, false, false);
                    $preview = array('rows' => $rows, 'sha256' => hash_file('sha256', $upload['tmp_name']));
                    if (!set_transient('kzfr_import_' . $user_id . '_' . $token, $preview, 30 * MINUTE_IN_SECONDS)) { $preview = null; $error = 'Could not retain the preview. No drafts were created.'; }
                }
            }
        } elseif ($action === 'import') {
            $token = isset($_POST['kzfr_preview_token']) && is_string($_POST['kzfr_preview_token']) ? $_POST['kzfr_preview_token'] : '';
            $key = 'kzfr_import_' . $user_id . '_' . $token;
            $preview = preg_match('/^[A-Za-z0-9]{32}$/D', $token) ? get_transient($key) : false;
            $selection = isset($_POST['kzfr_selected']) && is_array($_POST['kzfr_selected']) ? array_values(array_filter($_POST['kzfr_selected'], 'is_string')) : array();
            if (!$preview) { $error = 'This preview expired or was already imported. Upload the CSV again; existing source IDs will be skipped.'; }
            elseif (!$selection) { $error = 'Select at least one valid row.'; }
            else {
                $results = kzfr_bridge_import_rows($preview['rows'], $selection);
                if (is_wp_error($results)) { $error = $results->get_error_message(); $results = null; }
                else { delete_transient($key); $preview = null; }
            }
        }
    }
    echo '<div class="wrap"><h1>Station content import</h1><p>Bring approved program, event and underwriter content into WordPress drafts. Review each row before importing, then use the normal editor to approve and publish. Existing imported content is never overwritten.</p>';
    if ($error) { echo '<div class="notice notice-error"><p>' . esc_html($error) . '</p></div>'; }
    if (is_array($results)) {
        echo '<div class="notice notice-success"><p>Import finished. Review the results below.</p></div><table class="widefat striped"><thead><tr><th>Source ID</th><th>Result</th><th>Content</th></tr></thead><tbody>';
        foreach ($results as $result) {
            echo '<tr><td>' . esc_html($result['source_id']) . '</td><td>' . esc_html($result['status']) . '</td><td>';
            if ($result['post_id']) { echo '<a href="' . esc_url(get_edit_post_link($result['post_id'])) . '">Open editor</a>'; }
            echo '</td></tr>';
        }
        echo '</tbody></table>';
    }
    if (is_array($preview)) {
        echo '<h2>Review uploaded content</h2><p>Only selected valid rows become drafts. Preview expires in 30 minutes.</p><p>File SHA-256: <code>' . esc_html($preview['sha256']) . '</code></p><form method="post">';
        wp_nonce_field('kzfr_content_import');
        echo '<input type="hidden" name="kzfr_import_action" value="import"><input type="hidden" name="kzfr_preview_token" value="' . esc_attr($token) . '"><table class="widefat striped"><thead><tr><th>Import</th><th>Source / type</th><th>Content preview</th><th>Station details / status</th></tr></thead><tbody>';
        foreach ($preview['rows'] as $index => $row) {
            $existing = kzfr_bridge_existing_source($row['source_id']); $valid = !$row['errors'] && !$existing;
            echo '<tr><td><input type="checkbox" name="kzfr_selected[]" value="' . esc_attr($index) . '" aria-label="Import ' . esc_attr($row['title']) . '" ' . ($valid ? '' : 'disabled') . '></td><td><code>' . esc_html($row['source_id']) . '</code><br>' . esc_html($row['post_type']) . '</td><td><strong>' . esc_html($row['title']) . '</strong><p>' . esc_html($row['excerpt']) . '</p><details><summary>Content</summary><div>' . wp_kses_post($row['content']) . '</div></details></td><td>';
            foreach ($row['meta'] as $value) { echo '<p>' . esc_html($value) . '</p>'; }
            if ($row['genre']) { echo '<p>Genre: ' . esc_html($row['genre']) . '</p>'; }
            if ($existing) { echo '<p>Already imported — unchanged.</p>'; }
            foreach ($row['errors'] as $message) { echo '<p><strong>' . esc_html($message) . '</strong></p>'; }
            if ($valid) { echo '<p>Ready for draft import.</p>'; }
            echo '</td></tr>';
        }
        echo '</tbody></table>'; submit_button('Create selected drafts'); echo '</form>';
    }
    echo '<h2>Upload CSV</h2><p>Use UTF-8, at most 500 records and 1 MiB. Keep the same source_id on subsequent uploads. Programs may have one genre and an approved Creek URL; events need their local date; underwriters may have an HTTPS website.</p><p>Required header (empty unused cells are allowed):</p><pre>source_id,type,title,content,excerpt,genre,creek_url,event_date,website</pre><p>Allowed type values: <code>program</code>, <code>event</code>, <code>underwriter</code>. Choose your own stable source IDs from the approved content inventory. This is an editorial import format, not a Creek API export format.</p><form method="post" enctype="multipart/form-data">';
    wp_nonce_field('kzfr_content_import');
    echo '<input type="hidden" name="kzfr_import_action" value="preview"><label for="kzfr-csv">Content CSV </label><input id="kzfr-csv" name="kzfr_csv" type="file" accept=".csv,text/csv" required>';
    submit_button('Preview content'); echo '</form></div>';
}
