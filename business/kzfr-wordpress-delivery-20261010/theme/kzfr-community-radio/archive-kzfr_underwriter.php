<?php if (!defined('ABSPATH')) { exit; } get_header(); ?>
<main id="main" class="kfz-container"><div class="eyebrow">LOCAL PARTNERS</div><h1 class="kzfr-content-title">Community underwriters</h1><p>Meet the businesses and organizations supporting people-powered radio.</p>
<?php if (have_posts()) : ?><div class="kzfr-grid">
<?php while (have_posts()) : the_post(); $url = kzfr_theme_underwriter_link(get_the_ID()); ?>
<article <?php post_class('kzfr-card'); ?>><h2><a href="<?php echo esc_url(get_permalink()); ?>"><?php the_title(); ?></a></h2><p><?php echo esc_html(wp_trim_words(wp_strip_all_tags(get_the_excerpt()), 28)); ?></p><?php kzfr_theme_external_link($url, __('Visit their website', 'kzfr-community-radio')); ?></article>
<?php endwhile; ?></div><div class="kzfr-page-links"><?php the_posts_pagination(array('aria_label' => __('Underwriter pages', 'kzfr-community-radio'))); ?></div>
<?php else : ?><p>No published underwriter profiles yet.</p><?php endif; ?></main><?php get_footer(); ?>
