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
});
