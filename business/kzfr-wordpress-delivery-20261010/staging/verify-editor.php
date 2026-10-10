<?php
// One focused integration: real WordPress editor save -> metadata -> rendered archive.
require '/wordpress/wp-load.php';
wp_set_current_user(1);
$ids = get_option('kzfr_staging_records');
$checks = array();
function kzfr_stage_assert($condition, $label) {
    global $checks;
    if (!$condition) { throw new Exception($label); }
    $checks[] = $label;
}
$id = $ids['Demo: Evening Jazz'];
$post = get_post($id);
ob_start(); kzfr_bridge_render_editor_fields($post); $form = ob_get_clean();
kzfr_stage_assert(str_contains($form, 'Creek Studio program or archive URL') && str_contains($form, 'kzfr_editorial_nonce'), 'Native labeled editor field renders with save nonce');
$_POST = array('kzfr_editorial_nonce' => wp_create_nonce('kzfr_editorial_details_' . $id), 'kzfr_editorial_value' => 'https://kzfr.studio.creek.org/archives/');
wp_update_post(array('ID' => $id, 'post_excerpt' => 'Edited in the real WordPress runtime.'));
kzfr_stage_assert(get_post_meta($id, 'kzfr_creek_url', true) === $_POST['kzfr_editorial_value'], 'Real save_post persists accepted Creek link');
$_POST['kzfr_editorial_value'] = 'not a station URL';
wp_update_post(array('ID' => $id));
kzfr_stage_assert(get_post_meta($id, 'kzfr_creek_url', true) === 'https://kzfr.studio.creek.org/archives/', 'Invalid editor value preserves previously accepted link');
kzfr_stage_assert((bool) get_transient('kzfr_editorial_error_1_' . $id), 'Editor receives correction notice');
$_POST['kzfr_editorial_value'] = '';
wp_update_post(array('ID' => $id));
kzfr_stage_assert(get_post_meta($id, 'kzfr_creek_url', true) === '', 'Explicit blank removes optional link');
$_POST = array();
update_post_meta($id, 'kzfr_creek_url', 'https://kzfr.studio.creek.org/archives/');
kzfr_stage_assert(get_template() === 'twentytwentyone' && get_stylesheet() === 'kzfr-community-radio', 'Official parent and existing child theme active');
echo wp_json_encode(array('checks' => $checks, 'result' => 'PASS'));
