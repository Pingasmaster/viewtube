// The database manager is the heart of the offline frontend. These tests take a
// white-box approach: we feed in purposely messy payloads and assert that all
// normalization/IndexedDB flows behave as the SPA expects.
const { DatabaseManager } = require('../../app');

async function createManager() {
  const manager = new DatabaseManager();
  manager.metadataPath = '/noop';
  manager.api = {
    fetchBootstrap: jest.fn().mockResolvedValue(null),
    fetchVideos: jest.fn().mockResolvedValue([]),
    fetchShorts: jest.fn().mockResolvedValue([]),
    fetchVideo: jest.fn().mockResolvedValue(null),
    fetchShort: jest.fn().mockResolvedValue(null),
    fetchComments: jest.fn().mockResolvedValue([]),
    fetchShortComments: jest.fn().mockResolvedValue([])
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
