const sidebar = document.querySelector('.sidebar');
if (sidebar) {
  const registered = () => sidebar.querySelector('[data-view="source-updates"]');
  const old = () => sidebar.querySelector('[data-source-refresh-link]');
  if (!registered() && !old()) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = 'Source updates';
    button.dataset.sourceRefreshLink = 'true';
    button.addEventListener('click', () => { location.href = '/web/source-refresh.html'; });
    const before = sidebar.querySelector('[data-view="profiles"]') || sidebar.querySelector('.sidebar-footer');
    sidebar.insertBefore(button,before);
  }
  const observer = new MutationObserver(() => {
    if (registered()) { old()?.remove(); observer.disconnect(); }
  });
  if (registered()) old()?.remove();
  else observer.observe(sidebar,{childList:true,subtree:true});
  globalThis.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
}
