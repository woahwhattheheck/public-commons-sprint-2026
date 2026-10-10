<?php
if (!defined('ABSPATH')) { exit; }
get_header();
?>
<main id="main">
<section class="hero" aria-labelledby="hero-title"><div class="hero-grain" aria-hidden="true"></div>
<div class="shell hero-grid"><div class="hero-content">
<div class="eyebrow light"><span class="dash"></span> CHICO, CALIFORNIA · PEOPLE-POWERED SINCE 1990</div>
<h1 id="hero-title">The North State<br>has a <em>voice.</em></h1>
<p>Independent music, local stories, and community conversations. Keep the station's actual audio and radio services where they already work.</p>
<div class="hero-actions">
<a class="btn btn-yellow" href="https://kzfr.org" target="_blank" rel="noopener noreferrer"><span class="play-icon" aria-hidden="true">▶</span> Listen on KZFR ↗</a>
<a class="btn btn-outline" href="#programs">Explore local programs ↓</a>
</div><p class="micro-copy">External links open KZFR or its current provider. No audio is hosted by this WordPress concept.</p>
</div><div class="hero-art" aria-hidden="true"><div class="outer-rings"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="dial-face"><span class="dial-top">YOUR COMMUNITY. YOUR SOUND.</span><span class="dial-number">90<span>.</span>1</span><span class="dial-unit">FM / CHICO</span><div class="tiny-wave"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div></div><span class="floating-sticker sticker-one">LOCAL<br>LOUD</span><span class="floating-sticker sticker-two">SINCE<br>1990</span></div>
</div><div class="frequency-strip" aria-hidden="true"><span>90.1 FM</span><div class="strip-wave">▂ ▅ ▆ █ ▃ ▆ ▄ ▇ ▂ ▅ █ ▄ ▆ ▃ ▆ ▇ █ ▂ ▅ █ ▅ ▃ ▇ ▆ ▄ ▂</div><span>PEOPLE POWERED</span></div></section>
<section class="listen-panel shell" id="listen" aria-labelledby="listen-heading"><div class="listen-number">01 / LISTEN</div><div class="listen-copy"><div class="eyebrow">EXISTING RADIO INFRASTRUCTURE</div><h2 id="listen-heading">Always within earshot.</h2><p>Live listening, archive audio, radio scheduling, and playlists stay with the station's existing Creek Studio services. This site supplies navigation and editorial presentation only.</p></div><a class="text-link" href="https://kzfr.studio.creek.org/archives/" target="_blank" rel="noopener noreferrer">Explore real audio archives ↗</a></section>
<section id="programs" class="archives-section" aria-labelledby="program-title"><div class="shell"><div class="section-heading"><div><div class="eyebrow"><span class="dash"></span> EDITOR-OWNED WORDPRESS PROGRAMS</div><h2 id="program-title">Every voice has<br><em>a home.</em></h2></div><p>Content below comes from WordPress program entries authored by staff. Connected audio remains at the trusted Creek Studio host.</p></div>
<div class="kzfr-grid" role="list">
<?php
$programs = new WP_Query(array('post_type' => 'kzfr_program', 'post_status' => 'publish', 'posts_per_page' => 6, 'no_found_rows' => true));
if ($programs->have_posts()) :
    while ($programs->have_posts()) : $programs->the_post();
        $creek = kzfr_theme_creek_link(get_the_ID());
        ?>
        <article class="kzfr-card" role="listitem"><span class="kzfr-chip">Program · WordPress editorial</span><h3><?php the_title(); ?></h3><p><?php echo esc_html(wp_trim_words(wp_strip_all_tags(get_the_excerpt()), 28)); ?></p><a href="<?php echo esc_url(get_permalink()); ?>">Program details →</a><?php if ($creek) : ?><p><a href="<?php echo esc_url($creek); ?>" target="_blank" rel="noopener noreferrer">Play on Creek Studio ↗</a></p><?php endif; ?></article>
    <?php endwhile;
    wp_reset_postdata();
else : ?>
    <div class="kzfr-embedded-note" role="listitem">No program pages published yet. Editors can add them in <strong>Programs</strong> after activating the companion content plugin. This site does not fabricate a show schedule.</div>
<?php endif; ?>
</div><p><a class="btn btn-ink" href="<?php echo esc_url(get_post_type_archive_link('kzfr_program') ?: 'https://kzfr.studio.creek.org/archives/'); ?>">Browse programs &amp; archives ↗</a></p></div></section>
<section class="community-section" id="community" aria-labelledby="community-title"><div class="shell community-grid"><div><div class="eyebrow light"><span class="dash"></span> COMMUNITY BUILT</div><h2 id="community-title">More than<br><em>a station.</em></h2><p>Events, volunteers, underwriters, and conversations share one editorial home that the station's team can update without bespoke software.</p><a class="btn btn-yellow" href="<?php echo esc_url(get_post_type_archive_link('kzfr_event') ?: home_url('/')); ?>">Community calendar ↗</a></div><div class="community-tiles"><div><span>✶</span><strong>Discover</strong><p>WordPress-managed events.</p></div><div><span>◉</span><strong>Participate</strong><p>Staff-managed program pages.</p></div><div><span>↗</span><strong>Support</strong><p>Existing provider donation handoff.</p></div></div></div></section>
<section class="support-section shell" id="support" aria-labelledby="support-title"><div><div class="eyebrow"><span class="dash"></span> KEEP THE RADIO ON</div><h2 id="support-title">People-powered<br>means <em>you-powered.</em></h2></div><div><p>Donations stay with KZFR's existing provider. No donor card, user registration, payment account or customer data flows into this candidate theme.</p><a class="btn btn-ink" href="https://kzfr-donate.creek.org/" target="_blank" rel="noopener noreferrer">Support KZFR ↗</a></div></section>
</main>
<?php get_footer(); ?>
