<?php if (!defined('ABSPATH')) { exit; } get_header();
$today = current_time('Y-m-d');
$paged = max(1, (int) get_query_var('paged'));
$events = new WP_Query(array(
    'post_type' => 'kzfr_event', 'post_status' => 'publish', 'posts_per_page' => 12, 'paged' => $paged,
    'meta_key' => 'kzfr_event_date', 'orderby' => 'meta_value', 'order' => 'ASC',
    'meta_query' => array(array('key' => 'kzfr_event_date', 'value' => $today, 'compare' => '>=', 'type' => 'CHAR')),
)); ?>
<main id="main" class="kfz-container"><div class="eyebrow">COMMUNITY CALENDAR</div><h1 class="kzfr-content-title">Show up. Make a connection.</h1><p>Explore upcoming events in our community.</p>
<?php if ($events->have_posts()) : ?><div class="kzfr-grid">
<?php while ($events->have_posts()) : $events->the_post(); $day = kzfr_theme_event_day(get_the_ID()); ?>
<article <?php post_class('kzfr-card'); ?>><span class="kzfr-chip"><?php kzfr_theme_event_time($day); ?></span><h2><a href="<?php echo esc_url(get_permalink()); ?>"><?php the_title(); ?></a></h2><p><?php echo esc_html(wp_trim_words(wp_strip_all_tags(get_the_excerpt()), 28)); ?></p></article>
<?php endwhile; wp_reset_postdata(); ?></div>
<nav class="kzfr-page-links" aria-label="Event pages"><?php echo wp_kses_post(paginate_links(array('total' => $events->max_num_pages, 'current' => $paged))); ?></nav>
<?php else : ?><div class="kzfr-embedded-note">There are no upcoming events listed yet. Check back soon.</div><?php endif; ?></main>
<?php get_footer(); ?>
