<?php
if (!defined('ABSPATH')) { exit; }
get_header();
?>
<main id="main">
<section class="hero" aria-labelledby="hero-title"><div class="hero-grain" aria-hidden="true"></div>
<div class="shell hero-grid"><div class="hero-content">
<div class="eyebrow light"><span class="dash"></span> CHICO, CALIFORNIA · PEOPLE-POWERED SINCE 1990</div>
<h1 id="hero-title">The North State<br>has a <em>voice.</em></h1>
<p>Independent music, local stories, and community conversations. Discover the voices that make the North State sound like home.</p>
<div class="hero-actions">
<?php kzfr_theme_service_link('listen', __('Listen live', 'kzfr-community-radio'), 'btn btn-yellow'); ?>
<a class="btn btn-outline" href="#programs">Explore local programs ↓</a>
</div><p class="micro-copy">On your radio at 90.1 FM. Online wherever you listen.</p>
</div><div class="hero-art" aria-hidden="true"><div class="outer-rings"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="dial-face"><span class="dial-top">YOUR COMMUNITY. YOUR SOUND.</span><span class="dial-number">90<span>.</span>1</span><span class="dial-unit">FM / CHICO</span><div class="tiny-wave"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div></div><span class="floating-sticker sticker-one">LOCAL<br>LOUD</span><span class="floating-sticker sticker-two">SINCE<br>1990</span></div>
</div><div class="frequency-strip" aria-hidden="true"><span>90.1 FM</span><div class="strip-wave">▂ ▅ ▆ █ ▃ ▆ ▄ ▇ ▂ ▅ █ ▄ ▆ ▃ ▆ ▇ █ ▂ ▅ █ ▅ ▃ ▇ ▆ ▄ ▂</div><span>PEOPLE POWERED</span></div></section>
<section class="listen-panel shell" id="listen" aria-labelledby="listen-heading"><div class="listen-number">01 / LISTEN</div><div class="listen-copy"><div class="eyebrow">TUNE IN</div><h2 id="listen-heading">Always within earshot.</h2><p>Find a favorite show, discover something new, or catch an episode you missed.</p></div><div><?php kzfr_theme_service_link('archive', __('Explore audio archives', 'kzfr-community-radio'), 'text-link'); ?><br><?php kzfr_theme_service_link('schedule', __('See the program schedule', 'kzfr-community-radio'), 'text-link'); ?></div></section>
<section id="programs" class="archives-section" aria-labelledby="program-title"><div class="shell"><div class="section-heading"><div><div class="eyebrow"><span class="dash"></span> EXPLORE OUR PROGRAMS</div><h2 id="program-title">Every voice has<br><em>a home.</em></h2></div><p>Meet the programs, music and conversations that bring our community together.</p></div>
<div class="kzfr-grid" role="list">
<?php
$programs = new WP_Query(array('post_type' => 'kzfr_program', 'post_status' => 'publish', 'posts_per_page' => 6, 'no_found_rows' => true));
if ($programs->have_posts()) :
    while ($programs->have_posts()) : $programs->the_post();
        $creek = kzfr_theme_creek_link(get_the_ID());
        ?>
        <article class="kzfr-card" role="listitem"><span class="kzfr-chip">Program</span><h3><?php the_title(); ?></h3><p><?php echo esc_html(wp_trim_words(wp_strip_all_tags(get_the_excerpt()), 28)); ?></p><a href="<?php echo esc_url(get_permalink()); ?>">Program details →</a><?php if ($creek) : ?><p><?php kzfr_theme_external_link($creek, __('Listen to this program', 'kzfr-community-radio')); ?></p><?php endif; ?></article>
    <?php endwhile;
    wp_reset_postdata();
else : ?>
    <div class="kzfr-embedded-note" role="listitem">Program profiles are coming soon. <?php kzfr_theme_service_link('schedule', __('View the station schedule', 'kzfr-community-radio')); ?></div>
<?php endif; ?>
</div><p><a class="btn btn-ink" href="<?php echo esc_url(get_post_type_archive_link('kzfr_program') ?: home_url('/#programs')); ?>">Browse program profiles →</a></p></div></section>
<section class="community-section" id="community" aria-labelledby="community-title"><div class="shell community-grid"><div><div class="eyebrow light"><span class="dash"></span> COMMUNITY BUILT</div><h2 id="community-title">More than<br><em>a station.</em></h2><p>Find a local event, meet our community partners, and make a connection beyond the airwaves.</p><a class="btn btn-yellow" href="<?php echo esc_url(get_post_type_archive_link('kzfr_event') ?: home_url('/')); ?>">Community calendar →</a></div><div class="community-tiles">
<?php
$upcoming = new WP_Query(array('post_type' => 'kzfr_event', 'post_status' => 'publish', 'posts_per_page' => 2, 'no_found_rows' => true, 'meta_key' => 'kzfr_event_date', 'orderby' => 'meta_value', 'order' => 'ASC', 'meta_query' => array(array('key' => 'kzfr_event_date', 'value' => current_time('Y-m-d'), 'compare' => '>=', 'type' => 'CHAR'))));
while ($upcoming->have_posts()) : $upcoming->the_post(); $event_day = kzfr_theme_event_day(get_the_ID()); ?>
<div><span aria-hidden="true">✶</span><strong><a href="<?php echo esc_url(get_permalink()); ?>"><?php the_title(); ?></a></strong><p><?php kzfr_theme_event_time($event_day); ?></p></div>
<?php endwhile; wp_reset_postdata(); ?>
<div><span aria-hidden="true">↗</span><strong>Community partners</strong><p>Meet the local underwriters who support people-powered radio.</p><a href="<?php echo esc_url(get_post_type_archive_link('kzfr_underwriter') ?: home_url('/#support')); ?>">Meet our underwriters →</a></div>
</div></div></section>
<section class="support-section shell" id="support" aria-labelledby="support-title"><div><div class="eyebrow"><span class="dash"></span> KEEP THE RADIO ON</div><h2 id="support-title">People-powered<br>means <em>you-powered.</em></h2></div><div><p>Help keep independent voices on the air. Your support makes room for music, local stories and community conversations.</p><?php kzfr_theme_service_link('donate', __('Support KZFR', 'kzfr-community-radio'), 'btn btn-ink'); ?></div></section>
</main>
<?php get_footer(); ?>
