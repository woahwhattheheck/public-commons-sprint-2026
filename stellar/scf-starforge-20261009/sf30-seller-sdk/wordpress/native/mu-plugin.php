<?php
/* Owned native WordPress source fixture for one complete receiving operation. */
function sf_wordpress_native_register() {
    register_post_type('sf_note', array(
        'label' => 'Native field notes', 'public' => true, 'show_in_rest' => true,
        'rest_base' => 'field-notes', 'rest_namespace' => 'sf-native/v1',
        'supports' => array('title', 'editor', 'excerpt', 'author'),
    ));
    foreach (array('post', 'page', 'sf_note') as $type) {
        register_rest_field($type, 'native_exact', array(
            'get_callback' => function () { return PHP_INT_MAX; },
            'schema' => array('type' => 'integer', 'readonly' => true, 'context' => array('view', 'edit')),
        ));
    }
}
add_action('init', 'sf_wordpress_native_register');
add_filter('rest_pre_dispatch', function ($response, $server, $request) {
    $route = $request->get_route();
    if (in_array($route, array('/wp/v2/posts', '/wp/v2/pages', '/wp/v2/media', '/wp/v2/categories', '/sf-native/v1/field-notes'), true)) {
        $key = $route . '?page=' . (string)($request->get_param('page') ?: 1)
            . '&context=' . (string)($request->get_param('context') ?: 'view');
        $counts = get_option('sf_wordpress_native_counts', array());
        $counts[$key] = isset($counts[$key]) ? $counts[$key] + 1 : 1;
        update_option('sf_wordpress_native_counts', $counts, false);
    }
    return $response;
}, 10, 3);
