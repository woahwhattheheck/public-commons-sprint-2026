<?php
/** Ordinary WordPress staff forms, native media selection and retained public site settings. */
if (!defined('ABSPATH')) { exit; }

function csktm_site_form_date($value,$label) {
    $value=csktm_site_text($value,$label,30);
    if ($value==='') { return null; }
    $format=strlen($value)===16?'!Y-m-d\TH:i':'!Y-m-d\TH:i:s';
    $date=DateTimeImmutable::createFromFormat($format,$value,wp_timezone());
    $errors=DateTimeImmutable::getLastErrors();
    if (!$date || ($errors && ($errors['warning_count'] || $errors['error_count'])) || $date->format(substr($format,1))!==$value) {
        csktm_fail('site_date',$label.' is not a valid local calendar time in '.wp_timezone_string().'.');
    }
    return $date->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
}
function csktm_site_form_values($post_id) {
    if (($_POST['cskt_site_complete']??'')!=='1' || !is_array($_POST['cskt_site_details']??null)) {
        csktm_fail('site_incomplete_form','The complete details form did not reach WordPress. Reload the editor and submit it again.');
    }
    return csktm_site_parse_form_values($post_id,wp_unslash($_POST['cskt_site_details']));
}
function csktm_site_parse_form_values($post_id,$input) {
    if (!is_array($input)) { csktm_fail('site_incomplete_form','Retain the complete original detail fields.'); }
    $type=get_post_type($post_id);
    if ($type==='cskt_opportunity') {
        foreach (array('opensAt'=>'Opening time','closesAt'=>'Closing time') as $key=>$label) { $input[$key]=csktm_site_form_date($input[$key]??'',$label); }
        $ids=json_decode($input['attachmentIds']??'',true);
        if (!is_array($ids)) { csktm_fail('site_attachments','Select the complete original file list through the media picker.'); }
        $input['attachmentIds']=$ids;
    }
    return csktm_site_values($type,$input,$post_id,true);
}

function csktm_site_confirm_editor($input) {
    $id=$input['postId']??null;
    if (!is_int($id) || !in_array(get_post_type($id),array('cskt_staff','cskt_opportunity'),true) ||
        !current_user_can('edit_post',$id) || !is_string($input['nonce']??null) ||
        !wp_verify_nonce($input['nonce'],'cskt_site_details_'.$id)) {
        csktm_fail('site_editor_confirmation','Use the original authenticated WordPress detail form.',403);
    }
    if (!is_bool($input['archived']??null)) { csktm_fail('site_editor_confirmation','Retain the submitted archive selection.'); }
    $values=csktm_site_parse_form_values($id,$input['details']??null);
    $archived=get_post_type($id)==='cskt_opportunity'?$values['state']==='archived':$input['archived'];
    $accepted=csktm_hash(array('details'=>$values,'archive'=>$archived));
    clean_post_cache($id);
    if (!hash_equals(csktm_site_details_fingerprint($id),$accepted)) {
        csktm_fail('site_editor_confirmation','The current native fields do not match the submitted form. Reload the editor to review the saved record before another change.',409);
    }
    return array('postId'=>$id,'fingerprint'=>$accepted,'confirmed'=>true);
}
add_action('rest_api_init',function(){
    register_rest_route(CSKTM_SITE_NS,'/editor-confirmation',array('methods'=>'POST',
        'permission_callback'=>function($request){return current_user_can('edit_post',(int)($request['postId']??0));},
        'callback'=>csktm_site_rest(function($request){return csktm_site_confirm_editor($request->get_json_params());},true)));
});

function csktm_site_box($post) {
    try { $data=csktm_site_details($post->ID); $fingerprint=csktm_site_details_fingerprint($post->ID); }
    catch (Throwable $error) { echo '<div class="notice notice-error inline"><p>'.esc_html($error->getMessage()).'</p></div>'; return; }
    wp_nonce_field('cskt_site_details_'.$post->ID,'cskt_site_nonce');
    echo '<input type="hidden" name="cskt_site_expected" value="'.esc_attr($fingerprint).'">';
    echo '<div class="cskt-site-editor"><p>These fields appear on the public website when this record is published. Use the normal WordPress title, biography or description, excerpt, featured image and department controls.</p>';
    if ($post->post_type==='cskt_staff') {
        foreach (array('roleTitle'=>array('Role or job title','text'),'email'=>array('Public email','email'),
            'phone'=>array('Public telephone','text'),'office'=>array('Office','textarea'),
            'hours'=>array('Office hours','textarea'),'profileUrl'=>array('Related profile URL','url')) as $key=>$field) {
            csktm_editor_field('cskt-site-'.$key,$field[0],'cskt_site_details['.$key.']',$data[$key],array('type'=>$field[1]));
        }
        echo '<p><label><input type="checkbox" name="cskt_site_archived" value="1" '.checked(get_post_meta($post->ID,'_cskt_archive',true),'1',false).'> Archive this staff profile</label></p>';
        echo '<p class="description">Archived profiles remain published for reference and can be included through the archive filter. To remove a profile from public access, return the native post to Draft or Private.</p>';
    } else {
        echo '<p><label for="cskt-site-kind"><strong>Opportunity type</strong></label><br><select id="cskt-site-kind" name="cskt_site_details[kind]">';
        foreach (array('career'=>'Career','procurement'=>'Procurement') as $key=>$label) { echo '<option value="'.esc_attr($key).'" '.selected($data['kind'],$key,false).'>'.esc_html($label).'</option>'; }
        echo '</select></p><p><label for="cskt-site-state"><strong>Status</strong></label><br><select id="cskt-site-state" name="cskt_site_details[state]">';
        foreach (array('open'=>'Open according to the dates below','closed'=>'Closed','awarded'=>'Awarded','cancelled'=>'Cancelled','archived'=>'Archived') as $key=>$label) { echo '<option value="'.esc_attr($key).'" '.selected($data['state'],$key,false).'>'.esc_html($label).'</option>'; }
        echo '</select></p><p class="description">An open item is scheduled before its opening time and closed at its closing time. Archived preserves a historical record. Choose a non-archived status to restore it.</p>';
        foreach (array('reference'=>'Reference number','location'=>'Location') as $key=>$label) { csktm_editor_field('cskt-site-'.$key,$label,'cskt_site_details['.$key.']',$data[$key]); }
        foreach (array('opensAt'=>'Opens','closesAt'=>'Closes') as $key=>$label) {
            $value=$data[$key]?wp_date('Y-m-d\TH:i:s',strtotime($data[$key]),wp_timezone()):'';
            echo '<p><label for="cskt-site-'.esc_attr($key).'"><strong>'.esc_html($label).'</strong></label><br><input type="datetime-local" step="1" id="cskt-site-'.esc_attr($key).'" name="cskt_site_details['.esc_attr($key).']" value="'.esc_attr($value).'"><br><span class="description">'.esc_html('Local time in '.wp_timezone_string().'. Leave blank when no date has been selected.').'</span></p>';
        }
        foreach (array('applyUrl'=>array('Application or bid URL','url'),'contactEmail'=>array('Public contact email','email'),'contactPhone'=>array('Public contact telephone','text')) as $key=>$field) {
            csktm_editor_field('cskt-site-'.$key,$field[0],'cskt_site_details['.$key.']',$data[$key],array('type'=>$field[1]));
        }
        echo '<fieldset class="cskt-site-media"><legend><strong>Related files</strong></legend><p>Choose existing WordPress media files. A file attached to a private or password-protected resource will not be exposed by the public opportunity panel.</p>';
        echo '<input type="hidden" data-cskt-site-files name="cskt_site_details[attachmentIds]" value="'.esc_attr(csktm_json($data['attachmentIds'])).'"><ul data-cskt-site-file-list>';
        foreach ($data['attachmentIds'] as $id) {
            $file=get_post($id);
            echo '<li data-cskt-site-file="'.(int)$id.'"><span>'.esc_html($file?$file->post_title:'Unavailable attachment #'.$id).'</span> <button type="button" class="button-link-delete" data-cskt-site-remove="'.(int)$id.'">Remove file</button></li>';
        }
        echo '</ul><button type="button" class="button" data-cskt-site-pick-files '.disabled(!current_user_can('upload_files'),true,false).'>Choose media files</button><p data-cskt-site-media-status role="status" aria-live="polite"></p></fieldset>';
    }
    echo '<input type="hidden" name="cskt_site_complete" value="1"></div>';
}
add_action('add_meta_boxes',function($type,$post){
    if (in_array($type,array('cskt_staff','cskt_opportunity'),true) && $post) {
        add_meta_box('cskt-site-details','Public details','csktm_site_box',$type,'normal','high',array('__block_editor_compatible_meta_box'=>true));
    }
},20,2);
add_action('save_post',function($post_id,$post){
    if (!in_array($post->post_type,array('cskt_staff','cskt_opportunity'),true) || wp_is_post_revision($post_id) ||
        wp_is_post_autosave($post_id) || defined('DOING_AUTOSAVE')&&DOING_AUTOSAVE || !isset($_POST['cskt_site_nonce'])) { return; }
    if (!current_user_can('edit_post',$post_id) || !is_string($_POST['cskt_site_nonce']) ||
        !wp_verify_nonce(wp_unslash($_POST['cskt_site_nonce']),'cskt_site_details_'.$post_id)) {
        wp_die(esc_html('Your WordPress editing session has expired. Reload the editor and save again.'),'Public details',array('response'=>403,'back_link'=>true));
    }
    try {
        $values=csktm_site_form_values($post_id);
        $expected=wp_unslash($_POST['cskt_site_expected']??'');
        $archived=$post->post_type==='cskt_opportunity'?$values['state']==='archived':($_POST['cskt_site_archived']??'')==='1';
        csktm_transaction(function() use ($post_id,$post,$values,$expected,$archived){
            csktm_lock_post($post_id);
            if (!csktm_sha($expected) || !hash_equals(csktm_site_details_fingerprint($post_id),$expected)) {
                csktm_fail('site_details_changed','Another edit changed these public fields. Reload the current details before saving your changes.',409);
            }
            $key=$post->post_type==='cskt_staff'?'_cskt_staff':'_cskt_opportunity';
            csktm_site_meta_write($post_id,$key,csktm_json($values));
            csktm_site_meta_write($post_id,'_cskt_archive',$archived?'1':'0');
            if ($post->post_type==='cskt_opportunity') { csktm_site_index($post_id); }
            clean_post_cache($post_id);
            wp_save_post_revision($post_id);
        });
    } catch (Throwable $error) {
        clean_post_cache($post_id);
        wp_die(esc_html('The public detail fields were not saved. '.$error->getMessage()),'Public details',
            array('response'=>$error instanceof CSKTM_Problem?$error->status:500,'back_link'=>true));
    }
},25,2);
add_action('admin_enqueue_scripts',function(){
    $screen=get_current_screen();
    if (!$screen || !in_array($screen->post_type,array('cskt_staff','cskt_opportunity'),true)) { return; }
    if (current_user_can('upload_files')) { wp_enqueue_media(); }
    wp_enqueue_script('cskt-site-editor',plugins_url('site-admin.js',__FILE__),array('wp-api-fetch'),CSKTM_SITE_VERSION,true);
    wp_enqueue_style('cskt-site',plugins_url('site.css',__FILE__),array(),CSKTM_SITE_VERSION);
});
foreach (array('cskt_staff','cskt_opportunity') as $type) {
    add_filter('manage_'.$type.'_posts_columns',function($columns){
        $columns['cskt_site_details']='Public details';
        return $columns;
    });
    add_action('manage_'.$type.'_posts_custom_column',function($column,$id) use ($type){
        if ($column!=='cskt_site_details') { return; }
        try {
            $data=csktm_site_details($id);
            if ($type==='cskt_staff') { echo esc_html($data['roleTitle']); }
            else {
                echo esc_html(ucfirst($data['kind']).' · '.ucfirst(csktm_site_effective_state($data,get_post_meta($id,'_cskt_archive',true)==='1')));
                if ($data['closesAt']) { echo '<br>'.esc_html('Closes '.wp_date('M j, Y, g:i a T',strtotime($data['closesAt']))); }
            }
            if (get_post_meta($id,'_cskt_archive',true)==='1') { echo '<br><strong>Archived</strong>'; }
        } catch (Throwable $error) { echo '<strong>'.esc_html('Details need review').'</strong>'; }
    },10,2);
}

function csktm_site_page_roles() {
    return array('home'=>'Home','about'=>'About','projects'=>'Projects','documents'=>'Documents','news'=>'News','notices'=>'Notices',
        'staff'=>'Staff','opportunities'=>'Opportunities','contact'=>'Contact','gis'=>'Maps and GIS');
}
function csktm_site_settings_defaults() {
    return array('contact'=>array('email'=>'','phone'=>'','address'=>'','hours'=>''),
        'pages'=>array_fill_keys(array_keys(csktm_site_page_roles()),0),'announcementNoticeId'=>0,'reportingEnabled'=>true);
}
function csktm_site_settings_record() {
    wp_cache_delete('cskt_site_settings','options');
    $record=get_option('cskt_site_settings',null);
    if ($record===null) { return array('schema'=>'cskt.site.settings.v1','revision'=>0,'values'=>csktm_site_settings_defaults(),'operations'=>array(),'history'=>array()); }
    if (!is_array($record) || ($record['schema']??'')!=='cskt.site.settings.v1' || !is_array($record['values']??null)) {
        csktm_fail('site_settings_unreadable','The retained site settings are unreadable. Restore the original WordPress options before editing.',409);
    }
    return $record;
}
function csktm_site_menu_selection() {
    $locations=get_nav_menu_locations();
    $out=array();
    foreach (array('primary','footer','utility') as $name) { $out[$name]=(int)($locations[$name]??0); }
    return $out;
}
function csktm_site_selection_sha() {
    return csktm_hash(array('menus'=>csktm_site_menu_selection(),'theme'=>get_stylesheet()));
}
function csktm_site_announcement($id) {
    $post=$id?csktm_site_public_post((int)$id):null;
    if (!$post || $post->post_type!=='cskt_notice' || get_post_meta($post->ID,'_cskt_archive',true)==='1') { return null; }
    $notice=csktm_meta_json($post->ID,'_cskt_notice');
    if (!is_array($notice) || !in_array($notice['type']??'',array('general','meeting','emergency','news'),true)) { return null; }
    try {
        $start=csktm_editor_date($notice['startsAt']??'','Announcement starts');
        $end=csktm_editor_date($notice['endsAt']??'','Announcement ends');
    } catch (Throwable $error) { return null; }
    if ($start && $end && strtotime($start)>=strtotime($end) || $start && strtotime($start)>time() || $end && strtotime($end)<=time()) { return null; }
    return array('id'=>(int)$post->ID,'title'=>$post->post_title,'url'=>get_permalink($post->ID),'summary'=>wp_strip_all_tags($post->post_excerpt),
        'type'=>$notice['type'],'startsAt'=>$start?:null,'endsAt'=>$end?:null);
}
function csktm_site_config() {
    $record=csktm_site_settings_record(); $values=$record['values']; $pages=array();
    foreach (csktm_site_page_roles() as $role=>$label) {
        $post=csktm_site_public_post((int)($values['pages'][$role]??0));
        $pages[$role]=$post && $post->post_type==='page'?array('id'=>(int)$post->ID,'title'=>$post->post_title,'url'=>get_permalink($post->ID)):null;
    }
    return array('schema'=>'cskt.site.public.v1','revision'=>(int)$record['revision'],'siteName'=>get_bloginfo('name'),
        'tagline'=>get_bloginfo('description'),'homeUrl'=>home_url('/'),'contact'=>$values['contact'],'pages'=>$pages,
        'menus'=>csktm_site_menu_selection(),'announcement'=>csktm_site_announcement((int)($values['announcementNoticeId']??0)),
        'reportingEnabled'=>!empty($values['reportingEnabled']));
}
function csktm_site_settings_values($input) {
    if (!is_array($input) || array_diff(array_keys($input),array('contact','pages','announcementNoticeId','reportingEnabled','menus')) ||
        !is_array($input['contact']??null) || !is_array($input['pages']??null) || !is_array($input['menus']??null) ||
        !is_bool($input['reportingEnabled']??null)) { csktm_fail('site_settings','Provide the complete public contact, page, menu and reporting selection.'); }
    $contact=$input['contact'];
    if (array_diff(array_keys($contact),array('email','phone','address','hours')) || array_diff(array('email','phone','address','hours'),array_keys($contact))) { csktm_fail('site_settings','Use only the supported public contact fields.'); }
    $contact=array('email'=>csktm_site_email($contact['email']??'','Public email'),'phone'=>csktm_site_text($contact['phone']??'','Public telephone',100),
        'address'=>csktm_site_text($contact['address']??'','Public address',2000,false,true),'hours'=>csktm_site_text($contact['hours']??'','Public office hours',1000,false,true));
    if (array_diff(array_keys($input['pages']),array_keys(csktm_site_page_roles()))) { csktm_fail('site_pages','Use the supported landing-page roles.'); }
    $pages=array();
    foreach (csktm_site_page_roles() as $key=>$label) {
        $id=$input['pages'][$key]??null;
        if (!is_int($id) || $id<0) { csktm_fail('site_page',$label.' needs a native page ID or zero.'); }
        if ($id) { $page=csktm_site_public_post($id); if (!$page || $page->post_type!=='page') { csktm_fail('site_page',$label.' must select an existing published page without a password.',409); } }
        $pages[$key]=$id;
    }
    if (array_diff(array_keys($input['menus']),array('primary','footer','utility'))) { csktm_fail('site_menus','Use the primary, footer and utility menu locations.'); }
    $menus=array();
    foreach (array('primary','footer','utility') as $key) {
        $id=$input['menus'][$key]??null;
        if (!is_int($id) || $id<0 || $id && !wp_get_nav_menu_object($id)) { csktm_fail('site_menu','Select an existing native menu or none for '.$key.'.'); }
        $menus[$key]=$id;
    }
    $announcement=$input['announcementNoticeId']??null;
    if (!is_int($announcement) || $announcement<0) { csktm_fail('site_announcement','Choose an existing notice or none.'); }
    if ($announcement) {
        $notice=csktm_site_public_post($announcement);
        if (!$notice || $notice->post_type!=='cskt_notice' || get_post_meta($announcement,'_cskt_archive',true)==='1') {
            csktm_fail('site_announcement','The announcement must be an existing published, unprotected and unarchived notice.',409);
        }
        $details=csktm_meta_json($announcement,'_cskt_notice');
        if (!is_array($details) || !in_array($details['type']??'',array('general','meeting','emergency','news'),true)) { csktm_fail('site_announcement','Complete the selected notice details before using it as an announcement.',409); }
        $starts=csktm_editor_date($details['startsAt']??'','Announcement starts'); $ends=csktm_editor_date($details['endsAt']??'','Announcement ends');
        if ($starts && $ends && strtotime($starts)>=strtotime($ends)) { csktm_fail('site_announcement','The selected notice must end after it starts.',409); }
    }
    return array('contact'=>$contact,'pages'=>$pages,'announcementNoticeId'=>$announcement,'reportingEnabled'=>$input['reportingEnabled'],'menus'=>$menus);
}
function csktm_site_settings_save($input) {
    if (!current_user_can('manage_options') || !current_user_can('edit_theme_options')) { csktm_fail('site_settings_access','Site settings require an administrator with menu-editing access.',403); }
    if (!is_array($input) || !csktm_eng_uuid($input['operationId']??null) || !is_int($input['expectedRevision']??null) ||
        !csktm_sha($input['expectedSelectionSha256']??null)) { csktm_fail('site_settings_request','Keep the settings revision, menu selection and original operation ID.'); }
    $request_sha=csktm_eng_digest($input);
    $theme_option='theme_mods_'.get_stylesheet();
    try {
        return csktm_transaction(function() use ($input,$request_sha,$theme_option){
            wp_cache_delete($theme_option,'options'); wp_cache_delete('alloptions','options');
            $record=csktm_site_settings_record();
            $old=$record['operations'][$input['operationId']]??null;
            if ($old) {
                if (!hash_equals($old['requestSha256'],$request_sha)) { csktm_fail('site_settings_operation_conflict','This operation ID already identifies different site settings.',409); }
                return $old['result']+array('replayed'=>true);
            }
            if ($record['revision']!==$input['expectedRevision'] || !hash_equals(csktm_site_selection_sha(),$input['expectedSelectionSha256'])) {
                csktm_fail('site_settings_changed','The settings, active theme or menu selections changed. Reload the current form before saving.',409);
            }
            // Return an accepted original operation before revalidating resources that may later be withdrawn.
            $values=csktm_site_settings_values($input['values']??null);
            $menus=$values['menus']; unset($values['menus']);
            $all_locations=get_nav_menu_locations();
            foreach ($menus as $key=>$id) { $all_locations[$key]=$id; }
            set_theme_mod('nav_menu_locations',$all_locations);
            if (csktm_site_menu_selection()!==$menus) { csktm_fail('site_menu_write','WordPress did not retain the selected native menus.',500); }
            $record['values']=$values; $record['revision']++;
            $event=array('revision'=>$record['revision'],'at'=>csktm_now(),'actor'=>get_current_user_id(),'operationId'=>$input['operationId'],
                'values'=>$values,'menus'=>$menus,'theme'=>get_stylesheet());
            $record['history'][]=$event;
            $result=array('schema'=>'cskt.site.settings.saved.v1','operationId'=>$input['operationId'],'revision'=>$record['revision'],'savedAt'=>$event['at']);
            $record['operations'][$input['operationId']]=array('requestSha256'=>$request_sha,'result'=>$result);
            if (strlen(csktm_json($record))>CSKTM_MAX_MANIFEST) { csktm_fail('site_settings_history_size','The settings history exceeds the supported complete record size. Preserve its WordPress backup before extending it.',413); }
            if (!update_option('cskt_site_settings',$record,false)) {
                wp_cache_delete('cskt_site_settings','options');
                if (get_option('cskt_site_settings')!==$record) { csktm_fail('site_settings_write','WordPress could not retain the complete settings change.',500); }
            }
            return $result+array('replayed'=>false);
        });
    } finally {
        wp_cache_delete('cskt_site_settings','options'); wp_cache_delete($theme_option,'options');
        wp_cache_delete('alloptions','options'); wp_cache_delete('notoptions','options');
    }
}
function csktm_site_settings_inspect() {
    if (!current_user_can('manage_options')) { csktm_fail('site_settings_access','Site settings require an administrator.',403); }
    return array('record'=>csktm_site_settings_record(),'selectionSha256'=>csktm_site_selection_sha(),'menus'=>csktm_site_menu_selection(),'theme'=>get_stylesheet(),'public'=>csktm_site_config());
}
add_action('rest_api_init',function(){
    register_rest_route(CSKTM_SITE_NS,'/settings',array(
        array('methods'=>'GET','permission_callback'=>function(){return current_user_can('manage_options');},'callback'=>csktm_site_rest(function(){return csktm_site_settings_inspect();},true)),
        array('methods'=>'POST','permission_callback'=>function(){return current_user_can('manage_options')&&current_user_can('edit_theme_options');},'callback'=>csktm_site_rest(function($r){return csktm_site_settings_save($r->get_json_params());},true)),
    ));
});
function csktm_site_settings_page() {
    if (!current_user_can('manage_options')) { return; }
    $state=csktm_site_settings_inspect(); $record=$state['record']; $values=$record['values'];
    echo '<div class="wrap cskt-site-settings"><h1>Public site settings</h1>';
    if (($_GET['saved']??'')==='1') { echo '<div class="notice notice-success"><p>The public settings and native menu selections were saved.</p></div>'; }
    echo '<p>Edit the public contact details and select existing published pages for landing-page introductions. Site name, tagline and the native home-page setting remain available under <a href="'.esc_url(admin_url('options-general.php')).'">General</a> and <a href="'.esc_url(admin_url('options-reading.php')).'">Reading</a>. Menu items remain editable under <a href="'.esc_url(admin_url('nav-menus.php')).'">Menus</a>.</p>';
    echo '<form action="'.esc_url(admin_url('admin-post.php')).'" method="post"><input type="hidden" name="action" value="cskt_site_settings">';
    wp_nonce_field('cskt_site_settings');
    echo '<input type="hidden" name="operationId" value="'.esc_attr(wp_generate_uuid4()).'"><input type="hidden" name="expectedRevision" value="'.(int)$record['revision'].'"><input type="hidden" name="expectedSelectionSha256" value="'.esc_attr($state['selectionSha256']).'">';
    echo '<h2>Public contact details</h2>';
    foreach (array('email'=>array('Email','email'),'phone'=>array('Telephone','text'),'address'=>array('Address','textarea'),'hours'=>array('Office hours','textarea')) as $key=>$field) {
        csktm_editor_field('cskt-site-contact-'.$key,$field[0],'contact['.$key.']',$values['contact'][$key],array('type'=>$field[1]));
    }
    echo '<h2>Landing pages</h2><p>Only existing published, unprotected pages can be selected. No pages or content are created by this form.</p><table class="form-table" role="presentation"><tbody>';
    $pages=get_posts(array('post_type'=>'page','post_status'=>'publish','has_password'=>false,'posts_per_page'=>-1,'orderby'=>'title','order'=>'ASC'));
    foreach (csktm_site_page_roles() as $key=>$label) {
        echo '<tr><th scope="row"><label for="cskt-site-page-'.esc_attr($key).'">'.esc_html($label).'</label></th><td><select id="cskt-site-page-'.esc_attr($key).'" name="pages['.esc_attr($key).']"><option value="0">No selection</option>';
        foreach ($pages as $page) { echo '<option value="'.(int)$page->ID.'" '.selected((int)$values['pages'][$key],(int)$page->ID,false).'>'.esc_html($page->post_title).' (#'.(int)$page->ID.')</option>'; }
        echo '</select></td></tr>';
    }
    echo '</tbody></table><h2>Announcement notice</h2><p>Select one existing published notice for the site banner. Its original start/end times and archive state determine when it is shown; the complete notice remains unchanged.</p><label for="cskt-site-announcement">Notice</label> <select id="cskt-site-announcement" name="announcementNoticeId"><option value="0">No announcement</option>';
    $notices=get_posts(array('post_type'=>'cskt_notice','post_status'=>'publish','has_password'=>false,'posts_per_page'=>-1,'orderby'=>'title','order'=>'ASC',
        'meta_query'=>array('relation'=>'OR',array('key'=>'_cskt_archive','compare'=>'NOT EXISTS'),array('key'=>'_cskt_archive','value'=>'1','compare'=>'!='))));
    foreach ($notices as $notice) { echo '<option value="'.(int)$notice->ID.'" '.selected((int)($values['announcementNoticeId']??0),(int)$notice->ID,false).'>'.esc_html($notice->post_title).' (#'.(int)$notice->ID.')</option>'; }
    echo '</select><h2>Navigation menus</h2><table class="form-table" role="presentation"><tbody>';
    $menus=wp_get_nav_menus();
    foreach (array('primary'=>'Primary','footer'=>'Footer','utility'=>'Utility') as $key=>$label) {
        echo '<tr><th scope="row"><label for="cskt-site-menu-'.esc_attr($key).'">'.esc_html($label).'</label></th><td><select id="cskt-site-menu-'.esc_attr($key).'" name="menus['.esc_attr($key).']"><option value="0">No menu selected</option>';
        foreach ($menus as $menu) { echo '<option value="'.(int)$menu->term_id.'" '.selected($state['menus'][$key],(int)$menu->term_id,false).'>'.esc_html($menu->name).'</option>'; }
        echo '</select></td></tr>';
    }
    echo '</tbody></table><h2>Site reporting</h2><p><label><input type="checkbox" name="reportingEnabled" value="1" '.checked(!empty($values['reportingEnabled']),true,false).'> Record aggregate page views, search outcomes and download-link clicks on this WordPress site</label></p><p>No visitor identifiers, raw search text, IP addresses or third-party analytics are retained. Staff page loads are excluded. Reports describe observed browser events rather than unique people or completed downloads.</p><input type="hidden" name="complete" value="1">';
    submit_button('Save public site settings'); echo '</form>';
    if ($record['history']) {
        echo '<h2>Recent settings history</h2><table class="widefat striped"><thead><tr><th>Revision</th><th>Saved at (UTC)</th><th>WordPress user</th><th>Original operation</th></tr></thead><tbody>';
        foreach (array_slice(array_reverse($record['history']),0,20) as $event) { echo '<tr><td>'.(int)$event['revision'].'</td><td>'.esc_html($event['at']).'</td><td>#'.(int)$event['actor'].'</td><td><code>'.esc_html($event['operationId']).'</code></td></tr>'; }
        echo '</tbody></table><p>The complete history remains in the native settings record and WordPress database backup.</p>';
    }
    echo '</div>';
}
add_action('admin_menu',function(){add_options_page('Public site settings','Public site settings','manage_options','cskt-site-settings','csktm_site_settings_page');});
add_action('admin_post_cskt_site_settings',function(){
    if (!current_user_can('manage_options')) { wp_die('Site settings require an administrator.','Site settings',array('response'=>403)); }
    check_admin_referer('cskt_site_settings');
    try {
        if (($_POST['complete']??'')!=='1') { csktm_fail('site_settings_incomplete','The complete settings form did not reach WordPress.'); }
        $raw=wp_unslash($_POST); $pages=array(); $menus=array();
        foreach (array('pages'=>csktm_site_page_roles(),'menus'=>array('primary'=>'','footer'=>'','utility'=>'')) as $field=>$keys) {
            foreach ($keys as $key=>$label) {
                $value=$raw[$field][$key]??null;
                if (!is_string($value) || !ctype_digit($value)) { csktm_fail('site_settings_selection','Retain every native page and menu selection.'); }
                if ($field==='pages') { $pages[$key]=(int)$value; } else { $menus[$key]=(int)$value; }
            }
        }
        $announcement=$raw['announcementNoticeId']??null;
        if (!is_string($announcement) || !ctype_digit($announcement)) { csktm_fail('site_announcement','Retain the selected notice ID or zero.'); }
        $revision=$raw['expectedRevision']??null;
        if (!is_string($revision) || !ctype_digit($revision)) { csktm_fail('site_settings_revision','Retain the original settings revision.'); }
        csktm_site_settings_save(array('operationId'=>$raw['operationId']??null,'expectedRevision'=>(int)$revision,'expectedSelectionSha256'=>$raw['expectedSelectionSha256']??null,
            'values'=>array('contact'=>$raw['contact']??null,'pages'=>$pages,'menus'=>$menus,'announcementNoticeId'=>(int)$announcement,'reportingEnabled'=>($raw['reportingEnabled']??'')==='1')));
        wp_safe_redirect(add_query_arg('saved','1',admin_url('options-general.php?page=cskt-site-settings'))); exit;
    } catch (Throwable $error) {
        wp_die(esc_html('The site settings were not saved. '.$error->getMessage()),'Site settings',array('response'=>$error instanceof CSKTM_Problem?$error->status:500,'back_link'=>true));
    }
});
