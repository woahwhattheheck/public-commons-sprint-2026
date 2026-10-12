<?php
if (!defined('ABSPATH')) { exit; }
get_header();
global $wp_query;
$context = cskt_dewr_catalog_context('news');
$page = (int) get_option('page_for_posts');
?>
<main id="main-content" class="dewr-main dewr-shell" tabindex="-1">
    <?php cskt_dewr_breadcrumbs(); ?>
    <header class="dewr-page-header"><h1><?php echo esc_html($page ? get_the_title($page) : __('News', 'cskt-dewr')); ?></h1></header>
    <?php cskt_dewr_catalog($wp_query, $context, __('Published updates', 'cskt-dewr')); ?>
</main>
<?php get_footer(); ?>
