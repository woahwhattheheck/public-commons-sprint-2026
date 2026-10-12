<?php
if (!defined('ABSPATH')) { exit; }

function cskt_dewr_get($name, $fallback = '') {
    if (!isset($_GET[$name]) || !is_scalar($_GET[$name])) { return $fallback; }
    return sanitize_text_field(wp_unslash((string) $_GET[$name]));
}
function cskt_dewr_choice($name, $choices, $fallback) {
    $value = cskt_dewr_get($name, $fallback);
    return in_array($value, $choices, true) ? $value : $fallback;
}
function cskt_dewr_catalog_context($role = '', $page_id = 0, $native_query = null) {
    $roles = cskt_dewr_roles();
    if (!isset($roles[$role])) { $role = ''; }
    $locked = $role !== '';
    $native_types = array();
    if (!($native_query instanceof WP_Query)) { $native_query = $GLOBALS['wp_query'] ?? null; }
    if (!$locked) {
        $candidate = cskt_dewr_get('dewr_kind');
        if (isset($roles[$candidate])) { $role = $candidate; }
        if ($role === '' && $native_query instanceof WP_Query && $native_query->is_search()) {
            // Read the original request, not post_type later expanded by this theme.
            $requested = $native_query->query['post_type'] ?? null;
            if (is_string($requested)) { $requested = array($requested); }
            if (is_array($requested)) {
                $requested = array_filter($requested, 'is_string');
                $native_types = array_values(array_unique(array_intersect($requested, array_column($roles, 'type'))));
                if (count($native_types) === 1) { $role = cskt_dewr_role_for_type($native_types[0]); }
            }
        }
        if ($role === '' && is_post_type_archive()) {
            $type = get_query_var('post_type');
            if (is_string($type)) { $role = cskt_dewr_role_for_type($type); }
        }
    }
    $action = $page_id ? get_permalink($page_id) : home_url('/');
    if (!$page_id && is_tax(array('cskt_topic','cskt_department'))) {
        $term_link = get_term_link(get_queried_object());
        if (!is_wp_error($term_link)) { $action = $term_link; }
    } elseif (!$page_id && is_post_type_archive() && isset($roles[$role])) {
        $archive_link = get_post_type_archive_link($roles[$role]['type']);
        if ($archive_link) { $action = $archive_link; }
    } elseif (!$page_id && is_home() && (int) get_option('page_for_posts')) {
        $action = get_permalink((int) get_option('page_for_posts'));
    }
    $query = $page_id ? cskt_dewr_get('dewr_q') : get_search_query(false);
    $opportunity = cskt_dewr_choice('dewr_opportunity_state', array('all','scheduled','open','closed','awarded','cancelled','archived'), $role === 'opportunities' ? 'open' : 'all');
    $state = cskt_dewr_choice('dewr_state', array('current','all','archived'), 'current');
    if ($role === 'opportunities' && $opportunity === 'archived') { $state = 'all'; }
    return array(
        'role' => $role, 'locked' => $locked, 'pageId' => (int) $page_id, 'nativeTypes' => $native_types,
        'action' => $action,
        'query' => $query, 'state' => $state,
        'topic' => max(0, (int) cskt_dewr_get('dewr_topic', '0')),
        'department' => max(0, (int) cskt_dewr_get('dewr_department', '0')),
        'opportunityState' => $opportunity,
        'opportunityKind' => cskt_dewr_choice('dewr_opportunity_kind', array('all','career','procurement'), 'all'),
        'sort' => cskt_dewr_choice('dewr_sort', array('updated','newest','title'), in_array($role, array('staff','pages'), true) ? 'title' : 'updated'),
        'page' => max(1, $page_id ? (int) cskt_dewr_get('dewr_page', '1') : (int) get_query_var('paged')),
    );
}
function cskt_dewr_catalog_args($context, $base = array()) {
    $roles = cskt_dewr_roles();
    $types = isset($roles[$context['role']]) ? array($roles[$context['role']]['type']) : (!empty($context['nativeTypes']) ? $context['nativeTypes'] : array_column($roles, 'type'));
    $args = array_merge($base, array(
        'post_type' => count($types) === 1 ? $types[0] : $types, 'post_status' => 'publish', 'has_password' => false,
        'posts_per_page' => 20, 'paged' => $context['page'], 'ignore_sticky_posts' => true,
        's' => $context['query'],
    ));
    $args['orderby'] = $context['sort'] === 'title' ? array('title' => 'ASC', 'ID' => 'ASC') :
        ($context['sort'] === 'newest' ? array('date' => 'DESC', 'ID' => 'DESC') : array('modified' => 'DESC', 'ID' => 'DESC'));
    if ($context['state'] !== 'all') {
        $archive = $context['state'] === 'archived' ?
            array('key' => '_cskt_archive', 'value' => '1', 'compare' => '=') :
            array('relation' => 'OR', array('key' => '_cskt_archive', 'compare' => 'NOT EXISTS'), array('key' => '_cskt_archive', 'value' => '1', 'compare' => '!='));
        $existing = $args['meta_query'] ?? array();
        $args['meta_query'] = $existing ? array('relation' => 'AND', $existing, $archive) : array($archive);
    }
    if ($context['topic'] && taxonomy_exists('cskt_topic') && term_exists($context['topic'], 'cskt_topic')) {
        $topic = array('taxonomy' => 'cskt_topic', 'field' => 'term_id', 'terms' => array($context['topic']), 'include_children' => true);
        $existing = $args['tax_query'] ?? array();
        $args['tax_query'] = $existing ? array('relation' => 'AND', $existing, $topic) : array($topic);
    }
    if (function_exists('csktm_site_query_args')) {
        $args = csktm_site_query_args($args, array('departmentId' => $context['department'], 'opportunityState' => $context['opportunityState'], 'opportunityKind' => $context['opportunityKind'] ?? 'all'));
    }
    return $args;
}
add_action('pre_get_posts', function ($query) {
    if (is_admin() || !$query->is_main_query() || (defined('REST_REQUEST') && REST_REQUEST) || $query->is_feed()) { return; }
    $is_catalog = $query->is_search() || $query->is_home() || $query->is_post_type_archive(array('cskt_project','cskt_document','cskt_notice','cskt_staff','cskt_opportunity')) || $query->is_tax(array('cskt_topic','cskt_department'));
    if (!$is_catalog) { return; }
    $roles = cskt_dewr_roles();
    $role = $query->is_home() ? 'news' : '';
    $native_type = $query->get('post_type');
    if ($query->is_post_type_archive() && is_string($native_type)) { $role = cskt_dewr_role_for_type($native_type); }
    $context = cskt_dewr_catalog_context($role, 0, $query);
    $context['query'] = (string) $query->get('s');
    $context['page'] = max(1, (int) $query->get('paged'));
    $args = cskt_dewr_catalog_args($context, array('meta_query' => $query->get('meta_query') ?: array(), 'tax_query' => $query->get('tax_query') ?: array()));
    foreach ($args as $key => $value) { $query->set($key, $value); }
}, 30);

function cskt_dewr_term_select($name, $taxonomy, $label, $value) {
    if (!taxonomy_exists($taxonomy)) { return; }
    $terms = get_terms(array('taxonomy' => $taxonomy, 'hide_empty' => false));
    if (is_wp_error($terms) || !$terms) { return; }
    $id = wp_unique_id('dewr-filter-');
    echo '<div class="dewr-filter-field"><label for="' . esc_attr($id) . '">' . esc_html($label) . '</label><select name="' . esc_attr($name) . '" id="' . esc_attr($id) . '"><option value="0">' . esc_html__('All', 'cskt-dewr') . '</option>';
    foreach ($terms as $term) {
        $prefix = str_repeat('— ', count(get_ancestors($term->term_id, $taxonomy, 'taxonomy')));
        echo '<option value="' . (int) $term->term_id . '"' . selected((int) $value, (int) $term->term_id, false) . '>' . esc_html($prefix . $term->name) . '</option>';
    }
    echo '</select></div>';
}
function cskt_dewr_catalog_form($context) {
    $roles = cskt_dewr_roles();
    $id = wp_unique_id('dewr-catalog-');
    echo '<form class="dewr-catalog-filter" role="search" action="' . esc_url($context['action']) . '" method="get" aria-label="' . esc_attr__('Find published resources', 'cskt-dewr') . '">';
    cskt_dewr_form_action_fields($context['action']);
    if (count($context['nativeTypes'] ?? array()) > 1) {
        foreach ($context['nativeTypes'] as $type) {
            echo '<input type="hidden" name="post_type[]" value="' . esc_attr($type) . '">';
        }
    }
    echo '<div class="dewr-filter-search"><label for="' . esc_attr($id) . '">' . esc_html__('Search this collection', 'cskt-dewr') . '</label><div class="dewr-search-line"><input type="search" id="' . esc_attr($id) . '" name="' . ($context['pageId'] ? 'dewr_q' : 's') . '" value="' . esc_attr($context['query']) . '" maxlength="512"><button type="submit">' . esc_html__('Search', 'cskt-dewr') . '</button></div></div>';
    echo '<div class="dewr-filter-options">';
    if ($context['locked']) {
        echo '<input type="hidden" name="dewr_kind" value="' . esc_attr($context['role']) . '">';
    } else {
        echo '<div class="dewr-filter-field"><label for="' . esc_attr($id . '-kind') . '">' . esc_html__('Content', 'cskt-dewr') . '</label><select id="' . esc_attr($id . '-kind') . '" name="dewr_kind"><option value="">' . esc_html(count($context['nativeTypes'] ?? array()) > 1 ? __('All selected types', 'cskt-dewr') : __('All content', 'cskt-dewr')) . '</option>';
        foreach ($roles as $role => $value) { echo '<option value="' . esc_attr($role) . '"' . selected($context['role'], $role, false) . '>' . esc_html($value['label']) . '</option>'; }
        echo '</select></div>';
    }
    cskt_dewr_term_select('dewr_topic', 'cskt_topic', __('Topic', 'cskt-dewr'), $context['topic']);
    if ($context['role'] === '' || in_array($context['role'], array('staff','opportunities'), true)) {
        cskt_dewr_term_select('dewr_department', 'cskt_department', __('Department', 'cskt-dewr'), $context['department']);
    }
    echo '<div class="dewr-filter-field"><label for="' . esc_attr($id . '-state') . '">' . esc_html__('Publication', 'cskt-dewr') . '</label><select name="dewr_state" id="' . esc_attr($id . '-state') . '">';
    foreach (array('current' => __('Current', 'cskt-dewr'), 'all' => __('Current and archived', 'cskt-dewr'), 'archived' => __('Archived', 'cskt-dewr')) as $value => $label) {
        echo '<option value="' . esc_attr($value) . '"' . selected($context['state'], $value, false) . '>' . esc_html($label) . '</option>';
    }
    echo '</select></div>';
    if ($context['role'] === 'opportunities') {
        echo '<div class="dewr-filter-field"><label for="' . esc_attr($id . '-opportunity-kind') . '">' . esc_html__('Opportunity type', 'cskt-dewr') . '</label><select name="dewr_opportunity_kind" id="' . esc_attr($id . '-opportunity-kind') . '">';
        foreach (array('all' => __('Careers and procurement', 'cskt-dewr'), 'career' => __('Careers', 'cskt-dewr'), 'procurement' => __('Procurement', 'cskt-dewr')) as $value => $label) {
            echo '<option value="' . esc_attr($value) . '"' . selected($context['opportunityKind'], $value, false) . '>' . esc_html($label) . '</option>';
        }
        echo '</select></div>';
        echo '<div class="dewr-filter-field"><label for="' . esc_attr($id . '-opportunity') . '">' . esc_html__('Opportunity status', 'cskt-dewr') . '</label><select name="dewr_opportunity_state" id="' . esc_attr($id . '-opportunity') . '">';
        foreach (array('all' => __('All statuses', 'cskt-dewr'), 'open' => __('Open', 'cskt-dewr'), 'scheduled' => __('Upcoming', 'cskt-dewr'), 'closed' => __('Closed', 'cskt-dewr'), 'awarded' => __('Awarded', 'cskt-dewr'), 'cancelled' => __('Cancelled', 'cskt-dewr'), 'archived' => __('Archived', 'cskt-dewr')) as $value => $label) {
            echo '<option value="' . esc_attr($value) . '"' . selected($context['opportunityState'], $value, false) . '>' . esc_html($label) . '</option>';
        }
        echo '</select></div>';
    }
    echo '<div class="dewr-filter-field"><label for="' . esc_attr($id . '-sort') . '">' . esc_html__('Order', 'cskt-dewr') . '</label><select name="dewr_sort" id="' . esc_attr($id . '-sort') . '">';
    foreach (array('updated' => __('Recently updated', 'cskt-dewr'), 'newest' => __('Recently published', 'cskt-dewr'), 'title' => __('Title A–Z', 'cskt-dewr')) as $value => $label) {
        echo '<option value="' . esc_attr($value) . '"' . selected($context['sort'], $value, false) . '>' . esc_html($label) . '</option>';
    }
    echo '</select></div><button type="submit" class="dewr-filter-apply">' . esc_html__('Apply filters', 'cskt-dewr') . '</button></div>';
    $reset = $context['pageId'] ? get_permalink($context['pageId']) : ((is_tax(array('cskt_topic','cskt_department')) || is_post_type_archive() || is_home()) ? $context['action'] : ($context['role'] ? cskt_dewr_collection_url($context['role']) : add_query_arg('s', '', home_url('/'))));
    echo '<p class="dewr-filter-reset"><a href="' . esc_url($reset) . '">' . esc_html__('Reset filters', 'cskt-dewr') . '</a></p></form>';
}
function cskt_dewr_catalog_pagination($query, $context) {
    if ((int) $query->max_num_pages < 2) { return; }
    $number = 999999999;
    if ($context['pageId']) {
        $current = add_query_arg(array(
            'dewr_q' => $context['query'], 'dewr_kind' => $context['role'], 'dewr_state' => $context['state'],
            'dewr_topic' => $context['topic'], 'dewr_department' => $context['department'],
            'dewr_opportunity_state' => $context['opportunityState'], 'dewr_opportunity_kind' => $context['opportunityKind'], 'dewr_sort' => $context['sort'], 'dewr_page' => $number,
        ), $context['action']);
        $base = str_replace((string) $number, '%#%', $current);
    } else {
        $base = str_replace((string) $number, '%#%', get_pagenum_link($number, false));
    }
    $links = paginate_links(array('base' => $base, 'format' => '', 'current' => $context['page'],
        'total' => (int) $query->max_num_pages, 'mid_size' => 1, 'type' => 'list',
        'prev_text' => __('Previous', 'cskt-dewr'), 'next_text' => __('Next', 'cskt-dewr')));
    if ($links) { echo '<nav class="dewr-pagination" aria-label="' . esc_attr__('Results pages', 'cskt-dewr') . '">' . wp_kses_post($links) . '</nav>'; }
}
function cskt_dewr_catalog($query, $context, $heading = '') {
    if ($heading !== '') { echo '<h2 class="dewr-collection-title">' . esc_html($heading) . '</h2>'; }
    cskt_dewr_catalog_form($context);
    $total = (int) $query->found_posts;
    echo '<p class="dewr-result-count">' . esc_html(sprintf(_n('%s published resource', '%s published resources', $total, 'cskt-dewr'), number_format_i18n($total))) . '</p>';
    if ($query->have_posts()) {
        echo '<ol class="dewr-results" start="' . (int) (($context['page'] - 1) * 20 + 1) . '">';
        foreach ($query->posts as $post) { cskt_dewr_card($post); }
        echo '</ol>';
        cskt_dewr_catalog_pagination($query, $context);
    } else {
        echo '<div class="dewr-empty"><h2>' . esc_html__('No resources match these filters', 'cskt-dewr') . '</h2><p>' . esc_html__('Try another search term or include archived publications.', 'cskt-dewr') . '</p></div>';
    }
}


/**
 * Reuse the selected landing-page query in both the public list and its native
 * aggregate search outcome. The metric contains only type and result bucket.
 */
function cskt_dewr_landing_collection($role, $page_id) {
    static $queries = array();
    $context = cskt_dewr_catalog_context($role, $page_id);
    $key = md5(wp_json_encode($context));
    if (!isset($queries[$key])) {
        $queries[$key] = array('context' => $context, 'query' => new WP_Query(cskt_dewr_catalog_args($context)));
    }
    return $queries[$key];
}
add_filter('cskt_site_search_query', function ($existing) {
    if ($existing instanceof WP_Query) { return $existing; }
    if (!is_page() || trim(cskt_dewr_get('dewr_q')) === '') { return null; }
    $post = cskt_dewr_public_post(get_queried_object_id());
    if (!$post) { return null; }
    $role = cskt_dewr_collection_role($post->ID);
    if ($role === '') { return null; }
    $collection = cskt_dewr_landing_collection($role, $post->ID);
    return $collection['query'];
});
