#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Buyer } from '../../client.mjs';
import { startTaskDesk } from './server.mjs';

const HELP = `Task desk — operate caller tasks through the original buyer Inbox

Usage:
  starforge buyer-task-desk --runtime SF88_DIRECTORY --state NODE_STATE \
    --inbox ORIGINAL_INBOX --tasks SAVED_TASKS --outputs COMPLETE_RESULTS \
    [--workspace ORIGINAL_OPERATOR_WORKSPACE] [--commerce ORIGINAL_COMMERCE_SESSION] [--port PORT] \
    [--existing-task ORIGINAL_TASK --existing-output ORIGINAL_RESULTS] [--delivery CUSTOMER_DELIVERY]

From the Node package root, run node agents/task-desk/cli.mjs.
From the original SF88 root, run node node/agents/task-desk/cli.mjs.
The desk listens on 127.0.0.1 and prints its local address.
Use --port 0 (the default) to choose an available port.

--runtime    Complete original sf88-operator-buyer-cli runtime directory.
--state      Existing private Node buyer application state.
--inbox      Existing original Inbox, at its recorded absolute location.
--tasks      Private caller-task directory, normally inside --state.
--outputs    Private result directory outside both --inbox and --tasks.
--workspace  Optional original native operator workspace for explicit execution.
--commerce   Optional original commerce session containing this Inbox and saved RPC reads.
--existing-task    Optional original task directory containing task.json.
--existing-output  Its recorded receiving destination or complete delivered packet.
                   Supply both existing-directory options together.
--delivery   Optional separate private customer-delivery store for reviewed full packages.
--port       Local port, 0 through 65535.
--help       Print this help.

Select existing requests, preview and save a task, review an original request,
and explicitly execute or recover it. Receive saves every complete result.
Download the whole packet archive and extract it to use review.html offline.
Keep the original operating roots when restoring task execution.
An existing task stays in its selected directory. A recorded receiving resumes
at that same destination. A complete packet moved for delivery opens for
reading and download; its moved directory never starts another receiving.

Closing a browser leaves an accepted command running. Ctrl+C stops this desk
after accepted native commands finish. Reopening the same roots restores the
saved task and operation history.
`;

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args, allowPositionals: false, strict: true,
    options: {
      runtime: { type: 'string' }, state: { type: 'string' },
      inbox: { type: 'string' }, tasks: { type: 'string' },
      outputs: { type: 'string' }, workspace: { type: 'string' }, commerce: { type: 'string' }, delivery: { type: 'string' },
      'existing-task': { type: 'string' }, 'existing-output': { type: 'string' },
      port: { type: 'string' }, help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) { process.stdout.write(HELP); return null; }
  for (const key of ['runtime', 'state', 'inbox', 'tasks', 'outputs']) {
    if (!values[key]?.trim()) {
      const error = new Error('Supply --' + key + '. Use --help for the complete command.');
      error.code = 'DESK_ARGUMENT_REQUIRED'; throw error;
    }
  }
  if ((values['existing-task'] !== undefined) !== (values['existing-output'] !== undefined) ||
    values['existing-task'] !== undefined && (!values['existing-task'].trim() || !values['existing-output'].trim())) {
    const error = new Error('Supply both --existing-task and --existing-output with their original absolute directories.');
    error.code = 'DESK_RETAINED_PAIR_REQUIRED'; throw error;
  }
  if (values.commerce !== undefined && !values.commerce.trim()) {
    const error = new Error('Supply --commerce with the original commerce session directory.');
    error.code = 'DESK_RPC_COMMERCE_REQUIRED'; throw error;
  }
  if (values.delivery !== undefined && !values.delivery.trim()) {
    const error = new Error('Supply --delivery with a separate private customer-delivery directory.');
    error.code = 'DESK_DELIVERY_DIRECTORY'; throw error;
  }
  const portText = values.port ?? '0';
  if (!/^(0|[1-9][0-9]*)$/.test(portText) || Number(portText) > 65535) {
    const error = new Error('--port must be an integer from 0 through 65535.');
    error.code = 'DESK_PORT_INVALID'; throw error;
  }
  const buyer = await new Buyer({
    runtimeDirectory: resolve(values.runtime),
    stateDirectory: resolve(values.state),
  }).ready();
  const inbox = buyer.inbox(resolve(values.inbox));
  const desk = await startTaskDesk({
    inbox, tasksDirectory: resolve(values.tasks), outputsDirectory: resolve(values.outputs),
    workspaceDirectory: values.workspace === undefined ? undefined : resolve(values.workspace),
    commerceDirectory: values.commerce === undefined ? undefined : resolve(values.commerce),
    customerDeliveryDirectory: values.delivery === undefined ? undefined : resolve(values.delivery),
    existingTaskDirectory: values['existing-task'] === undefined ? undefined : resolve(values['existing-task']),
    existingOutputDirectory: values['existing-output'] === undefined ? undefined : resolve(values['existing-output']),
    port: Number(portText),
  });
  process.stdout.write(JSON.stringify({
    schema: 'stellar-forge.inbox-task-desk-launch.v1',
    url: desk.url, instanceId: desk.instanceId,
    inbox: inbox.directory, tasks: resolve(values.tasks), outputs: resolve(values.outputs),
    ...(values.commerce === undefined ? {} : { commerce: resolve(values.commerce) }),
    ...(values.delivery === undefined ? {} : { customerDelivery: resolve(values.delivery) }),
    ...(values['existing-task'] === undefined ? {} : {
      existingTask: resolve(values['existing-task']), existingOutput: resolve(values['existing-output']),
    }),
  }, null, 2) + '\n');
  return desk;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(desk => {
    if (!desk) return;
    let closing = false;
    const stop = async () => {
      if (closing) return;
      closing = true;
      process.stderr.write('Closing the task desk after accepted commands finish.\n');
      try { await desk.close(); }
      catch (error) {
        process.stderr.write(JSON.stringify({ error: { code: error.code || 'DESK_CLOSE_FAILED',
          message: error.message } }) + '\n');
        process.exitCode = 1;
      } finally {
        process.off('SIGINT', stop); process.off('SIGTERM', stop);
      }
    };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  }).catch(error => {
    process.stderr.write(JSON.stringify({ error: { code: error.code || 'DESK_LAUNCH_FAILED',
      message: error.message } }) + '\n');
    process.exitCode = 1;
  });
}
