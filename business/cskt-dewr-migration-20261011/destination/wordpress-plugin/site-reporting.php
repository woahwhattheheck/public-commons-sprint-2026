<?php
/**
 * First-party aggregate site reporting. No raw queries, URLs, visitor IDs, IPs,
 * user agents, referrers or engagement submission contents enter these records.
 */
if (!defined('ABSPATH')) { exit; }

function csktm_site_metrics_enabled() { return !empty(csktm_site_settings_record()['values']['reportingEnabled']); }
function csktm_site_origin($url) {
    $parts=wp_parse_url($url);
    if (!is_array($parts) || empty($parts['scheme']) || empty($parts['host'])) { return ''; }
    $scheme=strtolower($parts['scheme']); $port=$parts['port']??($scheme==='https'?443:80);
    return $scheme.'://'.strtolower($parts['host']).':'.$port;
}
function csktm_site_download_target($post_id,$attachment_id=0) {
    $post=csktm_site_public_post($post_id);
    if (!$post) { return null; }
    $selected=array();
    $document=csktm_meta_json($post->ID,'_cskt_document');
    if (is_array($document) && !empty($document['attachmentId'])) { $selected[]=(int)$document['attachmentId']; }
    if ($post->post_type==='cskt_opportunity') {
        try { $selected=array_merge($selected,csktm_site_details($post->ID)['attachmentIds']); } catch (Throwable $error) { return null; }
    }
    $selected=array_values(array_unique($selected));
    if (!$attachment_id && count($selected)===1) { $attachment_id=$selected[0]; }
    if (!in_array((int)$attachment_id,$selected,true)) { return null; }
    $file=csktm_site_attachment((int)$attachment_id,$post->ID);
    return $file?array('postId'=>(int)$post->ID,'file'=>$file):null;
}
function csktm_site_metric_descriptor($kind,$target_id=0,$attachment_id=0,$scope='',$bucket='') {
    return array('kind'=>$kind,'targetId'=>(int)$target_id,'attachmentId'=>(int)$attachment_id,'scope'=>$scope,'bucket'=>$bucket,
        'window'=>(int)floor(time()/(12*HOUR_IN_SECONDS)));
}
function csktm_site_metric_token($descriptor) {
    return hash_hmac('sha256',csktm_eng_digest($descriptor),wp_salt('auth'));
}
function csktm_site_metric_envelope($descriptor) {
    return array('descriptor'=>$descriptor,'token'=>csktm_site_metric_token($descriptor));
}
function csktm_site_download_attributes($target_id,$attachment_id=0) {
    if (!csktm_site_metrics_enabled()) { return ''; }
    $target=csktm_site_download_target((int)$target_id,(int)$attachment_id);
    if (!$target) { return ''; }
    $descriptor=csktm_site_metric_descriptor('download',$target['postId'],$target['file']['id']);
    return 'data-cskt-site-event="'.esc_attr(csktm_json(csktm_site_metric_envelope($descriptor))).'"';
}
function csktm_site_metric_validate($descriptor) {
    if (!is_array($descriptor) || (array_diff(array_keys($descriptor),array('kind','targetId','attachmentId','scope','bucket','window')) || array_diff(array('kind','targetId','attachmentId','scope','bucket','window'),array_keys($descriptor)))
        || !is_int($descriptor['targetId']) || $descriptor['targetId']<0 || !is_int($descriptor['attachmentId']) || $descriptor['attachmentId']<0
        || !is_int($descriptor['window']) || !is_string($descriptor['scope']) || !is_string($descriptor['bucket'])) {
        csktm_fail('site_metric','Use the complete original site event descriptor.');
    }
    $window=(int)floor(time()/(12*HOUR_IN_SECONDS));
    if ($descriptor['window']>$window || $descriptor['window']<$window-1) { csktm_fail('site_metric_expired','Reload this page before recording another event.',409); }
    $kind=$descriptor['kind']; $post_id=$descriptor['targetId']; $attachment_id=$descriptor['attachmentId'];
    $scope=$descriptor['scope']; $bucket=$descriptor['bucket'];
    if ($kind==='download') {
        if ($scope!=='' || $bucket!=='' || !csktm_site_download_target($post_id,$attachment_id)) { csktm_fail('site_metric_target','The selected public download is unavailable.',404); }
    } elseif ($kind==='search') {
        if ($post_id || $attachment_id || !in_array($scope,array_merge(array('all'),csktm_site_public_types()),true)
            || !in_array($bucket,array('none','1-9','10-49','50+'),true)) { csktm_fail('site_metric_search','Use the native search outcome descriptor.'); }
    } elseif ($kind==='page_view') {
        if ($attachment_id || $bucket!=='') { csktm_fail('site_metric_target','Use a native public page descriptor.'); }
        if ($post_id) {
            if ($scope!=='' || !csktm_site_public_post($post_id)) { csktm_fail('site_metric_target','The selected public page is unavailable.',404); }
        } elseif (!in_array($scope,array('home','archive','topics','departments','staff','opportunities','projects','documents','notices','news'),true)) {
            csktm_fail('site_metric_target','Use a native collection descriptor.');
        }
    } else { csktm_fail('site_metric_kind','Choose a supported public browser event.'); }
    return array('kind'=>$kind,'targetId'=>$post_id,'attachmentId'=>$attachment_id,'scope'=>$scope,'bucket'=>$bucket);
}
function csktm_site_metric_option($name,$default=array()) {
    wp_cache_delete($name,'options');
    return get_option($name,$default);
}
function csktm_site_metric_put($name,$value) {
    if (!update_option($name,$value,false)) {
        wp_cache_delete($name,'options');
        if (get_option($name)!==$value) { csktm_fail('site_metric_write','WordPress could not retain the aggregate event.',500); }
    }
}
function csktm_site_record_event($input,$origin) {
    if (!csktm_site_metrics_enabled()) { return array('recorded'=>false,'reason'=>'disabled'); }
    if (csktm_site_origin($origin)!==csktm_site_origin(home_url('/'))) { csktm_fail('site_metric_origin','Record events only from the original public site.',403); }
    if (!is_array($input) || array_diff(array_keys($input),array('eventId','descriptor','token')) ||
        !csktm_eng_uuid($input['eventId']??null) || !is_array($input['descriptor']??null) || !csktm_sha($input['token']??null)
        || !hash_equals(csktm_site_metric_token($input['descriptor']),$input['token'])) {
        csktm_fail('site_metric_token','Use the signed event from the original public page.',403);
    }
    $event=csktm_site_metric_validate($input['descriptor']);
    $day=gmdate('Y-m-d'); $stamp=gmdate('Ymd');
    $previous=gmdate('Ymd',time()-DAY_IN_SECONDS);
    $metric_key='cskt_site_metrics_'.$stamp;
    $receipt_key='cskt_site_metric_receipts_'.$stamp;
    $previous_key='cskt_site_metric_receipts_'.$previous;
    $event_id=hash('sha256',$input['eventId']); $event_sha=csktm_eng_digest($event);
    try {
        return csktm_transaction(function() use ($event,$event_id,$event_sha,$day,$metric_key,$receipt_key,$previous_key){
            foreach (array($receipt_key,$previous_key) as $key) {
                $receipts=csktm_site_metric_option($key);
                if (isset($receipts[$event_id])) {
                    if (!hash_equals($receipts[$event_id],$event_sha)) { csktm_fail('site_metric_replay_conflict','This event ID already identifies a different recorded event.',409); }
                    return array('recorded'=>true,'replayed'=>true);
                }
            }
            $receipts=csktm_site_metric_option($receipt_key);
            if (count($receipts)>=100000) { csktm_fail('site_metric_capacity','The daily event receipt capacity is full.',429); }
            $record=csktm_site_metric_option($metric_key,array('schema'=>'cskt.site.metrics.day.v1','day'=>$day,'firstRecordedAt'=>csktm_now(),'lastRecordedAt'=>csktm_now(),'counts'=>array()));
            if (($record['schema']??'')!=='cskt.site.metrics.day.v1' || !is_array($record['counts']??null)) { csktm_fail('site_metric_record','The original aggregate record is unreadable.',500); }
            $bucket=csktm_eng_digest($event);
            if (!isset($record['counts'][$bucket]) && count($record['counts'])>=10000) { csktm_fail('site_metric_capacity','The daily collection capacity is full.',429); }
            if (!isset($record['counts'][$bucket])) { $record['counts'][$bucket]=$event+array('count'=>0); }
            $record['counts'][$bucket]['count']++;
            $record['lastRecordedAt']=csktm_now();
            $receipts[$event_id]=$event_sha;
            csktm_site_metric_put($metric_key,$record);
            csktm_site_metric_put($receipt_key,$receipts);
            return array('recorded'=>true,'replayed'=>false,'day'=>$day);
        });
    } finally {
        foreach (array($metric_key,$receipt_key,$previous_key) as $key) { wp_cache_delete($key,'options'); }
    }
}
// Request UUID receipts expire independently of the permanent aggregate counters.
add_action('init',function(){
    if (!wp_next_scheduled('cskt_site_expire_metric_receipts')) { wp_schedule_event(time()+HOUR_IN_SECONDS,'daily','cskt_site_expire_metric_receipts'); }
},30);
add_action('cskt_site_expire_metric_receipts',function(){
    global $wpdb;
    $prefix='cskt_site_metric_receipts_'; $cutoff=$prefix.gmdate('Ymd',time()-2*DAY_IN_SECONDS);
    $names=$wpdb->get_col($wpdb->prepare("SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s AND option_name<%s ORDER BY option_name LIMIT 500",$wpdb->esc_like($prefix).'%',$cutoff));
    foreach ($names?:array() as $name) {
        if (!preg_match('/^cskt_site_metric_receipts_\d{8}$/D',$name)) { continue; }
        $wpdb->delete($wpdb->options,array('option_name'=>$name),array('%s'));
        wp_cache_delete($name,'options');
    }
});
function csktm_site_page_event() {
    global $wp_query;
    if (!csktm_site_metrics_enabled() || is_admin() || current_user_can('edit_pages') ||
        function_exists('csktm_eng_is_portal') && csktm_eng_is_portal()) { return null; }
    // Themes may supply their already-evaluated secondary collection search.
    // Its original query must be available before wp_enqueue_scripts; never rerun it here.
    $search_query=is_search()?$wp_query:apply_filters('cskt_site_search_query',null);
    if ($search_query instanceof WP_Query) {
        $type=$search_query->get('post_type');
        if (is_array($type) && count($type)===1) { $type=reset($type); }
        $scope=is_string($type) && in_array($type,csktm_site_public_types(),true)?$type:'all';
        $count=max(0,(int)$search_query->found_posts);
        $bucket=$count===0?'none':($count<10?'1-9':($count<50?'10-49':'50+'));
        return csktm_site_metric_envelope(csktm_site_metric_descriptor('search',0,0,$scope,$bucket));
    }
    if (is_singular()) {
        $post=csktm_site_public_post(get_queried_object_id());
        return $post?csktm_site_metric_envelope(csktm_site_metric_descriptor('page_view',$post->ID)):null;
    }
    $scope=null;
    if (is_home() || is_front_page()) { $scope='home'; }
    elseif (is_tax('cskt_topic')) { $scope='topics'; }
    elseif (is_tax('cskt_department')) { $scope='departments'; }
    else {
        foreach (array('cskt_staff'=>'staff','cskt_opportunity'=>'opportunities','cskt_project'=>'projects','cskt_document'=>'documents','cskt_notice'=>'notices') as $type=>$label) {
            if (is_post_type_archive($type)) { $scope=$label; break; }
        }
        if ($scope===null && is_archive()) { $scope='archive'; }
    }
    return $scope?csktm_site_metric_envelope(csktm_site_metric_descriptor('page_view',0,0,$scope)):null;
}
add_action('wp_enqueue_scripts',function(){
    $event=csktm_site_page_event();
    if (!$event) { return; }
    wp_enqueue_script('cskt-site-public',plugins_url('site-public.js',__FILE__),array(),CSKTM_SITE_VERSION,true);
    wp_add_inline_script('cskt-site-public','window.CSKTSiteMetrics='.wp_json_encode(array('endpoint'=>rest_url(CSKTM_SITE_NS.'/events'),'page'=>$event),JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT).';','before');
});
add_filter('the_content',function($content){
    if (!is_singular() || !in_the_loop() || !is_main_query() || !csktm_site_metrics_enabled() || !class_exists('WP_HTML_Tag_Processor')) { return $content; }
    $target=csktm_site_download_target(get_the_ID());
    if (!$target) { return $content; }
    $html=new WP_HTML_Tag_Processor($content);
    $event=csktm_site_metric_envelope(csktm_site_metric_descriptor('download',$target['postId'],$target['file']['id']));
    while ($html->next_tag(array('tag_name'=>'A'))) {
        $href=$html->get_attribute('href');
        if (is_string($href) && html_entity_decode($href,ENT_QUOTES|ENT_HTML5,'UTF-8')===$target['file']['url']) {
            $html->set_attribute('data-cskt-site-event',csktm_json($event));
        }
    }
    return $html->get_updated_html();
},30);
function csktm_site_report_date($value,$label) {
    if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}$/D',$value)) { csktm_fail('site_report_date',$label.' needs YYYY-MM-DD.'); }
    $date=DateTimeImmutable::createFromFormat('!Y-m-d',$value,new DateTimeZone('UTC'));
    if (!$date || $date->format('Y-m-d')!==$value) { csktm_fail('site_report_date',$label.' is not a valid date.'); }
    return $date;
}
function csktm_site_report($input=array()) {
    if (!current_user_can('edit_pages')) { csktm_fail('site_report_access','Site reporting requires staff page-editing access.',403); }
    $from=csktm_site_report_date($input['from']??gmdate('Y-m-d',time()-29*DAY_IN_SECONDS),'From');
    $to=csktm_site_report_date($input['to']??gmdate('Y-m-d'),'To');
    if ($from>$to || $from->diff($to)->days>365) { csktm_fail('site_report_range','Choose an inclusive date range of at most 366 days.'); }
    $days=array(); $rows=array(); $totals=array('pageViews'=>0,'searches'=>0,'emptySearches'=>0,'downloadClicks'=>0);
    for ($date=$from;$date<=$to;$date=$date->modify('+1 day')) {
        $day=$date->format('Y-m-d'); $record=csktm_site_metric_option('cskt_site_metrics_'.$date->format('Ymd'),null);
        $daily=array('day'=>$day,'pageViews'=>0,'searches'=>0,'emptySearches'=>0,'downloadClicks'=>0);
        if ($record!==null) {
            if (($record['schema']??'')!=='cskt.site.metrics.day.v1' || ($record['day']??'')!==$day || !is_array($record['counts']??null)) { csktm_fail('site_report_record','An original daily report is unreadable. Restore its exact WordPress record before reporting.',500); }
            foreach ($record['counts'] as $key=>$row) {
                if (!is_array($row) || !is_int($row['count']??null) || $row['count']<0) { csktm_fail('site_report_record','An original aggregate count is invalid.',500); }
                $metric=array('page_view'=>'pageViews','search'=>'searches','download'=>'downloadClicks')[$row['kind']]??null;
                if (!$metric) { csktm_fail('site_report_record','An original aggregate event kind is invalid.',500); }
                $daily[$metric]+=$row['count']; $totals[$metric]+=$row['count'];
                if ($row['kind']==='search' && $row['bucket']==='none') { $daily['emptySearches']+=$row['count']; $totals['emptySearches']+=$row['count']; }
                if (!isset($rows[$key])) { $rows[$key]=$row; $rows[$key]['count']=0; }
                $rows[$key]['count']+=$row['count'];
            }
        }
        $days[]=$daily;
    }
    $content=array(); $search=array();
    foreach ($rows as $row) {
        if ($row['kind']==='search') { $search[]=array('scope'=>$row['scope'],'resultBucket'=>$row['bucket'],'count'=>$row['count']); continue; }
        $post=$row['targetId']?get_post($row['targetId']):null;
        $file=$row['attachmentId']?get_post($row['attachmentId']):null;
        $label=$post?$post->post_title:($row['targetId']?'Unavailable resource #'.$row['targetId']:ucfirst($row['scope']).' collection');
        if ($file) { $label.=' / '.$file->post_title; }
        $content[]=$row+array('title'=>$label,'postType'=>$post?$post->post_type:null,
            'url'=>$post&&csktm_site_public_post($post)?get_permalink($post->ID):null,
            'editUrl'=>$post&&current_user_can('edit_post',$post->ID)?get_edit_post_link($post->ID,'raw'):null);
    }
    usort($content,function($a,$b){return ($b['count']<=>$a['count'])?:strcmp($a['title'],$b['title']);});
    usort($search,function($a,$b){return ($b['count']<=>$a['count'])?:strcmp($a['scope'].'|'.$a['resultBucket'],$b['scope'].'|'.$b['resultBucket']);});
    return array('schema'=>'cskt.site.report.v1','from'=>$from->format('Y-m-d'),'to'=>$to->format('Y-m-d'),'timezone'=>'UTC',
        'generatedAt'=>csktm_now(),'enabled'=>csktm_site_metrics_enabled(),'totals'=>$totals,'days'=>$days,'content'=>$content,'searchOutcomes'=>$search,
        'basis'=>'Recorded first-party browser events. Page views are not unique visitors; download clicks are not completed file transfers. Search buckets retain no search text. Staff page loads are excluded. JavaScript blocking, page caching and rejected or expired events can reduce the recorded counts.',
        'engagementDesk'=>admin_url('admin.php?page=cskt-engagement'));
}
function csktm_site_report_csv($report) {
    $stream=fopen('php://temp','w+');
    fputcsv($stream,array('section','day','event','resource_id','attachment_id','scope','result_bucket','title','count'));
    $cell=function($value){$value=(string)$value;return preg_match('/^[=\-+@\t\r]/',$value)?"'".$value:$value;};
    foreach ($report['days'] as $day) {
        foreach (array('pageViews','searches','emptySearches','downloadClicks') as $metric) { fputcsv($stream,array('daily',$day['day'],$metric,'','','','','',$day[$metric])); }
    }
    foreach ($report['content'] as $row) { fputcsv($stream,array('content','',$row['kind'],$row['targetId'],$row['attachmentId'],$row['scope'],'',$cell($row['title']),$row['count'])); }
    foreach ($report['searchOutcomes'] as $row) { fputcsv($stream,array('search','','search','','',$row['scope'],$row['resultBucket'],'',$row['count'])); }
    rewind($stream); $bytes=stream_get_contents($stream); fclose($stream); return $bytes;
}
add_action('rest_api_init',function(){
    register_rest_route(CSKTM_SITE_NS,'/events',array('methods'=>'POST','permission_callback'=>'__return_true',
        'callback'=>csktm_site_rest(function($r){return csktm_site_record_event($r->get_json_params(),(string)$r->get_header('origin'));},false,4096)));
    register_rest_route(CSKTM_SITE_NS,'/report',array('methods'=>'GET','permission_callback'=>function(){return current_user_can('edit_pages');},
        'callback'=>csktm_site_rest(function($r){return csktm_site_report($r->get_params());},true)));
});
function csktm_site_report_page() {
    if (!current_user_can('edit_pages')) { return; }
    echo '<div class="wrap cskt-site-report"><h1>Site reporting</h1><p>Recorded public page views, search outcomes and document-link activity on this WordPress site.</p>';
    $input=array('from'=>is_string($_GET['from']??null)?wp_unslash($_GET['from']):gmdate('Y-m-d',time()-29*DAY_IN_SECONDS),
        'to'=>is_string($_GET['to']??null)?wp_unslash($_GET['to']):gmdate('Y-m-d'));
    echo '<form method="get"><input type="hidden" name="page" value="cskt-site-report"><label for="cskt-report-from">From (UTC)</label> <input id="cskt-report-from" type="date" name="from" value="'.esc_attr($input['from']).'" required> <label for="cskt-report-to">To (UTC)</label> <input id="cskt-report-to" type="date" name="to" value="'.esc_attr($input['to']).'" required> ';
    submit_button('Show report','secondary','',false); echo '</form>';
    try { $report=csktm_site_report($input); }
    catch (Throwable $error) { echo '<div class="notice notice-error"><p>'.esc_html($error->getMessage()).'</p></div></div>'; return; }
    if (!$report['enabled']) { echo '<div class="notice notice-warning inline"><p>New aggregate collection is disabled. Previously recorded counts are retained.</p></div>'; }
    echo '<div class="cskt-site-totals">';
    foreach (array('pageViews'=>'Page views','searches'=>'Searches','emptySearches'=>'Searches without results','downloadClicks'=>'Download-link clicks') as $key=>$label) {
        echo '<section><h2>'.esc_html($label).'</h2><p>'.esc_html(number_format_i18n($report['totals'][$key])).'</p></section>';
    }
    echo '</div><p>'.esc_html($report['basis']).'</p>';
    echo '<p><a class="button" href="'.esc_url(wp_nonce_url(add_query_arg(array('action'=>'cskt_site_report_export','from'=>$report['from'],'to'=>$report['to'],'format'=>'csv'),admin_url('admin-post.php')),'cskt_site_report_export')).'">Download complete CSV</a> <a class="button" href="'.esc_url(wp_nonce_url(add_query_arg(array('action'=>'cskt_site_report_export','from'=>$report['from'],'to'=>$report['to'],'format'=>'json'),admin_url('admin-post.php')),'cskt_site_report_export')).'">Download complete JSON</a> <a href="'.esc_url($report['engagementDesk']).'">Open the original engagement desk</a></p>';
    echo '<h2>Content and downloads</h2><table class="widefat striped"><thead><tr><th scope="col">Resource</th><th scope="col">Event</th><th scope="col">Count</th><th scope="col">Native editing</th></tr></thead><tbody>';
    foreach ($report['content'] as $row) {
        echo '<tr><td>'.($row['url']?'<a href="'.esc_url($row['url']).'">'.esc_html($row['title']).'</a>':esc_html($row['title'])).'</td><td>'.esc_html($row['kind']==='page_view'?'Page view':'Download-link click').'</td><td>'.(int)$row['count'].'</td><td>'.($row['editUrl']?'<a href="'.esc_url($row['editUrl']).'">Edit native resource</a>':'').'</td></tr>';
    }
    if (!$report['content']) { echo '<tr><td colspan="4">No content events were recorded in this date range.</td></tr>'; }
    echo '</tbody></table><h2>Search outcomes</h2><p>Use the no-results count to assess findability. Query text and visitor details are not stored.</p><table class="widefat striped"><thead><tr><th scope="col">Collection</th><th scope="col">Results returned</th><th scope="col">Searches</th></tr></thead><tbody>';
    foreach ($report['searchOutcomes'] as $row) { echo '<tr><td>'.esc_html($row['scope']).'</td><td>'.esc_html($row['resultBucket']==='none'?'No results':$row['resultBucket']).'</td><td>'.(int)$row['count'].'</td></tr>'; }
    if (!$report['searchOutcomes']) { echo '<tr><td colspan="3">No searches were recorded in this date range.</td></tr>'; }
    echo '</tbody></table><h2>Daily activity</h2><table class="widefat striped"><thead><tr><th scope="col">Day (UTC)</th><th scope="col">Page views</th><th scope="col">Searches</th><th scope="col">No results</th><th scope="col">Download-link clicks</th></tr></thead><tbody>';
    foreach ($report['days'] as $day) { echo '<tr><th scope="row">'.esc_html($day['day']).'</th><td>'.(int)$day['pageViews'].'</td><td>'.(int)$day['searches'].'</td><td>'.(int)$day['emptySearches'].'</td><td>'.(int)$day['downloadClicks'].'</td></tr>'; }
    echo '</tbody></table></div>';
}
add_action('admin_menu',function(){add_dashboard_page('Site reporting','Site reporting','edit_pages','cskt-site-report','csktm_site_report_page');});
add_action('admin_enqueue_scripts',function($hook){
    if (in_array($hook,array('dashboard_page_cskt-site-report','settings_page_cskt-site-settings'),true)) {
        wp_enqueue_style('cskt-site',plugins_url('site.css',__FILE__),array(),CSKTM_SITE_VERSION);
    }
});
add_action('wp_enqueue_scripts',function(){
    if (is_singular(array('cskt_staff','cskt_opportunity'))) { wp_enqueue_style('cskt-site',plugins_url('site.css',__FILE__),array(),CSKTM_SITE_VERSION); }
});
add_action('admin_post_cskt_site_report_export',function(){
    if (!current_user_can('edit_pages')) { wp_die('Site reporting requires staff access.','Site report',array('response'=>403)); }
    check_admin_referer('cskt_site_report_export');
    try {
        $format=$_GET['format']??'csv';
        if (!in_array($format,array('csv','json'),true)) { csktm_fail('site_report_format','Choose CSV or JSON.'); }
        $report=csktm_site_report(array('from'=>wp_unslash($_GET['from']??''),'to'=>wp_unslash($_GET['to']??'')));
        $bytes=$format==='csv'?csktm_site_report_csv($report):csktm_json($report)."\n";
        nocache_headers(); header('Content-Type: '.($format==='csv'?'text/csv':'application/json').'; charset=utf-8');
        header('Content-Disposition: attachment; filename="site-report-'.$report['from'].'-'.$report['to'].'.'.$format.'"');
        header('Content-Length: '.strlen($bytes)); echo $bytes; exit;
    } catch (Throwable $error) {
        wp_die(esc_html($error->getMessage()),'Site report',array('response'=>$error instanceof CSKTM_Problem?$error->status:500,'back_link'=>true));
    }
});
