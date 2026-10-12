import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL, fileURLToPath} from 'node:url';

function need(ok, message) { if (!ok) throw new Error(message); }
async function json(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
async function save(file, value) {
  const temporary = file + '.pending-' + process.pid;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', {mode: 0o600});
  await fs.rename(temporary, file);
}
function run(argv, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {stdio: ['ignore', 'pipe', 'pipe'], ...options});
    let output = '', error = '';
    child.stdout.on('data', value => output += value);
    child.stderr.on('data', value => error += value);
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(output) : reject(new Error('Original Moodle CLI exited ' + code + ': ' + error.slice(-5000) + output.slice(-2000))));
  });
}
function attribute(value) { return JSON.stringify(String(value)); }
async function visible(locator) { return await locator.count() > 0 && await locator.first().isVisible(); }
async function nativeAttempt(config, attemptId) {
  const argv = [config.phpExecutable, ...(config.phpArguments || []), config.nativeReceiver,
    '--moodle-root=' + config.moodleRoot, '--package=' + config.packageFile,
    '--import-receipt=' + config.importReceipt, '--receipt=' + config.nativeReceipt,
    '--credentials=' + config.credentialsFile, '--action=attempt-plan', '--attempt-id=' + attemptId];
  const output = await run(argv, {env: process.env});
  const line = output.split('\n').filter(value => value.startsWith('DISO_RESULT ')).at(-1);
  need(line, 'Original Moodle returns this same learner attempt');
  return JSON.parse(line.slice('DISO_RESULT '.length));
}
async function login(page, origin, account) {
  await page.goto(origin + '/login/index.php', {waitUntil: 'domcontentloaded'});
  await page.locator('#username').fill(account.username);
  await page.locator('#password').fill(account.password);
  await page.locator('#loginbtn').click();
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#page').waitFor();
  need(!await visible(page.locator('#loginbtn')), 'Ordinary learner sign-in completes');
}
async function finish(page) {
  if (!page.url().includes('/mod/quiz/summary.php')) {
    const link = page.getByRole('link', {name: /Finish attempt/i});
    if (await visible(link)) await link.first().click();
    else await page.getByRole('button', {name: /Finish attempt/i}).first().click();
  }
  await page.waitForURL(/\/mod\/quiz\/summary\.php/);
  await page.getByRole('button', {name: 'Submit all and finish', exact: true}).first().click();
  const dialog = page.getByRole('dialog');
  const confirm = dialog.getByRole('button', {name: 'Submit all and finish', exact: true});
  if (await visible(confirm)) await confirm.click();
  await page.waitForURL(/\/mod\/quiz\/review\.php/);
}
async function startOrResume(page, config, cmid, key, receipt, receiptFile) {
  const prior = receipt.attempts[key];
  if (prior?.attemptId) {
    const native = await nativeAttempt(config, prior.attemptId);
    if (native.state === 'finished') return native;
    await page.goto(config.origin + '/mod/quiz/attempt.php?attempt=' + native.attemptId, {waitUntil: 'domcontentloaded'});
    return native;
  }
  await page.goto(config.origin + '/mod/quiz/view.php?id=' + cmid, {waitUntil: 'domcontentloaded'});
  const start = page.getByRole('button', {name: /^(Attempt quiz|Re-attempt quiz|Continue your attempt)/i});
  await start.first().click();
  const confirmation = page.getByRole('dialog').getByRole('button', {name: /Start attempt/i});
  if (await visible(confirmation)) await confirmation.click();
  await page.waitForURL(/\/mod\/quiz\/attempt\.php/);
  const id = Number(new URL(page.url()).searchParams.get('attempt'));
  need(Number.isSafeInteger(id) && id > 0, 'Retain original browser-created attempt ID');
  receipt.attempts[key] = {attemptId: id, quizCmid: cmid, state: 'STARTED'};
  await save(receiptFile, receipt);
  return nativeAttempt(config, id);
}
async function answerQuestion(page, question) {
  const root = page.locator('#' + question.outerId);
  if (!await visible(root) || question.finished) return false;
  for (const field of question.fields) {
    const control = root.locator('[name=' + attribute(field.name) + ']');
    if (question.type === 'ddwtos' || question.type === 'ddimageortext') {
      // Exercise the original drag interaction; do not fill its hidden response field.
      const source = root.locator('.draghome.choice' + field.choice + '.group' + field.group + ':not(.dragplaceholder):visible').first();
      const target = root.locator((question.type === 'ddimageortext' ? '.dropzone.place' : '.drop.place') + field.place + '.group' + field.group);
      await source.dragTo(target);
      need(await control.inputValue() === field.value, 'Native drag interaction retains the selected choice');
    } else if (await control.locator('xpath=self::select').count()) {
      await control.selectOption(field.value);
    } else {
      const radio = root.locator('input[type="radio"][name=' + attribute(field.name) + '][value=' + attribute(field.value) + ']');
      if (await radio.count()) await radio.check();
      else if (await control.count() && await control.first().getAttribute('type') === 'checkbox') {
        await control.first().setChecked(field.value === '1');
      } else {
        need(await visible(control), 'Original visible response control is available for ' + question.name);
        await control.fill(field.value);
      }
    }
  }
  const check = root.locator('input[type="submit"][name$="-submit"], button[name$="-submit"]');
  await check.click();
  await page.waitForLoadState('domcontentloaded');
  await root.locator('.state').filter({hasText: /^Correct$/}).waitFor({timeout: 30000});
  const feedback = root.locator('.generalfeedback');
  await feedback.waitFor();
  need((await feedback.innerText()).trim().length > 10, 'Learner receives the authored general feedback immediately');
  return true;
}
async function passQuiz(page, config, cmid, key, receipt, receiptFile) {
  let native = await startOrResume(page, config, cmid, key, receipt, receiptFile);
  if (native.state !== 'finished') {
    for (let pageNumber = 0; pageNumber < 20; pageNumber++) {
      native = await nativeAttempt(config, native.attemptId);
      const visibleQuestions = [];
      for (const question of native.questions) {
        if (await visible(page.locator('#' + question.outerId))) visibleQuestions.push(question);
      }
      need(visibleQuestions.length > 0, 'The original quiz page shows its retained questions');
      for (const question of visibleQuestions) {
        if (await answerQuestion(page, question)) {
          receipt.questionTypes[question.type] = true;
          await save(receiptFile, receipt);
        }
      }
      native = await nativeAttempt(config, native.attemptId);
      if (native.questions.every(question => question.finished)) break;
      const next = page.getByRole('button', {name: 'Next page', exact: true});
      need(await visible(next), 'Continue the same original quiz through every page');
      await next.click(); await page.waitForLoadState('domcontentloaded');
    }
    need(native.questions.every(question => question.finished && question.correct), 'Every displayed response is checked by the original native question engine');
    await finish(page);
  } else {
    await page.goto(config.origin + '/mod/quiz/review.php?attempt=' + native.attemptId, {waitUntil: 'domcontentloaded'});
  }
  native = await nativeAttempt(config, native.attemptId);
  need(native.state === 'finished' && native.percent === 100 && native.questions.every(question => question.correct),
    'The ordinary browser learner completes the original assessment at100%');
  receipt.attempts[key] = {attemptId: native.attemptId, quizCmid: cmid, attemptNumber: native.attemptNumber,
    state: native.state, percent: native.percent, questions: native.questions.length};
  await save(receiptFile, receipt);
  return native;
}
async function readBook(page, config, unit, directory) {
  await page.goto(config.origin + '/mod/book/view.php?id=' + unit.bookCmid, {waitUntil: 'domcontentloaded'});
  await page.locator('.book_content').waitFor();
  const first = (await page.locator('.book_content').innerText()).trim();
  need(first.length > 100, 'The original native book displays substantive authored learning content');
  // Follow the actual table-of-contents link for the last native chapter.
  const destination = unit.bookChapterIds.at(-1);
  const last = page.locator('a[href*="chapterid=' + destination + '"]');
  await last.first().click();
  await page.waitForURL(url => url.searchParams.get('chapterid') === String(destination));
  need((await page.locator('.book_content').innerText()).includes('Reflection'), 'The native book presents the application and reflection prompt');
  await page.screenshot({path: path.join(directory, 'unit-book-and-practice.png'), fullPage: true});
}
async function workbook(page, config, unit, receipt, receiptFile, directory) {
  const note = 'Receiving exercise: protect the service first, assign the information owner, record the lawful purpose, and escalate the risk with an accountable owner and review date. Keep the evidence in the approved departmental register.';
  await page.goto(config.origin + '/mod/assign/view.php?id=' + unit.workbookCmid, {waitUntil: 'domcontentloaded'});
  const edit = page.getByRole('button', {name: /^(Add submission|Edit submission)$/});
  await edit.first().click();
  const frame = page.frameLocator('iframe.tox-edit-area__iframe').locator('body');
  const plain = page.locator('textarea[name="onlinetext_editor[text]"]');
  if (await visible(page.locator('iframe.tox-edit-area__iframe'))) {
    await frame.fill(note);
  } else {
    await plain.fill(note);
  }
  await page.getByRole('button', {name: 'Save changes', exact: true}).click();
  await page.waitForLoadState('domcontentloaded');
  await page.reload({waitUntil: 'domcontentloaded'});
  const expand = page.getByRole('link', {name: /View full submission/i});
  if (await visible(expand)) await expand.first().click();
  need((await page.locator('#region-main').innerText()).includes('protect the service first'), 'The original personal workbook is saved and reopened');
  receipt.workbook = {cmid: unit.workbookCmid, savedAndReopened: true};
  await save(receiptFile, receipt);
  await page.screenshot({path: path.join(directory, 'personal-workbook-saved.png'), fullPage: true});
}
export async function receiveMoodleBrowser(config) {
  const directory = path.resolve(config.directory);
  await fs.mkdir(directory, {recursive: true, mode: 0o700});
  config.origin = new URL(config.origin).origin;
  need(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(config.origin).hostname), 'Owned local Moodle receiving origin required');
  const native = await json(config.nativeReceipt), privateAccounts = await json(config.credentialsFile);
  need(native.nativeState === 'PASS' && native.nativeGradedQuestions === 624 && native.nativePassedQuizzes === 52,
    'Complete original and restored native course receiving precedes browser delivery');
  const receiptFile = path.join(directory, 'browser-receiving.json');
  let receipt;
  try { receipt = await json(receiptFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  receipt ||= {schema: 'dpsa.diso.original-browser-receiving/v1', sourceSha256: native.sourceSha256,
    courseId: native.courseId, restoredCourseId: native.restoredCourseId, attempts: {}, questionTypes: {}, state: 'RECEIVING'};
  need(receipt.sourceSha256 === native.sourceSha256, 'Continue the same original browser course edition');
  const playwright = config.playwrightModule
    ? await import(pathToFileURL(config.playwrightModule).href) : await import('playwright');
  const browser = await playwright.chromium.launch({headless: true, executablePath: config.browserExecutable,
    args: ['--no-sandbox', '--disable-dev-shm-usage']});
  const context = await browser.newContext({viewport: {width: 1280, height: 900}, locale: 'en-GB'});
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await login(page, config.origin, privateAccounts.browser);
    const units = Object.values(native.originalInventory.units), first = units[0], second = units[1];
    await page.goto(config.origin + '/course/view.php?id=' + native.courseId, {waitUntil: 'domcontentloaded'});
    await page.locator('#region-main').waitFor();
    await page.screenshot({path: path.join(directory, 'complete-course-desktop.png'), fullPage: true});
    await readBook(page, config, first, directory);
    await workbook(page, config, first, receipt, receiptFile, directory);
    await page.goto(config.origin + '/mod/page/view.php?id=' + first.guidanceCmid, {waitUntil: 'domcontentloaded'});
    need((await page.locator('#region-main').innerText()).includes('Reflection guidance'),
      'The original submitted workbook opens its suggested answer and reflection guidance');
    receipt.guidanceAfterSubmission = {cmid: first.guidanceCmid, opened: true};
    await page.screenshot({path: path.join(directory, 'suggested-answer-after-practice.png'), fullPage: true});
    const presentation = native.originalInventory.presentations.M01;
    await page.goto(config.origin + '/mod/page/view.php?id=' + presentation.cmid, {waitUntil: 'domcontentloaded'});
    const video = page.locator('video').first();
    await video.waitFor();
    const playerButton = page.locator('.vjs-big-play-button').first();
    if (await visible(playerButton)) await playerButton.click();
    else await video.click();
    await page.waitForFunction(() => { const v = document.querySelector('video'); return v && v.readyState >= 2 && v.currentTime > 0; });
    const media = await video.evaluate(element => ({duration: element.duration, time: element.currentTime,
      sources: [...element.querySelectorAll('source')].map(s => s.type), captions: element.querySelectorAll('track[kind="captions"]').length}));
    need(media.duration > 30 && media.captions === 1 && media.sources.includes('video/mp4'), 'Original Moodle plays the complete captioned MP4 presentation');
    receipt.presentation = {cmid: presentation.cmid, ...media};
    await page.screenshot({path: path.join(directory, 'module-presentation-playing.png'), fullPage: true});
    await save(receiptFile, receipt);
    let failed = await startOrResume(page, config, first.quizCmid, 'first-unanswered-attempt', receipt, receiptFile);
    if (failed.state !== 'finished') await finish(page);
    failed = await nativeAttempt(config, failed.attemptId);
    need(failed.state === 'finished' && failed.percent < 75, 'Unanswered original browser assessment remains below the pass threshold');
    receipt.attempts['first-unanswered-attempt'] = {attemptId: failed.attemptId, percent: failed.percent, state: failed.state};
    await save(receiptFile, receipt);
    const firstPassed = await passQuiz(page, config, first.quizCmid, 'first-passed-retry', receipt, receiptFile);
    need(firstPassed.attemptNumber > failed.attemptNumber, 'An ordinary learner retries the same assessment after an unsuccessful attempt');
    await page.screenshot({path: path.join(directory, 'quiz-feedback-and-successful-retry.png'), fullPage: true});
    await passQuiz(page, config, second.quizCmid, 'second-passed-assessment', receipt, receiptFile);
    for (const type of ['multichoice', 'truefalse', 'match', 'gapselect', 'ddwtos', 'ddimageortext']) {
      need(receipt.questionTypes[type], 'Learner interacts with every delivered native question type: ' + type);
    }
    await page.setViewportSize({width: 390, height: 844});
    await page.goto(config.origin + '/course/view.php?id=' + native.courseId, {waitUntil: 'domcontentloaded'});
    const width = await page.evaluate(() => ({viewport: innerWidth, document: document.documentElement.scrollWidth}));
    need(width.document <= width.viewport + 1, 'The complete native course fits the390px learner view');
    await page.screenshot({path: path.join(directory, 'complete-course-mobile.png'), fullPage: true});
    await page.goto(config.origin + '/course/view.php?id=' + native.restoredCourseId, {waitUntil: 'domcontentloaded'});
    need((await page.locator('#region-main').innerText()).includes('received archive'), 'The ordinary learner opens the independently received native course');
    const restoredFirst = Object.values(native.restoredInventory.units)[0];
    await page.goto(config.origin + '/mod/book/view.php?id=' + restoredFirst.bookCmid, {waitUntil: 'domcontentloaded'});
    need((await page.locator('.book_content').innerText()).trim().length > 100, 'Received native book opens with its complete learning content');
    await page.screenshot({path: path.join(directory, 'received-course-book-mobile.png'), fullPage: true});
    await page.setViewportSize({width: 1280, height: 900});
    await page.locator('#user-menu-toggle').click();
    const logout = page.locator('a[href*="/login/logout.php"]');
    await logout.first().click();
    const confirmLogout = page.getByRole('button', {name: /^(Continue|Log out)$/});
    if (await visible(confirmLogout)) await confirmLogout.first().click();
    await page.waitForLoadState('domcontentloaded');
    await page.goto(config.origin + '/course/view.php?id=' + native.courseId, {waitUntil: 'domcontentloaded'});
    await page.locator('#loginbtn').waitFor();
    need(errors.length === 0, 'Original learner journey has no uncaught browser errors: ' + errors.join('; '));
    receipt.state = 'PASS'; receipt.completedAt = new Date().toISOString();
    receipt.nativeGradedQuestions = native.nativeGradedQuestions; receipt.nativePassedQuizzes = native.nativePassedQuizzes;
    receipt.nativeCourseCompletion = native.courseCompletion;
    receipt.mobile = width; receipt.browserErrors = errors;
    receipt.screenshots = (await fs.readdir(directory)).filter(name => name.endsWith('.png')).sort();
    await save(receiptFile, receipt);
    return receipt;
  } catch (error) {
    receipt.state = 'FAILED'; receipt.error = {message: error.message, at: new Date().toISOString()};
    await save(receiptFile, receipt);
    await page.screenshot({path: path.join(directory, 'receiving-error.png'), fullPage: true}).catch(() => {});
    throw error;
  } finally { await context.close(); await browser.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = await json(path.resolve(process.argv[2]));
  const receipt = await receiveMoodleBrowser(config);
  process.stdout.write(JSON.stringify(receipt, null, 2) + '\n');
}
