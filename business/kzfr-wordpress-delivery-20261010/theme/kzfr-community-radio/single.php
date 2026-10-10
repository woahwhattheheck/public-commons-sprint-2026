<?php if (!defined('ABSPATH')) { exit; } get_header(); ?>
<main id="main" class="kfz-container"><div class="kzfr-article">
<?php while (have_posts()) : the_post(); ?>
<article <?php post_class(); ?>><div class="eyebrow">STATION EDITORIAL CONTENT</div><h1 class="kzfr-content-title"><?php the_title(); ?></h1>
<?php if (get_post_type() === 'kzfr_event') : $event_day = get_post_meta(get_the_ID(), 'kzfr_event_date', true); ?>
<?php if ($event_day && function_exists('kzfr_bridge_event_date') && kzfr_bridge_event_date($event_day)) : ?><p class="kzfr-chip">Event date: <?php echo esc_html($event_day); ?></p><?php endif; ?>
<?php endif; ?>
<div class="kzfr-article-body"><?php the_content(); ?></div>
<?php if (get_post_type() === 'kzfr_program') : $creek = kzfr_theme_creek_link(get_the_ID()); ?>
<?php if ($creek) : ?><div class="kzfr-embedded-note"><strong>Existing audio provider:</strong> <a href="<?php echo esc_url($creek); ?>" target="_blank" rel="noopener noreferrer">Open this program on Creek Studio ↗</a>. Playback and hosting remain offsite.</div><?php else : ?><p>Program audio is available through the station's existing archive: <a href="https://kzfr.studio.creek.org/archives/" target="_blank" rel="noopener noreferrer">Creek Studio ↗</a></p><?php endif; ?>
<?php endif; ?></article>
<?php endwhile; ?>
</div></main><?php get_footer(); ?>
