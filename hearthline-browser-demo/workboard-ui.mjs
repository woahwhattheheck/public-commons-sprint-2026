const $ = id => document.getElementById(id);
function element(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}
function input(name, value, { type = 'text', maxLength, required = false } = {}) {
  const control = document.createElement('input');
  control.name = name; control.type = type; control.value = value ?? ''; control.required = required;
  if (maxLength) control.maxLength = maxLength;
  if (type === 'number') { control.min = '0'; control.max = '10000'; control.step = '1'; }
  return control;
}
function field(label, control) {
  const wrapper = element('label', undefined, 'field');
  wrapper.append(element('span', label), control);
  return wrapper;
}
function statusSelect(value) {
  const select = document.createElement('select');
  select.name = 'status';
  for (const [key, label] of [['todo', 'To do'], ['doing', 'In progress'], ['done', 'Done']]) {
    const option = element('option', label); option.value = key; select.append(option);
  }
  select.value = value;
  return select;
}
const pretty = name => String(name).replaceAll('_', ' ');
const dateTime = value => value ? new Date(value).toLocaleString() : 'No changes recorded';

export function createWorkboard({ tool, run, event, verdict }) {
  let missionId = null, workboard = null, inventory = null, busy = true, ready = false, addRequest = null;
  let filter = 'all';
  const addForm = $('add-task-form');

  function setBusy(value) {
    busy = value;
    for (const control of $('workboard').querySelectorAll('input,textarea,select,button')) control.disabled = busy || !ready || control.dataset.unavailable === 'true';
    for (const control of addForm.elements) control.disabled = busy || !ready || !missionId;
    $('task-filter').disabled = busy || !ready || !missionId;
    $('refresh-workboard').disabled = busy;
  }
  function renderInventory() {
    const form = $('stock-form'); form.replaceChildren();
    const entries = Object.entries(inventory?.items ?? {}).sort(([a], [b]) => a.localeCompare(b));
    if (!entries.length) form.append(element('p', 'No stock is recorded yet.', 'hint'));
    for (const [item, quantity] of entries) {
      const row = element('div', undefined, 'stock-row');
      row.append(field(pretty(item), input(item, quantity, { type: 'number', required: true })));
      form.append(row);
    }
    const button = element('button', 'Save counted stock', 'primary');
    button.type = 'submit'; form.append(button);
    $('stock-updated').textContent = 'Last recorded: ' + dateTime(inventory?.updatedAt);
    $('workspace-supplies').textContent = String(workboard?.summary.supplyGaps ?? '—');
  }
  function taskCard(task) {
    const card = element('article', undefined, 'task-card');
    card.dataset.taskId = task.id; card.dataset.status = task.status;
    const heading = element('div', undefined, 'task-heading');
    heading.append(element('h3', task.title), element('span', task.kind === 'supply' ? 'Supply task' : task.kind === 'household' ? 'Household' : 'Added task', 'tag'));
    card.append(heading);
    card.append(element('p', (task.assignee ? 'Assigned to ' + task.assignee : 'Unassigned') + (task.dueDate ? ' · Due ' + task.dueDate : '') + ' · ' + ({ todo: 'To do', doing: 'In progress', done: 'Done' })[task.status], 'task-meta'));
    if (task.notes) card.append(element('p', task.notes, 'task-notes'));
    if (task.kind === 'supply') card.append(element('p', task.onHand + ' on hand · plan target ' + task.target + (task.shortfall ? ' · ' + task.shortfall + ' still needed' : ' · target stocked'), 'stock-context'));
    const form = document.createElement('form');
    const first = element('div', undefined, 'task-fields');
    first.append(field('Task', input('title', task.title, { maxLength: 160, required: true })), field('Status', statusSelect(task.status)));
    const second = element('div', undefined, 'task-fields');
    second.append(field('Assigned to', input('assignee', task.assignee, { maxLength: 80 })), field('Due date', input('dueDate', task.dueDate, { type: 'date' })));
    form.append(first, second);
    if (task.kind === 'supply') form.append(field(pretty(task.item) + ' now on hand', input('quantityOnHand', task.onHand, { type: 'number', required: true })));
    const notes = document.createElement('textarea'); notes.name = 'notes'; notes.maxLength = 2000; notes.rows = 2; notes.value = task.notes;
    form.append(field('Notes', notes));
    const bottom = element('div', undefined, 'task-bottom');
    const save = element('button', 'Save task'); save.type = 'submit';
    bottom.append(save, element('span', (task.completedAt ? 'Completed ' : 'Updated ') + dateTime(task.completedAt ?? task.updatedAt), 'hint'));
    form.append(bottom);
    const edit = document.createElement('details');
    edit.append(element('summary', 'Edit assignment, notes and progress'), form);
    card.append(edit);
    const quick = element('div', undefined, 'task-quick');
    const complete = element('button', task.status === 'done' ? 'Reopen task' : 'Mark done');
    complete.type = 'button';
    complete.dataset.unavailable = String(task.status !== 'done' && task.kind === 'supply' && task.shortfall > 0);
    quick.append(complete);
    if (complete.dataset.unavailable === 'true') quick.append(element('span', 'Update the stock count to complete this restock.', 'hint'));
    card.append(quick);
    complete.addEventListener('click', () => {
      const args = { missionId, taskId: task.id, expectedRevision: task.revision, changes: { status: task.status === 'done' ? 'todo' : 'done' } };
      void run(async () => {
        const result = await tool('hearthline_update_task', args);
        accept(result.workboard);
        event(args.changes.status === 'done' ? 'Household task completed' : 'Household task reopened', { missionId, taskId: task.id });
        verdict(args.changes.status === 'done' ? 'Task marked done and saved.' : 'Task reopened. Recorded stock is retained.');
      });
    });
    form.addEventListener('submit', submit => {
      submit.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      const args = {
        missionId, taskId: task.id, expectedRevision: task.revision,
        changes: { title: values.title, status: values.status, assignee: values.assignee, dueDate: values.dueDate, notes: values.notes },
        ...(task.kind === 'supply' && Number(values.quantityOnHand) !== task.onHand ? { quantityOnHand: Number(values.quantityOnHand), expectedInventoryRevision: workboard.inventory.revision } : {}),
      };
      void run(async () => {
        const result = await tool('hearthline_update_task', args);
        accept(result.workboard);
        event('Household task saved', { missionId, taskId: task.id, status: values.status });
        verdict('Task saved. Assignment, stock and progress are retained in this workspace.');
      });
    });
    return card;
  }
  function renderTasks() {
    const list = $('task-list'); list.replaceChildren();
    const tasks = workboard?.tasks ?? [];
    const visible = filter === 'all' ? tasks : tasks.filter(task => task.status === filter);
    for (const task of visible) list.append(taskCard(task));
    if (!visible.length) list.append(element('p', !missionId ? 'Create or reopen a mission to begin household work.' : 'No tasks in this view.', 'empty-state'));
    const summary = workboard?.summary;
    $('workboard-progress').textContent = summary ? summary.done + ' of ' + summary.total + ' tasks done' : 'No mission open';
    $('workboard-assignment').textContent = summary ? summary.unassigned + ' unassigned · ' + summary.doing + ' in progress' : 'Assignments and notes stay with each plan';
    $('workspace-tasks').textContent = summary ? summary.done + ' / ' + summary.total : '—';
    $('workboard-updated').textContent = workboard ? 'Last task update: ' + dateTime(workboard.updatedAt) : '';
  }
  function render() { renderTasks(); renderInventory(); setBusy(busy); }
  function accept(value) {
    workboard = value; inventory = value.inventory;
    render();
  }
  async function open(id) {
    ready = false; setBusy(busy);
    if (id !== missionId) { addForm.reset(); addRequest = null; }
    missionId = id;
    if (id) {
      const result = await tool('hearthline_get_workboard', { missionId: id });
      ready = true; accept(result.workboard);
    }
    else {
      const result = await tool('hearthline_get_inventory', {});
      workboard = null; inventory = result.inventory; ready = true; render();
    }
  }
  $('task-filter').addEventListener('change', change => { filter = change.target.value; renderTasks(); setBusy(busy); });
  $('refresh-workboard').addEventListener('click', () => void run(async () => {
    await open(missionId);
    verdict('Current household progress and stock are shown.');
  }));
  $('stock-form').addEventListener('submit', submit => {
    submit.preventDefault();
    const items = Object.fromEntries([...new FormData(submit.currentTarget)]
      .map(([name, value]) => [name, Number(value)])
      .filter(([name, value]) => value !== inventory.items[name]));
    if (!Object.keys(items).length) { verdict('The recorded stock already matches these counts.'); return; }
    const expectedRevision = inventory.revision;
    void run(async () => {
      await tool('hearthline_update_inventory', { items, expectedRevision });
      await open(missionId);
      event('Counted household stock saved', { items });
      verdict('Stock saved. Current supply gaps have been recalculated; previous shopping handoffs keep their original quantities.');
    });
  });
  addForm.addEventListener('submit', submit => {
    submit.preventDefault();
    const values = Object.fromEntries(new FormData(addForm));
    const signature = JSON.stringify({ missionId, ...values });
    if (addRequest?.signature !== signature) addRequest = { signature, taskId: 'task_' + crypto.randomUUID() };
    const args = { missionId, taskId: addRequest.taskId, ...values };
    void run(async () => {
      const result = await tool('hearthline_add_task', args);
      accept(result.workboard); addForm.reset(); addRequest = null;
      event('Household task added', { missionId, taskId: result.taskId });
      verdict('Task added to the saved household plan.');
    });
  });
  return { open, setBusy, snapshot: () => ({ workboard, inventory }) };
}
