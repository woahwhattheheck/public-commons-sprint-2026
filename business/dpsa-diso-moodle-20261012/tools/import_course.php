<?php
declare(strict_types=1);
/**
 * Import the complete authored DISO course through the original Moodle 4.5 APIs.
 * Run with the PHP executable used by the target Moodle installation.
 */
define('CLI_SCRIPT', true);
$options = getopt('', ['moodle-root:', 'package:', 'receipt:', 'backup:', 'category-id:']);
foreach (['moodle-root', 'package', 'receipt', 'backup'] as $required) {
    if (empty($options[$required]) || !str_starts_with($options[$required], '/')) {
        throw new RuntimeException('An absolute --' . $required . ' path is required.');
    }
}
$moodleroot = realpath($options['moodle-root']);
$packageroot = realpath(dirname($options['package']));
if (!$moodleroot || !$packageroot) {
    throw new RuntimeException('Original Moodle source and compiled course are required.');
}
require($moodleroot . '/config.php');
require_once($CFG->dirroot . '/course/lib.php');
require_once($CFG->dirroot . '/course/modlib.php');
require_once($CFG->libdir . '/questionlib.php');
require_once($CFG->libdir . '/completionlib.php');
require_once($CFG->dirroot . '/question/format/xml/format.php');
require_once($CFG->dirroot . '/mod/quiz/lib.php');
require_once($CFG->dirroot . '/mod/quiz/locallib.php');
require_once($CFG->dirroot . '/completion/criteria/completion_criteria_activity.php');
require_once($CFG->dirroot . '/completion/completion_aggregation.php');
require_once($CFG->dirroot . '/backup/util/includes/backup_includes.php');

function diso_require(bool $condition, string $message): void {
    if (!$condition) { throw new RuntimeException($message); }
}
function diso_json(string $file): array {
    $data = file_get_contents($file);
    diso_require($data !== false, 'Read original course file: ' . $file);
    return json_decode($data, true, 512, JSON_THROW_ON_ERROR);
}
function diso_save(string $file, array $value): void {
    $temporary = $file . '.pending-' . getmypid();
    $data = json_encode($value, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
    diso_require(file_put_contents($temporary, $data, LOCK_EX) === strlen($data), 'Write complete receiving result');
    chmod($temporary, 0600);
    diso_require(rename($temporary, $file), 'Retain complete receiving result');
}
function diso_file(string $root, string $relative): string {
    diso_require(!str_starts_with($relative, '/') && !in_array('..', explode('/', $relative), true), 'Relative compiled course file required');
    $file = realpath($root . '/' . $relative);
    diso_require($file !== false && str_starts_with($file, $root . '/') && is_file($file), 'Original compiled course file required: ' . $relative);
    return $file;
}
function diso_html(string $value): string {
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}
function diso_course_summary(array $package): string {
    return '<p>Practical information security governance for Departmental Information Security Officers.</p>' .
        '<p>Work through thirteen modules and twenty-six learning units. Read the unit book, apply the case in your personal workbook, and complete its assessment.</p>' .
        '<p>Each unit assessment requires 75%. Attempts are unlimited, your highest result is retained, and feedback is available as you work. Complete every unit assessment to finish the course.</p>';
}
function diso_activity(stdClass $course, string $kind, string $idnumber, string $name, string $intro, int $section, array $settings = []): stdClass {
    global $DB;
    $moduleid = (int)$DB->get_field('modules', 'id', ['name' => $kind], MUST_EXIST);
    $existing = $DB->get_record('course_modules', ['course' => $course->id, 'idnumber' => $idnumber]);
    if ($existing) {
        diso_require((int)$existing->module === $moduleid, 'Retained activity kind differs: ' . $idnumber);
        return $existing;
    }
    if ($kind === 'page') { $settings += ['printintro' => 0, 'printlastmodified' => 0, 'display' => 5, 'revision' => 1]; }
    $info = (object)array_merge([
        'modulename' => $kind, 'module' => $moduleid, 'course' => $course->id,
        'section' => $section, 'name' => $name, 'intro' => $intro, 'introformat' => FORMAT_HTML,
        'cmidnumber' => $idnumber, 'visible' => 1, 'visibleoncoursepage' => 1,
        'groupmode' => NOGROUPS, 'groupingid' => 0, 'showdescription' => 0,
        'completion' => COMPLETION_TRACKING_MANUAL, 'completionview' => 0,
        'completiongradeitemnumber' => '', 'completionexpected' => 0,
    ], $settings);
    $created = add_moduleinfo($info, $course);
    return $DB->get_record('course_modules', ['id' => $created->coursemodule], '*', MUST_EXIST);
}
function diso_question(stdClass $category, string $idnumber): ?stdClass {
    global $DB;
    $sql = 'SELECT q.id, q.qtype, q.name, qv.version, qv.status, qbe.id AS bankentryid
              FROM {question_bank_entries} qbe
              JOIN {question_versions} qv ON qv.questionbankentryid = qbe.id
              JOIN {question} q ON q.id = qv.questionid
             WHERE qbe.questioncategoryid = :categoryid AND qbe.idnumber = :idnumber
          ORDER BY qv.version DESC';
    $rows = $DB->get_records_sql($sql, ['categoryid' => $category->id, 'idnumber' => $idnumber], 0, 1);
    return $rows ? reset($rows) : null;
}
function diso_import_questions(stdClass $course, array $unit, string $packageroot): array {
    global $DB;
    $context = context_course::instance($course->id);
    $category = $DB->get_record('question_categories', ['contextid' => $context->id, 'idnumber' => $unit['id']]);
    if (!$category) {
        $category = (object)[
            'contextid' => $context->id, 'name' => $unit['id'] . ' ' . $unit['title'],
            'info' => 'Original editable unit assessment', 'infoformat' => FORMAT_HTML,
            'stamp' => make_unique_id_code(), 'parent' => 0, 'sortorder' => 999,
            'idnumber' => $unit['id'],
        ];
        $category->id = $DB->insert_record('question_categories', $category);
    }
    $questions = array_map(fn(array $q) => diso_question($category, $q['id']), $unit['quiz']['questions']);
    $present = count(array_filter($questions));
    diso_require($present === 0 || $present === count($questions), 'Original question import must finish within its retained native transaction');
    if ($present === 0) {
        $transaction = $DB->start_delegated_transaction();
        $format = new qformat_xml();
        $format->setCategory($category);
        $format->setCourse($course);
        $format->setContexts([$context]);
        $format->setFilename(diso_file($packageroot, $unit['quiz']['file']));
        $format->setRealfilename(basename($unit['quiz']['file']));
        $format->setMatchgrades('error');
        $format->setCatfromfile(false);
        $format->setContextfromfile(false);
        $format->setStoponerror(true);
        $format->set_display_progress(false);
        diso_require($format->importpreprocess() && $format->importprocess() && $format->importpostprocess(), 'Native Moodle XML import must complete: ' . $unit['id']);
        $questions = array_map(fn(array $q) => diso_question($category, $q['id']), $unit['quiz']['questions']);
        diso_require(count(array_filter($questions)) === count($unit['quiz']['questions']), 'Every authored question keeps its native question-bank identity');
        $transaction->allow_commit();
    }
    foreach ($questions as $index => $question) {
        $xmltype = $unit['quiz']['questions'][$index]['type'];
        $nativetype = $xmltype === 'matching' ? 'match' : $xmltype;
        diso_require($question->qtype === $nativetype, 'Native question type differs from its Moodle XML representation');
        diso_require($question->status === 'ready', 'Native imported question must be ready');
    }
    return $questions;
}
function diso_book(stdClass $course, array $unit, int $section): stdClass {
    global $DB;
    $objectives = '<ul>' . implode('', array_map(fn(string $s) => '<li>' . diso_html($s) . '</li>', $unit['objectives'])) . '</ul>';
    $cm = diso_activity($course, 'book', $unit['id'] . '-BOOK', $unit['title'] . ' — unit book', $objectives, $section,
        ['numbering' => 1, 'navstyle' => 1, 'customtitles' => 1, 'revision' => 1]);
    $existing = $DB->get_records('book_chapters', ['bookid' => $cm->instance], 'pagenum');
    if (!$existing) {
        $transaction = $DB->start_delegated_transaction();
        foreach ($unit['chapters'] as $index => $chapter) {
            $DB->insert_record('book_chapters', (object)[
                'bookid' => $cm->instance, 'pagenum' => $index + 1, 'subchapter' => 0,
                'title' => $chapter['title'], 'content' => $chapter['content'], 'contentformat' => FORMAT_HTML,
                'hidden' => 0, 'timecreated' => time(), 'timemodified' => time(), 'importsrc' => $chapter['id'],
            ]);
        }
        $transaction->allow_commit();
        $existing = $DB->get_records('book_chapters', ['bookid' => $cm->instance], 'pagenum');
    }
    diso_require(count($existing) === count($unit['chapters']), 'Complete native book chapter count differs');
    foreach (array_values($existing) as $index => $chapter) {
        diso_require($chapter->content === $unit['chapters'][$index]['content'], 'Original editable chapter content differs');
    }
    return $cm;
}
function diso_workbook(stdClass $course, array $unit, int $section): stdClass {
    return diso_activity($course, 'assign', $unit['id'] . '-WORKBOOK', $unit['title'] . ' — practice workbook', $unit['applicationHtml'], $section, [
        'alwaysshowdescription' => 1, 'submissiondrafts' => 0, 'requiresubmissionstatement' => 0,
        'completion' => COMPLETION_TRACKING_AUTOMATIC, 'completionsubmit' => 1,
        'sendnotifications' => 0, 'sendlatenotifications' => 0, 'sendstudentnotifications' => 0,
        'duedate' => 0, 'cutoffdate' => 0, 'gradingduedate' => 0, 'allowsubmissionsfromdate' => 0,
        'grade' => 0, 'teamsubmission' => 0, 'requireallteammemberssubmit' => 0,
        'teamsubmissiongroupingid' => 0, 'blindmarking' => 0, 'hidegrader' => 0,
        'maxattempts' => -1, 'attemptreopenmethod' => 'manual',
        'markingworkflow' => 0, 'markingallocation' => 0, 'preventsubmissionnotingroup' => 0,
        'assignsubmission_onlinetext_enabled' => 1, 'assignsubmission_onlinetext_wordlimit_enabled' => 0,
        'assignsubmission_file_enabled' => 0, 'assignfeedback_comments_enabled' => 1,
        'assignfeedback_editpdf_enabled' => 0, 'assignfeedback_file_enabled' => 0,
    ]);
}
function diso_guidance(stdClass $course, array $unit, int $section, int $workbookcmid): stdClass {
    $availability = json_encode(['op' => '&', 'c' => [[
        'type' => 'completion', 'cm' => $workbookcmid, 'e' => COMPLETION_COMPLETE,
    ]], 'showc' => [true]], JSON_THROW_ON_ERROR);
    return diso_activity($course, 'page', $unit['id'] . '-GUIDANCE',
        $unit['title'] . ' — suggested answer and reflection guidance',
        '<p>Submit your practice workbook to open the worked answer and reflection guidance.</p>', $section, [
            'content' => $unit['guidanceHtml'], 'contentformat' => FORMAT_HTML,
            'completion' => COMPLETION_TRACKING_NONE, 'availability' => $availability,
        ]);
}
function diso_video(stdClass $course, array $module, string $packageroot): array {
    $video = $module['video'];
    $url = fn(string $file) => '@@PLUGINFILE@@/' . rawurlencode(basename($file));
    $content = '<p>Watch the module presentation, read its captions, or open the complete transcript.</p>' .
        '<video controls preload="none" style="width:100%;max-width:960px" poster="' . $url($video['posterFile']) . '">' .
        '<source src="' . $url($video['videoFile']) . '" type="video/mp4">' .
        '<track default kind="captions" src="' . $url($video['captionsFile']) . '" srclang="en" label="English">' .
        '<p><a href="' . $url($video['videoFile']) . '">Download the MP4 presentation</a></p></video>' .
        '<p><a href="' . $url($video['transcriptFile']) . '">Read or download the complete presentation transcript</a></p>';
    if ($video['audioFile']) { $content .= '<p><a href="' . $url($video['audioFile']) . '">Download the MP3 narration</a></p>'; }
    $cm = diso_activity($course, 'page', $video['id'], $video['title'] . ' — presentation',
        '<p>A captioned introduction to this module and its practical decisions.</p>', (int)$module['section'], [
            'content' => $content, 'contentformat' => FORMAT_HTML, 'completion' => COMPLETION_TRACKING_MANUAL,
        ]);
    $context = context_module::instance($cm->id);
    $storage = get_file_storage(); $files = [];
    foreach ($video['files'] as $entry) {
        $source = diso_file($packageroot, $entry['path']); $name = basename($entry['path']);
        diso_require(filesize($source) === $entry['bytes'] && hash_file('sha256', $source) === $entry['sha256'], 'Exact original presentation file required');
        $file = $storage->get_file($context->id, 'mod_page', 'content', 0, '/', $name);
        if (!$file) {
            $file = $storage->create_file_from_pathname([
                'contextid' => $context->id, 'component' => 'mod_page', 'filearea' => 'content',
                'itemid' => 0, 'filepath' => '/', 'filename' => $name,
            ], $source);
        }
        diso_require((int)$file->get_filesize() === $entry['bytes'] && $file->get_contenthash() === hash_file('sha1', $source),
            'Original Moodle file store retains the complete presentation');
        $files[] = ['name' => $name, 'bytes' => (int)$file->get_filesize(), 'sha256' => $entry['sha256'], 'nativeFileId' => (int)$file->get_id()];
    }
    return ['cmid' => (int)$cm->id, 'id' => $video['id'], 'files' => $files];
}
function diso_quiz(stdClass $course, array $unit, int $section, array $questions): stdClass {
    global $DB;
    $settings = [
        'preferredbehaviour' => 'immediatefeedback', 'attempts' => 0,
        'grademethod' => QUIZ_GRADEHIGHEST, 'grade' => 100, 'gradepass' => 75, 'sumgrades' => 0,
        'questionsperpage' => 4, 'navmethod' => 'free', 'shuffleanswers' => 1,
        'timeopen' => 0, 'timeclose' => 0, 'timelimit' => 0, 'overduehandling' => 'autosubmit',
        'graceperiod' => 0, 'quizpassword' => '', 'subnet' => '', 'browsersecurity' => '-',
        'delay1' => 0, 'delay2' => 0, 'decimalpoints' => 2, 'questiondecimalpoints' => -1,
        'showuserpicture' => 0, 'showblocks' => 0, 'attemptonlast' => 0,
        'completion' => COMPLETION_TRACKING_AUTOMATIC, 'completionusegrade' => 1,
        'completiongradeitemnumber' => 0, 'completionpassgrade' => 1, 'completionview' => 0,
        'completionattemptsexhausted' => 0, 'completionminattempts' => 0, 'completionunlocked' => 1,
    ];
    foreach (['attempt','correctness','maxmarks','marks','specificfeedback','generalfeedback','rightanswer','overallfeedback'] as $field) {
        foreach (['during','immediately','open','closed'] as $when) { $settings[$field . $when] = 1; }
    }
    $cm = diso_activity($course, 'quiz', $unit['id'] . '-QUIZ', $unit['quiz']['title'],
        '<p>Pass mark: 75%. Attempts are unlimited. Your highest result is retained. Check each response to see feedback, and use the unit book to improve your answer.</p>', $section, $settings);
    $quiz = $DB->get_record('quiz', ['id' => $cm->instance], '*', MUST_EXIST);
    foreach ($questions as $question) { quiz_add_quiz_question((int)$question->id, $quiz, 0, 1.0); }
    \mod_quiz\quiz_settings::create((int)$quiz->id)->get_grade_calculator()->recompute_quiz_sumgrades();
    quiz_grade_item_update($quiz);
    return $cm;
}
function diso_verify(stdClass $course, array $package): array {
    global $DB;
    $result = ['courseId' => (int)$course->id, 'modules' => [], 'counts' => ['books' => 0, 'assignments' => 0, 'quizzes' => 0, 'questions' => 0, 'chapters' => 0]];
    foreach ($package['modules'] as $module) {
        $item = ['id' => $module['id'], 'units' => []];
        foreach ($module['units'] as $unit) {
            $rows = [];
            foreach (['book' => 'BOOK', 'assign' => 'WORKBOOK', 'quiz' => 'QUIZ'] as $kind => $suffix) {
                $cm = $DB->get_record('course_modules', ['course' => $course->id, 'idnumber' => $unit['id'] . '-' . $suffix], '*', MUST_EXIST);
                $rows[$kind] = ['cmid' => (int)$cm->id, 'instanceId' => (int)$cm->instance];
                if ($kind === 'quiz') {
                    diso_require((int)$cm->completion === COMPLETION_TRACKING_AUTOMATIC &&
                        (int)$cm->completiongradeitemnumber === 0 && (int)$cm->completionpassgrade === 1,
                        'Original quiz completion requires its retained passing grade');
                }
            }
            $quiz = $DB->get_record('quiz', ['id' => $rows['quiz']['instanceId']], '*', MUST_EXIST);
            $grade = $DB->get_record('grade_items', ['courseid' => $course->id, 'itemtype' => 'mod', 'itemmodule' => 'quiz', 'iteminstance' => $quiz->id, 'itemnumber' => 0], '*', MUST_EXIST);
            diso_require((int)$quiz->attempts === 0 && $quiz->preferredbehaviour === 'immediatefeedback', 'Original assessment retry and feedback settings differ');
            diso_require((float)$grade->gradepass === 75.0 && (float)$grade->grademax === 100.0, 'Original native gradebook pass mark must be75/100');
            $immediate = \mod_quiz\question\display_options::IMMEDIATELY_AFTER;
            foreach (['reviewmarks','reviewspecificfeedback','reviewgeneralfeedback','reviewrightanswer'] as $field) {
                diso_require(((int)$quiz->$field & $immediate) === $immediate, 'Immediate native review setting differs: ' . $field);
            }
            $slots = $DB->count_records('quiz_slots', ['quizid' => $quiz->id]);
            diso_require($slots === count($unit['quiz']['questions']), 'Complete original native quiz slots required');
            $chapters = $DB->count_records('book_chapters', ['bookid' => $rows['book']['instanceId']]);
            diso_require($chapters === count($unit['chapters']), 'Complete original native book required');
            $result['counts']['books']++; $result['counts']['assignments']++; $result['counts']['quizzes']++;
            $result['counts']['questions'] += $slots; $result['counts']['chapters'] += $chapters;
            $rows['id'] = $unit['id']; $rows['questions'] = $slots; $rows['passPercent'] = (float)$grade->gradepass;
            $rows['attempts'] = (int)$quiz->attempts; $rows['behaviour'] = $quiz->preferredbehaviour;
            $item['units'][] = $rows;
        }
        $result['modules'][] = $item;
    }
    foreach (['books','assignments','quizzes','questions'] as $key) {
        diso_require($result['counts'][$key] === $package['counts'][$key], 'Whole original course count differs: ' . $key);
    }
    return $result;
}
function diso_backup(stdClass $course, string $destination, int $adminid): array {
    // Bind the original stored_file before copying any bytes. A completed copy can
    // then be reconciled after interruption without recreating the native backup.
    $bindingfile = $destination . '.native-backup.json';
    $staging = $destination . '.receiving';
    $binding = is_file($bindingfile) ? diso_json($bindingfile) : null;
    if (!$binding) {
        diso_require(!file_exists($destination) && !file_exists($staging), 'An existing unbound backup must be reconciled before using this output path');
        $controller = new backup_controller(backup::TYPE_1COURSE, (int)$course->id, backup::FORMAT_MOODLE,
            backup::INTERACTIVE_NO, backup::MODE_GENERAL, $adminid);
        try {
            $plan = $controller->get_plan();
            $plan->get_setting('users')->set_value(false);
            $plan->get_setting('filename')->set_value(basename($destination));
            $controller->execute_plan();
            $results = $controller->get_results();
            $file = $results['backup_destination'] ?? null;
            diso_require($file instanceof stored_file, 'Original Moodle course backup must return its retained file');
            $binding = [
                'schema' => 'dpsa.diso.native-backup-binding/v1', 'file' => $destination,
                'courseId' => (int)$course->id, 'controllerId' => $controller->get_backupid(),
                'nativeFileId' => (int)$file->get_id(), 'nativeContentHash' => $file->get_contenthash(),
                'bytes' => (int)$file->get_filesize(), 'usersIncluded' => false, 'format' => 'moodle-native-mbz',
            ];
            diso_save($bindingfile, $binding);
        } finally { $controller->destroy(); }
    }
    diso_require($binding['courseId'] === (int)$course->id && $binding['file'] === $destination && !$binding['usersIncluded'],
        'Resume the original course backup with its retained destination and native file');
    $matches = fn(string $path): bool => is_file($path) && filesize($path) === $binding['bytes'] &&
        hash_file('sha1', $path) === $binding['nativeContentHash'];
    if (file_exists($destination)) {
        diso_require($matches($destination), 'The retained delivered backup differs from its original Moodle stored_file');
    } else {
        if (file_exists($staging) && !$matches($staging)) {
            diso_require(unlink($staging), 'Retire only the incomplete owned backup copy');
        }
        if (!is_file($staging)) {
            $file = get_file_storage()->get_file_by_id($binding['nativeFileId']);
            diso_require($file instanceof stored_file && $file->get_contenthash() === $binding['nativeContentHash'],
                'Continue with the same original Moodle stored backup');
            diso_require($file->copy_content_to($staging), 'Copy the original complete Moodle backup');
        }
        diso_require($matches($staging), 'Every copied backup byte must match its original Moodle stored_file');
        $binding['sha256'] = hash_file('sha256', $staging);
        diso_save($bindingfile, $binding);
        diso_require(rename($staging, $destination), 'Promote the complete verified original backup');
    }
    $binding['sha256'] = hash_file('sha256', $destination);
    $binding['state'] = 'COMPLETE';
    diso_save($bindingfile, $binding);
    return $binding;
}

umask(0077);
foreach ([dirname($options['receipt']), dirname($options['backup'])] as $folder) {
    if (!is_dir($folder)) { diso_require(mkdir($folder, 0700, true), 'Create owned output directory'); }
}
$lock = fopen($options['receipt'] . '.lock', 'c');
diso_require($lock !== false && flock($lock, LOCK_EX), 'Acquire original course receiving');
$package = diso_json($options['package']);
diso_require(($package['schema'] ?? '') === 'dpsa.diso.moodle-package.v1', 'Complete compiled course schema required');
diso_require(count($package['modules']) === 13 && $package['counts']['questions'] === 312, 'Complete13-module/312-question course required');
$manifest = diso_json($packageroot . '/SOURCE_MANIFEST.json');
foreach ($manifest['outputs'] as $file) {
    $target = diso_file($packageroot, $file['path']);
    diso_require(filesize($target) === $file['bytes'] && hash_file('sha256', $target) === $file['sha256'], 'Exact compiled course source differs: ' . $file['path']);
}
require($CFG->dirroot . '/version.php');
diso_require((string)$branch === '405', 'The target is original Moodle4.5');
diso_require(!empty($CFG->enablecompletion) && !empty($CFG->enableavailability), 'Enable native completion and conditional resource access before importing this course');
$admin = get_admin();
diso_require((bool)$admin, 'Original installed Moodle administrator required');
\core\session\manager::set_user($admin);
$PAGE->set_context(context_system::instance());
$categoryid = (int)($options['category-id'] ?? 1);
$DB->get_record('course_categories', ['id' => $categoryid], '*', MUST_EXIST);
$receipt = file_exists($options['receipt']) ? diso_json($options['receipt']) : [
    'schema' => 'dpsa.diso.original-moodle-import/v1', 'sourceSha256' => $package['sourceSha256'],
    'moodleCommit' => $package['moodleCommit'], 'moodleRelease' => $release, 'units' => [],
];
diso_require($receipt['sourceSha256'] === $package['sourceSha256'], 'Continue this original course edition with its unchanged compiled source');
$identity = $package['course']['id'] . ':' . substr($package['sourceSha256'], 0, 20);
$course = $DB->get_record('course', ['idnumber' => $identity]);
if (($receipt['state'] ?? '') === 'COMPLETE') {
    diso_require($course && (int)$course->id === $receipt['courseId'], 'The completed course retains its original native identity');
    diso_require(!empty($receipt['backup']) && is_file($receipt['backup']['file']) &&
        hash_file('sha256', $receipt['backup']['file']) === $receipt['backup']['sha256'],
        'The completed course retains its original delivered Moodle backup');
    // Preserve all subsequent staff edits, question versions and learner completion IDs.
    echo json_encode($receipt + ['reusedOriginalImport' => true],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
    flock($lock, LOCK_UN); fclose($lock);
    exit(0);
}
if (!$course) {
    $course = create_course((object)[
        'fullname' => $package['course']['title'], 'shortname' => 'DISO-2026-' . substr($package['sourceSha256'], 0, 10),
        'idnumber' => $identity, 'category' => $categoryid, 'format' => 'topics', 'numsections' => 13,
        'summary' => diso_course_summary($package), 'summaryformat' => FORMAT_HTML,
        'enablecompletion' => 1, 'showgrades' => 1, 'visible' => 1, 'newsitems' => 0,
        'lang' => 'en', 'startdate' => 0, 'enddate' => 0,
    ]);
}
$receipt['courseId'] = (int)$course->id; $receipt['courseIdentity'] = $identity;
$receipt['state'] = 'IMPORTING'; diso_save($options['receipt'], $receipt);
try {
    course_create_sections_if_missing($course, range(0, 13));
    $quizcmids = [];
    foreach ($package['modules'] as $module) {
        $section = $DB->get_record('course_sections', ['course' => $course->id, 'section' => $module['section']], '*', MUST_EXIST);
        if (!isset($receipt['sections'][$module['id']])) {
            $untouched = empty($section->name) && trim((string)$section->summary) === '';
            $alreadyapplied = $section->name === $module['title'] && $section->summary === $module['summaryHtml'];
            diso_require($untouched || $alreadyapplied, 'Retain concurrent section edits and reconcile this original module: ' . $module['id']);
            if (!$alreadyapplied) {
                course_update_section($course, $section, ['name' => $module['title'], 'summary' => $module['summaryHtml'], 'summaryformat' => FORMAT_HTML]);
            }
            $receipt['sections'][$module['id']] = ['sectionId' => (int)$section->id, 'section' => $module['section']];
            diso_save($options['receipt'], $receipt);
        }
        $receipt['presentations'][$module['id']] = diso_video($course, $module, $packageroot);
        diso_save($options['receipt'], $receipt);
        foreach ($module['units'] as $unit) {
            $book = diso_book($course, $unit, $module['section']);
            $assignment = diso_workbook($course, $unit, $module['section']);
            $guidance = diso_guidance($course, $unit, $module['section'], (int)$assignment->id);
            $questions = diso_import_questions($course, $unit, $packageroot);
            $quiz = diso_quiz($course, $unit, $module['section'], $questions);
            $quizcmids[] = (int)$quiz->id;
            $receipt['units'][$unit['id']] = [
                'bookCmid' => (int)$book->id, 'workbookCmid' => (int)$assignment->id,
                'quizCmid' => (int)$quiz->id, 'guidanceCmid' => (int)$guidance->id, 'questionIds' => array_map(fn($q) => (int)$q->id, $questions),
            ];
            diso_save($options['receipt'], $receipt);
        }
    }
    diso_activity($course, 'page', $package['course']['id'] . '-SOURCES', 'Primary sources and further reading',
        '<p>Official sources used throughout the course.</p>', 0,
        ['content' => $package['sourcesHtml'], 'contentformat' => FORMAT_HTML, 'display' => 5,
         'displayoptions' => serialize(['printintro' => 0]), 'completion' => COMPLETION_TRACKING_NONE]);
    diso_activity($course, 'page', $package['course']['id'] . '-GLOSSARY', 'DISO glossary',
        '<p>Definitions, practical context and original references.</p>', 0,
        ['content' => $package['glossaryHtml'], 'contentformat' => FORMAT_HTML, 'completion' => COMPLETION_TRACKING_NONE]);
    $transaction = $DB->start_delegated_transaction();
    $missingcriteria = [];
    foreach ($quizcmids as $cmid) {
        $existingcriteria = $DB->get_records('course_completion_criteria', [
            'course' => $course->id, 'criteriatype' => COMPLETION_CRITERIA_TYPE_ACTIVITY, 'moduleinstance' => $cmid,
        ]);
        diso_require(count($existingcriteria) <= 1, 'Reconcile duplicate existing completion criteria for activity ' . $cmid);
        if (!$existingcriteria) { $missingcriteria[$cmid] = 1; }
    }
    if ($missingcriteria) {
        $criteria = new completion_criteria_activity();
        $settings = (object)['id' => $course->id, 'criteria_activity' => $missingcriteria];
        $criteria->update_config($settings);
    }
    foreach ([null, COMPLETION_CRITERIA_TYPE_ACTIVITY] as $type) {
        $existingaggregation = $DB->get_record('course_completion_aggr_methd', ['course' => $course->id, 'criteriatype' => $type]);
        if ($existingaggregation) {
            diso_require((int)$existingaggregation->method === COMPLETION_AGGREGATION_ALL,
                'Preserve and reconcile an existing course aggregation choice before changing it');
        } else {
            $aggregation = new completion_aggregation(['course' => $course->id, 'criteriatype' => $type]);
            $aggregation->setMethod(COMPLETION_AGGREGATION_ALL); $aggregation->save();
        }
    }
    $transaction->allow_commit();
    rebuild_course_cache($course->id, true);
    $receipt['nativeReadback'] = diso_verify($course, $package);
    if (!empty($receipt['backup'])) {
        diso_require(is_file($receipt['backup']['file']) && hash_file('sha256', $receipt['backup']['file']) === $receipt['backup']['sha256'], 'Continue with the retained original complete course backup');
    } else {
        $receipt['backup'] = diso_backup($course, $options['backup'], (int)$admin->id);
    }
    $receipt['state'] = 'COMPLETE'; $receipt['completedAt'] = gmdate('c');
    diso_save($options['receipt'], $receipt);
    echo json_encode($receipt, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
} catch (Throwable $error) {
    $receipt['state'] = 'FAILED'; $receipt['error'] = ['class' => get_class($error), 'message' => $error->getMessage(), 'at' => gmdate('c')];
    diso_save($options['receipt'], $receipt);
    throw $error;
} finally {
    flock($lock, LOCK_UN); fclose($lock);
}
