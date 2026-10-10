<?php
if (!defined('ABSPATH')) { exit; }
get_header();
$query_text = isset($_GET['program_q']) && is_string($_GET['program_q']) ? sanitize_text_field(wp_unslash($_GET['program_q'])) : '';
$genre = isset($_GET['genre']) && is_string($_GET['genre']) ? sanitize_title(wp_unslash($_GET['genre'])) : '';
$period = isset($_GET['period']) && is_string($_GET['period']) ? sanitize_key(wp_unslash($_GET['period'])) : '';
$period = in_array($period, array('week', 'month'), true) ? $period : '';
$paged = max(1, (int) get_query_var('paged'));
$args = array('post_type' => 'kzfr_program', 'post_status' => 'publish', 'posts_per_page' => 12, 'paged' => $paged, 's' => $query_text);
if ($genre) {
    $args['tax_query'] = array(array('taxonomy' => 'kzfr_genre', 'field' => 'slug', 'terms' => array($genre)));
}
if ($period) {
    $days = $period === 'week' ? 6 : 29;
    $args['date_query'] = array(array('after' => gmdate('Y-m-d', time() - $days * DAY_IN_SECONDS), 'inclusive' => true));
}
$programs = new WP_Query($args);
$genres = get_terms(array('taxonomy' => 'kzfr_genre', 'hide_empty' => true));
?>
<main id="main" class="kfz-container"><div class="eyebrow">WORDPRESS EDITORIAL PROGRAMS</div><h1 class="kzfr-content-title">Programs &amp; archives</h1>
<p>Discover station-managed program pages by text, genre, and publication date. Audio search and replay remain on Creek Studio until official provider access is integrated and acceptance-tested.</p>
<form action="<?php echo esc_url(get_post_type_archive_link('kzfr_program')); ?>" method="get" role="search" aria-label="Filter WordPress program pages" class="kzfr-form-row">
<label>Search programs <input type="search" name="program_q" value="<?php echo esc_attr($query_text); ?>" placeholder="Title or description"></label>
<label>Genre <select name="genre"><option value="">All genres</option>
<?php if (!is_wp_error($genres)) : foreach ($genres as $term) : ?><option value="<?php echo esc_attr($term->slug); ?>" <?php selected($genre, $term->slug); ?>><?php echo esc_html($term->name); ?></option><?php endforeach; endif; ?></select></label>
<label>Published <select name="period"><option value="">Any time</option><option value="week" <?php selected($period, 'week'); ?>>Past 7 days</option><option value="month" <?php selected($period, 'month'); ?>>Past 30 days</option></select></label>
<button class="btn btn-ink" type="submit">Find programs</button></form>
<p class="result-count" role="status"><?php echo esc_html(sprintf(_n('%d result', '%d results', $programs->found_posts, 'kzfr-community-radio'), $programs->found_posts)); ?></p>
<?php if ($programs->have_posts()) : ?><div class="kzfr-grid">
<?php while ($programs->have_posts()) : $programs->the_post(); $creek = kzfr_theme_creek_link(get_the_ID()); ?>
<article <?php post_class('kzfr-card'); ?>><span class="kzfr-chip">Program · <?php echo esc_html(get_the_date()); ?></span><h2><a href="<?php echo esc_url(get_permalink()); ?>"><?php the_title(); ?></a></h2><p><?php echo esc_html(wp_trim_words(wp_strip_all_tags(get_the_excerpt()), 26)); ?></p>
<?php if ($creek) : ?><a href="<?php echo esc_url($creek); ?>" target="_blank" rel="noopener noreferrer">Open on Creek Studio ↗</a><?php endif; ?></article>
<?php endwhile; wp_reset_postdata(); ?></div>
<nav class="kzfr-page-links" aria-label="Program pages"><?php echo wp_kses_post(paginate_links(array('total' => $programs->max_num_pages, 'current' => $paged, 'add_args' => array('program_q' => $query_text, 'genre' => $genre, 'period' => $period)))); ?></nav>
<?php else : ?><div class="kzfr-embedded-note">No matching published program pages. Use the filters or visit Creek for actual station audio.</div><?php endif; ?>
<p><a href="https://kzfr.studio.creek.org/archives/" target="_blank" rel="noopener noreferrer">Browse the existing Creek Studio audio archive ↗</a></p></main>
<?php get_footer(); ?>
