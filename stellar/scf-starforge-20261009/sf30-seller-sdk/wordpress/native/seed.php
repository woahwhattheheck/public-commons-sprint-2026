<?php
/* Run through the original native WordPress helper after wp-load.php.
 * Each fixture row is owned by this original operation and survives an interrupted carrier. */
wp_set_current_user(1);
if (!isset($operationId) || !preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]{2,120}$/D', $operationId)) {
    throw new RuntimeException('Select the original native fixture operation.');
}
$fixtureIdentity = hash('sha256', $operationId);
$fixtureOwner = get_option('sf_wordpress_native_owner', false);
function sf_native_fixture_save($key, $value) {
    if (get_option($key, false) === $value) return;
    if (!update_option($key, $value, false)) throw new RuntimeException('The native fixture progress was not saved: ' . $key);
}
if ($fixtureOwner === false) {
    if ($mode !== 'prepare') throw new RuntimeException('Prepare the original native fixture first.');
    sf_native_fixture_save('sf_wordpress_native_owner', $operationId);
} elseif ($fixtureOwner !== $operationId) {
    throw new RuntimeException('The native fixture belongs to another operation.');
}
function sf_native_fixture_marker($slot) {
    global $fixtureIdentity;
    return '<!-- sf-native:' . $fixtureIdentity . ':' . $slot . ' -->';
}
function sf_native_fixture_post($slot, $input, $file = null) {
    global $fixtureIdentity;
    $slug = 'sf-native-' . substr($fixtureIdentity, 0, 16) . '-' . $slot;
    $marker = sf_native_fixture_marker($slot);
    $values = array_merge(array(
        'post_status' => 'publish', 'post_author' => 1,
        'post_date' => '2026-10-10 12:00:00', 'post_date_gmt' => '2026-10-10 12:00:00',
    ), $input, array('post_name' => $slug, 'post_content' => ($input['post_content'] ?? '') . "\n" . $marker));
    $found = get_posts(array('post_type' => $values['post_type'], 'post_status' => array_keys(get_post_stati()),
        'name' => $slug, 'numberposts' => 2, 'suppress_filters' => true));
    if (count($found) > 1) throw new RuntimeException('Multiple native rows claim the same fixture slot.');
    if ($found) {
        if (strpos($found[0]->post_content, $marker) === false) throw new RuntimeException('The selected native row has another source identity.');
        $values['ID'] = $found[0]->ID;
        $id = wp_update_post($values, true);
    } elseif ($file !== null) {
        $id = wp_insert_attachment($values, $file, $values['post_parent'] ?? 0, true);
    } else {
        $id = wp_insert_post($values, true);
    }
    if (is_wp_error($id) || !$id) throw new RuntimeException(is_wp_error($id) ? $id->get_error_message() : 'The native row was not saved.');
    if ($file !== null) update_attached_file($id, $file);
    return (int)$id;
}
function sf_native_fixture_media_file() {
    global $fixtureIdentity;
    $upload = wp_upload_dir('2026-10-10 12:00:00');
    if ($upload['error']) throw new RuntimeException($upload['error']);
    $bytes = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZZkAAAAASUVORK5CYII=', true);
    $file = $upload['path'] . '/sf-native-' . substr($fixtureIdentity, 0, 16) . '-pixel.png';
    if (is_link($file) || (file_exists($file) && (!is_file($file) || file_get_contents($file) !== $bytes))) {
        throw new RuntimeException('The original native fixture media bytes differ.');
    }
    if (!file_exists($file)) {
        $temporary = $file . '.pending';
        if (is_link($temporary) || (file_exists($temporary) && !is_file($temporary))) {
            throw new RuntimeException('The native media staging path differs.');
        }
        $stream = fopen($temporary, 'c+b');
        if (!$stream) throw new RuntimeException('The native media staging file could not be opened.');
        try {
            if (!flock($stream, LOCK_EX) || !ftruncate($stream, 0) || !rewind($stream)) throw new RuntimeException('The native media staging file could not be prepared.');
            $offset = 0;
            while ($offset < strlen($bytes)) {
                $written = fwrite($stream, substr($bytes, $offset));
                if (!$written) throw new RuntimeException('The native media bytes could not be saved.');
                $offset += $written;
            }
            if (!fflush($stream) || !fsync($stream)) throw new RuntimeException('The native media bytes could not be flushed.');
        } finally {
            fclose($stream);
        }
        if (!rename($temporary, $file)) throw new RuntimeException('The native media could not be retained.');
    }
    return $file;
}
if ($mode === 'prepare') {
    if (!post_type_exists('sf_note')) sf_wordpress_native_register();
    $seed = get_option('sf_wordpress_native_seed', false);
    if (!$seed) {
        $progress = get_option('sf_wordpress_native_prepare_progress', array('cleared' => false, 'ids' => array()));
        if (!$progress['cleared']) {
            foreach (get_posts(array('post_type' => array('post', 'page'), 'post_status' => array_keys(get_post_stati()), 'numberposts' => -1)) as $post) {
                if (!wp_delete_post($post->ID, true) && get_post($post->ID)) throw new RuntimeException('The original private WordPress default row could not be cleared.');
            }
            $progress['cleared'] = true;
            sf_native_fixture_save('sf_wordpress_native_prepare_progress', $progress);
        }
        $termSlug = 'native-operations-' . substr($fixtureIdentity, 0, 16);
        $description = 'Original native fixture ' . $fixtureIdentity;
        $term = get_term_by('slug', $termSlug, 'category');
        if (!$term) {
            $created = wp_insert_term('Native operations', 'category', array('slug' => $termSlug, 'description' => $description));
            if (is_wp_error($created)) throw new RuntimeException($created->get_error_message());
            $term = get_term($created['term_id'], 'category');
        }
        if (!$term || is_wp_error($term) || $term->description !== $description) throw new RuntimeException('The native category has another fixture identity.');
        $ids = array();
        for ($index = 1; $index <= 5; $index++) {
            $ids[] = sf_native_fixture_post('article-' . $index, array(
                'post_type' => 'post', 'post_title' => 'Native source article ' . $index,
                'post_content' => '<p>Owned native source article ' . $index . ' with <strong>original markup</strong>.</p>',
                'post_excerpt' => 'Native article ' . $index, 'post_category' => array($term->term_id),
            ));
            $progress['ids']['article-' . $index] = end($ids);
            sf_native_fixture_save('sf_wordpress_native_prepare_progress', $progress);
        }
        $draft = sf_native_fixture_post('staff-draft', array('post_type' => 'post', 'post_status' => 'draft',
            'post_title' => 'Original staff draft', 'post_content' => 'Owned content visible to the configured native editor.'));
        $parent = sf_native_fixture_post('parent-page', array('post_type' => 'page',
            'post_title' => 'Source operations', 'post_content' => '<p>Native page parent.</p>'));
        $child = sf_native_fixture_post('child-page', array('post_type' => 'page', 'post_parent' => $parent,
            'post_title' => 'Source operating guide', 'post_content' => '<p>Native child page.</p>'));
        $note = sf_native_fixture_post('field-note', array('post_type' => 'sf_note',
            'post_title' => 'Original custom field note', 'post_content' => '<p>Custom REST namespace content.</p>'));
        $media = sf_native_fixture_post('retained-media', array('post_type' => 'attachment', 'post_mime_type' => 'image/png',
            'post_title' => 'Native retained media', 'post_status' => 'inherit', 'post_parent' => $ids[0]), sf_native_fixture_media_file());
        set_post_thumbnail($ids[0], $media);
        $seed = array('posts' => $ids, 'draft' => $draft, 'parent' => $parent, 'child' => $child,
            'note' => $note, 'media' => $media, 'category' => (int)$term->term_id);
        sf_native_fixture_save('sf_wordpress_native_seed', $seed);
    }
    $out = array('seed' => $seed, 'wordpress' => get_bloginfo('version'), 'php' => PHP_VERSION,
        'integer' => (string)PHP_INT_MAX, 'root' => ABSPATH);
    if ($needCredentials) {
        $credentials = get_option('sf_wordpress_native_credentials', false);
        if (!$credentials) {
            $name = 'Native WordPress receiving operation ' . substr($fixtureIdentity, 0, 16);
            foreach (WP_Application_Passwords::get_user_application_passwords(1) as $original) {
                if ($original['name'] === $name && is_wp_error(WP_Application_Passwords::delete_application_password(1, $original['uuid']))) {
                    throw new RuntimeException('The interrupted original native credential could not be reconciled.');
                }
            }
            $password = WP_Application_Passwords::create_new_application_password(1, array('name' => $name));
            if (is_wp_error($password)) throw new RuntimeException($password->get_error_message());
            $credentials = array('username' => get_userdata(1)->user_login, 'password' => $password[0], 'uuid' => $password[1]['uuid']);
            sf_native_fixture_save('sf_wordpress_native_credentials', $credentials);
        }
        if (!WP_Application_Passwords::get_user_application_password(1, $credentials['uuid'])) {
            throw new RuntimeException('The retained original native credential is no longer installed.');
        }
        $out['credentials'] = array('username' => $credentials['username'], 'password' => $credentials['password']);
    }
    echo wp_json_encode($out);
} elseif ($mode === 'mutate') {
    $value = get_option('sf_wordpress_native_mutated', false);
    if (!$value) {
        $seed = get_option('sf_wordpress_native_seed', false);
        if (!$seed) throw new RuntimeException('Prepare the original native fixture before its source changes.');
        $progress = get_option('sf_wordpress_native_mutation_progress', array('changed' => null, 'removed' => null, 'added' => null));
        if (!$progress['changed']) {
            $original = get_post($seed['posts'][0]);
            if (!$original || strpos($original->post_content, sf_native_fixture_marker('article-1')) === false) {
                throw new RuntimeException('The selected native revision has another source identity.');
            }
            $changed = wp_update_post(array('ID' => $seed['posts'][0], 'post_title' => 'Native source article 1 revised',
                'post_content' => '<p>Revision retained through the original WordPress editor.</p>' . "\n" . sf_native_fixture_marker('article-1')), true);
            if (is_wp_error($changed) || !$changed) throw new RuntimeException(is_wp_error($changed) ? $changed->get_error_message() : 'The native revision was not saved.');
            $progress['changed'] = (int)$changed;
            sf_native_fixture_save('sf_wordpress_native_mutation_progress', $progress);
        }
        if (!$progress['removed']) {
            $original = get_post($seed['posts'][1]);
            if ($original && strpos($original->post_content, sf_native_fixture_marker('article-2')) === false) {
                throw new RuntimeException('The selected native deletion has another source identity.');
            }
            if ($original && !wp_delete_post($original->ID, true) && get_post($original->ID)) {
                throw new RuntimeException('Native selected article deletion failed.');
            }
            $progress['removed'] = (int)$seed['posts'][1];
            sf_native_fixture_save('sf_wordpress_native_mutation_progress', $progress);
        }
        if (!$progress['added']) {
            $progress['added'] = sf_native_fixture_post('added-article', array('post_type' => 'post',
                'post_title' => 'Native new source article', 'post_content' => '<p>New original edition content.</p>',
                'post_category' => array($seed['category'])));
            sf_native_fixture_save('sf_wordpress_native_mutation_progress', $progress);
        }
        $value = $progress;
        sf_native_fixture_save('sf_wordpress_native_mutated', $value);
    }
    echo wp_json_encode($value);
} elseif ($mode === 'counts') {
    echo wp_json_encode(get_option('sf_wordpress_native_counts', array()));
} else {
    throw new RuntimeException('Choose the original native fixture action.');
}
