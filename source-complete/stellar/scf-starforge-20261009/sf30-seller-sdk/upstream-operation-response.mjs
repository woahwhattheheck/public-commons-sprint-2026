// MIT. One response-file contract for the original merchant CLI and operations console.
export function parseOperationResponse(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !['status','headers','body','bodyBase64'].includes(key)) ||
      Object.hasOwn(value,'body') === Object.hasOwn(value,'bodyBase64')) {
    throw new TypeError('Recovered response requires exactly body or bodyBase64');
  }
  if (!Object.hasOwn(value,'bodyBase64')) return value;
  if (typeof value.bodyBase64 !== 'string' ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.bodyBase64)) {
    throw new TypeError('Invalid response base64');
  }
  return {status:value.status,headers:value.headers,body:Buffer.from(value.bodyBase64,'base64')};
}
