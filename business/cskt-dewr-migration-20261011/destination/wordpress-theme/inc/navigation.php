<?php
if (!defined('ABSPATH')) { exit; }

function cskt_dewr_config() {
    static $config = null;
    if ($config !== null) { return $config; }
    $public = function_exists('csktm_site_config') ? csktm_site_config() : array();
    $config = is_array($public) ? $public : array();
    return $config;
}
function cskt_dewr_public_post($post) {
    $post = get_post($post);
    return $post && $post->post_status === 'publish' && $post->post_password === '' && is_post_publicly_viewable($post) ? $post : null;
}
function cskt_dewr_roles() {
    $roles = array(
        'pages' => array('type' => 'page', 'label' => __('Pages', 'cskt-dewr')),
        'projects' => array('type' => 'cskt_project', 'label' => __('Projects', 'cskt-dewr')),
        'documents' => array('type' => 'cskt_document', 'label' => __('Documents', 'cskt-dewr')),
        'news' => array('type' => 'post', 'label' => __('News', 'cskt-dewr')),
        'notices' => array('type' => 'cskt_notice', 'label' => __('Notices', 'cskt-dewr')),
        'staff' => array('type' => 'cskt_staff', 'label' => __('Staff', 'cskt-dewr')),
        'opportunities' => array('type' => 'cskt_opportunity', 'label' => __('Opportunities', 'cskt-dewr')),
    );
    return array_filter($roles, function ($value) { $type = get_post_type_object($value['type']); return $type && $type->public; });
}
function cskt_dewr_role_for_type($type) {
    foreach (cskt_dewr_roles() as $role => $value) {
        if ($value['type'] === $type) { return $role; }
    }
    return '';
}
function cskt_dewr_type_label($type) {
    $object = get_post_type_object($type);
    return $object ? $object->labels->singular_name : __('Resource', 'cskt-dewr');
}
function cskt_dewr_selected_page($role) {
    $config = cskt_dewr_config();
    $selected = $config['pages'][$role] ?? null;
    if (!is_array($selected)) { return null; }
    return cskt_dewr_public_post((int) ($selected['id'] ?? 0));
}
function cskt_dewr_collection_role($post_id) {
    foreach (cskt_dewr_roles() as $role => $value) {
        if ($role === 'pages') { continue; }
        $page = cskt_dewr_selected_page($role);
        if ($page && (int) $page->ID === (int) $post_id) { return $role; }
    }
    return '';
}
function cskt_dewr_collection_url($role) {
    $page = cskt_dewr_selected_page($role);
    if ($page) { return get_permalink($page->ID); }
    return add_query_arg(array('s' => '', 'dewr_kind' => $role), home_url('/'));
}
function cskt_dewr_role_url($role) {
    if ($role === 'home') { return home_url('/'); }
    $page = cskt_dewr_selected_page($role);
    if ($page) { return get_permalink($page->ID); }
    return isset(cskt_dewr_roles()[$role]) ? cskt_dewr_collection_url($role) : '';
}
function cskt_dewr_fallback_menu($args) {
    $roles = cskt_dewr_roles();
    echo '<ul class="dewr-menu">';
    echo '<li><a href="' . esc_url(home_url('/')) . '">' . esc_html__('Home', 'cskt-dewr') . '</a></li>';
    foreach (array('about', 'projects', 'documents', 'news', 'notices', 'staff', 'opportunities', 'contact') as $role) {
        $url = cskt_dewr_role_url($role);
        if ($url === '') { continue; }
        $label = $roles[$role]['label'] ?? ($role === 'about' ? __('About', 'cskt-dewr') : __('Contact', 'cskt-dewr'));
        echo '<li><a href="' . esc_url($url) . '">' . esc_html($label) . '</a></li>';
    }
    echo '</ul>';
}
function cskt_dewr_menu($location, $fallback = false) {
    $config = cskt_dewr_config();
    $args = array('theme_location' => $location, 'container' => false,
        'menu_class' => $location === 'primary' ? 'dewr-menu' : 'dewr-menu dewr-link-list',
        'depth' => $location === 'primary' ? 3 : 1,
        'fallback_cb' => $fallback ? 'cskt_dewr_fallback_menu' : false);
    if (!has_nav_menu($location) && !empty($config['menus'][$location])) {
        $menu = wp_get_nav_menu_object((int) $config['menus'][$location]);
        if ($menu && !is_wp_error($menu)) { $args['menu'] = $menu->term_id; }
    }
    wp_nav_menu($args);
}
function cskt_dewr_has_menu($location) {
    if (has_nav_menu($location)) { return true; }
    $config = cskt_dewr_config();
    return !empty($config['menus'][$location]) && (bool) wp_get_nav_menu_object((int) $config['menus'][$location]);
}
function cskt_dewr_form_action_fields($url, $skip = array()) {
    $query = wp_parse_url($url, PHP_URL_QUERY);
    if (!is_string($query) || $query === '') { return; }
    $parts = array();
    parse_str($query, $parts);
    foreach ($parts as $key => $value) {
        if (is_scalar($value) && !in_array($key, $skip, true) && in_array($key, array('page_id', 'p', 'post_type', 'cskt_topic', 'cskt_department'), true)) {
            echo '<input type="hidden" name="' . esc_attr($key) . '" value="' . esc_attr((string) $value) . '">';
        }
    }
}
function cskt_dewr_breadcrumbs() {
    if (is_front_page()) { return; }
    $items = array(array('url' => home_url('/'), 'label' => __('Home', 'cskt-dewr')));
    if (is_singular()) {
        $post = get_queried_object();
        $role = cskt_dewr_role_for_type($post->post_type);
        if ($role !== '' && $role !== 'pages') {
            $items[] = array('url' => cskt_dewr_collection_url($role), 'label' => cskt_dewr_roles()[$role]['label']);
        }
        foreach (array_reverse(get_post_ancestors($post->ID)) as $id) {
            $ancestor = cskt_dewr_public_post($id);
            if ($ancestor) { $items[] = array('url' => get_permalink($id), 'label' => get_the_title($id)); }
        }
        $current = get_the_title($post);
    } elseif (is_search()) {
        $current = __('Search', 'cskt-dewr');
    } elseif (is_404()) {
        $current = __('Page not found', 'cskt-dewr');
    } else {
        $current = wp_strip_all_tags(get_the_archive_title());
    }
    echo '<nav class="dewr-breadcrumbs" aria-label="' . esc_attr__('Breadcrumb', 'cskt-dewr') . '"><ol>';
    foreach ($items as $item) {
        echo '<li><a href="' . esc_url($item['url']) . '">' . esc_html($item['label']) . '</a></li>';
    }
    echo '<li aria-current="page">' . esc_html($current) . '</li></ol></nav>';
}
function cskt_dewr_section_links($post) {
    if (!is_post_type_hierarchical($post->post_type)) { return; }
    $parent_id = (int) $post->post_parent;
    $children = get_pages(array('post_type' => $post->post_type, 'parent' => $post->ID, 'post_status' => 'publish', 'sort_column' => 'menu_order,post_title'));
    if (!$children && $parent_id) {
        $children = get_pages(array('post_type' => $post->post_type, 'parent' => $parent_id, 'post_status' => 'publish', 'sort_column' => 'menu_order,post_title'));
    }
    $children = array_values(array_filter($children ?: array(), 'cskt_dewr_public_post'));
    if (!$children) { return; }
    echo '<nav class="dewr-section-nav" aria-label="' . esc_attr__('In this section', 'cskt-dewr') . '"><h2>' . esc_html__('In this section', 'cskt-dewr') . '</h2><ul>';
    foreach ($children as $child) {
        echo '<li><a href="' . esc_url(get_permalink($child)) . '"' . ((int) $child->ID === (int) $post->ID ? ' aria-current="page"' : '') . '>' . esc_html(get_the_title($child)) . '</a></li>';
    }
    echo '</ul></nav>';
}
