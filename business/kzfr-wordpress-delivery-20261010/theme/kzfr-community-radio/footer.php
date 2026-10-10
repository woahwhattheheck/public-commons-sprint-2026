<?php if (!defined('ABSPATH')) { exit; } ?>
<footer class="site-footer"><div class="shell footer-inner">
<div class="footer-name">KZFR <span>90.1 FM</span><small>PEOPLE POWERED RADIO</small></div>
<div class="footer-right">
<p>Independent voices. Local connections. Chico and the North State.</p>
<nav aria-label="Station services">
<?php kzfr_theme_service_link('listen', __('Listen live', 'kzfr-community-radio')); ?>
<?php kzfr_theme_service_link('archive', __('Audio archives', 'kzfr-community-radio')); ?>
<?php kzfr_theme_service_link('schedule', __('Program schedule', 'kzfr-community-radio')); ?>
<?php kzfr_theme_service_link('donate', __('Donate', 'kzfr-community-radio')); ?>
</nav>
<a href="#top">Back to top ↑</a>
</div></div></footer>
<?php wp_footer(); ?>
</body></html>
