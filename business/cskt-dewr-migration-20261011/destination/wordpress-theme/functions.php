<?php
/**
 * DEWR public website theme.
 */
if (!defined('ABSPATH')) { exit; }
define('CSKT_DEWR_THEME_VERSION', '1.0.0');

require_once __DIR__ . '/inc/navigation.php';
require_once __DIR__ . '/inc/catalog.php';
require_once __DIR__ . '/inc/content.php';
require_once __DIR__ . '/inc/patterns.php';

add_action('after_setup_theme', function () {
    load_theme_textdomain('cskt-dewr', get_template_directory() . '/languages');
    add_theme_support('title-tag');
    add_theme_support('post-thumbnails');
    add_theme_support('automatic-feed-links');
    add_theme_support('responsive-embeds');
    add_theme_support('align-wide');
    add_theme_support('editor-styles');
    add_theme_support('html5', array('search-form', 'comment-form', 'comment-list', 'gallery', 'caption', 'style', 'script'));
    add_theme_support('custom-logo', array('height' => 100, 'width' => 300, 'flex-height' => true, 'flex-width' => true));
    add_editor_style('assets/editor.css');
    register_nav_menus(array(
        'primary' => __('Primary navigation', 'cskt-dewr'),
        'utility' => __('Utility links', 'cskt-dewr'),
        'footer' => __('Footer links', 'cskt-dewr'),
    ));
});
add_action('wp_enqueue_scripts', function () {
    wp_enqueue_style('cskt-dewr-theme', get_theme_file_uri('/style.css'), array(), CSKT_DEWR_THEME_VERSION);
    wp_enqueue_script('cskt-dewr-theme', get_theme_file_uri('/assets/site.js'), array(), CSKT_DEWR_THEME_VERSION, array('in_footer' => true, 'strategy' => 'defer'));
    wp_add_inline_script('cskt-dewr-theme', 'window.csktDewrText=' . wp_json_encode(array(
        'compare' => __('Compare images', 'cskt-dewr'),
        'originals' => __('Show both original images', 'cskt-dewr'),
        'position' => __('Image comparison position', 'cskt-dewr'),
        'before' => __('Before', 'cskt-dewr'),
        'after' => __('After', 'cskt-dewr'),
        'comparison' => __('Before and after image comparison', 'cskt-dewr'),
        'percentBefore' => __('% of the before image is visible', 'cskt-dewr'),
        'scrollTable' => __('Scrollable data table', 'cskt-dewr'),
    ), JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) . ';', 'before');
});
add_filter('body_class', function ($classes) {
    $classes[] = 'dewr-site';
    return $classes;
});
add_filter('excerpt_more', function () { return '…'; });
