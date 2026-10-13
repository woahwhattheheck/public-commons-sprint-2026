/** Keep the maintained Conservation browser and decision client in one desk. */
import {attachConservation} from './conservation.mjs';
import {attachConservationOptimization} from './conservation_optimization.mjs';

export function attachConservationWithOptimization(host) {
  const original = attachConservation(host);
  if (original.integratedOptimization) return original;
  const decision = attachConservationOptimization(host, {view:'conservation'});
  let target = null;
  function ensureStyle() {
    const document=host.document || globalThis.document, href='/web/conservation_optimization.css';
    if(!document || [...document.querySelectorAll('link[rel="stylesheet"]')].some(link=>link.getAttribute('href')===href))return;
    const link=document.createElement('link');link.rel='stylesheet';link.href=href;document.head.append(link);
  }
  return {
    ...original,
    render(state = host.getState()) {
      return '<div data-conservation-composed>' + original.render(state) +
        (state?.workspace_key ?
          '<section data-conservation-optimization aria-label="Conservation objectives and resources"></section>' : '') +
        '</div>';
    },
    mount(root, state = host.getState()) {
      ensureStyle();
      original.mount(root, state);
      target = root?.querySelector('[data-conservation-optimization]') || null;
      if (target) return decision.mount(target);
    },
    update(state = host.getState()) {
      original.update?.(state);
      return decision.update(state);
    },
    detach() {
      original.detach?.();
      decision.detach();
      target = null;
    },
    async dispatch(button) {
      if (!button?.dataset?.action?.startsWith('portfolio-optimization-')) {
        return original.dispatch(button);
      }
      // Queue-result controls also work from the original task dialog.
      if (!button.closest?.('[data-conservation-optimization]')) {
        host.closeDetail?.();
        await host.navigate('conservation');
      }
      const result = await decision.dispatch(button);
      if (target && ['portfolio-optimization-result','portfolio-optimization-plan',
          'portfolio-optimization-analysis'].includes(button.dataset.action)) {
        target.scrollIntoView?.({block:'start',behavior:'smooth'});
      }
      return result;
    },
    taskActions(task) {
      return (original.taskActions?.(task) || '') + (decision.taskActions(task) || '');
    }
  };
}
