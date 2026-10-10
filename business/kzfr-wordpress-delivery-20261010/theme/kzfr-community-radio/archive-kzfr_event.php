<?php if (!defined('ABSPATH')) { exit; } get_header();
$today = current_time('Y-m-d');
$events = new WP_Query(array(
    'post_type' => 'kzfr_event', 'post_status' => 'publish', 'posts_per_page' => 12,
    'meta_key' => 'kzfr_event_date', 'orderby' => 'meta_value', 'order' => 'ASC',
    'meta_query' => array(array('key' => 'kzfr_event_date', 'value' => $today, 'compare' => '>=', 'type' => 'CHAR')),
)); ?>
<main id="main" class="kfz-container"><div class="eyebrow">COMMUNITY CALENDAR</div><h1 class="kzfr-content-title">Show up. Make radio.</h1><p>Only published future events entered by KZFR staff appear here. There is no external calendar feed or fabricated event listing.</p>
<?php if ($events->have_posts()) : ?><div class="kzfr-grid">
<?php while ($events->have_posts()) : $events->the_post(); $day = get_post_meta(get_the_ID(), 'kzfr_event_date', true); ?>
<article <?php post_class('kzfr-card'); ?>><span class="kzfr-chip"><?php echo esc_html($day); ?></span><h2><a href="<?php echo esc_url(get_permalink()); ?>"><?php the_title(); ?></a></h2><p><?php echo esc_html(wp_trim_words(wp_strip_all_tags(get_the_excerpt()), 28)); ?></p></article>
<?php endwhile; wp_reset_postdata(); ?></div><?php else : ?><div class="kzfr-embedded-note">No upcoming events have been entered. Editors can create an event and set its event-date custom field.</div><?php endif; ?></main>
<?php get_footer(); ?>
