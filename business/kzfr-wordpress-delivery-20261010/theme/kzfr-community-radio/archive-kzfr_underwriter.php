<?php if (!defined('ABSPATH')) { exit; } get_header(); ?>
<main id="main" class="kfz-container"><div class="eyebrow">LOCAL PARTNERS</div><h1 class="kzfr-content-title">Community underwriters</h1><p>Station-managed profiles and links. External support agreements and financial arrangements remain outside this theme.</p>
<?php if (have_posts()) : ?><div class="kzfr-grid">
<?php while (have_posts()) : the_post(); $url = get_post_meta(get_the_ID(), 'kzfr_underwriter_site', true); $url = function_exists('kzfr_bridge_safe_https_url') ? kzfr_bridge_safe_https_url($url) : ''; ?>
<article <?php post_class('kzfr-card'); ?>><h2><?php the_title(); ?></h2><p><?php echo esc_html(wp_trim_words(wp_strip_all_tags(get_the_excerpt()), 28)); ?></p><?php if ($url) : ?><a href="<?php echo esc_url($url); ?>" target="_blank" rel="noopener noreferrer">Partner website ↗</a><?php endif; ?></article>
<?php endwhile; ?></div><nav class="kzfr-page-links"><?php the_posts_pagination(); ?></nav>
<?php else : ?><p>No published underwriter profiles yet.</p><?php endif; ?></main><?php get_footer(); ?>
