<?php
/** Native staff screens, REST routes and public form rendering. */
if (!defined('ABSPATH')) { exit; }

function csktm_eng_portal_url() { return add_query_arg('cskt_engagement','receipt',home_url('/')); }
function csktm_eng_is_portal() {
    return isset($_GET['cskt_engagement']) && is_string($_GET['cskt_engagement']) && $_GET['cskt_engagement']==='receipt';
}
add_action('template_redirect',function() {
    if (!csktm_eng_is_portal()) { return; }
    status_header(200); nocache_headers();
    header('Referrer-Policy: no-referrer');
    header('X-Robots-Tag: noindex, nofollow');
    echo '<!doctype html><html '; language_attributes(); echo '><head><meta charset="'.esc_attr(get_bloginfo('charset')).'">';
    echo '<meta name="viewport" content="width=device-width,initial-scale=1"><title>'.esc_html__('Manage your submission','cskt-migration').'</title>';
    wp_head();
    echo '</head><body class="cskt-eng-portal"><main class="cskt-eng"><h1>Manage your submission</h1>';
    echo '<p>Your private receipt or confirmation link opens the original submission here.</p><noscript><p>Enable JavaScript to open the private link from your receipt or confirmation email.</p></noscript></main>';
    wp_footer(); echo '</body></html>'; exit;
},-100);
function csktm_eng_parent_list($request) {
    $search=csktm_eng_text((string)($request['search']??''),'Resource search',200);
    $page=max(1,(int)($request['page']??1));
    $query=new WP_Query(array('post_type'=>array('page','post','cskt_project','cskt_notice'),
        'post_status'=>array('publish','draft','pending','private','future'),
        'posts_per_page'=>50,'paged'=>$page,'s'=>$search,'orderby'=>'title','order'=>'ASC'));
    $items=array();
    foreach ($query->posts as $post) {
        if (current_user_can('edit_post',$post->ID)) {
            $items[]=array('id'=>$post->ID,'title'=>$post->post_title,'type'=>$post->post_type,
                'state'=>$post->post_status,'url'=>get_permalink($post->ID));
        }
    }
    return array('items'=>$items,'page'=>$page,'pages'=>(int)$query->max_num_pages);
}
function csktm_eng_staff_directory() {
    $items=array(); $page=1;
    do {
        $query=new WP_User_Query(array('number'=>200,'paged'=>$page,'orderby'=>'display_name','order'=>'ASC','count_total'=>false));
        $users=$query->get_results();
        foreach ($users as $user) {
            if (user_can($user,'edit_pages')) { $items[]=array('id'=>(int)$user->ID,'name'=>$user->display_name); }
        }
        $page++;
    } while (count($users)===200);
    return array('items'=>$items);
}
function csktm_eng_staff_list($kind,$request) {
    $filters=array();
    foreach (array('formId','state','mode','search') as $key) {
        if (isset($request[$key])) { $filters[$key]=csktm_eng_text((string)$request[$key],$key,300); }
    }
    $after=max(0,(int)($request['after']??0));
    return csktm_eng_rows($kind,$filters,$after,50,false);
}
function csktm_eng_inspect() {
    $forms=csktm_eng_all('form');
    $result=array();
    foreach ($forms as $row) {
        $row['data']['occupied']=$row['data']['mode']==='rsvp'?csktm_eng_occupied($row['data']['id']):null;
        $result[]=$row;
    }
    return array('schema'=>'cskt.engagement.operator.v1','version'=>CSKTM_ENG_VERSION,
        'origin'=>untrailingslashit(home_url('/')),'siteTimezone'=>wp_timezone_string(),
        'actor'=>array('id'=>get_current_user_id(),'name'=>wp_get_current_user()->display_name),
        'capabilities'=>array('staff'=>csktm_eng_staff(),'publish'=>csktm_eng_publisher(),'admin'=>csktm_eng_admin()),
        'forms'=>$result,'mailTransport'=>'wp_mail','automaticDelivery'=>'WordPress single-event cron',
        'cronDisabled'=>defined('DISABLE_WP_CRON')&&DISABLE_WP_CRON,
        'privatePostTypes'=>array('cskt_eng_form','cskt_eng_entry','cskt_eng_mail'));
}
add_action('rest_api_init',function() {
    $staff=array(
        array('/inspect','GET',function(){ return csktm_eng_inspect(); },'csktm_eng_staff'),
        array('/staff','GET','csktm_eng_staff_directory','csktm_eng_staff'),
        array('/parents','GET','csktm_eng_parent_list','csktm_eng_publisher'),
        array('/forms','GET',function($r){ return csktm_eng_staff_list('form',$r); },'csktm_eng_staff'),
        array('/forms','POST',function($r){ return csktm_eng_save_form($r->get_json_params()); },'csktm_eng_publisher'),
        array('/forms/(?P<id>[a-f0-9-]{36})','GET',function($r){ return csktm_eng_row('form',$r['id']); },'csktm_eng_staff'),
        array('/entries','GET',function($r){ return csktm_eng_staff_list('entry',$r); },'csktm_eng_staff'),
        array('/entries/(?P<id>[a-f0-9-]{36})','GET',function($r){ return csktm_eng_row('entry',$r['id']); },'csktm_eng_staff'),
        array('/entries/(?P<id>[a-f0-9-]{36})/decide','POST',function($r){ return csktm_eng_entry_decision($r['id'],$r->get_json_params()); },'csktm_eng_staff'),
        array('/mail','GET',function($r){ return csktm_eng_staff_list('mail',$r); },'csktm_eng_staff'),
        array('/mail/(?P<id>[a-f0-9-]{36})','GET',function($r){ return csktm_eng_row('mail',$r['id']); },'csktm_eng_staff'),
        array('/mail/(?P<id>[a-f0-9-]{36})/send','POST',function($r){ return csktm_eng_deliver($r['id'],$r->get_json_params()); },'csktm_eng_staff'),
        array('/mail/(?P<id>[a-f0-9-]{36})/decide','POST',function($r){ return csktm_eng_mail_decision($r['id'],$r->get_json_params()); },'csktm_eng_staff'),
        array('/export','POST',function($r){ return csktm_eng_export($r->get_json_params()); },'csktm_eng_admin'),
        array('/export-csv','POST',function($r){ return csktm_eng_csv($r->get_json_params()); },'csktm_eng_staff'),
        array('/receive/preview','POST',function($r){ return csktm_eng_receive_preview($r->get_json_params()); },'csktm_eng_admin'),
        array('/receive/apply','POST',function($r){ return csktm_eng_receive_apply($r->get_json_params()); },'csktm_eng_admin'),
    );
    foreach ($staff as $route) {
        register_rest_route(CSKTM_ENG_NS,$route[0],array('methods'=>$route[1],
            'permission_callback'=>$route[3],
            'callback'=>csktm_eng_endpoint($route[2],false,$route[0]==='/receive/preview'?CSKTM_MAX_MANIFEST+1048576:65536)));
    }
    $public=array(
        array('/public/forms/(?P<id>[a-f0-9-]{36})','GET',function($r){ return csktm_eng_public_form($r['id']); }),
        array('/public/forms/(?P<id>[a-f0-9-]{36})/submit','POST',function($r){ return csktm_eng_submit($r['id'],$r->get_json_params()); }),
        array('/public/forms/(?P<id>[a-f0-9-]{36})/comments','GET',function($r){ return array('items'=>csktm_eng_comments($r['id'])); }),
        array('/public/entries/(?P<id>[a-f0-9-]{36})/receipt','POST',function($r){ $p=$r->get_json_params(); return array('receipt'=>csktm_eng_receipt(csktm_eng_receipt_entry($r['id'],$p['receiptKey']??null))); }),
        array('/public/entries/(?P<id>[a-f0-9-]{36})/confirm','POST',function($r){ return csktm_eng_confirm($r['id'],$r->get_json_params()); }),
        array('/public/entries/(?P<id>[a-f0-9-]{36})/decide','POST',function($r){ return csktm_eng_public_decision($r['id'],$r->get_json_params()); }),
    );
    foreach ($public as $route) {
        register_rest_route(CSKTM_ENG_NS,$route[0],array('methods'=>$route[1],
            'permission_callback'=>'__return_true','callback'=>csktm_eng_endpoint($route[2],true)));
    }
});
add_action('admin_menu',function() {
    add_menu_page('Engagement','Engagement','edit_pages','cskt-engagement',function() {
        if (!csktm_eng_staff()) { return; }
        echo '<div class="wrap cskt-eng"><h1>Engagement</h1><p>Manage forms, incoming submissions and staff correspondence for published projects and notices.</p>';
        echo '<div id="cskt-eng-status" role="status" aria-live="polite"></div><div id="cskt-eng-app"><p>Loading the native workspace…</p></div></div>';
    },'dashicons-feedback',26);
});
add_action('admin_enqueue_scripts',function($hook) {
    if ($hook!=='toplevel_page_cskt-engagement') { return; }
    wp_enqueue_style('cskt-engagement',plugins_url('engagement.css',__FILE__),array(),CSKTM_ENG_VERSION);
    wp_enqueue_script('cskt-engagement-admin',plugins_url('engagement-admin.js',__FILE__),array(),CSKTM_ENG_VERSION,true);
    wp_add_inline_script('cskt-engagement-admin','window.CSKTEngagement='.wp_json_encode(array(
        'baseUrl'=>home_url('/'),'namespace'=>CSKTM_ENG_NS,'nonce'=>wp_create_nonce('wp_rest'),
        'siteTimezone'=>wp_timezone_string(),'actorId'=>get_current_user_id(),'adminUrl'=>admin_url('admin.php?page=cskt-engagement'),
    ),JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT).';','before');
});
add_action('wp_enqueue_scripts',function() {
    if (!csktm_eng_is_portal() && !is_singular(array('page','post','cskt_project','cskt_notice'))) { return; }
    wp_enqueue_style('cskt-engagement',plugins_url('engagement.css',__FILE__),array(),CSKTM_ENG_VERSION);
    wp_enqueue_script('cskt-engagement-public',plugins_url('engagement-public.js',__FILE__),array(),CSKTM_ENG_VERSION,true);
    wp_add_inline_script('cskt-engagement-public','window.CSKTEngagementPublic='.wp_json_encode(array(
        'baseUrl'=>home_url('/'),'namespace'=>CSKTM_ENG_NS,'receiptUrl'=>csktm_eng_portal_url(),
    ),JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT).';','before');
});
function csktm_eng_public_input($id,$name,$label,$type='text',$required=false,$value='') {
    return '<label for="'.esc_attr($id).'-'.esc_attr($name).'">'.esc_html($label).($required?' <span aria-hidden="true">*</span>':'').
        '</label><input id="'.esc_attr($id).'-'.esc_attr($name).'" name="'.esc_attr($name).'" type="'.esc_attr($type).
        '" value="'.esc_attr($value).'"'.($required?' required':'').' maxlength="'.($name==='email'?'254':'300').'">';
}
function csktm_eng_render_form($id) {
    try { $form=csktm_eng_public_form($id); } catch (Throwable $error) { return ''; }
    $out='<section class="cskt-eng cskt-eng-public" data-cskt-rendered="'.esc_attr($id).'" aria-labelledby="cskt-eng-title-'.esc_attr($id).'">';
    $out.='<h2 id="cskt-eng-title-'.esc_attr($id).'">'.esc_html($form['title']).'</h2>';
    if ($form['instructions']!=='') { $out.='<p class="cskt-eng-prose">'.esc_html($form['instructions']).'</p>'; }
    $out.='<p class="cskt-eng-associated">For <a href="'.esc_url($form['parent']['url']).'">'.esc_html($form['parent']['title']).'</a></p>';
    if ($form['opensAt'] || $form['closesAt']) {
        $out.='<p>';
        foreach (array('opensAt'=>'Opens','closesAt'=>'Closes') as $key=>$label) {
            if ($form[$key]) { $out.=$label.' <time datetime="'.esc_attr($form[$key]).'">'.esc_html(wp_date('F j, Y, g:i a T',strtotime($form[$key]))).'</time>. '; }
        }
        $out.='</p>';
    }
    if ($form['available']) {
        $out.='<form data-cskt-engagement="'.esc_attr($id).'" data-mode="'.esc_attr($form['mode']).'" action="'.esc_url(admin_url('admin-post.php')).'" method="post">';
        foreach (array('action'=>'cskt_eng_submit','formId'=>$id,'requestId'=>wp_generate_uuid4(),'formRevision'=>$form['revision'],'formToken'=>$form['formToken']) as $key=>$value) {
            $out.='<input type="hidden" name="'.esc_attr($key).'" value="'.esc_attr((string)$value).'">';
        }
        $out.='<div class="cskt-eng-fields">';
        $out.=csktm_eng_public_input($id,'name','Name','text',$form['mode']!=='comment');
        $out.=csktm_eng_public_input($id,'email','Email address','email',true);
        if (in_array($form['mode'],array('contact','comment'),true)) {
            if ($form['mode']==='contact') { $out.=csktm_eng_public_input($id,'subject','Subject'); }
            $out.='<label for="'.esc_attr($id).'-message">'.($form['mode']==='comment'?'Your comment':'Message').' <span aria-hidden="true">*</span></label>'.
                '<textarea id="'.esc_attr($id).'-message" name="message" rows="7" maxlength="20000" required></textarea>';
        }
        if ($form['mode']==='comment') { $out.=csktm_eng_public_input($id,'displayName','Display name for a published comment (optional)'); }
        if ($form['mode']==='rsvp') {
            $out.='<label for="'.esc_attr($id).'-partySize">People attending</label><input id="'.esc_attr($id).'-partySize" name="partySize" type="number" value="1" min="1" max="'.(int)$form['maxParty'].'" required>';
        }
        $out.='</div><div class="cskt-eng-honey" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>';
        $out.='<div class="cskt-eng-privacy"><h3>How this information is used</h3><p class="cskt-eng-prose">'.esc_html($form['privacyText']).'</p></div>';
        $out.='<label class="cskt-eng-check"><input type="checkbox" name="consent" value="1" required><span>'.esc_html($form['consentText']).'</span></label>';
        if ($form['mode']==='comment') {
            $out.='<label class="cskt-eng-check"><input type="checkbox" name="publicationConsent" value="1"><span>'.esc_html($form['publicationLabel']).'</span></label>';
        }
        if (in_array($form['mode'],array('newsletter','rsvp'),true)) { $out.='<p>Use the confirmation email to finish this request.</p>'; }
        $out.='<p><button type="submit">Submit</button></p><div class="cskt-eng-form-status" role="status" aria-live="polite"></div></form>';
    } else { $out.='<p>This form is currently closed.</p>'; }
    if ($form['mode']==='comment') {
        try { $comments=csktm_eng_comments($id); } catch (Throwable $error) { $comments=array(); }
        if ($comments) {
            $out.='<section class="cskt-eng-comments"><h3>Published comments</h3>';
            foreach ($comments as $comment) {
                $out.='<article><p class="cskt-eng-prose">'.esc_html($comment['text']).'</p><p><strong>'.esc_html($comment['displayName']?:'Community member').
                    '</strong> · <time datetime="'.esc_attr($comment['publishedAt']).'">'.esc_html(wp_date('F j, Y',strtotime($comment['publishedAt']))).'</time></p></article>';
            }
            $out.='</section>';
        }
    }
    return $out.'</section>';
}
add_shortcode('cskt_engagement',function($attributes) {
    $attributes=shortcode_atts(array('id'=>''),$attributes);
    return csktm_eng_uuid($attributes['id'])?csktm_eng_render_form($attributes['id']):'';
});
add_filter('the_content',function($content) {
    if (!is_singular() || !in_the_loop() || !is_main_query() || is_admin()) { return $content; }
    $post_id=get_the_ID();
    foreach (csktm_eng_all('form') as $row) {
        $form=$row['data'];
        if ($form['autoAttach'] && (int)$form['parent']['postId']===$post_id && $form['state']!=='draft' &&
            !str_contains($content,'data-cskt-rendered="'.esc_attr($form['id']).'"')) {
            $content.=csktm_eng_render_form($form['id']);
        }
    }
    return $content;
},30);
function csktm_eng_post_submission() {
    try {
        $raw=wp_unslash($_POST);
        $input=array('requestId'=>$raw['requestId']??'','formRevision'=>(int)($raw['formRevision']??0),
            'formToken'=>$raw['formToken']??'','name'=>$raw['name']??'','email'=>$raw['email']??'',
            'subject'=>$raw['subject']??'','message'=>$raw['message']??'','displayName'=>$raw['displayName']??'',
            'partySize'=>(int)($raw['partySize']??1),'consent'=>($raw['consent']??'')==='1',
            'publicationConsent'=>($raw['publicationConsent']??'')==='1','website'=>$raw['website']??'');
        $result=csktm_eng_submit($raw['formId']??'',$input); $receipt=$result['receipt'];
        $entry=csktm_eng_row('entry',$receipt['id'])['data'];
        $html='<h1>Submission recorded</h1><p>'.esc_html($receipt['message']).'</p><p>Receipt: <strong>'.esc_html($receipt['id']).'</strong></p>'.
            '<p><a href="'.esc_url(csktm_eng_management_url($entry)).'">Open your private receipt</a></p>'.
            '<p>Keep that private link to view or cancel this request.</p>';
        wp_die($html,'Submission recorded',array('response'=>200));
    } catch (Throwable $error) {
        wp_die(esc_html($error instanceof CSKTM_Problem?$error->getMessage():'WordPress could not complete this request. Return to the form and retry.'),
            'Engagement form',array('response'=>$error instanceof CSKTM_Problem?$error->status:500,'back_link'=>true));
    }
}
add_action('admin_post_nopriv_cskt_eng_submit','csktm_eng_post_submission');
add_action('admin_post_cskt_eng_submit','csktm_eng_post_submission');
