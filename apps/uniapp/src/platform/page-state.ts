type AnyMethod = (...args: any[]) => any;
export function applyPatch(state: Record<string, any>, patch: Record<string, unknown>): void {
  for (const [path, value] of Object.entries(patch)) {
    const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    if (keys.some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) throw new Error('Invalid state path');
    let target = state;
    keys.slice(0, -1).forEach((key, index) => { target = target[key] ??= /^\d+$/.test(keys[index + 1]) ? [] : {}; });
    target[keys[keys.length - 1]] = value;
  }
}
export function definePage<D extends WechatMiniprogram.Page.DataOption, M extends WechatMiniprogram.Page.CustomOption>(options: WechatMiniprogram.Page.Options<D,M>): {data:D}&M { return options as {data:D}&M; }
export function createPageInstance<D extends Record<string, unknown>, M extends object>(options: { data:D } & M, state = options.data) {
  const instance = { data: state, setData: (patch:Record<string, unknown>) => applyPatch(state,patch) } as {data:D;setData:(patch:Record<string,unknown>)=>void}&M;
  for (const [key,value] of Object.entries(options) as Array<[string,unknown]>) if (typeof value === 'function') (instance as Record<string,unknown>)[key] = value.bind(instance);
  return instance;
}
