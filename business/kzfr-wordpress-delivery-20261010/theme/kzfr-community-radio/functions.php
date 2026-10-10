<?php
/** Accessible classic WordPress theme starter. Content types live in the portable companion plugin. */
if (!defined('ABSPATH')) { exit; }

function kzfr_theme_setup() {
    add_theme_support('title-tag');
    add_theme_support('post-thumbnails');
    add_theme_support('responsive-embeds');
    add_theme_support('automatic-feed-links');
    add_theme_support('html5', array('search-form', 'comment-form', 'comment-list', 'gallery', 'caption', 'style', 'script'));
    register_nav_menus(array('primary' => __('Primary Navigation', 'kzfr-community-radio')));
}
add_action('after_setup_theme', 'kzfr_theme_setup');
function kzfr_theme_assets() {
    $version = wp_get_theme()->get('Version');
    wp_enqueue_style('kzfr-community-style', get_stylesheet_uri(), array(), $version);
    wp_enqueue_script('kzfr-community-menu', get_template_directory_uri() . '/assets/site.js', array(), $version, true);
}
add_action('wp_enqueue_scripts', 'kzfr_theme_assets');

/** Trust only existing Creek Studio links, not arbitrary HTML/embed/stream code. */
function kzfr_theme_creek_link($post_id) {
    $url = get_post_meta($post_id, 'kzfr_creek_url', true);
    if (function_exists('kzfr_bridge_creek_url')) {
        return kzfr_bridge_creek_url($url);
    }
    return '';
}
function kzfr_theme_fallback_menu() {
    $base = home_url('/');
    echo '<ul class="kzfr-menu">';
    foreach (array(
        array($base . '#listen', 'Listen'),
        array(get_post_type_archive_link('kzfr_program') ?: $base . '#programs', 'Programs'),
        array(get_post_type_archive_link('kzfr_event') ?: $base . '#community', 'Events'),
        array($base . '#support', 'Support'),
    ) as $entry) {
        echo '<li><a href="' . esc_url($entry[0]) . '">' . esc_html($entry[1]) . '</a></li>';
    }
    echo '</ul>';
}
