// MIT. Original package name validation shared by compiler and file receiving.
const fail = m => { throw new TypeError(m); };
export function packageName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name)) fail('Package name: 1–64 letters, numbers, underscores or hyphens');
  return name;
}
