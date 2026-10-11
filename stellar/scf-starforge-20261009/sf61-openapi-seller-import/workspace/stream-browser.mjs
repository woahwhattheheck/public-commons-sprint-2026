// MIT. Stream authoring controls within the original merchant workspace.
export const isStreamFormat = value => value === 'sse' || value === 'ndjson';

export function createStreamSettings({make,field}, previous) {
  const element=make('div',undefined,'wide'), controls=make('div',undefined,'fields');
  element.append(make('p','Retain a finite UTF-8 response using its declared stream format. Each paid request opens its own backend source.','hint'));
  const definitions=[['maxBytes','Maximum stream bytes',67108864,67108864],
    ['maxDurationMs','Maximum generation duration, milliseconds',60000,3600000],
    ['idleTimeoutMs','Maximum time between source bytes, milliseconds',10000,300000]];
  const inputs={};
  for(const [name,label,fallback,maximum] of definitions) {
    const control=field(label,previous?.stream?.[name]??fallback,'number');
    control.input.min='1';control.input.max=String(maximum);
    inputs[name]=control.input;controls.append(control.container);
  }
  element.append(controls,make('p','The ordinary backend timeout limits the wait for response headers. Generation duration and idle time apply to the stream. SSE ends at response EOF; NDJSON records require a newline.','hint'));
  return {element,
    setEnabled(selected,format) {
      element.hidden=!isStreamFormat(format);
      Object.values(inputs).forEach(input=>{input.disabled=!selected||element.hidden;});
    },
    read:()=>Object.fromEntries(Object.entries(inputs).map(([name,input])=>[name,Number(input.value)]))};
}

export function merchantResponseLabel(route) {
  if(!route.stream) return route.responseValidation==='declared'?
    'Declared '+route.responseStatuses.join(', '):'Transport limits';
  return route.responseMode.toUpperCase()+' · '+route.responseMimeType+' · '+
    route.stream.maxBytes+' bytes · '+route.stream.maxDurationMs+' ms total · '+
    route.stream.idleTimeoutMs+' ms idle';
}
