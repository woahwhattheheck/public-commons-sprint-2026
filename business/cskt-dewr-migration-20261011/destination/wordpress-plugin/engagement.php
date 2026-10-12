<?php
/** Native public engagement, joined to the reviewed CSKT WordPress destination. */
if (!defined('ABSPATH')) { exit; }

define('CSKTM_ENG_NS', 'cskt-engagement/v1');
define('CSKTM_ENG_VERSION', '1.0.0');

function csktm_eng_types() {
    foreach (array('cskt_eng_form'=>'Engagement forms', 'cskt_eng_entry'=>'Engagement submissions', 'cskt_eng_mail'=>'Engagement correspondence') as $type=>$label) {
        register_post_type($type, array(
            'label'=>$label, 'public'=>false, 'publicly_queryable'=>false,
            'exclude_from_search'=>true, 'show_ui'=>false, 'show_in_rest'=>false,
            'rewrite'=>false, 'query_var'=>false, 'can_export'=>true,
            'delete_with_user'=>false, 'supports'=>array('title','editor','revisions'),
            'capability_type'=>'page', 'map_meta_cap'=>true,
        ));
    }
}
add_action('init', 'csktm_eng_types');

function csktm_eng_staff() { return current_user_can('edit_pages'); }
function csktm_eng_publisher() { return current_user_can('publish_pages'); }
function csktm_eng_admin() { return current_user_can('manage_options'); }
function csktm_eng_uuid($value) {
    return is_string($value) && preg_match('/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/D', $value);
}
function csktm_eng_text($value, $label, $max=1000, $required=false) {
    if (!is_string($value) || strlen($value)>$max || ($required && trim($value)==='')) {
        csktm_fail('engagement_field', $label . ' requires ' . ($required?'nonempty ':'') . 'text of at most ' . $max . ' bytes.');
    }
    return sanitize_textarea_field($value);
}
function csktm_eng_int($value, $label, $min, $max) {
    if (!is_int($value) || $value<$min || $value>$max) {
        csktm_fail('engagement_number', $label . ' must be an integer from ' . $min . ' to ' . $max . '.');
    }
    return $value;
}
function csktm_eng_canonical($value) {
    if (!is_array($value)) { return $value; }
    if (!array_is_list($value)) { ksort($value, SORT_STRING); }
    foreach ($value as $key=>$item) { $value[$key]=csktm_eng_canonical($item); }
    return $value;
}
function csktm_eng_digest($value) { return csktm_hash(csktm_eng_canonical($value)); }
function csktm_eng_type($kind) {
    $types=array('form'=>'cskt_eng_form','entry'=>'cskt_eng_entry','mail'=>'cskt_eng_mail');
    if (!isset($types[$kind])) { csktm_fail('engagement_kind','Choose a supported native record.'); }
    return $types[$kind];
}
function csktm_eng_row($kind, $id, $required=true) {
    global $wpdb;
    if (!csktm_eng_uuid($id)) { csktm_fail('engagement_id','Use the complete engagement record ID.'); }
    $row=$wpdb->get_row($wpdb->prepare(
        "SELECT ID,post_content FROM {$wpdb->posts} WHERE post_type=%s AND post_name=%s AND post_status='private' ORDER BY ID LIMIT 1",
        csktm_eng_type($kind), $id
    ), ARRAY_A);
    if (!$row) {
        if ($required) { csktm_fail('engagement_missing','The selected native engagement record was not found.',404); }
        return null;
    }
    $data=json_decode($row['post_content'],true);
    if (!is_array($data) || ($data['id']??null)!==$id || ($data['schema']??null)!=='cskt.engagement.'.$kind.'.v1') {
        csktm_fail('engagement_record_unreadable','The retained native engagement record could not be read.',500);
    }
    return array('nativeId'=>(int)$row['ID'],'data'=>$data,'sha256'=>csktm_eng_digest($data));
}
function csktm_eng_put($kind, $data) {
    if (!csktm_eng_uuid($data['id']??null)) { csktm_fail('engagement_id','A native record needs its stable ID.'); }
    $old=csktm_eng_row($kind,$data['id'],false);
    $content=csktm_json($data);
    if (strlen($content)>CSKTM_MAX_MANIFEST) { csktm_fail('engagement_record_size','Export this record history before extending it beyond 32 MiB.',413); }
    $post=array('post_type'=>csktm_eng_type($kind),'post_name'=>$data['id'],'post_status'=>'private',
        'post_title'=>$kind==='form'?$data['title']:ucfirst($kind).' '.$data['id'],
        'post_content'=>$content,'post_excerpt'=>'','comment_status'=>'closed','ping_status'=>'closed');
    if ($old) {
        $post['ID']=$old['nativeId'];
        $result=wp_update_post(wp_slash($post),true);
    } else {
        $result=wp_insert_post(wp_slash($post),true);
    }
    if (is_wp_error($result) || !$result) { csktm_fail('engagement_write','WordPress could not retain the engagement record.',500); }
    foreach (array('_cskt_eng_form'=>$kind==='form'?$data['id']:($data['formId']??''),
                   '_cskt_eng_state'=>$data['state']??'',
                   '_cskt_eng_mode'=>$data['mode']??'') as $key=>$value) {
        if (!update_post_meta((int)$result,$key,$value) && get_post_meta((int)$result,$key,true)!==$value) {
            csktm_fail('engagement_index_write','WordPress could not retain the engagement collection index.',500);
        }
    }
    clean_post_cache((int)$result);
    wp_save_post_revision((int)$result);
    return array('nativeId'=>(int)$result,'data'=>$data,'sha256'=>csktm_eng_digest($data));
}
function csktm_eng_rows($kind, $filters=array(), $after=0, $limit=100, $ascending=true) {
    global $wpdb;
    $limit=max(1,min(500,(int)$limit));
    $where=array("p.post_type=%s","p.post_status='private'",$ascending?"p.ID>%d":"p.ID<%d");
    $args=array(csktm_eng_type($kind),$ascending?(int)$after:($after?(int)$after:PHP_INT_MAX));
    foreach (array('formId'=>'_cskt_eng_form','state'=>'_cskt_eng_state','mode'=>'_cskt_eng_mode') as $filter=>$key) {
        if (isset($filters[$filter]) && $filters[$filter]!=='') {
            $where[]="EXISTS (SELECT 1 FROM {$wpdb->postmeta} m WHERE m.post_id=p.ID AND m.meta_key=%s AND m.meta_value=%s)";
            $args[]=$key; $args[]=$filters[$filter];
        }
    }
    if (!empty($filters['search'])) {
        $where[]='p.post_content LIKE %s';
        $args[]='%'.$wpdb->esc_like($filters['search']).'%';
    }
    $args[]=$limit+1;
    $rows=$wpdb->get_results($wpdb->prepare("SELECT p.ID,p.post_content FROM {$wpdb->posts} p WHERE ".implode(' AND ',$where)." ORDER BY p.ID ".($ascending?"ASC":"DESC")." LIMIT %d",...$args),ARRAY_A);
    if ($rows===null) { csktm_fail('engagement_read','WordPress could not read the engagement collection.',500); }
    $more=count($rows)>$limit;
    $rows=array_slice($rows,0,$limit);
    $items=array();
    foreach ($rows as $row) {
        $data=json_decode($row['post_content'],true);
        if (!is_array($data) || !csktm_eng_uuid($data['id']??null)) { csktm_fail('engagement_record_unreadable','A retained engagement record could not be read.',500); }
        $items[]=array('nativeId'=>(int)$row['ID'],'data'=>$data,'sha256'=>csktm_eng_digest($data));
    }
    return array('items'=>$items,'next'=>$more?(int)end($rows)['ID']:null);
}
function csktm_eng_all($kind, $filters=array()) {
    $items=array(); $after=0;
    do {
        $page=csktm_eng_rows($kind,$filters,$after,500);
        foreach ($page['items'] as $item) { $items[]=$item; }
        $after=$page['next'];
    } while ($after!==null);
    return $items;
}
function csktm_eng_parent($post_id, $published=false) {
    $post_id=csktm_eng_int($post_id,'Associated page or project',1,PHP_INT_MAX);
    $post=get_post($post_id);
    if (!$post || !in_array($post->post_type,array('page','post','cskt_project','cskt_notice'),true) || $post->post_status==='trash') {
        csktm_fail('engagement_parent','Choose an existing WordPress page, project, news item or notice.',404);
    }
    if ($published && (!is_post_publicly_viewable($post) || $post->post_password!=='' || get_post_meta($post_id,'_cskt_archive',true)==='1')) {
        csktm_fail('engagement_parent_unpublished','Publish the associated resource and clear its archive state before opening this form.',409);
    }
    $bindings=array();
    foreach (get_option('cskt_migration_bindings',array()) as $binding) {
        if ((int)($binding['postId']??0)===$post_id) { $bindings[]=$binding; }
    }
    return array('postId'=>$post_id,'postType'=>$post->post_type,'title'=>$post->post_title,
        'url'=>get_permalink($post_id),'sourceBindings'=>$bindings);
}
function csktm_eng_event(&$data, $action, $detail=array(), $actor=null) {
    $data['revision']=($data['revision']??0)+1;
    $data['updatedAt']=csktm_now();
    $data['history'][]=array('revision'=>$data['revision'],'at'=>$data['updatedAt'],
        'actor'=>$actor===null?get_current_user_id():$actor,'action'=>$action,'detail'=>$detail);
}
function csktm_eng_operation($data, $operation_id, $action, $input) {
    if (!csktm_eng_uuid($operation_id)) { csktm_fail('engagement_operation','Keep one operation UUID for this exact action.'); }
    $previous=$data['operations'][$operation_id]??null;
    if ($previous && ($previous['action']!==$action || !hash_equals($previous['sha256'],csktm_eng_digest($input)))) {
        csktm_fail('engagement_operation_conflict','This operation ID already identifies a different request.',409);
    }
    return $previous;
}
function csktm_eng_remember(&$data, $operation_id, $action, $input, $result=array()) {
    $data['operations'][$operation_id]=array('action'=>$action,'sha256'=>csktm_eng_digest($input),
        'at'=>csktm_now(),'revision'=>$data['revision'],'actor'=>get_current_user_id(),'result'=>$result);
}
function csktm_eng_expected($data, $revision) {
    if (!is_int($revision) || $revision!==$data['revision']) {
        csktm_fail('engagement_changed','The record has changed. Reload its current revision before applying this decision.',409,
            array('currentRevision'=>$data['revision']));
    }
}
function csktm_eng_form_values($input) {
    if (!is_array($input)) { csktm_fail('engagement_form','Provide the complete form definition.'); }
    $mode=$input['mode']??'';
    if (!in_array($mode,array('contact','comment','newsletter','rsvp'),true)) { csktm_fail('engagement_mode','Choose contact, public comment, newsletter or event registration.'); }
    $state=$input['state']??'draft';
    if (!in_array($state,array('draft','open','closed'),true)) { csktm_fail('engagement_state','Choose draft, open or closed.'); }
    $parent=csktm_eng_parent($input['parentId']??0,$state==='open');
    if (!current_user_can('edit_post',$parent['postId'])) { csktm_fail('engagement_parent_access','Your account needs editing access to the associated resource.',403); }
    $opens=csktm_editor_date($input['opensAt']??'','Opening time');
    $closes=csktm_editor_date($input['closesAt']??'','Closing time');
    if ($opens && $closes && strtotime($opens)>=strtotime($closes)) { csktm_fail('engagement_dates','The closing time must be after the opening time.'); }
    $notify=csktm_eng_text($input['notifyEmail']??'','Staff notification address',254);
    if ($notify!=='' && (!is_email($notify) || preg_match('/[\r\n]/',$notify))) { csktm_fail('engagement_email','Use one complete staff notification email address.'); }
    $privacy=csktm_eng_text($input['privacyText']??'','Privacy information',8000,$state==='open');
    $consent=csktm_eng_text($input['consentText']??'','Consent statement',4000,$state==='open');
    return array('mode'=>$mode,'state'=>$state,'parent'=>$parent,
        'title'=>csktm_eng_text($input['title']??'','Form title',300,true),
        'instructions'=>csktm_eng_text($input['instructions']??'','Instructions',12000),
        'privacyText'=>$privacy,'consentText'=>$consent,
        'successMessage'=>csktm_eng_text($input['successMessage']??'Your submission has been recorded.','Receipt message',2000,true),
        'opensAt'=>$opens,'closesAt'=>$closes,'notifyEmail'=>$notify,
        'capacity'=>csktm_eng_int($input['capacity']??0,'Event capacity',0,1000000),
        'maxParty'=>csktm_eng_int($input['maxParty']??1,'Maximum people per registration',1,100),
        'autoAttach'=>($input['autoAttach']??true)===true,
        'publicationLabel'=>csktm_eng_text($input['publicationLabel']??'You may publish the reviewed text of my comment and my chosen display name.','Public comment consent',2000,true));
}
function csktm_eng_save_form($input) {
    if (!csktm_eng_publisher()) { csktm_fail('engagement_publish_access','Your account needs publishing access to manage forms.',403); }
    $id=$input['id']??null;
    if (!csktm_eng_uuid($id)) { csktm_fail('engagement_id','Keep a UUID for this form before its first save.'); }
    $operation=$input['operationId']??null;
    $result=csktm_transaction(function() use ($input,$id,$operation) {
        $row=csktm_eng_row('form',$id,false);
        $data=$row?$row['data']:array('schema'=>'cskt.engagement.form.v1','id'=>$id,'revision'=>0,
            'createdAt'=>csktm_now(),'createdBy'=>get_current_user_id(),'history'=>array(),'operations'=>array());
        $previous=csktm_eng_operation($data,$operation,'save_form',$input);
        if ($previous) { return array('record'=>$row,'replayed'=>true,'operation'=>$previous); }
        csktm_eng_expected($data,$input['expectedRevision']??null);
        $values=csktm_eng_form_values($input['form']??null);
        if ($row && $data['mode']!==$values['mode'] && count(csktm_eng_rows('entry',array('formId'=>$id),0,1)['items'])) {
            csktm_fail('engagement_mode_in_use','A form with submissions retains its original type. Create a new form for a different workflow.',409);
        }
        foreach ($values as $key=>$value) { $data[$key]=$value; }
        csktm_eng_event($data,'form_saved',array('state'=>$data['state'],'parent'=>$data['parent'],'mode'=>$data['mode']));
        csktm_eng_remember($data,$operation,'save_form',$input);
         $saved=csktm_eng_put('form',$data);
        $mail_ids=$data['mode']==='rsvp'?csktm_eng_promote($data):array();
        return array('record'=>$saved,'replayed'=>false,'mailIds'=>$mail_ids);
    });
    foreach ($result['mailIds']??array() as $mail_id) { csktm_eng_schedule_mail($mail_id); }
    unset($result['mailIds']);
    return $result;
}
function csktm_eng_available($form) {
    if ($form['state']!=='open') { return false; }
    $now=time();
    if ($form['opensAt'] && $now<strtotime($form['opensAt'])) { return false; }
    if ($form['closesAt'] && $now>=strtotime($form['closesAt'])) { return false; }
    try { csktm_eng_parent($form['parent']['postId'],true); } catch (CSKTM_Problem $e) { return false; }
    return true;
}
function csktm_eng_token($form) {
    $issued=time(); $salt=bin2hex(random_bytes(12));
    $value=$form['id'].':'.$form['revision'].':'.$issued.':'.$salt;
    return $issued.'.'.$salt.'.'.hash_hmac('sha256',$value,wp_salt('nonce'));
}
function csktm_eng_check_token($form,$token) {
    if (!is_string($token) || !preg_match('/^(\d{10})\.([a-f0-9]{24})\.([a-f0-9]{64})$/D',$token,$match)) {
        csktm_fail('engagement_form_expired','Reload this form before submitting.',403);
    }
    $issued=(int)$match[1];
    $expected=hash_hmac('sha256',$form['id'].':'.$form['revision'].':'.$issued.':'.$match[2],wp_salt('nonce'));
    if ($issued>time()+60 || $issued<time()-7200 || !hash_equals($expected,$match[3])) {
        csktm_fail('engagement_form_expired','This form edition has changed or expired. Reload it before submitting.',409);
    }
}
function csktm_eng_public_form($id) {
    $form=csktm_eng_row('form',$id)['data'];
    if ($form['state']==='draft') { csktm_fail('engagement_missing','This form is not published.',404); }
    csktm_eng_parent($form['parent']['postId'],true);
    $result=array_intersect_key($form,array_flip(array('id','revision','mode','state','parent','title','instructions',
        'privacyText','consentText','successMessage','opensAt','closesAt','capacity','maxParty','publicationLabel')));
    unset($result['parent']['sourceBindings']);
    $result['available']=csktm_eng_available($form);
    $result['formToken']=$result['available']?csktm_eng_token($form):null;
    return $result;
}
function csktm_eng_submission($form,$input) {
    $name=csktm_eng_text($input['name']??'','Name',200,$form['mode']!=='comment');
    $email=csktm_eng_text($input['email']??'','Email address',254,true);
    if (!is_email($email) || preg_match('/[\r\n]/',$email)) { csktm_fail('engagement_email','Use one complete email address.'); }
    $email=strtolower(trim($email));
    $message=csktm_eng_text($input['message']??'','Message',20000,in_array($form['mode'],array('contact','comment'),true));
    $subject=csktm_eng_text($input['subject']??'','Subject',300);
    $display=csktm_eng_text($input['displayName']??'','Public display name',200);
    if (($input['consent']??false)!==true) { csktm_fail('engagement_consent','Confirm the displayed consent statement before submitting.'); }
    $party=csktm_eng_int($input['partySize']??1,'People attending',1,$form['mode']==='rsvp'?$form['maxParty']:1);
    return array('name'=>$name,'email'=>$email,'subject'=>$subject,'message'=>$message,'displayName'=>$display,
        'partySize'=>$party,'consent'=>true,'publicationConsent'=>$form['mode']==='comment'&&($input['publicationConsent']??false)===true);
}
function csktm_eng_rate($form,$email) {
    $window=(int)floor(time()/3600);
    $address=$_SERVER['REMOTE_ADDR']??'native';
    $keys=array(hash_hmac('sha256','network:'.$address,wp_salt('auth'))=>40,
        hash_hmac('sha256','mail:'.$form['id'].':'.$email,wp_salt('auth'))=>6);
    foreach ($keys as $key=>$max) {
        $name='cskt_eng_rate_'.$key;
        $old=get_transient($name);
        if (!is_array($old)) { $old=array('window'=>$window,'count'=>0); }
        if (($old['window']??null)!==$window) { $old=array('window'=>$window,'count'=>0); }
        if ($old['count']>=$max) { csktm_fail('engagement_rate','Too many requests were received. Please try again after this hour.',429); }
        $old['count']++;
        set_transient($name,$old,HOUR_IN_SECONDS+300);
    }
}
function csktm_eng_publication_allowed($entry) {
    return !empty($entry['submission']['publicationConsent']) && empty($entry['publicationPermissionWithdrawnAt']);
}
function csktm_eng_receipt($entry) {
    $form=csktm_eng_row('form',$entry['formId'])['data'];
    return array('id'=>$entry['id'],'formId'=>$entry['formId'],'title'=>$form['title'],'mode'=>$entry['mode'],
        'createdAt'=>$entry['createdAt'],'state'=>$entry['state'],
        'subscription'=>$entry['subscription']??null,'rsvp'=>$entry['rsvp']??null,
        'publicCommentState'=>$entry['publicComment']['state']??null,
        'message'=>$form['successMessage'],'receiptKey'=>$entry['receiptKey']);
}
function csktm_eng_receipt_entry($id,$key) {
    $entry=csktm_eng_row('entry',$id)['data'];
    if (!is_string($key) || !hash_equals($entry['receiptKey'],$key)) { csktm_fail('engagement_receipt','Use the complete private receipt key.',403); }
    return $entry;
}
function csktm_eng_submit($form_id,$input) {
    if (!is_array($input) || !csktm_eng_uuid($input['requestId']??null)) { csktm_fail('engagement_request','Keep a request UUID for this submission.'); }
    $entry_id=$input['requestId'];
    $result=csktm_transaction(function() use ($form_id,$input,$entry_id) {
        $form=csktm_eng_row('form',$form_id)['data'];
        $old=csktm_eng_row('entry',$entry_id,false);
        $validation=$old?array('mode'=>$old['data']['mode'],'maxParty'=>100):$form;
        $submission=csktm_eng_submission($validation,$input);
        $intent=array('formId'=>$form_id,'formRevision'=>$input['formRevision']??null,'submission'=>$submission);
        $hash=csktm_eng_digest($intent);
        if ($old) {
            if (!hash_equals($old['data']['submissionSha256'],$hash)) { csktm_fail('engagement_request_conflict','This request ID already identifies different submitted information.',409); }
            return array('entry'=>$old['data'],'replayed'=>true,'mailIds'=>$old['data']['submissionMailIds']??array());
        }
        if (!csktm_eng_available($form)) { csktm_fail('engagement_closed','This form is not accepting submissions at this time.',409); }
        csktm_eng_expected($form,$input['formRevision']??null);
        csktm_eng_check_token($form,$input['formToken']??null);
        if (!empty($input['website'])) { csktm_fail('engagement_form_check','Reload this form and leave its automated check empty.',422); }
        csktm_eng_rate($form,$submission['email']);
        $entry=array('schema'=>'cskt.engagement.entry.v1','id'=>$entry_id,'formId'=>$form_id,
            'formRevision'=>$form['revision'],'mode'=>$form['mode'],'parent'=>$form['parent'],
            'revision'=>0,'createdAt'=>csktm_now(),'receiptKey'=>bin2hex(random_bytes(24)),
            'submissionSha256'=>$hash,'submission'=>$submission,
            'formSnapshot'=>array_intersect_key($form,array_flip(array('title','instructions','privacyText','consentText','publicationLabel','opensAt','closesAt'))),
            'state'=>'new','assignedTo'=>0,'staffNotes'=>'','responseDraft'=>array('subject'=>'','message'=>''),
            'subscription'=>$form['mode']==='newsletter'?'pending_confirmation':null,
            'rsvp'=>$form['mode']==='rsvp'?array('state'=>'pending_confirmation','partySize'=>$submission['partySize'],'confirmedAt'=>null):null,
            'publicComment'=>array('state'=>'unpublished','text'=>'','displayName'=>'','publishedAt'=>null,'publishedBy'=>null),
            'publicationPermissionWithdrawnAt'=>null,
            'verification'=>null,'history'=>array(),'operations'=>array());
        $mail_ids=array();
        if (in_array($form['mode'],array('newsletter','rsvp'),true)) {
            $entry['verification']=array('token'=>bin2hex(random_bytes(32)),'expiresAt'=>gmdate('Y-m-d\TH:i:s\Z',time()+7*DAY_IN_SECONDS),'confirmedAt'=>null);
            $mail=csktm_eng_verification_mail($entry,$form);
            $mail_ids[]=$mail['id'];
        }
        if ($form['notifyEmail']!=='') {
            $mail=csktm_eng_new_mail($entry,'staff_notification',$form['notifyEmail'],'New submission: '.$form['title'],
                'A new '.$form['mode'].' submission is ready for staff review.'."\n\n".admin_url('admin.php?page=cskt-engagement#entry='.$entry_id));
            $mail_ids[]=$mail['id'];
        }
        $entry['submissionMailIds']=$mail_ids;
        csktm_eng_event($entry,'submitted',array('formRevision'=>$form['revision'],'parent'=>$form['parent']),0);
        csktm_eng_put('entry',$entry);
        return array('entry'=>$entry,'replayed'=>false,'mailIds'=>$mail_ids);
    });
    foreach ($result['mailIds'] as $mail_id) { csktm_eng_schedule_mail($mail_id); }
    return array('receipt'=>csktm_eng_receipt($result['entry']),'replayed'=>$result['replayed']);
}
function csktm_eng_endpoint($callback,$public=false,$max=65536) {
    return function($request) use ($callback,$public,$max) {
        try {
            if (strlen($request->get_body())>$max) { csktm_fail('engagement_request_size','The submitted request is too large.',413); }
            $response=rest_ensure_response($callback($request));
            $response->header('Cache-Control','no-store, private');
            $response->header('Referrer-Policy','no-referrer');
            return $response;
        } catch (Throwable $error) {
            $status=$error instanceof CSKTM_Problem?$error->status:500;
            $message=$public && $status>=500?'WordPress could not complete this request. Keep its receipt and retry.':$error->getMessage();
            return new WP_Error($error instanceof CSKTM_Problem?$error->slug:'engagement_error',$message,array('status'=>$status));
        }
    };
}
require_once __DIR__.'/engagement-actions.php';
require_once __DIR__.'/engagement-transfer.php';
require_once __DIR__.'/engagement-admin.php';
