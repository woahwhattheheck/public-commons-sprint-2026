<?php
/** Native editor controls for the portable KZFR content model. */
if (!defined('ABSPATH')) { exit; }

function kzfr_bridge_editor_field($post_type) {
    $fields = array(
        'kzfr_program' => array('kzfr_creek_url', 'Creek Studio program or archive URL', 'url', 'kzfr_bridge_creek_url', 'Use an approved https://kzfr.studio.creek.org/ link. Audio remains on Creek Studio.'),
        'kzfr_event' => array('kzfr_event_date', 'Event date at the station', 'date', 'kzfr_bridge_event_date', 'Calendar listings use the WordPress site timezone. Choose the local event date.'),
        'kzfr_underwriter' => array('kzfr_underwriter_site', 'Underwriter website', 'url', 'kzfr_bridge_safe_https_url', 'Use the approved HTTPS website. Leave empty to show the underwriter without an outbound link.'),
    );
    return $fields[$post_type] ?? null;
}

function kzfr_bridge_add_editor_fields($post_type) {
    if (kzfr_bridge_editor_field($post_type)) {
        add_meta_box('kzfr-editorial-details', 'Station details', 'kzfr_bridge_render_editor_fields', $post_type, 'normal', 'high');
    }
}
add_action('add_meta_boxes', 'kzfr_bridge_add_editor_fields');

function kzfr_bridge_render_editor_fields($post) {
    $field = kzfr_bridge_editor_field($post->post_type);
    if (!$field) { return; }
    wp_nonce_field('kzfr_editorial_details_' . $post->ID, 'kzfr_editorial_nonce');
    $value = get_post_meta($post->ID, $field[0], true);
    echo '<p><label for="kzfr-editorial-value"><strong>' . esc_html($field[1]) . '</strong></label></p>';
    echo '<input class="widefat" id="kzfr-editorial-value" name="kzfr_editorial_value" type="' . esc_attr($field[2]) . '" value="' . esc_attr($value) . '" aria-describedby="kzfr-editorial-help" maxlength="2048">';
    echo '<p id="kzfr-editorial-help" class="description">' . esc_html($field[4]) . '</p>';
    if ($post->post_type === 'kzfr_event' && !$value) {
        echo '<p><strong>A valid event date is needed for this event to appear in the upcoming calendar.</strong></p>';
    }
}

function kzfr_bridge_save_editor_fields($post_id, $post) {
    $field = kzfr_bridge_editor_field($post->post_type);
    if (!$field || wp_is_post_revision($post_id) || wp_is_post_autosave($post_id)) { return; }
    if (!current_user_can('edit_post', $post_id)) { return; }
    if (!isset($_POST['kzfr_editorial_nonce']) || !is_string($_POST['kzfr_editorial_nonce']) ||
        !wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['kzfr_editorial_nonce'])), 'kzfr_editorial_details_' . $post_id)) { return; }
    if (!isset($_POST['kzfr_editorial_value']) || !is_string($_POST['kzfr_editorial_value'])) { return; }
    $raw = trim(wp_unslash($_POST['kzfr_editorial_value']));
    if ($raw === '') {
        delete_post_meta($post_id, $field[0]);
        delete_transient('kzfr_editorial_error_' . get_current_user_id() . '_' . $post_id);
        return;
    }
    $value = call_user_func($field[3], $raw);
    if ($value === '') {
        // Keep the last accepted value rather than silently removing it.
        set_transient('kzfr_editorial_error_' . get_current_user_id() . '_' . $post_id, 'Station details were not saved. Check the field format; the previous accepted value was retained.', MINUTE_IN_SECONDS);
        return;
    }
    update_post_meta($post_id, $field[0], $value);
    delete_transient('kzfr_editorial_error_' . get_current_user_id() . '_' . $post_id);
}
add_action('save_post', 'kzfr_bridge_save_editor_fields', 10, 2);

function kzfr_bridge_editor_notice() {
    $post_id = isset($_GET['post']) ? absint($_GET['post']) : 0;
    if (!$post_id || !current_user_can('edit_post', $post_id)) { return; }
    $key = 'kzfr_editorial_error_' . get_current_user_id() . '_' . $post_id;
    $notice = get_transient($key);
    if ($notice) {
        delete_transient($key);
        echo '<div class="notice notice-error is-dismissible"><p>' . esc_html($notice) . '</p></div>';
    }
}
add_action('admin_notices', 'kzfr_bridge_editor_notice');
