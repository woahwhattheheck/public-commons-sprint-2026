<?php
/* Run through the original native WordPress helper after wp-load.php. */
wp_set_current_user(1);
if ($mode === 'prepare') {
    if (!post_type_exists('sf_note')) sf_wordpress_native_register();
    $seed = get_option('sf_wordpress_native_seed', false);
    if (!$seed) {
        foreach (get_posts(array('post_type' => array('post', 'page'), 'post_status' => 'any', 'numberposts' => -1)) as $post) {
            wp_delete_post($post->ID, true);
        }
        $term = wp_insert_term('Native operations', 'category', array('slug' => 'native-operations'));
        if (is_wp_error($term)) throw new RuntimeException($term->get_error_message());
        $ids = array();
        for ($index = 1; $index <= 5; $index++) {
            $value = wp_insert_post(array(
                'post_type' => 'post', 'post_status' => 'publish',
                'post_title' => 'Native source article ' . $index,
                'post_name' => 'native-source-article-' . $index,
                'post_content' => '<p>Owned native source article ' . $index . ' with <strong>original markup</strong>.</p>',
                'post_excerpt' => 'Native article ' . $index,
                'post_date' => '2026-10-10 12:00:00', 'post_date_gmt' => '2026-10-10 12:00:00',
                'post_category' => array($term['term_id']),
            ), true);
            if (is_wp_error($value)) throw new RuntimeException($value->get_error_message());
            $ids[] = $value;
        }
        $draft = wp_insert_post(array('post_type' => 'post', 'post_status' => 'draft',
            'post_title' => 'Original staff draft', 'post_content' => 'Owned content visible to the configured native editor.'), true);
        $parent = wp_insert_post(array('post_type' => 'page', 'post_status' => 'publish',
            'post_title' => 'Source operations', 'post_content' => '<p>Native page parent.</p>'), true);
        $child = wp_insert_post(array('post_type' => 'page', 'post_status' => 'publish',
            'post_parent' => $parent, 'post_title' => 'Source operating guide', 'post_content' => '<p>Native child page.</p>'), true);
        $note = wp_insert_post(array('post_type' => 'sf_note', 'post_status' => 'publish',
            'post_title' => 'Original custom field note', 'post_content' => '<p>Custom REST namespace content.</p>'), true);
        foreach (array($draft, $parent, $child, $note) as $value) if (is_wp_error($value)) throw new RuntimeException($value->get_error_message());
        $upload = wp_upload_bits('native-source-pixel.png', null,
            base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZZkAAAAASUVORK5CYII='));
        if ($upload['error']) throw new RuntimeException($upload['error']);
        $media = wp_insert_attachment(array('post_mime_type' => 'image/png', 'post_title' => 'Native retained media',
            'post_status' => 'inherit'), $upload['file'], $ids[0], true);
        if (is_wp_error($media)) throw new RuntimeException($media->get_error_message());
        update_attached_file($media, $upload['file']);
        set_post_thumbnail($ids[0], $media);
        $seed = array('posts' => $ids, 'draft' => $draft, 'parent' => $parent, 'child' => $child,
            'note' => $note, 'media' => $media, 'category' => $term['term_id']);
        update_option('sf_wordpress_native_seed', $seed, false);
    }
    $out = array('seed' => $seed, 'wordpress' => get_bloginfo('version'), 'php' => PHP_VERSION,
        'integer' => (string)PHP_INT_MAX, 'root' => ABSPATH);
    if ($needCredentials) {
        $password = WP_Application_Passwords::create_new_application_password(1, array('name' => 'Native WordPress receiving operation'));
        if (is_wp_error($password)) throw new RuntimeException($password->get_error_message());
        $out['credentials'] = array('username' => get_userdata(1)->user_login, 'password' => $password[0]);
    }
    echo wp_json_encode($out);
} elseif ($mode === 'mutate') {
    $value = get_option('sf_wordpress_native_mutated', false);
    if (!$value) {
        $seed = get_option('sf_wordpress_native_seed');
        $changed = wp_update_post(array('ID' => $seed['posts'][0], 'post_title' => 'Native source article 1 revised',
            'post_content' => '<p>Revision retained through the original WordPress editor.</p>'), true);
        if (is_wp_error($changed)) throw new RuntimeException($changed->get_error_message());
        $deleted = wp_delete_post($seed['posts'][1], true);
        if (!$deleted) throw new RuntimeException('Native selected article deletion failed.');
        $added = wp_insert_post(array('post_type' => 'post', 'post_status' => 'publish',
            'post_title' => 'Native new source article', 'post_content' => '<p>New original edition content.</p>',
            'post_category' => array($seed['category'])), true);
        if (is_wp_error($added)) throw new RuntimeException($added->get_error_message());
        $value = array('changed' => $changed, 'removed' => $deleted->ID, 'added' => $added);
        update_option('sf_wordpress_native_mutated', $value, false);
    }
    echo wp_json_encode($value);
} elseif ($mode === 'counts') {
    echo wp_json_encode(get_option('sf_wordpress_native_counts', array()));
} else {
    throw new RuntimeException('Choose the original native fixture action.');
}
