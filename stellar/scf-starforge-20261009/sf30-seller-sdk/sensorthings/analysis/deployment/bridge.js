// MIT. Connect the unchanged native Helgoland XHR client to one saved analysis.
(() => {
  'use strict';
  const script = document.currentScript;
  const configuration = {
    viewerId: script?.dataset.viewer, versionId: script?.dataset.version,
    mode: script?.dataset.mode, workspaceId: script?.dataset.workspace,
    settingsPath: script?.dataset.settingsPath
  };
  const hash = /^[a-f0-9]{64}$/, uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
  if (!hash.test(configuration.viewerId || '') || !hash.test(configuration.versionId || '') ||
      !['map', 'numeric'].includes(configuration.mode) || !uuid.test(configuration.workspaceId || '') ||
      typeof configuration.settingsPath !== 'string') throw new Error('The retained viewer binding is incomplete.');
  const basePath = '/analysis/viewer/' + configuration.viewerId + '/' + configuration.versionId + '/' + configuration.mode + '/';
  const protectedBase = '/api/analysis/viewers/' + configuration.viewerId + '/' + configuration.versionId + '/' + configuration.mode + '/';
  const staBase = '/api/analysis/sta/' + configuration.versionId + '/' + configuration.mode + '/';
  if (!location.pathname.startsWith(basePath)) throw new Error('The native viewer path differs from its retained binding.');
  const origin = location.origin, base = new URL(basePath, origin);
  const originalSettings = new URL(configuration.settingsPath, base);
  if (originalSettings.origin !== origin || !originalSettings.pathname.startsWith(basePath))
    throw new Error('The original settings path escapes its retained viewer.');
  const originals = {
    open: XMLHttpRequest.prototype.open, setRequestHeader: XMLHttpRequest.prototype.setRequestHeader,
    send: XMLHttpRequest.prototype.send
  };
  const requests = new WeakMap();
  function status(message) {
    const write = () => {
      const node = document.getElementById('sensorthings-viewer-connection-status');
      if (node) node.textContent = message;
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', write, {once:true});
    else write();
  }
  function connectionHeaders() {
    try {
      if (parent === window || typeof parent.sensorThingsAnalysisHeaders !== 'function')
        throw new Error('Registered analysis parent unavailable.');
      const supplied = parent.sensorThingsAnalysisHeaders(window);
      if (!supplied || typeof supplied !== 'object' || typeof supplied.then === 'function')
        throw new Error('Registered analysis headers unavailable.');
      const headers = new Headers(supplied), authorization = headers.get('authorization'),
        workspace = headers.get('x-sensorthings-workspace');
      if (!/^Bearer [A-Za-z0-9_-]{32,200}$/.test(authorization || '') || workspace !== configuration.workspaceId)
        throw new Error('Original analysis session differs.');
      return {authorization, workspace};
    } catch {
      status('Open this viewer from its current analysis workspace.');
      throw new DOMException('The original analysis frame/session is not available.', 'SecurityError');
    }
  }
  XMLHttpRequest.prototype.open = function(method, target, async, username, password) {
    const resolved = new URL(String(target), document.baseURI), next = new URL(resolved.href);
    if (next.origin === origin && next.pathname === originalSettings.pathname) {
      next.pathname = protectedBase + 'settings.json';
      next.search = ''; next.hash = '';
    }
    const sameAnalysis = next.origin === origin && next.pathname.startsWith('/api/analysis/');
    if (sameAnalysis && !next.pathname.startsWith(staBase) && next.pathname !== protectedBase + 'settings.json') {
      status('The viewer requested a different saved selection.');
      throw new DOMException('This native viewer is bound to its original saved selection.', 'SecurityError');
    }
    if (sameAnalysis && (!['GET','HEAD'].includes(String(method).toUpperCase()) || username || password || next.username || next.password))
      throw new DOMException('The native viewer connection is read only.', 'SecurityError');
    requests.set(this, {protected:sameAnalysis});
    const args = Array.from(arguments); args[1] = next.href;
    return originals.open.apply(this, args);
  };
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    if (requests.get(this)?.protected && ['authorization','x-sensorthings-workspace'].includes(String(name).toLowerCase()))
      return; // Only the registered original parent supplies these two headers.
    return originals.setRequestHeader.call(this, name, value);
  };
  XMLHttpRequest.prototype.send = function(body) {
    if (requests.get(this)?.protected) {
      const headers = connectionHeaders();
      originals.setRequestHeader.call(this, 'Authorization', headers.authorization);
      originals.setRequestHeader.call(this, 'X-SensorThings-Workspace', headers.workspace);
      status('');
    }
    return originals.send.call(this, body);
  };
})();
