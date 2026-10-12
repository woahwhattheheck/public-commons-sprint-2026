<?php
if (!defined('ABSPATH')) { exit; }

function cskt_dewr_excerpt($post, $words = 42) {
    $text = trim((string) $post->post_excerpt);
    if ($text === '') { $text = strip_shortcodes((string) $post->post_content); }
    return wp_trim_words(wp_strip_all_tags($text, true), $words, '…');
}
function cskt_dewr_document($post_id) {
    $raw = get_post_meta($post_id, '_cskt_document', true);
    $value = is_string($raw) ? json_decode($raw, true) : null;
    return is_array($value) ? $value : null;
}
function cskt_dewr_public_entry($post) {
    if (!in_array($post->post_type, array('cskt_staff','cskt_opportunity'), true) || !function_exists('csktm_site_entry')) { return null; }
    $entry = csktm_site_entry($post);
    return is_array($entry) ? $entry : null;
}
function cskt_dewr_terms($post_id, $taxonomy = 'cskt_topic') {
    if (!taxonomy_exists($taxonomy)) { return; }
    $terms = get_the_terms($post_id, $taxonomy);
    if (!$terms || is_wp_error($terms)) { return; }
    echo '<ul class="dewr-topic-links" aria-label="' . esc_attr($taxonomy === 'cskt_department' ? __('Departments', 'cskt-dewr') : __('Topics', 'cskt-dewr')) . '">';
    foreach ($terms as $term) {
        $link = get_term_link($term);
        if (!is_wp_error($link)) { echo '<li><a href="' . esc_url($link) . '">' . esc_html($term->name) . '</a></li>'; }
    }
    echo '</ul>';
}
function cskt_dewr_date($value) {
    if (!is_string($value) || trim($value) === '') { return ''; }
    try { $date = new DateTimeImmutable($value); }
    catch (Exception $error) { return ''; }
    return wp_date(get_option('date_format') . ', ' . get_option('time_format') . ' T', $date->getTimestamp());
}
function cskt_dewr_card($post) {
    $post = cskt_dewr_public_post($post);
    if (!$post) { return; }
    $entry = cskt_dewr_public_entry($post);
    $archived = get_post_meta($post->ID, '_cskt_archive', true) === '1';
    $title = get_the_title($post);
    $document = cskt_dewr_document($post->ID);
    echo '<li class="dewr-result"><article class="dewr-result-inner">';
    if ($post->post_type === 'cskt_staff' && !empty($entry['thumbnail']) && has_post_thumbnail($post)) {
        echo '<div class="dewr-result-photo">' . get_the_post_thumbnail($post, 'thumbnail', array('loading' => 'lazy')) . '</div>';
    }
    echo '<div class="dewr-result-body"><div class="dewr-eyebrow">' . esc_html(cskt_dewr_type_label($post->post_type));
    if ($archived) { echo ' <span class="dewr-status">' . esc_html__('Archived', 'cskt-dewr') . '</span>'; }
    if (is_array($entry['opportunity'] ?? null)) {
        $state = $entry['opportunity']['effectiveState'] ?? '';
        $labels = array('scheduled' => __('Upcoming', 'cskt-dewr'), 'open' => __('Open', 'cskt-dewr'),
            'closed' => __('Closed', 'cskt-dewr'), 'awarded' => __('Awarded', 'cskt-dewr'),
            'cancelled' => __('Cancelled', 'cskt-dewr'), 'archived' => __('Archived', 'cskt-dewr'));
        if (isset($labels[$state]) && !($archived && $state === 'archived')) { echo ' <span class="dewr-status">' . esc_html($labels[$state]) . '</span>'; }
    }
    echo '</div><h3><a href="' . esc_url(get_permalink($post)) . '">' . esc_html($title) . '</a></h3>';
    if (is_array($entry['staff'] ?? null) && !empty($entry['staff']['roleTitle'])) {
        echo '<p class="dewr-card-role">' . esc_html($entry['staff']['roleTitle']) . '</p>';
    }
    $excerpt = cskt_dewr_excerpt($post);
    if ($excerpt !== '') { echo '<p class="dewr-result-summary">' . esc_html($excerpt) . '</p>'; }
    if ($document) {
        echo '<p class="dewr-result-facts">';
        $facts = array();
        if (!empty($document['versionLabel'])) { $facts[] = $document['versionLabel']; }
        if (!empty($document['mimeType'])) { $facts[] = $document['mimeType']; }
        if (isset($document['bytes']) && is_numeric($document['bytes'])) { $facts[] = size_format((int) $document['bytes'], 1); }
        echo esc_html(implode(' · ', $facts)) . '</p>';
    }
    if (is_array($entry['opportunity'] ?? null)) {
        $opportunity = $entry['opportunity'];
        $facts = array();
        if (!empty($opportunity['reference'])) { $facts[] = $opportunity['reference']; }
        if (!empty($opportunity['location'])) { $facts[] = $opportunity['location']; }
        if ($facts) { echo '<p class="dewr-result-facts">' . esc_html(implode(' · ', $facts)) . '</p>'; }
        if (!empty($opportunity['closesAt']) && cskt_dewr_date($opportunity['closesAt']) !== '') {
            echo '<p class="dewr-result-facts">' . esc_html__('Deadline:', 'cskt-dewr') . ' <time datetime="' . esc_attr($opportunity['closesAt']) . '">' . esc_html(cskt_dewr_date($opportunity['closesAt'])) . '</time></p>';
        }
    }
    cskt_dewr_terms($post->ID, in_array($post->post_type, array('cskt_staff','cskt_opportunity'), true) ? 'cskt_department' : 'cskt_topic');
    $date = get_the_modified_date('c', $post);
    echo '<p class="dewr-result-meta">' . esc_html__('Updated', 'cskt-dewr') . ' <time datetime="' . esc_attr($date) . '">' . esc_html(get_the_modified_date(get_option('date_format'), $post)) . '</time></p>';
    echo '</div></article></li>';
}
function cskt_dewr_home_collection($role, $limit = 4) {
    $roles = cskt_dewr_roles();
    if (!isset($roles[$role])) { return; }
    $context = array('role' => $role, 'query' => '', 'state' => 'current', 'topic' => 0, 'department' => 0,
        'opportunityState' => $role === 'opportunities' ? 'open' : 'all', 'sort' => 'updated', 'page' => 1);
    $args = cskt_dewr_catalog_args($context);
    $args['posts_per_page'] = $limit;
    $args['no_found_rows'] = true;
    $query = new WP_Query($args);
    if (!$query->posts) { return; }
    echo '<section class="dewr-home-collection"><div class="dewr-section-heading"><h2>' . esc_html($roles[$role]['label']) . '</h2><a href="' . esc_url(cskt_dewr_collection_url($role)) . '">' . esc_html(sprintf(__('View all %s', 'cskt-dewr'), strtolower($roles[$role]['label']))) . '</a></div><ol class="dewr-results">';
    foreach ($query->posts as $post) { cskt_dewr_card($post); }
    echo '</ol></section>';
}
function cskt_dewr_page_meta($post) {
    echo '<div class="dewr-page-tools"><p>' . esc_html__('Last updated', 'cskt-dewr') . ' <time datetime="' . esc_attr(get_the_modified_date('c', $post)) . '">' . esc_html(get_the_modified_date(get_option('date_format'), $post)) . '</time></p>';
    echo '<button class="dewr-print-link" type="button" data-dewr-print hidden>' . esc_html__('Print this page', 'cskt-dewr') . '</button></div>';
    cskt_dewr_terms($post->ID);
}
function cskt_dewr_contact() {
    $config = cskt_dewr_config();
    $contact = is_array($config['contact'] ?? null) ? $config['contact'] : array();
    if (!array_filter($contact, function ($value) { return is_string($value) && trim($value) !== ''; })) { return; }
    echo '<section class="dewr-footer-contact"><h2>' . esc_html__('Contact', 'cskt-dewr') . '</h2><address>';
    if (!empty($contact['address'])) { echo '<p>' . nl2br(esc_html($contact['address'])) . '</p>'; }
    if (!empty($contact['email']) && is_email($contact['email'])) {
        echo '<p><a href="' . esc_url('mailto:' . $contact['email']) . '">' . esc_html($contact['email']) . '</a></p>';
    }
    if (!empty($contact['phone'])) {
        $phone = preg_replace('/[^0-9+*#(),;. -]/', '', $contact['phone']);
        echo '<p><a href="' . esc_url('tel:' . str_replace(' ', '', $phone)) . '">' . esc_html($contact['phone']) . '</a></p>';
    }
    if (!empty($contact['hours'])) { echo '<p>' . esc_html($contact['hours']) . '</p>'; }
    echo '</address></section>';
}
