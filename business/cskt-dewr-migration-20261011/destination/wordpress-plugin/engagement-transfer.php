<?php
/** Complete selected-form export and previewed, revision-guarded native receiving. */
if (!defined('ABSPATH')) { exit; }

function csktm_eng_export($input) {
    if (!csktm_eng_admin()) { csktm_fail('engagement_export_access','An administrator must export complete submissions and correspondence.',403); }
    $ids=$input['formIds']??null;
    if (!is_array($ids) || !array_is_list($ids) || !$ids || count($ids)>500) { csktm_fail('engagement_export_selection','Select from one to five hundred complete forms.'); }
    $ids=array_values(array_unique($ids));
    return csktm_transaction(function() use ($ids) {
        $payload=array('schema'=>'cskt.engagement.workspace.v1','exportedAt'=>csktm_now(),
            'origin'=>untrailingslashit(home_url('/')),'pluginVersion'=>CSKTM_ENG_VERSION,
            'forms'=>array(),'entries'=>array(),'mail'=>array());
        foreach ($ids as $id) {
            $payload['forms'][]=csktm_eng_row('form',$id)['data'];
            foreach (csktm_eng_all('entry',array('formId'=>$id)) as $row) { $payload['entries'][]=$row['data']; }
            foreach (csktm_eng_all('mail',array('formId'=>$id)) as $row) { $payload['mail'][]=$row['data']; }
        }
        if (strlen(csktm_json($payload))>CSKTM_MAX_MANIFEST) { csktm_fail('engagement_export_size','Select fewer forms for each complete portable export. This selection exceeds 32 MiB.',413); }
        return array('schema'=>'cskt.engagement.transfer.v1','sha256'=>csktm_eng_digest($payload),
            'counts'=>array('forms'=>count($payload['forms']),'entries'=>count($payload['entries']),'mail'=>count($payload['mail'])),
            'workspace'=>$payload);
    });
}
function csktm_eng_csv_cell($value) {
    $value=(string)$value;
    if (preg_match('/^[\s]*[=+\-@]/u',$value)) { $value="'".$value; }
    return $value;
}
function csktm_eng_csv($input) {
    if (!csktm_eng_staff()) { csktm_fail('engagement_access','Staff access is required for this export.',403); }
    $form=csktm_eng_row('form',$input['formId']??null)['data'];
    $kind=$input['kind']??'submissions';
    if (!in_array($kind,array('submissions','subscribers','attendance','public_comments'),true)) { csktm_fail('engagement_export_kind','Choose submissions, subscribers, attendance or public comments.'); }
    $rows=array(); $seen=array();
    if ($kind==='subscribers') { $header=array('email','name','form_id','form_title','confirmed_at','consent_text','submitted_at'); }
    elseif ($kind==='attendance') { $header=array('entry_id','name','email','people','reservation_state','confirmed_at','attended_at'); }
    elseif ($kind==='public_comments') { $header=array('display_name','reviewed_comment','published_at','form_id','project_url'); }
    else { $header=array('entry_id','form_id','form_revision','name','email','subject','message','submitted_at','staff_state','subscription_state','reservation_state','people','publication_consent'); }
    foreach (csktm_eng_all('entry',array('formId'=>$form['id'])) as $row) {
        $entry=$row['data']; $s=$entry['submission'];
        if ($kind==='subscribers') {
            if ($entry['mode']!=='newsletter' || $entry['subscription']!=='confirmed' || in_array($entry['state'],array('spam','archived'),true)) { continue; }
            if (isset($seen[$s['email']])) { continue; }
            $seen[$s['email']]=true;
            $rows[]=array($s['email'],$s['name'],$form['id'],$form['title'],$entry['verification']['confirmedAt'],$entry['formSnapshot']['consentText'],$entry['createdAt']);
        } elseif ($kind==='attendance') {
            if ($entry['mode']!=='rsvp') { continue; }
            $rows[]=array($entry['id'],$s['name'],$s['email'],$entry['rsvp']['partySize'],$entry['rsvp']['state'],$entry['rsvp']['confirmedAt']??'',$entry['rsvp']['attendedAt']??'');
        } elseif ($kind==='public_comments') {
            if ($entry['mode']!=='comment' || $entry['publicComment']['state']!=='published' || !csktm_eng_publication_allowed($entry)) { continue; }
            $c=$entry['publicComment'];
            $rows[]=array($c['displayName'],$c['text'],$c['publishedAt'],$form['id'],$form['parent']['url']);
        } else {
            $rows[]=array($entry['id'],$form['id'],$entry['formRevision'],$s['name'],$s['email'],$s['subject'],$s['message'],$entry['createdAt'],$entry['state'],$entry['subscription']??'',$entry['rsvp']['state']??'',$entry['rsvp']['partySize']??'',$s['publicationConsent']?'yes':'no');
        }
    }
    $stream=fopen('php://temp','w+');
    fputcsv($stream,$header,',','"','');
    foreach ($rows as $row) { fputcsv($stream,array_map('csktm_eng_csv_cell',$row),',','"',''); }
    rewind($stream); $body=stream_get_contents($stream); fclose($stream);
    return array('filename'=>'engagement-'.$kind.'-'.$form['id'].'.csv','mimeType'=>'text/csv;charset=utf-8',
        'bytes'=>strlen($body),'sha256'=>hash('sha256',$body),'rows'=>count($rows),'content'=>$body);
}
function csktm_eng_validate_record($kind,$record) {
    if (!is_array($record) || ($record['schema']??null)!=='cskt.engagement.'.$kind.'.v1' || !csktm_eng_uuid($record['id']??null)) {
        csktm_fail('engagement_receive_schema','Every received record must retain its original schema and UUID.');
    }
    csktm_eng_int($record['revision']??null,'Record revision',1,PHP_INT_MAX);
    foreach (array('createdAt','updatedAt') as $key) { csktm_editor_date($record[$key]??'',$key); }
    if (!is_array($record['history']??null) || !array_is_list($record['history']) || !is_array($record['operations']??null)) {
        csktm_fail('engagement_receive_history','Retain each record’s complete history and operation map.');
    }
    if (!in_array($record['mode']??'',array('contact','comment','newsletter','rsvp'),true)) { csktm_fail('engagement_receive_mode','A received record has an unsupported form type.'); }
    if ($kind!=='form' && !csktm_eng_uuid($record['formId']??null)) { csktm_fail('engagement_receive_form','Every submission and message needs its original form ID.'); }
    if ($kind==='entry') {
        $s=csktm_eng_submission(array('mode'=>$record['mode'],'maxParty'=>100),$record['submission']??array());
        if (csktm_eng_digest($s)!==csktm_eng_digest($record['submission'])) { csktm_fail('engagement_receive_submission','The original submitted fields do not match their supported native form.'); }
        if (!preg_match('/^[a-f0-9]{48}$/D',$record['receiptKey']??'') || !csktm_sha($record['submissionSha256']??null)) { csktm_fail('engagement_receive_receipt','Retain the original private receipt and submitted-request hash.'); }
        csktm_eng_int($record['formRevision']??null,'Original form revision',1,PHP_INT_MAX);
        $original_intent=array('formId'=>$record['formId'],'formRevision'=>$record['formRevision'],'submission'=>$record['submission']);
        if (!hash_equals($record['submissionSha256'],csktm_eng_digest($original_intent))) { csktm_fail('engagement_receive_original_submission','The original submission digest differs from the retained source fields.'); }
        if (!empty($record['publicationPermissionWithdrawnAt'])) { csktm_editor_date($record['publicationPermissionWithdrawnAt'],'Publication permission withdrawal'); }
        if (!in_array($record['state']??'',array('new','in_review','resolved','archived','spam'),true)) { csktm_fail('engagement_receive_state','A submission has an unsupported staff state.'); }
        if (!is_array($record['formSnapshot']??null) || !is_array($record['parent']??null) || !is_array($record['publicComment']??null)) { csktm_fail('engagement_receive_context','Retain the original consent, project and reviewed-publication context.'); }
        if (!in_array($record['publicComment']['state']??'',array('unpublished','published','withdrawn'),true)) { csktm_fail('engagement_receive_publication','A comment has an unsupported publication state.'); }
        csktm_eng_text($record['publicComment']['text']??'','Reviewed public comment',20000);
        csktm_eng_text($record['publicComment']['displayName']??'','Reviewed display name',200);
        if ($record['mode']==='newsletter' && !in_array($record['subscription']??'',array('pending_confirmation','confirmed','unsubscribed'),true)) { csktm_fail('engagement_receive_consent','A newsletter record has an unsupported consent state.'); }
        if ($record['mode']==='rsvp') {
            if (!is_array($record['rsvp']??null) || !in_array($record['rsvp']['state']??'',array('pending_confirmation','confirmed','waitlisted','cancelled','attended'),true)) { csktm_fail('engagement_receive_reservation','An event record has an unsupported reservation state.'); }
            csktm_eng_int($record['rsvp']['partySize']??null,'People attending',1,100);
        }
        if (($record['verification']??null)!==null && (!is_array($record['verification']) || !preg_match('/^[a-f0-9]{64}$/D',$record['verification']['token']??''))) { csktm_fail('engagement_receive_confirmation','Retain the original confirmation state.'); }
    } elseif ($kind==='mail') {
        if (!csktm_eng_uuid($record['entryId']??null) || !is_email($record['to']??'') || preg_match('/[\r\n]/',$record['to'])) { csktm_fail('engagement_receive_message','Retain one valid original recipient and submission ID.'); }
        csktm_eng_text($record['subject']??'','Message subject',500,true);
        csktm_eng_text($record['message']??'','Message text',40000,true);
        if (!in_array($record['state']??'',array('draft','pending','sending','accepted','failed','cancelled'),true) || !is_array($record['attempts']??null)) { csktm_fail('engagement_receive_transport','Retain the original message state and attempt history.'); }
    }
}
function csktm_eng_receive_preview($input) {
    if (!csktm_eng_admin()) { csktm_fail('engagement_receive_access','An administrator must receive an engagement workspace.',403); }
    $transfer=$input['transfer']??null; $workspace=$transfer['workspace']??null;
    if (!is_array($transfer) || ($transfer['schema']??null)!=='cskt.engagement.transfer.v1' || !csktm_sha($transfer['sha256']??null) ||
        !is_array($workspace) || ($workspace['schema']??null)!=='cskt.engagement.workspace.v1' ||
        !hash_equals($transfer['sha256'],csktm_eng_digest($workspace))) {
        csktm_fail('engagement_receive_hash','Choose the complete original engagement transfer with its matching workspace SHA-256.');
    }
    foreach (array('forms','entries','mail') as $key) {
        if (!is_array($workspace[$key]??null) || !array_is_list($workspace[$key])) { csktm_fail('engagement_receive_collection','Retain all three original workspace collections.'); }
    }
    if (!$workspace['forms']) { csktm_fail('engagement_receive_forms','Select a transfer containing at least one complete form.'); }
    $mapping=$input['parentMappings']??array();
    if (!is_array($mapping)) { csktm_fail('engagement_receive_mapping','Map original associated post IDs to their selected destination post IDs.'); }
    $replace=($input['replaceChanged']??false)===true;
    return csktm_transaction(function() use ($workspace,$transfer,$mapping,$replace) {
        $forms=array(); $entries=array(); $plan=array(); $changes=array(); $bindings=array();
        foreach ($workspace['forms'] as $form) {
            csktm_eng_validate_record('form',$form);
            if (isset($forms[$form['id']])) { csktm_fail('engagement_receive_duplicate','A form ID occurs more than once.'); }
            $original_post=$form['parent']['postId']??null;
            csktm_eng_int($original_post,'Original associated post',1,PHP_INT_MAX);
            $target=$mapping[(string)$original_post]??$original_post;
            $values=$form; $values['parentId']=$target;
            $normalized=csktm_eng_form_values($values);
            $candidate=$form;
            $new_parent=$normalized['parent'];
            $source_bindings=$form['parent']['sourceBindings']??array();
            if (untrailingslashit($workspace['origin']??'')!==untrailingslashit(home_url('/')) && !array_key_exists((string)$original_post,$mapping)) {
                csktm_fail('engagement_receive_mapping_required','Map every original resource explicitly when receiving on another WordPress site.',409,array('sourcePostId'=>$original_post));
            }
            if ($original_post!==$target || untrailingslashit($workspace['origin']??'')!==untrailingslashit(home_url('/'))) {
                $candidate['parent']=$new_parent;
                $candidate['receivedSource']=array('origin'=>$workspace['origin'],'formSha256'=>csktm_eng_digest($form),
                    'parent'=>$form['parent'],'exportSha256'=>$transfer['sha256']);
            }
            $forms[$form['id']]=$form;
            $bindings[]=array('formId'=>$form['id'],'sourceParent'=>$form['parent'],'destinationParent'=>$new_parent);
            $plan[]=array('kind'=>'form','id'=>$form['id'],'sourceSha256'=>csktm_eng_digest($form),'data'=>$candidate);
        }
        foreach ($workspace['entries'] as $entry) {
            csktm_eng_validate_record('entry',$entry);
            if (isset($entries[$entry['id']]) || !isset($forms[$entry['formId']]) || $forms[$entry['formId']]['mode']!==$entry['mode']) { csktm_fail('engagement_receive_relationship','Every distinct submission must belong to an included form of its original type.'); }
            $entries[$entry['id']]=$entry;
            $plan[]=array('kind'=>'entry','id'=>$entry['id'],'sourceSha256'=>csktm_eng_digest($entry),'data'=>$entry);
        }
        $mail_ids=array();
        foreach ($workspace['mail'] as $mail) {
            csktm_eng_validate_record('mail',$mail);
            if (isset($mail_ids[$mail['id']]) || !isset($entries[$mail['entryId']]) || $entries[$mail['entryId']]['formId']!==$mail['formId']) { csktm_fail('engagement_receive_mail_relationship','Every distinct message must belong to an included original submission.'); }
            $mail_ids[$mail['id']]=true;
            $current=csktm_eng_row('mail',$mail['id'],false);
            $candidate=$mail;
            if (!$current || $current['sha256']!==csktm_eng_digest($mail)) {
                $candidate['dispatchDisabled']=true;
                $candidate['receivedSource']=array('origin'=>$workspace['origin'],'messageSha256'=>csktm_eng_digest($mail),'exportSha256'=>$transfer['sha256']);
            }
            $plan[]=array('kind'=>'mail','id'=>$mail['id'],'sourceSha256'=>csktm_eng_digest($mail),'data'=>$candidate);
        }
        $counts=array('create'=>0,'same'=>0,'replace'=>0,'conflict'=>0);
        foreach ($plan as &$item) {
            $current=csktm_eng_row($item['kind'],$item['id'],false);
            $item['expectedSha256']=$current?$current['sha256']:null;
            $item['candidateSha256']=csktm_eng_digest($item['data']);
            $action=!$current?'create':($current['sha256']===$item['candidateSha256']?'same':($replace?'replace':'conflict'));
            $item['action']=$action; $counts[$action]++;
            $changes[]=array('kind'=>$item['kind'],'id'=>$item['id'],'action'=>$action,
                'sourceRevision'=>$item['data']['revision'],'currentRevision'=>$current?$current['data']['revision']:null,
                'expectedSha256'=>$item['expectedSha256'],'candidateSha256'=>$item['candidateSha256']);
        }
        unset($item);
        $id=wp_generate_uuid4();
        $preview=array('schema'=>'cskt.engagement.receiving-preview.v1','id'=>$id,'createdAt'=>csktm_now(),
            'actor'=>get_current_user_id(),'sourceSha256'=>$transfer['sha256'],'sourceOrigin'=>$workspace['origin'],
            'bindings'=>$bindings,'counts'=>$counts,'changes'=>$changes,'plan'=>$plan,'replaceChanged'=>$replace);
        $preview['sha256']=csktm_eng_digest($preview);
        if (!add_option('cskt_eng_preview_'.$id,$preview,'','no')) { csktm_fail('engagement_preview_write','The complete receiving preview could not be retained.',500); }
        unset($preview['plan']);
        return $preview;
    });
}
function csktm_eng_receive_apply($input) {
    if (!csktm_eng_admin()) { csktm_fail('engagement_receive_access','An administrator must receive an engagement workspace.',403); }
    $id=$input['previewId']??null; $operation=$input['operationId']??null;
    if (!csktm_eng_uuid($id) || !csktm_eng_uuid($operation) || !csktm_sha($input['sha256']??null)) { csktm_fail('engagement_receive_identity','Keep the exact preview ID, preview hash and one receiving operation UUID.'); }
    return csktm_transaction(function() use ($input,$id,$operation) {
        $operation_key='cskt_eng_receive_'.$operation;
        wp_cache_delete($operation_key,'options');
        $old=get_option($operation_key);
        if (is_array($old)) {
            if (!hash_equals($old['requestSha256'],csktm_eng_digest($input))) { csktm_fail('engagement_receive_operation_conflict','This receiving operation already identifies a different preview.',409); }
            return array('result'=>$old['result'],'replayed'=>true);
        }
        $key='cskt_eng_preview_'.$id; wp_cache_delete($key,'options');
        $preview=get_option($key);
        if (!is_array($preview) || $preview['actor']!==get_current_user_id() || !hash_equals($preview['sha256'],$input['sha256'])) { csktm_fail('engagement_receive_preview','Use your original complete receiving preview and its hash.',409); }
        if ($preview['counts']['conflict']) { csktm_fail('engagement_receive_conflicts','Review the changed destination records and select replacement before receiving.',409); }
        $check=$preview; unset($check['sha256']);
        if (!hash_equals($preview['sha256'],csktm_eng_digest($check))) { csktm_fail('engagement_receive_preview_changed','The retained receiving preview has changed.',409); }
        foreach ($preview['plan'] as $item) {
            $current=csktm_eng_row($item['kind'],$item['id'],false);
            if (($current?$current['sha256']:null)!==$item['expectedSha256']) { csktm_fail('engagement_receive_destination_changed','A selected native record changed after preview. Preview the same original transfer again.',409); }
            if ($item['kind']==='form') {
                $parent=csktm_eng_parent($item['data']['parent']['postId'],$item['data']['state']==='open');
                if (!current_user_can('edit_post',$parent['postId'])) { csktm_fail('engagement_parent_access','Your access to a selected parent changed.',403); }
                $binding=array_values(array_filter($preview['bindings'],function($b) use ($item) { return $b['formId']===$item['id']; }))[0];
                if (csktm_eng_digest($parent)!==csktm_eng_digest($binding['destinationParent'])) { csktm_fail('engagement_parent_changed','An associated native resource changed after receiving preview.',409); }
            }
        }
        $saved=array();
        foreach ($preview['plan'] as $item) {
            if ($item['action']!=='same') { $row=csktm_eng_put($item['kind'],$item['data']); }
            else { $row=csktm_eng_row($item['kind'],$item['id']); }
            if (!hash_equals($item['candidateSha256'],$row['sha256'])) { csktm_fail('engagement_receive_readback','The received record did not retain the selected complete content.',500); }
            $saved[]=array('kind'=>$item['kind'],'id'=>$item['id'],'nativeId'=>$row['nativeId'],'sha256'=>$row['sha256'],'action'=>$item['action']);
        }
        $result=array('schema'=>'cskt.engagement.received.v1','operationId'=>$operation,'previewId'=>$id,
            'sourceSha256'=>$preview['sourceSha256'],'sourceOrigin'=>$preview['sourceOrigin'],
            'receivedAt'=>csktm_now(),'actor'=>get_current_user_id(),'counts'=>$preview['counts'],
            'bindings'=>$preview['bindings'],'records'=>$saved);
        if (!add_option($operation_key,array('requestSha256'=>csktm_eng_digest($input),'result'=>$result),'','no')) { csktm_fail('engagement_receive_result','WordPress could not retain the completed receiving result.',500); }
        return array('result'=>$result,'replayed'=>false);
    });
}
