describe('service worker behavior', () => {
  let listeners;
  let cache;

  beforeEach(() => {
    jest.resetModules();
    listeners = {};
    cache = {
      addAll: jest.fn().mockResolvedValue(),
      put: jest.fn(),
      match: jest.fn().mockResolvedValue('cached')
    };
    global.self = {
      addEventListener: (type, handler) => {
        listeners[type] = handler;
      },
      skipWaiting: jest.fn(),
      clients: { claim: jest.fn() }
    };
    global.caches = {
      open: jest.fn().mockResolvedValue(cache),
      keys: jest.fn().mockResolvedValue(['old-cache']),
      delete: jest.fn().mockResolvedValue(true),
      match: jest.fn().mockResolvedValue('index')
    };
    global.fetch = jest.fn(() =>
      Promise.resolve({
        status: 200,
        type: 'basic',
        clone: () => ({
          status: 200,
          type: 'basic'
        })
      })
    );
    require('../../sw.js');
  });

  it('ignores API and stream requests during fetch', () => {
    const respondWith = jest.fn();
    listeners.fetch({
      request: { method: 'GET', url: 'https://example.com/api/videos', mode: 'cors' },
      respondWith,
      waitUntil: jest.fn()
    });
    expect(respondWith).not.toHaveBeenCalled();

    listeners.fetch({
      request: { method: 'GET', url: 'https://example.com/watch/streams/vid', mode: 'cors' },
      respondWith,
      waitUntil: jest.fn()
    });
    expect(respondWith).not.toHaveBeenCalled();
  });

  it('serves navigation requests from network with fallback to index.html', async () => {
    const respondWith = jest.fn();
    global.fetch.mockRejectedValueOnce(new Error('offline'));
    await listeners.fetch({
      request: { method: 'GET', url: 'https://example.com/watch', mode: 'navigate' },
      respondWith,
      waitUntil: jest.fn()
    });
    expect(respondWith).toHaveBeenCalled();
  });

  it('serves cached static assets', async () => {
    const respondWith = jest.fn();
    await listeners.fetch({
      request: { method: 'GET', url: 'https://example.com/app.js', mode: 'cors' },
      respondWith,
      waitUntil: jest.fn()
    });
    expect(caches.match).toHaveBeenCalled();
    expect(respondWith).toHaveBeenCalled();
  });

  it('handles skip waiting and clear cache messages', async () => {
    await listeners.message({
      data: { type: 'SKIP_WAITING' }
    });
    expect(self.skipWaiting).toHaveBeenCalled();

    const waitUntil = jest.fn((promise) => promise);
    await listeners.message({
      data: { type: 'CLEAR_CACHE' },
      waitUntil
    });
    expect(caches.keys).toHaveBeenCalled();
    expect(caches.delete).toHaveBeenCalledWith('old-cache');
  });
});
