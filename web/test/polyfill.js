/**
 * 测试环境 polyfill：给 Node 提供浏览器全局（localStorage / window 存根）。
 * 必须在 import 业务模块之前最先被 import（静态 import 按文本顺序执行）。
 */
function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => map.set(String(k), String(v)),
    removeItem: (k) => map.delete(String(k)),
    clear: () => map.clear(),
    _map: map,
  };
}

globalThis.localStorage = makeStorage();

if (typeof globalThis.window === "undefined") {
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    matchMedia: () => ({ addEventListener: () => {}, matches: false }),
    location: { host: "127.0.0.1:8765", protocol: "http:", href: "http://127.0.0.1:8765/" },
  };
}

export { makeStorage };
