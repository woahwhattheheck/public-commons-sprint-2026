<?php
/**
 * Plugin Name: KZFR Editorial Bridge (Independent Candidate)
 * Description: Portable WordPress editorial content model for a KZFR website-redesign proof. Does not ingest or replace Creek Studio.
 * Version: 0.1.0
 * Requires at least: 6.3
 * Requires PHP: 8.0
 * License: GPL-2.0-or-later
 */
if (!defined('ABSPATH')) { exit; }

/** No DNS/network calls: this is only a link allowlist, never an audio fetch. */
function kzfr_bridge_creek_url($value) {
    if (!is_string($value) || strlen($value) > 2048) { return ''; }
    $value = trim($value);
    $parts = wp_parse_url($value);
    if (!is_array($parts)) { return ''; }
    if (strtolower($parts['scheme'] ?? '') !== 'https') { return ''; }
    if (strtolower($parts['host'] ?? '') !== 'kzfr.studio.creek.org') { return ''; }
    if (isset($parts['user']) || isset($parts['pass']) || isset($parts['port'])) { return ''; }
    return esc_url_raw($value, array('https'));
}
function kzfr_bridge_safe_https_url($value) {
    if (!is_string($value) || strlen($value) > 2048) { return ''; }
    $value = trim($value);
    $parts = wp_parse_url($value);
    if (!is_array($parts) || strtolower($parts['scheme'] ?? '') !== 'https' || empty($parts['host'])) { return ''; }
    if (isset($parts['user']) || isset($parts['pass']) || isset($parts['port'])) { return ''; }
    return esc_url_raw($value, array('https'));
}
function kzfr_bridge_event_date($value) {
    if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}$/D', $value)) { return ''; }
    list($year, $month, $day) = array_map('intval', explode('-', $value));
    return checkdate($month, $day, $year) ? $value : '';
}
function kzfr_bridge_can_edit_meta($allowed, $meta_key, $post_id) {
    return current_user_can('edit_post', (int) $post_id);
}
function kzfr_bridge_register_content() {
    $types = array(
        'kzfr_program' => array('Program', 'Programs', 'dashicons-format-audio', 'programs'),
        'kzfr_event' => array('Community Event', 'Community Events', 'dashicons-calendar-alt', 'events'),
        'kzfr_underwriter' => array('Underwriter', 'Underwriters', 'dashicons-groups', 'underwriters'),
    );
    foreach ($types as $slug => $entry) {
        register_post_type($slug, array(
            'labels' => array('name' => $entry[1], 'singular_name' => $entry[0], 'add_new_item' => 'Add ' . $entry[0]),
            'public' => true,
            'show_in_rest' => true,
            'has_archive' => true,
            'rewrite' => array('slug' => $entry[3], 'with_front' => false),
            'menu_icon' => $entry[2],
            'supports' => array('title', 'editor', 'excerpt', 'thumbnail', 'revisions', 'custom-fields'),
        ));
    }
    register_taxonomy('kzfr_genre', array('kzfr_program'), array(
        'labels' => array('name' => 'Program Genres', 'singular_name' => 'Program Genre'),
        'hierarchical' => true,
        'public' => true,
        'show_in_rest' => true,
        'rewrite' => array('slug' => 'program-genre', 'with_front' => false),
    ));
    foreach (array(
        array('kzfr_program', 'kzfr_creek_url', 'kzfr_bridge_creek_url', 'URL of existing Creek Studio program or archive'),
        array('kzfr_event', 'kzfr_event_date', 'kzfr_bridge_event_date', 'Local event date YYYY-MM-DD'),
        array('kzfr_underwriter', 'kzfr_underwriter_site', 'kzfr_bridge_safe_https_url', 'Underwriter HTTPS website'),
    ) as $meta) {
        register_post_meta($meta[0], $meta[1], array(
            'type' => 'string',
            'description' => $meta[3],
            'single' => true,
            'show_in_rest' => true,
            'sanitize_callback' => $meta[2],
            'auth_callback' => 'kzfr_bridge_can_edit_meta',
            'revisions_enabled' => true,
        ));
    }
}
add_action('init', 'kzfr_bridge_register_content');

function kzfr_bridge_activate() {
    kzfr_bridge_register_content();
    flush_rewrite_rules();
}
register_activation_hook(__FILE__, 'kzfr_bridge_activate');
register_deactivation_hook(__FILE__, 'flush_rewrite_rules');
