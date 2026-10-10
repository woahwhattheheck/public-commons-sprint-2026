<?php
// Disposable demonstration content only. The launcher creates a new isolated database.
require '/wordpress/wp-load.php';
wp_set_current_user(1);
$records = array(
    array('kzfr_program', 'Demo: Community Voices', 'A fictional interview program for reviewing the editorial workflow.', 'kzfr_creek_url', 'https://kzfr.studio.creek.org/archives/'),
    array('kzfr_program', 'Demo: Evening Jazz', 'A fictional music program for trying genre and text filters.', 'kzfr_creek_url', 'https://kzfr.studio.creek.org/archives/'),
    array('kzfr_event', 'Demo: Open Studio', 'A fictional future event. Do not copy this into a live calendar.', 'kzfr_event_date', wp_date('Y-m-d', time() + 7 * DAY_IN_SECONDS)),
    array('kzfr_event', 'Demo: Past Gathering', 'A fictional expired event, intentionally absent from the upcoming calendar.', 'kzfr_event_date', wp_date('Y-m-d', time() - 7 * DAY_IN_SECONDS)),
    array('kzfr_underwriter', 'Demo: Community Books', 'A fictional underwriter for reviewing directory and website editing.', 'kzfr_underwriter_site', 'https://example.org/'),
);
$ids = array();
foreach ($records as $r) {
    $id = wp_insert_post(array('post_type' => $r[0], 'post_title' => $r[1], 'post_content' => $r[2], 'post_excerpt' => $r[2], 'post_status' => 'publish'), true);
    if (is_wp_error($id)) { throw new Exception($id->get_error_message()); }
    update_post_meta($id, $r[3], $r[4]);
    if ($r[0] === 'kzfr_program') { wp_set_object_terms($id, $r[1] === 'Demo: Evening Jazz' ? 'Music' : 'Talk', 'kzfr_genre'); }
    $ids[$r[1]] = $id;
}
update_option('kzfr_staging_records', $ids);
flush_rewrite_rules();
echo wp_json_encode(array('wordpress' => get_bloginfo('version'), 'php' => PHP_VERSION, 'theme' => get_stylesheet(), 'parent' => get_template(), 'records' => $ids));
