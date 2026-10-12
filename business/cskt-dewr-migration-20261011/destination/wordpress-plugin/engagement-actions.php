<?php
/** Consent, reservations, moderation and the native correspondence journal. */
if (!defined('ABSPATH')) { exit; }

function csktm_eng_new_mail($entry,$kind,$to,$subject,$message,$automatic=true) {
    if (!is_email($to) || preg_match('/[\r\n]/',$to)) { csktm_fail('engagement_mail_address','A message needs one valid recipient.'); }
    $mail=array('schema'=>'cskt.engagement.mail.v1','id'=>wp_generate_uuid4(),'entryId'=>$entry['id'],
        'formId'=>$entry['formId'],'mode'=>$entry['mode'],'kind'=>$kind,'revision'=>0,
        'createdAt'=>csktm_now(),'to'=>$to,'subject'=>sanitize_text_field(csktm_eng_text($subject,'Email subject',500,true)),
        'message'=>csktm_eng_text($message,'Email message',40000,true),
        'state'=>$automatic?'pending':'draft','automatic'=>$automatic,'dispatchDisabled'=>false,
        'history'=>array(),'operations'=>array(),'attempts'=>array());
    if ($kind==='registration_update') {
        $mail['registrationSnapshot']=array('state'=>$entry['rsvp']['state'],
            'partySize'=>$entry['rsvp']['partySize'],'confirmedAt'=>$entry['rsvp']['confirmedAt']);
    }
    csktm_eng_event($mail,'message_prepared',array('kind'=>$kind,'automatic'=>$automatic));
    csktm_eng_put('mail',$mail);
    return $mail;
}
function csktm_eng_management_url($entry,$confirm=false) {
    $token=$confirm?$entry['verification']['token']:$entry['receiptKey'];
    return csktm_eng_portal_url().'#cskt-'.($confirm?'confirm':'receipt').'='.$entry['id'].':'.$token;
}
function csktm_eng_verification_mail($entry,$form) {
    $purpose=$entry['mode']==='newsletter'?'newsletter signup':'event registration';
    $mail=csktm_eng_new_mail($entry,'confirmation',$entry['submission']['email'],
        'Confirm your '.$purpose.': '.$form['title'],
        'Please confirm your '.$purpose.' for '.$form['title'].".\n\n".
        csktm_eng_management_url($entry,true)."\n\n".
        'The confirmation link expires '.$entry['verification']['expiresAt'].".\n".
        'Open the link and choose Confirm. If you did not request this, you can ignore the message.'."\n\n".
        'Your private receipt and cancellation link:'."\n".csktm_eng_management_url($entry));
    $mail['verificationTokenSha256']=hash('sha256',$entry['verification']['token']);
    csktm_eng_put('mail',$mail);
    return $mail;
}
function csktm_eng_schedule_mail($mail_id) {
    $row=csktm_eng_row('mail',$mail_id,false);
    if (!$row || $row['data']['state']!=='pending' || !$row['data']['automatic'] || $row['data']['dispatchDisabled']) { return; }
    if (!wp_next_scheduled('csktm_engagement_deliver',array($mail_id))) {
        $scheduled=wp_schedule_single_event(time()+1,'csktm_engagement_deliver',array($mail_id),true);
        if (($scheduled===false || is_wp_error($scheduled)) && !wp_next_scheduled('csktm_engagement_deliver',array($mail_id))) {
            csktm_fail('engagement_mail_schedule','The message is saved. Resume this exact action to finish scheduling its pending mail.',503);
        }
    }
}
add_action('csktm_engagement_deliver',function($mail_id) {
    try {
        $mail=csktm_eng_row('mail',$mail_id)['data'];
        if ($mail['state']==='pending' && !$mail['dispatchDisabled']) {
            csktm_eng_deliver($mail_id,array('operationId'=>wp_generate_uuid4(),'expectedRevision'=>$mail['revision']),true);
        }
    } catch (Throwable $error) {
        // The saved message and any attempt remain available in the staff outbox.
        do_action('csktm_engagement_delivery_error',$mail_id,$error);
    }
});
function csktm_eng_deliver($mail_id,$input,$cron=false) {
    if (!$cron && !csktm_eng_staff()) { csktm_fail('engagement_mail_access','Staff access is required to send this message.',403); }
    $operation=$input['operationId']??null;
    $prepared=csktm_transaction(function() use ($mail_id,$input,$operation,$cron) {
        $row=csktm_eng_row('mail',$mail_id); $mail=$row['data'];
        $previous=csktm_eng_operation($mail,$operation,'send_mail',$input);
        if ($previous) { return array('record'=>$row,'send'=>false,'replayed'=>true); }
        csktm_eng_expected($mail,$input['expectedRevision']??null);
        if ($mail['dispatchDisabled']) { csktm_fail('engagement_received_mail','This message is retained from a received workspace. Prepare a new staff message to use the receiving site transport.',409); }
        if (!in_array($mail['state'],array('draft','pending','failed'),true)) { csktm_fail('engagement_mail_state','This message already has a sending outcome. Review its saved attempt before another decision.',409); }
        if ($cron && $mail['state']!=='pending') { return array('record'=>$row,'send'=>false,'replayed'=>false); }
        $entry=csktm_eng_row('entry',$mail['entryId'])['data'];
        if ($entry['state']==='spam' || $entry['state']==='archived') { csktm_fail('engagement_recipient_inactive','Review the archived or spam submission before sending correspondence.',409); }
        if ($mail['kind']==='confirmation' && (!hash_equals($mail['verificationTokenSha256']??'',hash('sha256',$entry['verification']['token']??'')) || !empty($entry['verification']['confirmedAt']) || !empty($entry['verification']['revokedAt']) ||
                ($entry['subscription']??null)==='unsubscribed' || ($entry['rsvp']['state']??null)==='cancelled' ||
                strtotime($entry['verification']['expiresAt'])<time())) {
            $mail['state']='cancelled';
            csktm_eng_event($mail,'confirmation_no_longer_needed');
            csktm_eng_remember($mail,$operation,'send_mail',$input);
            return array('record'=>csktm_eng_put('mail',$mail),'send'=>false,'replayed'=>false);
        }
        if ($mail['kind']==='registration_update') {
            $bound=$mail['registrationSnapshot']??null;
            if (!is_array($bound) || ($entry['rsvp']['state']??null)!=='confirmed' ||
                ($entry['rsvp']['confirmedAt']??null)!==($bound['confirmedAt']??null) ||
                ($entry['rsvp']['partySize']??null)!==($bound['partySize']??null)) {
                $mail['state']='cancelled';
                csktm_eng_event($mail,'registration_update_superseded');
                csktm_eng_remember($mail,$operation,'send_mail',$input);
                return array('record'=>csktm_eng_put('mail',$mail),'send'=>false,'replayed'=>false);
            }
        }
        $attempt=wp_generate_uuid4();
        $mail['state']='sending';
        $mail['attempts'][]=array('id'=>$attempt,'operationId'=>$operation,'startedAt'=>csktm_now(),
            'completedAt'=>null,'transport'=>'wp_mail','outcome'=>'sending','actor'=>get_current_user_id());
        csktm_eng_event($mail,'send_started',array('attemptId'=>$attempt));
        csktm_eng_remember($mail,$operation,'send_mail',$input);
        return array('record'=>csktm_eng_put('mail',$mail),'send'=>true,'attemptId'=>$attempt,'replayed'=>false);
    });
    if (!$prepared['send']) { return $prepared; }
    $mail=$prepared['record']['data']; $outcome='sending';
    try { $outcome=wp_mail($mail['to'],$mail['subject'],$mail['message'],array('Content-Type: text/plain; charset=UTF-8'))===true?'accepted':'failed'; }
    catch (Throwable $error) { $outcome='sending'; }
    return csktm_transaction(function() use ($mail_id,$prepared,$outcome) {
        $mail=csktm_eng_row('mail',$mail_id)['data'];
        foreach ($mail['attempts'] as &$attempt) {
            if ($attempt['id']===$prepared['attemptId']) {
                if ($attempt['outcome']!=='sending') { return array('record'=>csktm_eng_row('mail',$mail_id),'replayed'=>true); }
                $attempt['completedAt']=$outcome==='sending'?null:csktm_now(); $attempt['outcome']=$outcome;
                $mail['state']=$attempt['outcome'];
                csktm_eng_event($mail,'send_completed',array('attemptId'=>$attempt['id'],'outcome'=>$attempt['outcome']));
                break;
            }
        }
        unset($attempt);
        return array('record'=>csktm_eng_put('mail',$mail),'replayed'=>false);
    });
}
function csktm_eng_mail_decision($mail_id,$input) {
    return csktm_transaction(function() use ($mail_id,$input) {
        $row=csktm_eng_row('mail',$mail_id); $mail=$row['data'];
        $action=$input['action']??''; $op=$input['operationId']??null;
        $old=csktm_eng_operation($mail,$op,$action,$input);
        if ($old) {
            $copy_id=$old['result']['copyId']??null;
            return array('record'=>$row,'copy'=>$copy_id?csktm_eng_row('mail',$copy_id)['data']:null,'replayed'=>true);
        }
        csktm_eng_expected($mail,$input['expectedRevision']??null);
        if ($action==='save_draft') {
            if (!in_array($mail['state'],array('draft','failed'),true) || $mail['kind']!=='staff_reply' || $mail['dispatchDisabled']) {
                csktm_fail('engagement_mail_state','Only an unsent staff response can be edited.',409);
            }
            $mail['subject']=sanitize_text_field(csktm_eng_text($input['subject']??'','Subject',500,true));
            $mail['message']=csktm_eng_text($input['message']??'','Message',40000,true);
            $mail['state']='draft';
        } elseif ($action==='cancel') {
            if ($mail['state']==='sending' || $mail['state']==='accepted') { csktm_fail('engagement_mail_state','A started send retains its outcome. Use the transport reconciliation decision for an interrupted attempt.',409); }
            $mail['state']='cancelled';
        } elseif ($action==='reconcile') {
            if (!csktm_eng_admin()) { csktm_fail('engagement_admin','An administrator must reconcile the installed email transport.',403); }
            if ($mail['state']!=='sending' || !in_array($input['outcome']??'',array('accepted','failed'),true)) {
                csktm_fail('engagement_reconcile','Choose the observed accepted or failed result of this sending attempt.',409);
            }
            $note=csktm_eng_text($input['note']??'','Transport observation',4000,true);
            $mail['state']=$input['outcome'];
            $index=count($mail['attempts'])-1;
            if ($index<0) { csktm_fail('engagement_attempt','The retained sending attempt is missing.',409); }
            $mail['attempts'][$index]['outcome']=$input['outcome'];
            $mail['attempts'][$index]['completedAt']=csktm_now();
            $mail['attempts'][$index]['reconciliation']=array('actor'=>get_current_user_id(),'note'=>$note);
        } elseif ($action==='new_copy') {
            $entry=csktm_eng_row('entry',$mail['entryId'])['data'];
            if ($mail['kind']!=='staff_reply') { csktm_fail('engagement_mail_kind','Use the submission’s confirmation action for a consent message.',409); }
            $copy=csktm_eng_new_mail($entry,'staff_reply',$entry['submission']['email'],$mail['subject'],$mail['message'],false);
            $mail['copies'][]=$copy['id'];
        } else { csktm_fail('engagement_action','Choose a supported correspondence action.'); }
        csktm_eng_event($mail,$action,array('state'=>$mail['state']));
        csktm_eng_remember($mail,$op,$action,$input,array('copyId'=>$copy['id']??null));
        return array('record'=>csktm_eng_put('mail',$mail),'copy'=>$copy??null,'replayed'=>false);
    });
}
function csktm_eng_occupied($form_id,$except=null) {
    $seats=0;
    foreach (csktm_eng_all('entry',array('formId'=>$form_id,'mode'=>'rsvp')) as $row) {
        $entry=$row['data'];
        if ($entry['id']!==$except && in_array($entry['rsvp']['state']??'',array('confirmed','attended'),true)) {
            $seats+=(int)$entry['rsvp']['partySize'];
        }
    }
    return $seats;
}
function csktm_eng_reservation_order($left,$right) {
    $time=strtotime($left['createdAt'])<=>strtotime($right['createdAt']);
    return $time!==0?$time:strcmp($left['id'],$right['id']);
}
function csktm_eng_reservations($form_id) {
    $entries=array_map(function($row){return $row['data'];},csktm_eng_all('entry',array('formId'=>$form_id,'mode'=>'rsvp')));
    usort($entries,'csktm_eng_reservation_order');
    return $entries;
}
function csktm_eng_allocate(&$entry,$form) {
    $size=$entry['rsvp']['partySize'];
    $occupied=csktm_eng_occupied($form['id'],$entry['id']);
    $available=$form['capacity']===0 || $occupied+$size<=$form['capacity'];
    foreach (csktm_eng_reservations($form['id']) as $waiting) {
        if ($waiting['id']!==$entry['id'] && ($waiting['rsvp']['state']??'')==='waitlisted' && csktm_eng_reservation_order($waiting,$entry)<0) { $available=false; break; }
    }
    $entry['rsvp']['state']=$available?'confirmed':'waitlisted';
    if ($available) { $entry['rsvp']['confirmedAt']=csktm_now(); }
    return $available;
}
function csktm_eng_promote($form) {
    if ($form['mode']!=='rsvp' || !csktm_eng_available($form)) { return array(); }
    $occupied=csktm_eng_occupied($form['id']); $mail_ids=array();
    foreach (csktm_eng_reservations($form['id']) as $entry) {
        if (($entry['rsvp']['state']??'')!=='waitlisted' || in_array($entry['state'],array('spam','archived'),true)) { continue; }
        $size=$entry['rsvp']['partySize'];
        // Waiting parties keep chronological priority; a later small party does not overtake.
        if ($form['capacity']!==0 && $occupied+$size>$form['capacity']) { break; }
        $entry['rsvp']['state']='confirmed'; $entry['rsvp']['confirmedAt']=csktm_now();
        csktm_eng_event($entry,'waitlist_promoted',array('partySize'=>$size));
        csktm_eng_put('entry',$entry); $occupied+=$size;
        $mail=csktm_eng_new_mail($entry,'registration_update',$entry['submission']['email'],
            'Your registration is confirmed: '.$form['title'],
            'Your place for '.$form['title'].' is confirmed for '.$size." participant(s).\n\n".
            'Your private receipt and cancellation link:'."\n".csktm_eng_management_url($entry));
        $mail_ids[]=$mail['id'];
    }
    return $mail_ids;
}
function csktm_eng_confirm($id,$input) {
    $result=csktm_transaction(function() use ($id,$input) {
        $entry=csktm_eng_row('entry',$id)['data'];
        $token=$input['token']??null; $verification=$entry['verification'];
        if (!$verification || !is_string($token) || !hash_equals($verification['token'],$token)) { csktm_fail('engagement_confirmation','Use the complete confirmation link from the email.',403); }
        if (!empty($verification['revokedAt']) || in_array($entry['state'],array('spam','archived'),true) ||
            ($entry['subscription']??null)==='unsubscribed' || ($entry['rsvp']['state']??null)==='cancelled') {
            csktm_fail('engagement_confirmation_withdrawn','This confirmation has been withdrawn. Submit the current form for a new request.',409);
        }
        if (!empty($verification['confirmedAt'])) { return array('entry'=>$entry,'replayed'=>true); }
        if (strtotime($verification['expiresAt'])<time()) { csktm_fail('engagement_confirmation_expired','The confirmation expired. Use the private receipt to request a new confirmation.',409); }
        $form=csktm_eng_row('form',$entry['formId'])['data'];
        if ($entry['mode']==='rsvp' && !csktm_eng_available($form)) { csktm_fail('engagement_registration_closed','This event is no longer accepting confirmations.',409); }
        $entry['verification']['confirmedAt']=csktm_now();
        if ($entry['mode']==='newsletter') { $entry['subscription']='confirmed'; }
        elseif ($entry['mode']==='rsvp') { csktm_eng_allocate($entry,$form); }
        else { csktm_fail('engagement_confirmation_kind','This submission does not require email confirmation.'); }
        csktm_eng_event($entry,'email_confirmed',array('subscription'=>$entry['subscription'],'rsvp'=>$entry['rsvp']),0);
        csktm_eng_put('entry',$entry);
        return array('entry'=>$entry,'replayed'=>false);
    });
    return array('receipt'=>csktm_eng_receipt($result['entry']),'replayed'=>$result['replayed']);
}
function csktm_eng_public_decision($id,$input) {
    $mail_ids=array();
    $result=csktm_transaction(function() use ($id,$input,&$mail_ids) {
        $entry=csktm_eng_receipt_entry($id,$input['receiptKey']??null);
        $form=csktm_eng_row('form',$entry['formId'])['data'];
        $action=$input['action']??''; $op=$input['operationId']??null;
        $previous=csktm_eng_operation($entry,$op,$action,$input);
        if ($previous) {
            $mail_ids=$previous['result']['scheduledMailIds']??array();
            return array('entry'=>$entry,'replayed'=>true);
        }
        if ($action==='unsubscribe' && $entry['mode']==='newsletter') {
            $email=$entry['submission']['email'];
            // A withdrawal applies to every subscription to this form for this address.
            foreach (csktm_eng_all('entry',array('formId'=>$form['id'],'mode'=>'newsletter')) as $other_row) {
                $other=$other_row['data'];
                if ($other['id']===$id || $other['submission']['email']!==$email || $other['subscription']==='unsubscribed') { continue; }
                $other['subscription']='unsubscribed'; $other['verification']['revokedAt']=csktm_now();
                csktm_eng_event($other,'subscriber_withdrew',array('viaEntryId'=>$id),0);
                csktm_eng_put('entry',$other);
            }
            $entry['subscription']='unsubscribed'; $entry['verification']['revokedAt']=csktm_now();
        } elseif ($action==='cancel_registration' && $entry['mode']==='rsvp') {
            $entry['rsvp']['state']='cancelled';
            $entry['verification']['revokedAt']=csktm_now();
        } elseif ($action==='withdraw_publication' && $entry['mode']==='comment') {
            $entry['publicationPermissionWithdrawnAt']=csktm_now();
            $entry['publicComment']['state']='withdrawn';
        } elseif ($action==='resend_confirmation' && in_array($entry['mode'],array('newsletter','rsvp'),true)) {
            if (($entry['subscription']??null)==='unsubscribed' || ($entry['rsvp']['state']??null)==='cancelled' || !empty($entry['verification']['confirmedAt'])) {
                csktm_fail('engagement_confirmation_state','This request already has a completed confirmation or withdrawal.',409);
            }
            csktm_eng_rate($form,$entry['submission']['email']);
            $entry['verification']=array('token'=>bin2hex(random_bytes(32)),'expiresAt'=>gmdate('Y-m-d\TH:i:s\Z',time()+7*DAY_IN_SECONDS),'confirmedAt'=>null);
            $mail=csktm_eng_verification_mail($entry,$form); $mail_ids[]=$mail['id'];
        } else { csktm_fail('engagement_public_action','Choose an action available for this receipt.'); }
        csktm_eng_event($entry,$action,array(),0);
        if ($action==='cancel_registration') {
            // Promotion reads the released seats inside this same transaction.
            csktm_eng_put('entry',$entry);
            $mail_ids=array_merge($mail_ids,csktm_eng_promote($form));
        }
        csktm_eng_remember($entry,$op,$action,$input,array('scheduledMailIds'=>$mail_ids));
        csktm_eng_put('entry',$entry);
        return array('entry'=>$entry,'replayed'=>false);
    });
    foreach ($mail_ids as $mail_id) { csktm_eng_schedule_mail($mail_id); }
    return array('receipt'=>csktm_eng_receipt($result['entry']),'replayed'=>$result['replayed']);
}
function csktm_eng_entry_decision($id,$input) {
    $mail_ids=array();
    $result=csktm_transaction(function() use ($id,$input,&$mail_ids) {
        $row=csktm_eng_row('entry',$id); $entry=$row['data'];
        $form=csktm_eng_row('form',$entry['formId'])['data'];
        $action=$input['action']??''; $op=$input['operationId']??null;
        $previous=csktm_eng_operation($entry,$op,$action,$input);
        if ($previous) {
            $mail_ids=$previous['result']['scheduledMailIds']??array();
            $mail_id=$previous['result']['mailId']??null;
            return array('record'=>$row,'mail'=>$mail_id?csktm_eng_row('mail',$mail_id)['data']:null,'replayed'=>true);
        }
        csktm_eng_expected($entry,$input['expectedRevision']??null);
        if ($action==='review') {
            $state=$input['state']??'in_review';
            if (!in_array($state,array('new','in_review','resolved','archived','spam'),true)) { csktm_fail('engagement_review_state','Choose a supported staff review state.'); }
            $assigned=csktm_eng_int($input['assignedTo']??0,'Assigned staff account',0,PHP_INT_MAX);
            if ($assigned && !user_can($assigned,'edit_pages')) { csktm_fail('engagement_assignment','Choose a staff account with page editing access.'); }
            $entry['assignedTo']=$assigned;
            $entry['staffNotes']=csktm_eng_text($input['staffNotes']??'','Staff notes',20000);
            $entry['state']=$state;
            if (in_array($state,array('archived','spam'),true)) {
                if ($entry['mode']==='comment') { $entry['publicComment']['state']='withdrawn'; }
                if ($entry['mode']==='newsletter') { $entry['subscription']='unsubscribed'; }
                if ($entry['mode']==='rsvp') { $entry['rsvp']['state']='cancelled'; }
                if ($entry['verification']) { $entry['verification']['revokedAt']=csktm_now(); }
            }
        } elseif ($action==='publish_comment') {
            if (!csktm_eng_publisher()) { csktm_fail('engagement_publish_access','A publisher must release public comments.',403); }
            if ($entry['mode']!=='comment' || !csktm_eng_publication_allowed($entry) || in_array($entry['state'],array('archived','spam'),true)) {
                csktm_fail('engagement_publication_consent','This comment needs active publication consent before release.',409);
            }
            csktm_eng_parent($form['parent']['postId'],true);
            $entry['publicComment']=array('state'=>'published',
                'text'=>csktm_eng_text($input['text']??'','Reviewed public comment',20000,true),
                'displayName'=>csktm_eng_text($input['displayName']??'','Reviewed display name',200),
                'publishedAt'=>csktm_now(),'publishedBy'=>get_current_user_id());
        } elseif ($action==='withdraw_comment') {
            $entry['publicComment']['state']='withdrawn';
        } elseif ($action==='prepare_reply') {
            $subject=csktm_eng_text($input['subject']??'','Reply subject',500,true);
            $message=csktm_eng_text($input['message']??'','Reply message',40000,true);
            $mail=csktm_eng_new_mail($entry,'staff_reply',$entry['submission']['email'],$subject,$message,false);
            $entry['responseDraft']=array('subject'=>$subject,'message'=>$message);
            $entry['replyIds'][]=$mail['id'];
        } elseif ($action==='confirm_registration') {
            if ($entry['mode']!=='rsvp' || in_array($entry['state'],array('spam','archived'),true)) { csktm_fail('engagement_registration','Choose an active event registration.',409); }
            if (!in_array($entry['rsvp']['state'],array('pending_confirmation','waitlisted'),true)) { csktm_fail('engagement_registration_state','This registration has already been confirmed or cancelled.',409); }
            $note=csktm_eng_text($input['note']??'','Staff confirmation basis',4000,true);
            csktm_eng_allocate($entry,$form);
            $entry['verification']['confirmedAt']=csktm_now();
            $entry['verification']['staffConfirmation']=array('actor'=>get_current_user_id(),'note'=>$note);
        } elseif ($action==='cancel_registration') {
            if ($entry['mode']!=='rsvp') { csktm_fail('engagement_registration','Choose an event registration.'); }
            $entry['rsvp']['state']='cancelled'; $entry['verification']['revokedAt']=csktm_now();
        } elseif ($action==='check_in') {
            if ($entry['mode']!=='rsvp' || $entry['rsvp']['state']!=='confirmed') { csktm_fail('engagement_registration_state','Only a confirmed registration can be checked in.',409); }
            $entry['rsvp']['state']='attended'; $entry['rsvp']['attendedAt']=csktm_now();
        } elseif ($action==='resend_confirmation') {
            if (!$entry['verification'] || !empty($entry['verification']['confirmedAt']) || !empty($entry['verification']['revokedAt'])) {
                csktm_fail('engagement_confirmation_state','Choose an active, unconfirmed request.',409);
            }
            csktm_eng_rate($form,$entry['submission']['email']);
            $entry['verification']=array('token'=>bin2hex(random_bytes(32)),'expiresAt'=>gmdate('Y-m-d\TH:i:s\Z',time()+7*DAY_IN_SECONDS),'confirmedAt'=>null);
            $mail=csktm_eng_verification_mail($entry,$form); $mail_ids[]=$mail['id'];
        } else { csktm_fail('engagement_staff_action','Choose a supported staff action.'); }
        csktm_eng_event($entry,$action,array('state'=>$entry['state'],'rsvp'=>$entry['rsvp'],'subscription'=>$entry['subscription']));
        if ($entry['mode']==='rsvp' && ($action==='cancel_registration' || in_array($entry['state'],array('spam','archived'),true))) {
            csktm_eng_put('entry',$entry);
            $mail_ids=array_merge($mail_ids,csktm_eng_promote($form));
        }
        csktm_eng_remember($entry,$op,$action,$input,array('mailId'=>$mail['id']??null,'scheduledMailIds'=>$mail_ids));
        return array('record'=>csktm_eng_put('entry',$entry),'mail'=>$mail??null,'replayed'=>false);
    });
    foreach ($mail_ids as $mail_id) { csktm_eng_schedule_mail($mail_id); }
    return $result;
}
function csktm_eng_comments($form_id) {
    $form=csktm_eng_row('form',$form_id)['data'];
    if ($form['mode']!=='comment' || $form['state']==='draft') { return array(); }
    csktm_eng_parent($form['parent']['postId'],true);
    $items=array();
    foreach (csktm_eng_all('entry',array('formId'=>$form_id,'mode'=>'comment')) as $row) {
        $entry=$row['data']; $comment=$entry['publicComment'];
        if ($comment['state']==='published' && csktm_eng_publication_allowed($entry)) {
            $items[]=array_intersect_key($comment,array_flip(array('text','displayName','publishedAt')));
        }
    }
    return $items;
}
