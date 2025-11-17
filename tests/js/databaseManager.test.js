// The database manager is the heart of the offline frontend. These tests take a
// white-box approach: we feed in purposely messy payloads and assert that all
// normalization/IndexedDB flows behave as the SPA expects.
const { DatabaseManager } = require('../../app');

async function createManager(overrides = {}) {
  const manager = new DatabaseManager();
  manager.metadataPath = '/noop';
  manager.dbName = `NewTubeDB-test-${Date.now()}-${Math.random()}`;
  manager.api = {
    fetchBootstrap: jest.fn().mockResolvedValue(null),
    fetchVideos: jest.fn().mockResolvedValue([]),
    fetchShorts: jest.fn().mockResolvedValue([]),
    fetchVideo: jest.fn().mockResolvedValue(null),
    fetchShort: jest.fn().mockResolvedValue(null),
    fetchComments: jest.fn().mockResolvedValue([]),
    fetchShortComments: jest.fn().mockResolvedValue([]),
    ...overrides
  };
  await manager.init();
  return manager;
}

describe('DatabaseManager normalization helpers', () => {
  it('Normalizes heterogeneous video payloads', () => {
    const manager = new DatabaseManager();
    // Payload combines camelCase, snake_case and JSON strings to mimic the
    // API responses scraped from yt-dlp metadata dumps
    const normalized = manager.normalizeVideo({
      videoid: 'abc',
      title: 'Demo',
      description: 'desc',
      likes: '42',
      dislikes: 0,
      views: '1000',
      upload_date: '2024-05-01',
      duration: '125',
      tags_json: '["tech","review"]',
      thumbnails: ['a.jpg', 'b.jpg'],
      sources_json: '[{"format_id":"1080p","url":"https://cdn"}]'
    });

    expect(normalized.videoid).toBe('abc');
    expect(normalized.tags).toEqual(['tech', 'review']); // JSON string -> array
    expect(normalized.thumbnailUrl).toBe('a.jpg'); // first thumbnail fallback
    expect(normalized.durationText).toBe('2:05'); // 125 seconds -> pretty text
    expect(normalized.sources[0]).toMatchObject({ formatId: '1080p' });
  });

  it('Normalizes comments and subtitles collections', () => {
    const manager = new DatabaseManager();
    // Comments should manage any type of text like legacy snake_case names and truthy integers
    const comment = manager.normalizeComment({
      id: 'c1',
      videoid: 'abc',
      parent_comment_id: 'root',
      likes: '3',
      status_likedbycreator: 1
    });
    expect(comment.parentCommentId).toBe('root');
    expect(comment.likes).toBe(3);
    expect(comment.status_likedbycreator).toBe(true);

    const subtitles = manager.normalizeSubtitle({
      videoid: 'abc',
      languages_json: '[{"code":"en","name":"English","url":"/en"}]'
    });
    // Subtitles JSON is expected to be expanded into rich objects
    expect(subtitles.languages).toHaveLength(1);
    expect(subtitles.languages[0].code).toBe('en');
  });
});

describe('DatabaseManager IndexedDB operations', () => {
  let manager;

  beforeEach(async () => {
    manager = await createManager();
  });

  it('Bulk insert & replace pipelines write to IndexedDB', async () => {
    // Bulk insert is used by the bootstrap sync, we ensure it stores records
    // and that bulkReplace clears any stale data first
    await manager.bulkInsert('videos', [{ videoid: 'one', title: 'One' }]);
    let all = await manager.getAllFromStore('videos');
    expect(all).toHaveLength(1);
    expect(all[0].videoid).toBe('one');

    await manager.bulkReplace('videos', [{ videoid: 'two', title: 'Two' }]);
    all = await manager.getAllFromStore('videos');
    expect(all).toHaveLength(1);
    expect(all[0].videoid).toBe('two');
  });

  it('ReplaceComments clears stale entries before inserting', async () => {
    // Comments MUST be rebuilt entirely whenever a video sync occurs
    await manager.replaceComments('abc', [
      { id: '1', videoid: 'abc', text: 'before', parentCommentId: null }
    ]);
    await manager.replaceComments('abc', [
      { id: '2', videoid: 'abc', text: 'after', parentCommentId: null }
    ]);

    const comments = await manager.readCommentsFromStore('abc');
    expect(comments).toHaveLength(1);
    expect(comments[0].id).toBe('2');
  });

  it('Sorts videos by upload date descending', () => {
    // Edge case: missing dates should be treated as ancient entries, old
    // youtube video do this sometimes. Very annoying but we have no choice.
    const list = [
      { videoid: 'old', uploadDate: '2023-01-01' },
      { videoid: 'new', uploadDate: '2024-01-01' },
      { videoid: 'unknown' }
    ];
    const sorted = manager.sortByUploadDate(list);
    expect(sorted.map((v) => v.videoid)).toEqual(['new', 'old', 'unknown']);
  });
});

describe('DatabaseManager lifecycle', () => {
  const originalIndexedDB = window.indexedDB;

  afterEach(() => {
    window.indexedDB = originalIndexedDB;
    global.fetch.mockClear();
    jest.restoreAllMocks();
  });

  it('short-circuits init when IndexedDB is missing', async () => {
    delete window.indexedDB;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const manager = new DatabaseManager();
    const result = await manager.init();
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('IndexedDB not supported'));
  });

  it('seedFromMetadata cancels fetch stream and bulk loads bootstrap payload', async () => {
    const cancel = jest.fn().mockResolvedValue();
    global.fetch.mockResolvedValueOnce({
      ok: true,
      body: { cancel },
      arrayBuffer: jest.fn()
    });

    const payload = {
      videos: [{ videoid: 'video-1', title: 'Video' }],
      shorts: [{ videoid: 'short-1', title: 'Short' }],
      subtitles: [{ videoid: 'video-1', languages: [] }],
      comments: [{ id: 'c1', videoid: 'video-1', parentCommentId: null }]
    };
    const manager = await createManager({
      fetchBootstrap: jest.fn().mockResolvedValue(payload)
    });

    expect(cancel).toHaveBeenCalled();
    const videos = await manager.getAllFromStore('videos');
    const shorts = await manager.getAllFromStore('shorts');
    const subtitles = await manager.getAllFromStore('subtitles');
    const comments = await manager.getAllFromStore('comments');
    expect(videos.map((v) => v.videoid)).toContain('video-1');
    expect(shorts.map((v) => v.videoid)).toContain('short-1');
    expect(subtitles.map((s) => s.videoid)).toContain('video-1');
    expect(comments.map((c) => c.id)).toContain('c1');
  });

  it('refreshFromApi enforces apiSyncPromise lock', async () => {
    const manager = await createManager();
    await manager.refreshFromApi();
    manager.api.fetchBootstrap.mockClear();
    let resolveSync;
    const pending = new Promise((resolve) => {
      resolveSync = resolve;
    });
    manager.api.fetchBootstrap.mockReturnValueOnce(pending);

    const first = manager.refreshFromApi();
    const second = manager.refreshFromApi();
    expect(manager.api.fetchBootstrap).toHaveBeenCalledTimes(1);

    resolveSync(null);
    await Promise.all([first, second]);
    manager.api.fetchBootstrap.mockResolvedValueOnce(null);
    await manager.refreshFromApi();
    expect(manager.api.fetchBootstrap).toHaveBeenCalledTimes(2);
  });
});

describe('DatabaseManager API fallbacks', () => {
  afterEach(() => {
    global.fetch.mockClear();
  });

  it('fetchAndStoreMedia hits video and short endpoints appropriately', async () => {
    const manager = await createManager();
    manager.api.fetchVideo.mockResolvedValueOnce({ videoid: 'v1', title: 'Video' });
    manager.api.fetchShort.mockResolvedValueOnce({ videoid: 's1', title: 'Short' });

    await manager.fetchAndStoreMedia('v1', 'videos');
    await manager.fetchAndStoreMedia('s1', 'shorts');

    expect(manager.api.fetchVideo).toHaveBeenCalledWith('v1');
    expect(manager.api.fetchShort).toHaveBeenCalledWith('s1');
    const storedVideo = await manager.getFromStore('videos', 'v1');
    const storedShort = await manager.getFromStore('shorts', 's1');
    expect(storedVideo.title).toBe('Video');
    expect(storedShort.title).toBe('Short');
  });

  it('fetchCommentsFromApi falls back to shorts when video thread fails', async () => {
    const manager = await createManager();
    manager.api.fetchComments.mockResolvedValueOnce(null);
    manager.api.fetchShortComments.mockResolvedValueOnce([
      { id: 'short-comment', videoid: 'abc', parentCommentId: null }
    ]);

    await manager.fetchCommentsFromApi('abc');
    expect(manager.api.fetchShortComments).toHaveBeenCalledWith('abc');
    const stored = await manager.readCommentsFromStore('abc');
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe('short-comment');
  });

  it('getVideo/getShort refresh stores before returning entries', async () => {
    const manager = await createManager();
    manager.api.fetchVideo.mockResolvedValueOnce({ videoid: 'vid-9', title: 'Video Nine' });
    manager.api.fetchShort.mockResolvedValueOnce({ videoid: 'short-9', title: 'Short Nine' });

    const video = await manager.getVideo('vid-9');
    const short = await manager.getShort('short-9');

    expect(video.title).toBe('Video Nine');
    expect(short.title).toBe('Short Nine');
  });

  it('getComments filters replies while getCommentReplies returns them', async () => {
    const manager = await createManager();
    manager.api.fetchComments.mockResolvedValueOnce([
      { id: 'parent', videoid: 'abc', parentCommentId: null },
      { id: 'reply', videoid: 'abc', parentCommentId: 'parent' }
    ]);

    const parents = await manager.getComments('abc');
    expect(parents).toHaveLength(1);
    expect(parents[0].id).toBe('parent');

    const replies = await manager.getCommentReplies('parent');
    expect(replies).toHaveLength(1);
    expect(replies[0].id).toBe('reply');
  });

  it('getComments falls back to short comments when fetchComments rejects', async () => {
    const manager = await createManager();
    manager.api.fetchComments.mockRejectedValueOnce(new Error('boom'));
    manager.api.fetchShortComments.mockResolvedValueOnce([
      { id: 'short-fallback', videoid: 'xyz', parentCommentId: null }
    ]);

    await manager.getComments('xyz');
    expect(manager.api.fetchShortComments).toHaveBeenCalledWith('xyz');
    const stored = await manager.readCommentsFromStore('xyz');
    expect(stored.some((c) => c.id === 'short-fallback')).toBe(true);
  });
});
