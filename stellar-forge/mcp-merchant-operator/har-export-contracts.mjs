// MIT. Original tool metadata; provider runtimes load only when selected.


const HAR_EXPORT_FILES = Object.freeze({
  reviewer: ['review.html', 'text/html; charset=utf-8'],
  inventory: ['inventory.json', 'application/json'],
  decisions: ['decisions.json', 'application/json'],
  draft: ['draft.json', 'application/json'],
  comparison: ['change-report.json', 'application/json'],
  openapi: ['openapi.json', 'application/json'],
});

export { HAR_EXPORT_FILES };
