'use strict';
/** Exact shared text representation of an original First contact message. */
function renderFirstContactTextHtml(body) {
  if (typeof body !== 'string') throw new TypeError('Complete reviewed text required');
  const escaped = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return body.split('\n\n').map(part => '<p>' + escaped(part).replace(/\n/g, '<br>') + '</p>').join('\n');
}
module.exports={renderFirstContactTextHtml};
