<?php
/** Station-owned service links; no embeds, audio fetching or payment processing. */
if (!defined('ABSPATH')) { exit; }

function kzfr_theme_services() {
    return array(
        'listen' => array('label' => __('Listen live', 'kzfr-community-radio'), 'default' => 'https://kzfr.org/listen', 'hosts' => array('kzfr.org', 'www.kzfr.org', 'listen.kzfr.org')),
        'archive' => array('label' => __('Audio archives', 'kzfr-community-radio'), 'default' => 'https://kzfr.studio.creek.org/archives/', 'hosts' => array('kzfr.studio.creek.org')),
        'schedule' => array('label' => __('Program schedule', 'kzfr-community-radio'), 'default' => 'https://kzfr.org/programs', 'hosts' => array('kzfr.org', 'www.kzfr.org', 'kzfr.studio.creek.org')),
        'donate' => array('label' => __('Donate', 'kzfr-community-radio'), 'default' => 'https://kzfr-donate.creek.org/', 'hosts' => array('kzfr-donate.creek.org')),
    );
}

/** Empty disables a service; null is invalid and must not overwrite a saved link. */
function kzfr_theme_clean_service_url($value, $service) {
    $services = kzfr_theme_services();
    if (!isset($services[$service]) || !is_string($value) || strlen($value) > 2048) { return null; }
    $value = trim($value);
    if ($value === '') { return ''; }
    if (preg_match('/[\x00-\x20\x7f\\\\]/', $value)) { return null; }
    $parts = wp_parse_url($value);
    if (!is_array($parts) || strtolower($parts['scheme'] ?? '') !== 'https' ||
        !in_array(strtolower($parts['host'] ?? ''), $services[$service]['hosts'], true) ||
        isset($parts['user']) || isset($parts['pass']) || isset($parts['port'])) { return null; }
    $clean = esc_url_raw($value, array('https'));
    return $clean !== '' ? $clean : null;
}

function kzfr_theme_service_url($service) {
    $services = kzfr_theme_services();
    if (!isset($services[$service])) { return ''; }
    $url = kzfr_theme_clean_service_url(get_theme_mod('kzfr_service_' . $service, $services[$service]['default']), $service);
    return $url === null ? $services[$service]['default'] : $url;
}

function kzfr_theme_customize_services($wp_customize) {
    $wp_customize->add_section('kzfr_station_services', array(
        'title' => __('Station service links', 'kzfr-community-radio'),
        'description' => __('Update the existing station and Creek links. Clear a field to hide that service link.', 'kzfr-community-radio'),
        'priority' => 35,
    ));
    foreach (kzfr_theme_services() as $service => $details) {
        $id = 'kzfr_service_' . $service;
        $wp_customize->add_setting($id, array(
            'type' => 'theme_mod', 'capability' => 'edit_theme_options',
            'default' => $details['default'], 'transport' => 'refresh',
            'validate_callback' => function ($validity, $value) use ($service) {
                if (kzfr_theme_clean_service_url($value, $service) === null) {
                    $validity->add('kzfr_service_url', __('Use an HTTPS address on the listed station service, without a username or port.', 'kzfr-community-radio'));
                }
                return $validity;
            },
            'sanitize_callback' => function ($value) use ($service) { return kzfr_theme_clean_service_url($value, $service); },
        ));
        $wp_customize->add_control($id, array(
            'section' => 'kzfr_station_services', 'label' => $details['label'], 'type' => 'url',
            'description' => sprintf(__('Allowed services: %s. Leave blank to hide.', 'kzfr-community-radio'), implode(', ', $details['hosts'])),
            'input_attrs' => array('maxlength' => 2048),
        ));
    }
}
add_action('customize_register', 'kzfr_theme_customize_services');

function kzfr_theme_external_link($url, $label, $class = '') {
    if (!$url) { return; }
    echo '<a href="' . esc_url($url) . '" class="' . esc_attr($class) . '" target="_blank" rel="noopener noreferrer">' .
        esc_html($label) . ' <span aria-hidden="true">↗</span><span class="sr-only"> ' .
        esc_html__('(opens a new tab)', 'kzfr-community-radio') . '</span></a>';
}

function kzfr_theme_service_link($service, $label, $class = '') {
    kzfr_theme_external_link(kzfr_theme_service_url($service), $label, $class);
}

function kzfr_theme_event_day($post_id) {
    $day = get_post_meta($post_id, 'kzfr_event_date', true);
    return function_exists('kzfr_bridge_event_date') ? kzfr_bridge_event_date($day) : '';
}

function kzfr_theme_event_time($day) {
    if (!$day || !function_exists('kzfr_bridge_event_date') || !kzfr_bridge_event_date($day)) { return; }
    $date = new DateTimeImmutable($day, wp_timezone());
    echo '<time datetime="' . esc_attr($day) . '">' . esc_html(wp_date(get_option('date_format'), $date->getTimestamp(), wp_timezone())) . '</time>';
}

function kzfr_theme_underwriter_link($post_id) {
    $url = get_post_meta($post_id, 'kzfr_underwriter_site', true);
    return function_exists('kzfr_bridge_safe_https_url') ? kzfr_bridge_safe_https_url($url) : '';
}
