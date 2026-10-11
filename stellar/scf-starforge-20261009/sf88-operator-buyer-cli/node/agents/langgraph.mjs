// MIT — Official LangGraph checkpoints; original SF88 attempt and result custody.
import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import { BuyerAgent, summarizeOutcome } from './operation.mjs';
import { need } from '../store.mjs';

const BuyerGraphState = Annotation.Root({
  binding: Annotation({ reducer: (previous, next) => {
    if (previous) need(next && Object.keys(previous).every(key => previous[key] === next[key]),
      'AGENT_OPERATION_BINDING_MISMATCH');
    return next;
  }, default: () => null }),
  action: Annotation({ reducer: (_previous, next) => next, default: () => 'recover' }),
  nativeReview: Annotation({ reducer: (_previous, next) => next, default: () => null }),
  readOptions: Annotation({ reducer: (_previous, next) => next, default: () => null }),
  phase: Annotation({ reducer: (_previous, next) => next, default: () => 'created' }),
  outcome: Annotation({ reducer: (_previous, next) => next, default: () => null }),
  artifact: Annotation({ reducer: (_previous, next) => next, default: () => null }),
});

/** Input action is explicit: recover (default), offline review, or native execute. */
export function createBuyerGraph({ operation, checkpointer, read = { format: 'file' },
  interruptAfter = [], name = 'stellar_native_buyer' }) {
  need(checkpointer && typeof checkpointer.getTuple === 'function', 'DURABLE_CHECKPOINTER_REQUIRED');
  need(Array.isArray(interruptAfter) && interruptAfter.every(node =>
    ['bind', 'inspect', 'review', 'execute', 'read'].includes(node)), 'AGENT_INTERRUPT_NODE_INVALID');
  need(read === false || (read !== null && typeof read === 'object' && !Array.isArray(read)),
    'AGENT_READ_OPTIONS_INVALID');
  const readKeys = new Set(['format', 'limitBytes', 'offset', 'limitRecords', 'allowPartial',
    'maxRecordBytes', 'maxRecords', 'headers']);
  need(read === false || Object.keys(read).every(key => readKeys.has(key)), 'AGENT_READ_OPTIONS_INVALID');
  const agent = new BuyerAgent(operation);
  const nextAfterResult = state => {
    const selected = state.readOptions, result = state.outcome.result;
    if (selected === false || !result) return END;
    if (result.deliveryStatus === 'SAVED') return 'read';
    if (result.deliveryStatus === 'FAILED' && result.file && selected?.allowPartial === true &&
      ['sse', 'ndjson'].includes(selected.format) && result.stream?.format === selected.format) return 'read';
    // Recovery still returns the complete native outcome when no readable
    // response was retained. File consumption must not obscure that outcome.
    return END;
  };
  const workflow = new StateGraph(BuyerGraphState)
    .addNode('bind', async state => {
      need(['recover', 'review', 'execute'].includes(state.action), 'AGENT_ACTION_INVALID');
      return { binding: await agent.binding(state.binding), readOptions: structuredClone(read),
        artifact: null, phase: 'bound' };
    })
    .addNode('inspect', async state => {
      const outcome = await agent.recover({ binding: state.binding });
      return { outcome: summarizeOutcome(outcome), phase: outcome.phase };
    })
    .addNode('review', async state => {
      // The original runtime performs offline review. This is the same Review
      // required by Operation.execute; checkpoints introduce no second authority.
      const review = await agent.review({ binding: state.binding });
      return { nativeReview: review, phase: 'reviewed' };
    })
    .addNode('execute', async (state, config) => {
      const outcome = await agent.execute({ binding: state.binding, review: state.nativeReview,
        signal: config?.signal });
      return { outcome: summarizeOutcome(outcome), phase: outcome.phase };
    })
    .addNode('read', async (state, config) => ({
      artifact: await agent.read({ ...state.readOptions, binding: state.binding, signal: config?.signal }),
      phase: 'read',
    }))
    .addEdge(START, 'bind')
    .addEdge('bind', 'inspect')
    .addConditionalEdges('inspect', state => {
      if (state.action === 'review') return 'review';
      if (state.outcome.phase === 'result') return nextAfterResult(state);
      if (state.outcome.phase === 'awaiting_result' || state.action === 'recover') return END;
      return 'review';
    }, ['read', 'review', END])
    .addConditionalEdges('review', state => state.action === 'execute' ? 'execute' : END,
      ['execute', END])
    .addConditionalEdges('execute', state => state.outcome.phase === 'result'
      ? nextAfterResult(state) : END, ['read', END])
    .addEdge('read', END);
  return workflow.compile({ checkpointer, interruptAfter, name });
}
