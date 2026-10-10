<?php
/** Focused execution of the actual content-model source under first-party WP function stubs; no WordPress install claimed. */
error_reporting(E_ALL);
if (!defined('ABSPATH')) { define('ABSPATH', '/tmp/'); }
if (!defined('DAY_IN_SECONDS')) { define('DAY_IN_SECONDS', 86400); }
$GLOBALS['records'] = array('posttypes' => array(), 'taxonomies' => array(), 'postmeta' => array(), 'actions' => array());
function add_action($hook, $callback) { $GLOBALS['records']['actions'][] = array($hook, $callback); }
function register_activation_hook($file, $callback) {}
function register_deactivation_hook($file, $callback) {}
function wp_parse_url($value) { return parse_url($value); }
function esc_url_raw($value, $protocols = array()) { return $value; }
function current_user_can($cap, $id) { return $cap === 'edit_post' && $id === 10; }
function register_post_type($slug, $args) { $GLOBALS['records']['posttypes'][$slug] = $args; }
function register_taxonomy($slug, $types, $args) { $GLOBALS['records']['taxonomies'][$slug] = array($types, $args); }
function register_post_meta($post_type, $key, $args) { $GLOBALS['records']['postmeta'][$post_type . '/' . $key] = $args; }
function flush_rewrite_rules() {}
function get_post_meta($id, $key, $single) { return $GLOBALS['meta_url'] ?? ''; }
function kzfr_assert($condition, $label) {
    static $count = 0; $count++;
    if (!$condition) { fwrite(STDERR, "FAILED assertion $count: $label\n"); exit(1); }
    return $count;
}
require __DIR__ . '/../plugin/kzfr-editorial-bridge/kzfr-editorial-bridge.php';
require __DIR__ . '/../theme/kzfr-community-radio/functions.php';
kzfr_bridge_register_content();
kzfr_assert(count($GLOBALS['records']['posttypes']) === 3, 'three portable editorial types');
foreach (array('kzfr_program','kzfr_event','kzfr_underwriter') as $key) {
    kzfr_assert($GLOBALS['records']['posttypes'][$key]['show_in_rest'] === true, 'REST exposed with WP permission core');
    kzfr_assert(in_array('custom-fields', $GLOBALS['records']['posttypes'][$key]['supports'], true), 'REST meta supported');
}
kzfr_assert(isset($GLOBALS['records']['taxonomies']['kzfr_genre']), 'program taxonomy');
kzfr_assert(count($GLOBALS['records']['postmeta']) === 3, 'three explicit editorial meta fields');
kzfr_assert(kzfr_bridge_creek_url('https://kzfr.studio.creek.org/archives/') === 'https://kzfr.studio.creek.org/archives/', 'existing trusted Creek allowed');
foreach (array('http://kzfr.studio.creek.org/archives/', 'https://evil.example/x', 'https://kzfr.studio.creek.org.evil.example/', 'https://evil.example@kzfr.studio.creek.org/', 'https://kzfr.studio.creek.org:8080/', 'javascript:alert(1)') as $url) {
    kzfr_assert(kzfr_bridge_creek_url($url) === '', 'unsafe provider link rejected');
}
kzfr_assert(kzfr_bridge_event_date('2028-02-29') === '2028-02-29', 'valid leap event');
kzfr_assert(kzfr_bridge_event_date('2027-02-29') === '', 'invalid leap event');
kzfr_assert(kzfr_bridge_event_date('2026-99-99') === '', 'invalid event');
kzfr_assert(kzfr_bridge_safe_https_url('http://local') === '', 'underwriter HTTPS only');
kzfr_assert(!kzfr_bridge_can_edit_meta(null, 'kzfr_creek_url', 11), 'editing unrelated post rejected');
kzfr_assert(kzfr_bridge_can_edit_meta(null, 'kzfr_creek_url', 10), 'own edit capacity accepted');
$GLOBALS['meta_url'] = 'https://kzfr.studio.creek.org/archives/';
kzfr_assert(kzfr_theme_creek_link(10) === $GLOBALS['meta_url'], 'theme returns approved provider link');
$GLOBALS['meta_url'] = 'https://attacker.example/video';
kzfr_assert(kzfr_theme_creek_link(10) === '', 'theme revalidates persisted provider link');
kzfr_assert(strpos(file_get_contents(__DIR__ . '/../theme/kzfr-community-radio/style.css'), 'Template: twentytwentyone') !== false, 'official WP parent set');
kzfr_assert(strpos(file_get_contents(__DIR__ . '/../theme/kzfr-community-radio/functions.php'), 'get_stylesheet_directory_uri()') !== false, 'child assets resolve from child, not parent');
echo 'PASS: original WordPress source, scoped post types/REST/editor ownership, URL allowlist, date validation, provider handoff\n';
