// The persistence layer for likes/playlists/watch history lives entirely in
// the browser. These tests make sure this works correctly.
const UserDataStore = require('../../userData');

describe('UserDataStore', () => {
  const originalDispatch = window.dispatchEvent;

  beforeEach(() => {
    window.dispatchEvent = jest.fn();
    window.localStorage.clear();
  });

  afterEach(() => {
    window.dispatchEvent = originalDispatch;
  });

  it('creates default playlists and deduplicates entries', () => {
    // Instantiation should always create the "Favorites" playlist to avoid null checks in the UI
    const store = new UserDataStore('test-playlists');
    const playlistKey = store.normalizeKey('Favorites');
    expect(store.data.playlists[playlistKey]).toBeDefined();

    // Adding the same video twice must not duplicate entries
    store.addToPlaylist('Favorites', 'vid-1', { title: 'Video 1' });
    store.addToPlaylist('Favorites', 'vid-1', { title: 'Video 1' });

    const playlist = store.data.playlists[playlistKey];
    expect(playlist.videoIds).toEqual(['vid-1']);
    expect(window.dispatchEvent).toHaveBeenCalled();
  });

  it('Manages mutually exclusive reactions', () => {
    const store = new UserDataStore('test-reactions');
    // Likes convert to dislikes when toggled, and a second dislike removes it (basic like/dislike logic)
    expect(store.toggleLike('vid-2')).toBe('like');
    expect(store.getReaction('vid-2')).toBe('like');
    expect(store.toggleDislike('vid-2')).toBe('dislike');
    expect(store.getReaction('vid-2')).toBe('dislike');
    expect(store.toggleDislike('vid-2')).toBe('none');
  });

  it('clamps watch progress and marks watched when >= 90%', () => {
    const store = new UserDataStore('test-watch');
    // Values > 1 should be clamped to 1 and mark the entry as watched,
    // should never happen but you never know with &t= future implementation planned
    // we'll have to make sure this passes and make more tests on it
    store.setWatchProgress('vid-3', 1.5, { title: 'demo' });
    expect(store.getWatchProgress('vid-3')).toBe(1);
    expect(store.isWatched('vid-3')).toBe(true);

    // Partial progress must not mark the content as watched
    store.setWatchProgress('vid-4', 0.2, {});
    expect(store.getWatchProgress('vid-4')).toBe(0.2);
    expect(store.isWatched('vid-4')).toBe(false);
  });

  it('handles subscriptions, stats, exports, and imports', () => {
    const store = new UserDataStore('test-advanced');
    window.dispatchEvent.mockClear();
    expect(store.toggleSubscription('channel-1', { name: 'Channel' })).toBe(true);
    expect(store.isSubscribed('channel-1')).toBe(true);
    expect(
      window.dispatchEvent.mock.calls.some(
        ([event]) => event.detail && event.detail.type === 'subscription'
      )
    ).toBe(true);

    const stats = store.getStats();
    expect(stats.playlists).toBeGreaterThan(0);

    const exported = store.exportToString();
    expect(() => JSON.parse(exported)).not.toThrow();

    const originalCreateElement = document.createElement;
    const originalAppendChild = document.body.appendChild;
    const originalRemoveChild = document.body.removeChild;
    const originalCreateObjectURL = global.URL.createObjectURL;
    const originalRevokeObjectURL = global.URL.revokeObjectURL;
    const link = {
      click: jest.fn(),
      set href(value) {
        this._href = value;
      },
      get href() {
        return this._href;
      },
      set download(value) {
        this._download = value;
      },
      get download() {
        return this._download;
      },
      style: {}
    };
    document.createElement = jest.fn().mockReturnValue(link);
    document.body.appendChild = jest.fn();
    document.body.removeChild = jest.fn();
    global.URL.createObjectURL = jest.fn().mockReturnValue('blob:123');
    global.URL.revokeObjectURL = jest.fn();

    store.downloadExport('custom.json');
    expect(link.click).toHaveBeenCalled();
    expect(document.body.appendChild).toHaveBeenCalledWith(link);
    expect(document.body.removeChild).toHaveBeenCalledWith(link);
    document.createElement = originalCreateElement;
    document.body.appendChild = originalAppendChild;
    document.body.removeChild = originalRemoveChild;
    global.URL.createObjectURL = originalCreateObjectURL;
    global.URL.revokeObjectURL = originalRevokeObjectURL;

    expect(() => store.importFromString('{"data":{}}')).not.toThrow();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => store.importFromString('bad json')).toThrow();
    errorSpy.mockRestore();
  });

  it('dispatches events for each save pathway', () => {
    const store = new UserDataStore('test-events');
    window.dispatchEvent.mockClear();

    store.addToPlaylist('Favorites', 'vid', {});
    store.toggleLike('vid');
    store.setWatchProgress('vid', 0.5, {});
    store.toggleSubscription('channel');
    store.importFromString(JSON.stringify({ data: store.getSnapshot() }));

    const types = window.dispatchEvent.mock.calls
      .map(([event]) => event.detail && event.detail.type)
      .filter(Boolean);
    expect(types).toEqual(
      expect.arrayContaining(['playlist', 'reaction', 'watch', 'subscription', 'import'])
    );
  });
});
