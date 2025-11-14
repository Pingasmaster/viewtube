// Jest runs in node, so we polyfill browser APIs (IndexedDB, fetch, service
// workers) that the frontend relies on
const { TextEncoder, TextDecoder } = require('util');

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

global.window = global.window || global;
// Make sure we are in testing mode in the UI so we load a clean DB
Object.defineProperty(window, '__VIEWTUBE_TEST__', {
  value: true,
  writable: true,
  configurable: true
});

global.navigator = global.navigator || {};
navigator.serviceWorker = navigator.serviceWorker || {
  register: jest.fn().mockResolvedValue({ scope: '/' })
};

if (typeof global.structuredClone !== 'function') {
  global.structuredClone = (value) => JSON.parse(JSON.stringify(value));
}

global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0))
  })
);

global.IDBKeyRange = require('fake-indexeddb/lib/FDBKeyRange');

afterEach(() => {
  document.body.innerHTML = '';
});
