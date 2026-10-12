<?php
if (!defined('ABSPATH')) { exit; }
$field_id = wp_unique_id('dewr-search-');
?>
<form role="search" method="get" class="dewr-search" action="<?php echo esc_url(home_url('/')); ?>" aria-label="<?php echo esc_attr($args['aria_label'] ?? __('Site search', 'cskt-dewr')); ?>">
    <label class="screen-reader-text" for="<?php echo esc_attr($field_id); ?>"><?php esc_html_e('Search the website', 'cskt-dewr'); ?></label>
    <div class="dewr-search-line">
    <input id="<?php echo esc_attr($field_id); ?>" type="search" name="s" value="<?php echo esc_attr(get_search_query(false)); ?>" maxlength="512" placeholder="<?php esc_attr_e('Search the website', 'cskt-dewr'); ?>">
    <button type="submit"><?php esc_html_e('Search', 'cskt-dewr'); ?></button>
    </div>
</form>
