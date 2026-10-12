<?php
declare(strict_types=1);
/**
 * Receive the complete DISO course in an owned local Moodle 4.5 installation.
 * Uses the original restore, enrolment, quiz, question and completion engines.
 */
define('CLI_SCRIPT', true);
$opt = getopt('', ['moodle-root:', 'package:', 'import-receipt:', 'receipt:', 'credentials:', 'action:', 'attempt-id:']);
foreach (['moodle-root', 'package', 'import-receipt', 'receipt', 'credentials'] as $key) {
    if (empty($opt[$key]) || !str_starts_with($opt[$key], '/')) { throw new RuntimeException('Absolute --' . $key . ' required'); }
}
require(realpath($opt['moodle-root']) . '/config.php');
require_once($CFG->dirroot . '/course/lib.php');
require_once($CFG->dirroot . '/user/lib.php');
require_once($CFG->libdir . '/enrollib.php');
require_once($CFG->libdir . '/completionlib.php');
require_once($CFG->dirroot . '/mod/quiz/lib.php');
require_once($CFG->dirroot . '/mod/quiz/locallib.php');
require_once($CFG->dirroot . '/backup/util/includes/restore_includes.php');

function recv_need(bool $ok, string $message): void {
    if (!$ok) { throw new RuntimeException($message); }
}
function recv_json(string $path): array {
    return json_decode(file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
}
function recv_save(string $path, array $value): void {
    $text = json_encode($value, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
    $temp = $path . '.pending-' . getmypid();
    recv_need(file_put_contents($temp, $text, LOCK_EX) === strlen($text), 'Retain complete original receiving state');
    chmod($temp, 0600);
    recv_need(rename($temp, $path), 'Promote original receiving state');
}
function recv_output(array $value): void {
    echo 'DISO_RESULT ' . json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
}
function recv_digest(mixed $value): string {
    return hash('sha256', json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
}
function recv_units(array $package): array {
    $result = [];
    foreach ($package['modules'] as $module) {
        foreach ($module['units'] as $unit) { $result[$unit['id']] = $unit; }
    }
    return $result;
}
function recv_cm(int $courseid, string $idnumber, string $kind): stdClass {
    global $DB;
    $cm = $DB->get_record('course_modules', ['course' => $courseid, 'idnumber' => $idnumber], '*', MUST_EXIST);
    recv_need((string)$DB->get_field('modules', 'name', ['id' => $cm->module], MUST_EXIST) === $kind, 'Original activity type matches ' . $idnumber);
    return $cm;
}
function recv_inventory(int $courseid, array $package): array {
    global $DB;
    $course = get_course($courseid);
    $units = [];
    foreach (recv_units($package) as $id => $unit) {
        $bookcm = recv_cm($courseid, $id . '-BOOK', 'book');
        $workcm = recv_cm($courseid, $id . '-WORKBOOK', 'assign');
        $quizcm = recv_cm($courseid, $id . '-QUIZ', 'quiz');
        $guidancecm = recv_cm($courseid, $id . '-GUIDANCE', 'page');
        $quiz = $DB->get_record('quiz', ['id' => $quizcm->instance], '*', MUST_EXIST);
        $grade = $DB->get_record('grade_items', ['courseid' => $courseid, 'itemtype' => 'mod',
            'itemmodule' => 'quiz', 'iteminstance' => $quiz->id, 'itemnumber' => 0], '*', MUST_EXIST);
        recv_need((int)$quiz->attempts === 0 && $quiz->preferredbehaviour === 'immediatefeedback' &&
            (int)$quiz->grademethod === QUIZ_GRADEHIGHEST && (float)$grade->gradepass === 75.0 &&
            (float)$grade->grademax === 100.0, 'Original assessment retry/feedback/highest-grade/pass policy: ' . $id);
        recv_need((int)$quizcm->completion === COMPLETION_TRACKING_AUTOMATIC &&
            (int)$quizcm->completionpassgrade === 1 && (int)$quizcm->completiongradeitemnumber === 0,
            'Native completion requires a passing grade: ' . $id);
        foreach (['reviewmarks', 'reviewspecificfeedback', 'reviewgeneralfeedback', 'reviewrightanswer'] as $field) {
            $mask = \mod_quiz\question\display_options::IMMEDIATELY_AFTER;
            recv_need(((int)$quiz->$field & $mask) === $mask, 'Native immediate feedback is visible: ' . $id);
        }
        $chapters = array_values($DB->get_records('book_chapters', ['bookid' => $bookcm->instance], 'pagenum'));
        recv_need(count($chapters) === count($unit['chapters']), 'Complete native unit book: ' . $id);
        $book = [];
        foreach ($chapters as $i => $chapter) {
            recv_need($chapter->title === $unit['chapters'][$i]['title'] &&
                $chapter->content === $unit['chapters'][$i]['content'], 'Original editable book content: ' . $id);
            $book[] = ['title' => $chapter->title, 'html' => $chapter->content, 'page' => (int)$chapter->pagenum];
        }
        $work = $DB->get_record('assign', ['id' => $workcm->instance], '*', MUST_EXIST);
        recv_need($work->intro === $unit['applicationHtml'] && (int)$work->completionsubmit === 1 &&
            (int)$workcm->completion === COMPLETION_TRACKING_AUTOMATIC, 'Original native application workbook and submission completion: ' . $id);
        $guidance = $DB->get_record('page', ['id' => $guidancecm->instance], '*', MUST_EXIST);
        $condition = json_decode($guidancecm->availability, true, 512, JSON_THROW_ON_ERROR);
        recv_need($guidance->content === $unit['guidanceHtml'] && $condition['c'][0]['type'] === 'completion' &&
            (int)$condition['c'][0]['cm'] === (int)$workcm->id && (int)$condition['c'][0]['e'] === COMPLETION_COMPLETE,
            'Suggested answers and reflection guidance follow the original submitted workbook: ' . $id);
        $questions = $DB->count_records('quiz_slots', ['quizid' => $quiz->id]);
        recv_need($questions === count($unit['quiz']['questions']), 'Complete original question slots: ' . $id);
        $units[$id] = ['bookCmid' => (int)$bookcm->id, 'workbookCmid' => (int)$workcm->id,
            'guidanceCmid' => (int)$guidancecm->id, 'quizCmid' => (int)$quizcm->id, 'quizId' => (int)$quiz->id, 'questions' => $questions,
            'bookSha256' => recv_digest($book), 'workbookSha256' => hash('sha256', $work->intro),
            'bookChapterIds' => array_map(fn($c) => (int)$c->id, $chapters)];
    }
    recv_need(count($units) === 26 && array_sum(array_column($units, 'questions')) === 312, 'Receive every original course unit and question');
    $criteria = $DB->get_records('course_completion_criteria', ['course' => $courseid, 'criteriatype' => COMPLETION_CRITERIA_TYPE_ACTIVITY]);
    $required = array_column($units, 'quizCmid'); $actual = array_map(fn($c) => (int)$c->moduleinstance, array_values($criteria));
    sort($required); sort($actual);
    recv_need($required === $actual && (bool)$course->enablecompletion, 'All26 quiz passes control the original course completion');
    $presentations = [];
    foreach ($package['modules'] as $module) {
        $cm = recv_cm($courseid, $module['video']['id'], 'page'); $context = context_module::instance($cm->id);
        $files = [];
        foreach ($module['video']['files'] as $entry) {
            $file = get_file_storage()->get_file($context->id, 'mod_page', 'content', 0, '/', basename($entry['path']));
            recv_need($file && (int)$file->get_filesize() === $entry['bytes'] &&
                hash('sha256', $file->get_content()) === $entry['sha256'], 'Complete original media survives native file-store receiving');
            $files[] = ['name' => basename($entry['path']), 'bytes' => (int)$file->get_filesize(), 'sha256' => $entry['sha256']];
        }
        $presentations[$module['id']] = ['cmid' => (int)$cm->id, 'files' => $files];
    }
    $glossarycm = recv_cm($courseid, $package['course']['id'] . '-GLOSSARY', 'page');
    recv_need($DB->get_field('page', 'content', ['id' => $glossarycm->instance], MUST_EXIST) === $package['glossaryHtml'],
        'The complete editable native glossary is retained');
    return ['courseId' => $courseid, 'units' => $units, 'presentations' => $presentations, 'glossaryCmid' => (int)$glossarycm->id,
        'counts' => ['modules' => 13, 'units' => 26, 'books' => 26, 'workbooks' => 26, 'quizzes' => 26,
        'questions' => 312, 'chapters' => 104, 'guidancePages' => 26, 'presentations' => 13]];

}
function recv_user(string $kind, array $package, array &$private, string $file): stdClass {
    global $DB, $CFG;
    $username = 'diso_' . $kind . '_' . substr($package['sourceSha256'], 0, 12);
    if (!isset($private[$kind])) {
        $private[$kind] = ['username' => $username, 'password' => 'D!9a' . bin2hex(random_bytes(20))];
        recv_save($file, $private);
    }
    recv_need($private[$kind]['username'] === $username, 'Reuse original receiving account');
    $user = $DB->get_record('user', ['username' => $username, 'mnethostid' => $CFG->mnet_localhost_id]);
    if (!$user) {
        $id = user_create_user((object)[
            'username' => $username, 'password' => $private[$kind]['password'], 'auth' => 'manual',
            'confirmed' => 1, 'mnethostid' => $CFG->mnet_localhost_id,
            'firstname' => 'DISO', 'lastname' => ucfirst($kind) . ' learner',
            'email' => $username . '@example.invalid', 'emailstop' => 1, 'lang' => 'en',
            'country' => 'ZA', 'city' => 'Receiving installation', 'timezone' => 'Africa/Johannesburg',
        ], true, false);
        $user = $DB->get_record('user', ['id' => $id], '*', MUST_EXIST);
    }
    if (isset($private[$kind]['id'])) { recv_need($private[$kind]['id'] === (int)$user->id, 'Reuse the same original learner ID'); }
    $private[$kind]['id'] = (int)$user->id; recv_save($file, $private);
    return $user;
}
function recv_enrol(stdClass $user, int $courseid): void {
    global $DB;
    $plugin = enrol_get_plugin('manual');
    recv_need((bool)$plugin, 'Original manual enrolment plugin is installed');
    $instances = enrol_get_instances($courseid, true);
    $manual = null;
    foreach ($instances as $instance) { if ($instance->enrol === 'manual') { $manual = $instance; break; } }
    if (!$manual) {
        $id = $plugin->add_instance(get_course($courseid), ['status' => ENROL_INSTANCE_ENABLED]);
        $manual = $DB->get_record('enrol', ['id' => $id], '*', MUST_EXIST);
    }
    $role = $DB->get_record('role', ['shortname' => 'student'], '*', MUST_EXIST);
    if (!is_enrolled(context_course::instance($courseid), $user, '', true)) {
        $plugin->enrol_user($manual, (int)$user->id, (int)$role->id, 0, 0, ENROL_USER_ACTIVE);
    }
    recv_need(has_capability('mod/quiz:attempt', context_course::instance($courseid), $user) &&
        !has_capability('mod/quiz:preview', context_course::instance($courseid), $user),
        'Receiving learner uses original ordinary-student capabilities');
}
function recv_restore(array $package, array $import, array &$receipt, string $receiptfile, int $adminid): int {
    global $DB;
    $backup = $import['backup'];
    recv_need(is_file($backup['file']) && hash_file('sha256', $backup['file']) === $backup['sha256'], 'Use the original delivered native Moodle archive');
    $identity = 'DISO-RECEIVED:' . substr($package['sourceSha256'], 0, 20);
    $target = isset($receipt['restoredCourseId'])
        ? $DB->get_record('course', ['id' => $receipt['restoredCourseId']], '*', MUST_EXIST)
        : $DB->get_record('course', ['idnumber' => $identity]);
    if (!$target) {
        $original = get_course($import['courseId']);
        $target = create_course((object)[
            'fullname' => $package['course']['title'] . ' (received archive)',
            'shortname' => 'DISO-RECV-' . substr($package['sourceSha256'], 0, 10),
            'idnumber' => $identity, 'category' => $original->category, 'format' => 'topics',
            'numsections' => 13, 'visible' => 1, 'enablecompletion' => 1, 'lang' => 'en', 'newsitems' => 0,
        ]);
    }
    recv_need($target->idnumber === $identity && (int)$target->id !== $import['courseId'], 'Use only the owned receiving course');
    $receipt['restoredCourseId'] = (int)$target->id; recv_save($receiptfile, $receipt);
    $cmcount = $DB->count_records('course_modules', ['course' => $target->id]);
    if ($cmcount > 0) {
        // An accepted restore is read back from the same target after interruption.
        // A partial native restore must be repaired in this owned receiving target.
        recv_inventory((int)$target->id, $package);
        $receipt['restore']['state'] = 'COMPLETE'; recv_save($receiptfile, $receipt);
        return (int)$target->id;
    }
    $directory = $receipt['restore']['temporaryDirectory'] ?? restore_controller::get_tempdir_name(SITEID, $adminid);
    $path = make_backup_temp_directory($directory);
    if (!is_file($path . '/moodle_backup.xml')) {
        recv_need(get_file_packer('application/vnd.moodle.backup')->extract_to_pathname($backup['file'], $path),
            'Extract the same original native Moodle archive');
    }
    $controller = new restore_controller($directory, (int)$target->id, backup::INTERACTIVE_NO,
        backup::MODE_GENERAL, $adminid, backup::TARGET_EXISTING_ADDING);
    try {
        $receipt['restore'] = ['state' => 'PREPARING', 'temporaryDirectory' => $directory,
            'controllerId' => $controller->get_restoreid(), 'backupSha256' => $backup['sha256'],
            'targetCourseId' => (int)$target->id];
        recv_save($receiptfile, $receipt);
        $controller->execute_precheck();
        $precheck = $controller->get_precheck_results();
        recv_need(empty($precheck['errors']), 'Original Moodle restore precheck: ' . json_encode($precheck));
        $receipt['restore']['precheck'] = $precheck;
        $receipt['restore']['state'] = 'EXECUTING'; recv_save($receiptfile, $receipt);
        $controller->execute_plan();
        $receipt['restoredInventory'] = recv_inventory((int)$target->id, $package);
        $receipt['restore']['state'] = 'COMPLETE'; recv_save($receiptfile, $receipt);
    } finally { $controller->destroy(); }
    return (int)$target->id;
}
function recv_attempt(int $quizid, int $userid, int $number): stdClass {
    global $DB;
    $existing = $DB->get_record('quiz_attempts', ['quiz' => $quizid, 'userid' => $userid, 'attempt' => $number, 'preview' => 0]);
    if ($existing) { return $existing; }
    $last = $number > 1 ? $DB->get_record('quiz_attempts', ['quiz' => $quizid, 'userid' => $userid, 'attempt' => $number - 1, 'preview' => 0], '*', MUST_EXIST) : null;
    recv_need(!$last || $last->state === \mod_quiz\quiz_attempt::FINISHED, 'Finish the same original attempt before retrying');
    return quiz_prepare_and_start_new_attempt(\mod_quiz\quiz_settings::create($quizid, $userid), $number, $last,
        false, [], [], $userid);
}
function recv_grade_attempt(stdClass $attempt, bool $correct): array {
    global $DB;
    $object = \mod_quiz\quiz_attempt::create((int)$attempt->id);
    if ($attempt->state !== \mod_quiz\quiz_attempt::FINISHED) {
        if ($correct) {
            $post = []; $slots = [];
            foreach ($object->get_slots() as $slot) {
                $qa = $object->get_question_attempt($slot);
                if ($qa->get_state()->is_finished()) { continue; }
                $response = $qa->get_correct_response();
                recv_need(is_array($response) && count($response) > 0, 'Native question provides its own correct-response fixture');
                $slots[] = $slot;
                $post[$qa->get_control_field_name('sequencecheck')] = $qa->get_sequence_check_count();
                foreach ($response as $name => $value) {
                    $field = str_starts_with($name, '-') ? $qa->get_behaviour_field_name(substr($name, 1)) : $qa->get_qt_field_name($name);
                    $post[$field] = $value;
                }
                $post[$qa->get_behaviour_field_name('submit')] = 1;
            }
            if ($slots) {
                $post['slots'] = implode(',', $slots);
                // Feed the original engine its actual form-field names and sequence numbers.
                $object->process_submitted_actions(time(), false, $post);
            }
        }
        $object->process_finish(time(), false);
    }
    $object = \mod_quiz\quiz_attempt::create((int)$attempt->id);
    $native = $DB->get_record('quiz_attempts', ['id' => $attempt->id], '*', MUST_EXIST);
    $quiz = $DB->get_record('quiz', ['id' => $native->quiz], '*', MUST_EXIST);
    $percent = (float)$native->sumgrades * (float)$quiz->grade / (float)$quiz->sumgrades;
    recv_need($native->state === \mod_quiz\quiz_attempt::FINISHED && (int)$native->preview === 0, 'Original ordinary learner attempt is finished');
    recv_need($correct ? abs($percent - 100.0) < 0.00001 : $percent < 75.0, 'Native grading returns the expected complete result');
    $questions = []; $types = [];
    foreach ($object->get_slots() as $slot) {
        $qa = $object->get_question_attempt($slot); $q = $qa->get_question();
        if ($correct) { recv_need($qa->get_state()->is_correct(), 'Every original question type grades its correct response'); }
        $types[$q->get_type_name()] = ($types[$q->get_type_name()] ?? 0) + 1;
        $questions[] = ['name' => $q->name, 'type' => $q->get_type_name(), 'questionHtml' => $q->questiontext,
            'generalFeedbackHtml' => $q->generalfeedback, 'defaultMark' => (float)$q->defaultmark];
    }
    return ['attemptId' => (int)$native->id, 'attemptNumber' => (int)$native->attempt, 'quizId' => (int)$quiz->id,
        'percent' => $percent, 'questionCount' => count($questions), 'types' => $types, 'questionContentSha256' => recv_digest($questions)];
}
function recv_grade_course(int $courseid, stdClass $learner, array $inventory, array &$receipt, string $receiptfile): array {
    global $DB;
    \core\session\manager::set_user($learner);
    $completion = new completion_completion(['course' => $courseid, 'userid' => $learner->id]);
    $completion->mark_inprogress();
    $info = new completion_info(get_course($courseid)); $result = []; $first = true;
    foreach ($inventory['units'] as $id => $unit) {
        if ($first) {
            $failed = recv_grade_attempt(recv_attempt($unit['quizId'], (int)$learner->id, 1), false);
            $receipt['nativeRetries'][$courseid] = $failed;
        }
        $passed = recv_grade_attempt(recv_attempt($unit['quizId'], (int)$learner->id, $first ? 2 : 1), true);
        $grade = $DB->get_record('quiz_grades', ['quiz' => $unit['quizId'], 'userid' => $learner->id], '*', MUST_EXIST);
        recv_need(abs((float)$grade->grade - 100.0) < 0.00001, 'The native highest learner result is retained');
        $cm = get_fast_modinfo($courseid, $learner->id)->get_cm($unit['quizCmid']);
        $info->update_state($cm, COMPLETION_UNKNOWN, (int)$learner->id);
        $data = $info->get_data($cm, false, (int)$learner->id);
        recv_need((int)$data->completionstate === COMPLETION_COMPLETE_PASS, 'Original quiz completion records the passed assessment');
        $passed['completionState'] = (int)$data->completionstate;
        $result[$id] = $passed; $receipt['gradedCourses'][$courseid] = $result;
        recv_save($receiptfile, $receipt); $first = false;
    }
    \core_completion\api::mark_course_completions_activity_criteria();
    $nativecompletion = $DB->get_record('course_completions', ['course' => $courseid, 'userid' => $learner->id], '*', MUST_EXIST);
    aggregate_completions((int)$nativecompletion->id);
    $nativecompletion = $DB->get_record('course_completions', ['id' => $nativecompletion->id], '*', MUST_EXIST);
    recv_need(!empty($nativecompletion->timecompleted), 'Original Moodle course completion aggregates all26 passing unit assessments');
    $receipt['courseCompletion'][$courseid] = ['id' => (int)$nativecompletion->id, 'timeCompleted' => (int)$nativecompletion->timecompleted,
        'learnerId' => (int)$learner->id, 'passedUnits' => count($result)];
    recv_save($receiptfile, $receipt);
    return $result;
}
function recv_browser_attempt(int $id, array $private, array $receipt): array {
    global $DB;
    $row = $DB->get_record('quiz_attempts', ['id' => $id], '*', MUST_EXIST);
    $quiz = $DB->get_record('quiz', ['id' => $row->quiz], '*', MUST_EXIST);
    recv_need((int)$row->userid === $private['browser']['id'] &&
        in_array((int)$quiz->course, [$receipt['courseId'], $receipt['restoredCourseId']], true), 'Read only the owned browser learner attempt');
    $attempt = \mod_quiz\quiz_attempt::create($id); $questions = [];
    foreach ($attempt->get_slots() as $slot) {
        $qa = $attempt->get_question_attempt($slot); $question = $qa->get_question();
        $fields = [];
        foreach ($qa->get_correct_response() ?? [] as $name => $value) {
            if (str_starts_with($name, '-')) { continue; }
            $field = ['name' => $qa->get_qt_field_name($name), 'value' => (string)$value, 'key' => $name];
            if (in_array($question->get_type_name(), ['ddwtos', 'ddimageortext'], true)) {
                $place = (int)substr($name, 1);
                $group = $question->get_type_name() === 'ddimageortext' ? $question->places[$place]->group : $question->places[$place];
                $field += ['place' => $place, 'group' => (int)$group, 'choice' => (int)$value];
            }
            $fields[] = $field;
        }
        $questions[] = ['slot' => $slot, 'outerId' => $qa->get_outer_question_div_unique_id(),
            'type' => $question->get_type_name(), 'name' => $question->name, 'fields' => $fields,
            'finished' => $qa->get_state()->is_finished(), 'correct' => $qa->get_state()->is_correct()];
    }
    return ['attemptId' => $id, 'state' => $row->state, 'quizId' => (int)$row->quiz, 'attemptNumber' => (int)$row->attempt,
        'percent' => $row->sumgrades === null ? null : (float)$row->sumgrades * (float)$quiz->grade / (float)$quiz->sumgrades,
        'questions' => $questions];
}

umask(0077);
recv_need(in_array(parse_url($CFG->wwwroot, PHP_URL_HOST), ['127.0.0.1', 'localhost', '::1'], true),
    'Use the owned local receiving installation for these fixture learners');
$CFG->noemailever = true;
$package = recv_json($opt['package']); $import = recv_json($opt['import-receipt']);
recv_need(($package['schema'] ?? '') === 'dpsa.diso.moodle-package.v1' && $import['state'] === 'COMPLETE' &&
    $package['sourceSha256'] === $import['sourceSha256'], 'Receive this complete original imported course edition');
$receipt = is_file($opt['receipt']) ? recv_json($opt['receipt']) : [
    'schema' => 'dpsa.diso.original-moodle-receiving/v1', 'sourceSha256' => $package['sourceSha256'],
    'moodleCommit' => $package['moodleCommit'], 'courseId' => $import['courseId'], 'state' => 'RECEIVING',
];
recv_need($receipt['sourceSha256'] === $package['sourceSha256'], 'Continue the original course receiving operation');
$private = is_file($opt['credentials']) ? recv_json($opt['credentials']) : ['schema' => 'dpsa.diso.private-receiving-accounts/v1'];
$action = $opt['action'] ?? 'native';
if ($action === 'attempt-plan') {
    recv_output(recv_browser_attempt((int)($opt['attempt-id'] ?? 0), $private, $receipt)); exit(0);
}
recv_need($action === 'native', 'Unknown original receiving action');
$lock = fopen($opt['receipt'] . '.lock', 'c');
recv_need($lock !== false && flock($lock, LOCK_EX), 'Own this course receiving continuation');
$admin = get_admin(); recv_need((bool)$admin, 'Original installed Moodle administrator required');
\core\session\manager::set_user($admin); $PAGE->set_context(context_system::instance());
try {
    $receipt['originalInventory'] = recv_inventory($import['courseId'], $package);
    $restoredid = recv_restore($package, $import, $receipt, $opt['receipt'], (int)$admin->id);
    $receipt['restoredInventory'] = recv_inventory($restoredid, $package);
    foreach ($receipt['originalInventory']['units'] as $id => $unit) {
        $restored = $receipt['restoredInventory']['units'][$id];
        recv_need($unit['bookSha256'] === $restored['bookSha256'] && $unit['workbookSha256'] === $restored['workbookSha256'],
            'Whole editable book and workbook content survives native backup/restore: ' . $id);
    }
    $learner = recv_user('native', $package, $private, $opt['credentials']);
    $browser = recv_user('browser', $package, $private, $opt['credentials']);
    foreach ([$import['courseId'], $restoredid] as $courseid) { recv_enrol($learner, $courseid); recv_enrol($browser, $courseid); }
    $originalgrades = recv_grade_course($import['courseId'], $learner, $receipt['originalInventory'], $receipt, $opt['receipt']);
    $restoredgrades = recv_grade_course($restoredid, $learner, $receipt['restoredInventory'], $receipt, $opt['receipt']);
    foreach ($originalgrades as $id => $unit) {
        recv_need($unit['questionContentSha256'] === $restoredgrades[$id]['questionContentSha256'] &&
            $unit['types'] === $restoredgrades[$id]['types'], 'Native question types, content and feedback survive complete course receiving: ' . $id);
    }
    $receipt['nativeState'] = 'PASS';
    $receipt['nativeGradedQuestions'] = 624; $receipt['nativePassedQuizzes'] = 52;
    $receipt['browserLearnerId'] = (int)$browser->id;
    $receipt['state'] = 'NATIVE_COMPLETE'; $receipt['nativeCompletedAt'] = gmdate('c');
    recv_save($opt['receipt'], $receipt); recv_output($receipt);
} catch (Throwable $error) {
    $receipt['state'] = 'FAILED'; $receipt['error'] = ['class' => get_class($error), 'message' => $error->getMessage(), 'at' => gmdate('c')];
    recv_save($opt['receipt'], $receipt); throw $error;
} finally { flock($lock, LOCK_UN); fclose($lock); }
