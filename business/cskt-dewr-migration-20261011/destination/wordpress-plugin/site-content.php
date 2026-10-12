<?php
/**
 * Native public staff, opportunities and theme-facing site contracts.
 * The migration and engagement records remain owned by their original modules.
 */
if (!defined('ABSPATH')) { exit; }
define('CSKTM_SITE_VERSION', '1.0.0');
define('CSKTM_SITE_NS', 'cskt-site/v1');

function csktm_site_types() {
    foreach (array('cskt_staff'=>array('Staff','Staff member','staff','dashicons-groups'),
                   'cskt_opportunity'=>array('Opportunities','Opportunity','opportunities','dashicons-clipboard')) as $type=>$label) {
        register_post_type($type,array(
            'labels'=>array('name'=>$label[0],'singular_name'=>$label[1],'add_new_item'=>'Add '.$label[1],'edit_item'=>'Edit '.$label[1]),
            'public'=>true,'show_in_rest'=>true,'has_archive'=>$label[2],
            'rewrite'=>array('slug'=>$label[2],'with_front'=>false),
            'capability_type'=>'page','map_meta_cap'=>true,'menu_icon'=>$label[3],
            'supports'=>array('title','editor','excerpt','thumbnail','author','revisions','custom-fields','page-attributes'),
            'taxonomies'=>array('cskt_department','cskt_topic'),
        ));
        $key=$type==='cskt_staff'?'_cskt_staff':'_cskt_opportunity';
        foreach (array($key,'_cskt_archive') as $meta) {
            register_post_meta($type,$meta,array('type'=>'string','single'=>true,'show_in_rest'=>true,
                'revisions_enabled'=>true,
                'auth_callback'=>function($allowed,$key,$id){return current_user_can('edit_post',$id);}));
        }
        register_taxonomy_for_object_type('cskt_topic',$type);
    }
    register_taxonomy('cskt_department',array('cskt_staff','cskt_opportunity'),array(
        'label'=>'Departments','public'=>true,'hierarchical'=>true,'show_in_rest'=>true,
        'rewrite'=>array('slug'=>'departments'),'capabilities'=>array('manage_terms'=>'manage_categories','edit_terms'=>'manage_categories','delete_terms'=>'manage_categories','assign_terms'=>'edit_pages')));
}
add_action('init','csktm_site_types',20);
add_action('admin_init',function(){
    if (current_user_can('manage_options') && get_option('cskt_site_rewrite_version')!==CSKTM_SITE_VERSION) {
        flush_rewrite_rules(false);
        update_option('cskt_site_rewrite_version',CSKTM_SITE_VERSION,false);
    }
});
function csktm_site_public_types() { return array('page','post','cskt_project','cskt_document','cskt_notice','cskt_staff','cskt_opportunity'); }
function csktm_site_public_post($value) {
    $post=get_post($value);
    return $post && in_array($post->post_type,csktm_site_public_types(),true)
        && $post->post_status==='publish' && $post->post_password==='' && is_post_publicly_viewable($post)?$post:null;
}
function csktm_site_text($value,$label,$max=500,$required=false,$paragraph=false) {
    if (!is_string($value) || strlen($value)>$max || str_contains($value,"\0") || ($required && trim($value)==='')) {
        csktm_fail('site_field',$label.' requires '.($required?'nonempty ':'').'text of at most '.$max.' bytes.');
    }
    return $paragraph?sanitize_textarea_field($value):sanitize_text_field($value);
}
function csktm_site_url($value,$label) {
    if (!is_string($value) || strlen($value)>4000) { csktm_fail('site_url',$label.' requires a URL of at most 4000 bytes.'); }
    if ($value==='') { return ''; }
    // Validate, then retain the original encoded URL. Text sanitizers can remove %xx query bytes.
    $parts=wp_parse_url($value);
    if (!is_array($parts) || !in_array(strtolower($parts['scheme']??''),array('https','http'),true)
        || empty($parts['host']) || isset($parts['user']) || isset($parts['pass'])
        || preg_match('/[\x00-\x20\x7f]/',$value) || esc_url_raw($value,array('http','https'))==='') {
        csktm_fail('site_url',$label.' needs a complete HTTP or HTTPS URL without embedded credentials.');
    }
    return $value;
}
function csktm_site_email($value,$label) {
    $value=csktm_site_text($value,$label,254);
    if ($value!=='' && (!is_email($value) || preg_match('/[\r\n]/',$value))) { csktm_fail('site_email',$label.' needs one complete email address.'); }
    return $value;
}
function csktm_site_date($value,$label) {
    if ($value===null || $value==='') { return null; }
    if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/D',$value)) {
        csktm_fail('site_date',$label.' needs a complete UTC date and time, for example 2026-01-02T15:00:00Z.');
    }
    $date=DateTimeImmutable::createFromFormat('!Y-m-d\TH:i:s\Z',$value,new DateTimeZone('UTC'));
    $errors=DateTimeImmutable::getLastErrors();
    if (!$date || ($errors && ($errors['warning_count'] || $errors['error_count'])) || $date->format('Y-m-d\TH:i:s\Z')!==$value) {
        csktm_fail('site_date',$label.' is not a valid calendar date and time.');
    }
    return $value;
}
function csktm_site_defaults($type) {
    if ($type==='cskt_staff') { return array('roleTitle'=>'','email'=>'','phone'=>'','office'=>'','hours'=>'','profileUrl'=>''); }
    if ($type==='cskt_opportunity') {
        return array('kind'=>'career','reference'=>'','location'=>'','opensAt'=>null,'closesAt'=>null,'state'=>'open',
            'applyUrl'=>'','contactEmail'=>'','contactPhone'=>'','attachmentIds'=>array());
    }
    csktm_fail('site_type','Choose a native staff member or opportunity.');
}
function csktm_site_values($type,$input,$post_id=0,$check_access=false) {
    $defaults=csktm_site_defaults($type);
    if (!is_array($input) || array_is_list($input) || array_diff(array_keys($input),array_keys($defaults)) || array_diff(array_keys($defaults),array_keys($input))) {
        csktm_fail('site_details','Use only the supported complete staff or opportunity fields.');
    }
    $input=array_merge($defaults,$input);
    if ($type==='cskt_staff') {
        return array('roleTitle'=>csktm_site_text($input['roleTitle'],'Role or job title'),
            'email'=>csktm_site_email($input['email'],'Public email'),
            'phone'=>csktm_site_text($input['phone'],'Public telephone',100),
            'office'=>csktm_site_text($input['office'],'Office',1000,false,true),
            'hours'=>csktm_site_text($input['hours'],'Office hours',1000,false,true),
            'profileUrl'=>csktm_site_url($input['profileUrl'],'Related profile URL'));
    }
    if (!in_array($input['kind'],array('career','procurement'),true) ||
        !in_array($input['state'],array('open','closed','awarded','cancelled','archived'),true)) {
        csktm_fail('site_opportunity_state','Choose a career or procurement opportunity and a supported publication state.');
    }
    $opens=csktm_site_date($input['opensAt'],'Opening time');
    $closes=csktm_site_date($input['closesAt'],'Closing time');
    if ($opens && $closes && strcmp($opens,$closes)>=0) { csktm_fail('site_opportunity_dates','The closing time must be later than the opening time.'); }
    if (!is_array($input['attachmentIds']) || !array_is_list($input['attachmentIds']) || count($input['attachmentIds'])>40) {
        csktm_fail('site_attachments','Select at most forty native media-library files.');
    }
    $ids=array();
    foreach ($input['attachmentIds'] as $id) {
        if (!is_int($id) || $id<1 || in_array($id,$ids,true)) { csktm_fail('site_attachments','Each selected file needs a distinct native attachment ID.'); }
        if ($check_access) {
            $attachment=get_post($id);
            if (!$attachment || $attachment->post_type!=='attachment' || in_array($attachment->post_status,array('trash','private'),true) || $attachment->post_password!=='') {
                csktm_fail('site_attachment_missing','One selected native file is missing or private.',409,array('attachmentId'=>$id));
            }
            if (!current_user_can('read_post',$id)) { csktm_fail('site_attachment_access','Your account cannot read one selected file.',403); }
        }
        $ids[]=$id;
    }
    return array('kind'=>$input['kind'],'reference'=>csktm_site_text($input['reference'],'Reference number',200),
        'location'=>csktm_site_text($input['location'],'Location',1000),
        'opensAt'=>$opens,'closesAt'=>$closes,'state'=>$input['state'],
        'applyUrl'=>csktm_site_url($input['applyUrl'],'Application or bid URL'),
        'contactEmail'=>csktm_site_email($input['contactEmail'],'Public contact email'),
        'contactPhone'=>csktm_site_text($input['contactPhone'],'Public contact telephone',100),'attachmentIds'=>$ids);
}
function csktm_site_details($post_id) {
    $type=get_post_type($post_id); $key=$type==='cskt_staff'?'_cskt_staff':'_cskt_opportunity';
    $raw=get_post_meta($post_id,$key,true);
    if ($raw==='') { return csktm_site_defaults($type); }
    $data=is_string($raw)?json_decode($raw,true):null;
    if (!is_array($data)) { csktm_fail('site_details_unreadable','The retained content details cannot be decoded. Restore a native revision before editing these fields.',409); }
    return csktm_site_values($type,$data,$post_id,false);
}
function csktm_site_details_fingerprint($post_id) {
    return csktm_hash(array('details'=>csktm_site_details($post_id),'archive'=>get_post_meta($post_id,'_cskt_archive',true)==='1'));
}
function csktm_site_meta_write($post_id,$key,$value) {
    if (get_post_meta($post_id,$key,true)!==$value && !update_post_meta($post_id,$key,wp_slash($value))) {
        csktm_fail('site_details_write','WordPress could not retain '.$key.'.',500);
    }
}
function csktm_site_index($post_id) {
    if (get_post_type($post_id)!=='cskt_opportunity' || wp_is_post_revision($post_id)) { return; }
    $data=csktm_site_details($post_id);
    foreach (array('_cskt_site_kind'=>$data['kind'],'_cskt_site_state'=>$data['state'],
        '_cskt_site_opens'=>$data['opensAt']?(string)strtotime($data['opensAt']):'0',
        '_cskt_site_closes'=>$data['closesAt']?(string)strtotime($data['closesAt']):'0') as $key=>$value) {
        csktm_site_meta_write($post_id,$key,$value);
    }
}
add_action('save_post_cskt_opportunity',function($id,$post){
    if (!wp_is_post_revision($id) && !wp_is_post_autosave($id)) { csktm_site_index($id); }
},40,2);
foreach (array('added_post_meta','updated_post_meta','deleted_post_meta') as $hook) {
    add_action($hook,function($meta_id,$post_id,$key){
        if ($key==='_cskt_opportunity' && get_post_type($post_id)==='cskt_opportunity' && !wp_is_post_revision($post_id)) {
            csktm_site_index($post_id);
        }
    },20,3);
}
foreach (array('cskt_staff','cskt_opportunity') as $site_type) {
    add_filter('rest_pre_insert_'.$site_type,function($prepared,$request) use ($site_type) {
        try {
            $meta=$request->get_param('meta');
            if (!is_array($meta)) { return $prepared; }
            $key=$site_type==='cskt_staff'?'_cskt_staff':'_cskt_opportunity';
            if (array_key_exists($key,$meta)) {
                if (!is_string($meta[$key])) { csktm_fail('site_details','Retain the native details as a complete JSON string.'); }
                $data=json_decode($meta[$key],true);
                $data=csktm_site_values($site_type,$data,(int)($request['id']??0),true);
                $meta[$key]=csktm_json($data);
                if ($site_type==='cskt_opportunity') { $meta['_cskt_archive']=$data['state']==='archived'?'1':'0'; }
            }
            if (array_key_exists('_cskt_archive',$meta) && !in_array($meta['_cskt_archive'],array('0','1',''),true)) {
                csktm_fail('site_archive','Use the native archive flag 0 or 1.');
            }
            $request->set_param('meta',$meta);
            return $prepared;
        } catch (Throwable $error) {
            return new WP_Error($error instanceof CSKTM_Problem?$error->slug:'site_details_error',$error->getMessage(),
                array('status'=>$error instanceof CSKTM_Problem?$error->status:500));
        }
    },10,2);
    add_action('rest_after_insert_'.$site_type,function($post){
        if ($post->post_type==='cskt_opportunity') { csktm_site_index($post->ID); }
    },20,1);
}
function csktm_site_effective_state($data,$archived=false,$now=null) {
    if ($archived || $data['state']==='archived') { return 'archived'; }
    if ($data['state']!=='open') { return $data['state']; }
    $now=$now===null?time():(int)$now;
    if ($data['closesAt'] && strtotime($data['closesAt'])<=$now) { return 'closed'; }
    if ($data['opensAt'] && strtotime($data['opensAt'])>$now) { return 'scheduled'; }
    return 'open';
}
function csktm_site_query_args(array $args,array $filters=array()) {
    $tax=array(); $meta=array();
    if (isset($filters['departmentId']) && (int)$filters['departmentId']>0) {
        $tax[]=array('taxonomy'=>'cskt_department','field'=>'term_id','terms'=>array((int)$filters['departmentId']));
    }
    $kind=$filters['opportunityKind']??'all';
    if (!in_array($kind,array('all','career','procurement'),true)) { csktm_fail('site_filter','Choose all, career or procurement.'); }
    if ($kind!=='all') { $meta[]=array('key'=>'_cskt_site_kind','value'=>$kind); }
    $state=$filters['opportunityState']??'all';
    if (!in_array($state,array('all','scheduled','open','closed','awarded','cancelled','archived'),true)) { csktm_fail('site_filter','Choose a supported opportunity state.'); }
    $archive=array('key'=>'_cskt_archive','value'=>'1');
    $not_archive=array('relation'=>'OR',array('key'=>'_cskt_archive','compare'=>'NOT EXISTS'),array('key'=>'_cskt_archive','value'=>'1','compare'=>'!='));
    $open=array('key'=>'_cskt_site_state','value'=>'open');
    $now=time();
    $unclosed=array('relation'=>'OR',array('key'=>'_cskt_site_closes','value'=>0,'compare'=>'=','type'=>'NUMERIC'),array('key'=>'_cskt_site_closes','value'=>$now,'compare'=>'>','type'=>'NUMERIC'));
    if ($state==='archived') {
        $meta[]=array('relation'=>'OR',$archive,array('key'=>'_cskt_site_state','value'=>'archived'));
    } elseif ($state!=='all') {
        $meta[]=$not_archive;
        if ($state==='open') {
            $meta[]=array('relation'=>'AND',$open,$unclosed,array('key'=>'_cskt_site_opens','value'=>$now,'compare'=>'<=','type'=>'NUMERIC'));
        } elseif ($state==='scheduled') {
            $meta[]=array('relation'=>'AND',$open,$unclosed,array('key'=>'_cskt_site_opens','value'=>$now,'compare'=>'>','type'=>'NUMERIC'));
        } elseif ($state==='closed') {
            $meta[]=array('relation'=>'OR',array('key'=>'_cskt_site_state','value'=>'closed'),
                array('relation'=>'AND',$open,array('key'=>'_cskt_site_closes','value'=>0,'compare'=>'>','type'=>'NUMERIC'),
                    array('key'=>'_cskt_site_closes','value'=>$now,'compare'=>'<=','type'=>'NUMERIC')));
        } else { $meta[]=array('key'=>'_cskt_site_state','value'=>$state); }
    }
    foreach (array('tax_query'=>$tax,'meta_query'=>$meta) as $key=>$clauses) {
        if (!$clauses) { continue; }
        $joined=array('relation'=>'AND');
        if (!empty($args[$key])) { $joined[]=$args[$key]; }
        foreach ($clauses as $clause) { $joined[]=$clause; }
        $args[$key]=$joined;
    }
    return $args;
}
function csktm_site_terms($post_id,$taxonomy) {
    $terms=wp_get_post_terms($post_id,$taxonomy);
    if (is_wp_error($terms)) { return array(); }
    $items=array();
    foreach ($terms as $term) {
        $url=get_term_link($term);
        $items[]=array('id'=>(int)$term->term_id,'name'=>$term->name,'slug'=>$term->slug,'url'=>is_wp_error($url)?null:$url);
    }
    return $items;
}
function csktm_site_attachment($id,$owner_id) {
    if (!csktm_site_public_post($owner_id)) { return null; }
    $post=get_post($id);
    if (!$post || $post->post_type!=='attachment' || $post->post_password!=='' || !in_array($post->post_status,array('inherit','publish'),true)) { return null; }
    if ($post->post_parent && !csktm_site_public_post($post->post_parent)) { return null; }
    $url=wp_get_attachment_url($post->ID);
    if (!is_string($url) || $url==='' || !in_array(strtolower((string)wp_parse_url($url,PHP_URL_SCHEME)),array('https','http'),true)) { return null; }
    $path=get_attached_file($post->ID);
    $metadata=wp_get_attachment_metadata($post->ID);
    $bytes=is_string($path)&&is_file($path)?filesize($path):(is_array($metadata)&&isset($metadata['filesize'])?(int)$metadata['filesize']:null);
    return array('id'=>(int)$post->ID,'title'=>$post->post_title,'url'=>$url,'downloadName'=>wp_basename(wp_parse_url($url,PHP_URL_PATH)?:''),
        'mimeType'=>(string)get_post_mime_type($post),'bytes'=>$bytes===false?null:$bytes,'altText'=>(string)get_post_meta($post->ID,'_wp_attachment_image_alt',true));
}
function csktm_site_entry($post_or_id) {
    $post=csktm_site_public_post($post_or_id);
    if (!$post) { return null; }
    $id=(int)$post->ID; $thumbnail=null;
    $image_id=(int)get_post_thumbnail_id($id);
    if ($image_id && csktm_site_attachment($image_id,$id)) {
        $image=wp_get_attachment_image_src($image_id,'large');
        if ($image) { $thumbnail=array('id'=>$image_id,'url'=>$image[0],'alt'=>(string)get_post_meta($image_id,'_wp_attachment_image_alt',true),'width'=>(int)$image[1],'height'=>(int)$image[2]); }
    }
    $entry=array('id'=>$id,'type'=>$post->post_type,'title'=>$post->post_title,'url'=>get_permalink($id),
        'summary'=>wp_strip_all_tags($post->post_excerpt),'contentHtml'=>wp_kses_post($post->post_content),
        'modifiedAt'=>get_post_modified_time('c',true,$post),'thumbnail'=>$thumbnail,
        'departments'=>in_array($post->post_type,array('cskt_staff','cskt_opportunity'),true)?csktm_site_terms($id,'cskt_department'):array(),
        'topics'=>csktm_site_terms($id,'cskt_topic'),'archived'=>get_post_meta($id,'_cskt_archive',true)==='1');
    if (in_array($post->post_type,array('cskt_staff','cskt_opportunity'),true)) {
        try { $data=csktm_site_details($id); } catch (Throwable $error) { return null; }
        if ($post->post_type==='cskt_staff') { $entry['staff']=$data; }
        else {
            $state=csktm_site_effective_state($data,$entry['archived']);
            $attachments=array();
            foreach ($data['attachmentIds'] as $attachment_id) {
                $attachment=csktm_site_attachment($attachment_id,$id);
                if ($attachment) { $attachments[]=$attachment; }
            }
            unset($data['attachmentIds']);
            $entry['archived']=$state==='archived';
            $entry['opportunity']=$data+array('effectiveState'=>$state,'isCurrent'=>$state==='open','attachments'=>$attachments);
        }
    }
    return $entry;
}
function csktm_site_panel($entry) {
    if (!$entry || !isset($entry['staff']) && !isset($entry['opportunity'])) { return ''; }
    $out='<section class="cskt-site-details" aria-label="'.esc_attr(isset($entry['staff'])?'Staff contact details':'Opportunity details').'">';
    if (isset($entry['staff'])) {
        $data=$entry['staff']; $out.='<h2>Contact details</h2><dl>';
        foreach (array('roleTitle'=>'Role','office'=>'Office','hours'=>'Office hours') as $key=>$label) {
            if ($data[$key]!=='') { $out.='<dt>'.esc_html($label).'</dt><dd>'.nl2br(esc_html($data[$key])).'</dd>'; }
        }
        $email=$data['email']; $phone=$data['phone']; $external=$data['profileUrl'];
        if ($email!=='') { $out.='<dt>Email</dt><dd><a href="'.esc_url('mailto:'.$email).'">'.esc_html($email).'</a></dd>'; }
        if ($phone!=='') { $out.='<dt>Telephone</dt><dd>'.esc_html($phone).'</dd>'; }
        $out.='</dl>';
        if ($external!=='') { $out.='<p><a href="'.esc_url($external).'">Related staff profile</a></p>'; }
    } else {
        $data=$entry['opportunity']; $out.='<h2>Opportunity details</h2><dl>';
        foreach (array('kind'=>'Type','reference'=>'Reference','location'=>'Location','effectiveState'=>'Status') as $key=>$label) {
            if ($data[$key]!=='') { $out.='<dt>'.esc_html($label).'</dt><dd>'.esc_html(in_array($key,array('kind','effectiveState'),true)?ucfirst($data[$key]):$data[$key]).'</dd>'; }
        }
        foreach (array('opensAt'=>'Opens','closesAt'=>'Closes') as $key=>$label) {
            if ($data[$key]) { $out.='<dt>'.esc_html($label).'</dt><dd><time datetime="'.esc_attr($data[$key]).'">'.esc_html(wp_date('F j, Y, g:i a T',strtotime($data[$key]))).'</time></dd>'; }
        }
        if ($data['contactEmail']!=='') { $out.='<dt>Email</dt><dd><a href="'.esc_url('mailto:'.$data['contactEmail']).'">'.esc_html($data['contactEmail']).'</a></dd>'; }
        if ($data['contactPhone']!=='') { $out.='<dt>Telephone</dt><dd>'.esc_html($data['contactPhone']).'</dd>'; }
        $out.='</dl>';
        if ($data['applyUrl']!=='' && $data['isCurrent']) { $out.='<p><a class="cskt-site-apply" href="'.esc_url($data['applyUrl']).'">'.esc_html($data['kind']==='career'?'Application information':'Bid and procurement information').'</a></p>'; }
        if (!$data['isCurrent']) { $out.='<p>This opportunity is '.esc_html($data['effectiveState']).'. Refer to the published details for its current disposition.</p>'; }
        if ($data['attachments']) {
            $out.='<h3>Related files</h3><ul class="cskt-site-files">';
            foreach ($data['attachments'] as $file) {
                $out.='<li><a href="'.esc_url($file['url']).'" download="'.esc_attr($file['downloadName']).'" '.csktm_site_download_attributes($entry['id'],$file['id']).'>'.esc_html($file['title']?:$file['downloadName']).'</a>';
                $out.=' <span>'.esc_html($file['mimeType']).($file['bytes']!==null?' · '.esc_html(size_format($file['bytes'],1)):'').'</span></li>';
            }
            $out.='</ul>';
        }
    }
    return $out.'</section>';
}
add_filter('the_content',function($content){
    if (!is_singular(array('cskt_staff','cskt_opportunity')) || !in_the_loop() || !is_main_query()) { return $content; }
    return $content.csktm_site_panel(csktm_site_entry(get_the_ID()));
},25);
function csktm_site_rest($callback,$private=false,$max=65536) {
    return function($request) use ($callback,$private,$max) {
        try {
            if (strlen($request->get_body())>$max) { csktm_fail('site_request_size','The complete request is too large.',413); }
            $response=rest_ensure_response($callback($request));
            $response->header('Cache-Control',$private?'no-store, private':'no-cache');
            return $response;
        } catch (Throwable $error) {
            return new WP_Error($error instanceof CSKTM_Problem?$error->slug:'site_error',
                $private || $error instanceof CSKTM_Problem?$error->getMessage():'The site could not complete this request.',
                array('status'=>$error instanceof CSKTM_Problem?$error->status:500));
        }
    };
}
function csktm_site_list($type,$request) {
    $page=max(1,(int)($request['page']??1)); $per=max(1,min(100,(int)($request['perPage']??20)));
    $search=csktm_site_text((string)($request['search']??''),'Search',200);
    $filters=array('departmentId'=>max(0,(int)($request['departmentId']??0)));
    if ($type==='cskt_opportunity') {
        $filters['opportunityState']=(string)($request['opportunityState']??'open');
        $filters['opportunityKind']=(string)($request['opportunityKind']??'all');
    }
    $args=array('post_type'=>$type,'post_status'=>'publish','has_password'=>false,'posts_per_page'=>$per,
        'paged'=>$page,'s'=>$search,'orderby'=>array('menu_order'=>'ASC','title'=>'ASC','ID'=>'ASC'));
    $archive=(string)($request['archive']??'current');
    if (!in_array($archive,array('all','current','archived'),true)) { csktm_fail('site_archive_filter','Choose current, archived or all content.'); }
    if (($filters['opportunityState']??'')==='archived') { $archive='all'; }
    if ($archive!=='all') {
        $args['meta_query']=$archive==='archived'?array(array('key'=>'_cskt_archive','value'=>'1')):
            array('relation'=>'OR',array('key'=>'_cskt_archive','compare'=>'NOT EXISTS'),array('key'=>'_cskt_archive','value'=>'1','compare'=>'!='));
    }
    $query=new WP_Query(csktm_site_query_args($args,$filters));
    $items=array();
    foreach ($query->posts as $post) { $entry=csktm_site_entry($post); if ($entry) { $items[]=$entry; } }
    return array('schema'=>'cskt.site.collection.v1','items'=>$items,'page'=>$page,'perPage'=>$per,
        'total'=>(int)$query->found_posts,'totalPages'=>(int)$query->max_num_pages,
        'next'=>$page<$query->max_num_pages?$page+1:null,'evaluatedAt'=>csktm_now());
}
add_action('rest_api_init',function(){
    foreach (array('/config'=>function(){return csktm_site_config();},
        '/staff'=>function($r){return csktm_site_list('cskt_staff',$r);},
        '/opportunities'=>function($r){return csktm_site_list('cskt_opportunity',$r);},
        '/entries/(?P<id>\d+)'=>function($r){$entry=csktm_site_entry((int)$r['id']);if(!$entry)csktm_fail('site_entry_missing','This published resource is not available.',404);return $entry;}) as $route=>$callback) {
        register_rest_route(CSKTM_SITE_NS,$route,array('methods'=>'GET','permission_callback'=>'__return_true','callback'=>csktm_site_rest($callback)));
    }
});
require_once __DIR__.'/site-admin.php';
require_once __DIR__.'/site-reporting.php';
