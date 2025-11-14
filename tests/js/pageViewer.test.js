const { VideoViewer, ShortsViewer, ViewerPage } = require('../../pageViewer');

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: jest.fn().mockResolvedValue()
  });
});

function createVideoData() {
  return {
    videoid: 'video-1',
    title: 'Demo Video',
    description: 'desc',
    author: 'Channel',
    subscriberCount: 10,
    views: 1000,
    likes: 5,
    dislikes: 1,
    uploadDate: '2024-01-01T00:00:00Z',
    sources: [
      { formatId: 'low', format_id: 'low', width: 480, height: 480, url: '/low', mimeType: 'video/mp4' },
      { formatId: 'high', format_id: 'high', width: 1080, height: 1080, url: '/high', mimeType: 'video/mp4' }
    ],
    thumbnails: [],
    thumbnailUrl: null,
    extras: {},
    tags: []
  };
}

function createServices(overrides = {}) {
  return {
    getVideo: jest.fn().mockResolvedValue(createVideoData()),
    getSubtitles: jest.fn().mockResolvedValue({
      videoid: 'video-1',
      languages: [{ code: 'en', name: 'English', url: '/subs/en.vtt' }]
    }),
    getComments: jest.fn().mockResolvedValue([]),
    getShort: jest.fn().mockResolvedValue({
      ...createVideoData(),
      videoid: 'short-1',
      sources: [
        { formatId: 'short-low', width: 480, height: 480, url: '/short-low', mimeType: 'video/mp4' },
        { formatId: 'short-high', width: 720, height: 720, url: '/short-high', mimeType: 'video/mp4' }
      ]
    }),
    fetchShortComments: jest.fn().mockResolvedValue([]),
    ...overrides
  };
}

describe('VideoViewer', () => {
  let services;
  let userDataStore;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    services = createServices();
    let subscribed = false;
    userDataStore = {
      getReaction: jest.fn().mockReturnValue('none'),
      toggleLike: jest.fn(),
      toggleDislike: jest.fn(),
      addToPlaylist: jest.fn(),
      toggleSubscription: jest.fn().mockImplementation(() => {
        subscribed = !subscribed;
        return subscribed;
      }),
      isSubscribed: jest.fn().mockImplementation(() => subscribed),
      getWatchProgress: jest.fn().mockReturnValue(0.5),
      setWatchProgress: jest.fn(),
      markWatched: jest.fn()
    };
    window.userDataStore = userDataStore;
    window.prompt = jest.fn().mockReturnValue('Favorites');
    window.alert = jest.fn();
  });

  it('renders sources sorted by quality and subtitles list', async () => {
    const viewer = new VideoViewer(services, 'video-1', 0);
    await viewer.init();
    const sources = Array.from(document.querySelectorAll('video source'));
    expect(sources).toHaveLength(2);
    expect(sources[0].getAttribute('src')).toBe('/high');
    const tracks = document.querySelectorAll('track');
    expect(tracks).toHaveLength(1);
    expect(tracks[0].getAttribute('srclang')).toBe('en');
  });

  it('restores watch progress and records updates', async () => {
    const viewer = new VideoViewer(services, 'video-1', 0);
    await viewer.init();
    Object.defineProperty(viewer.player, 'duration', { value: 200, configurable: true });
    viewer.restoreWatchProgress();
    expect(viewer.player.currentTime).toBe(100);

    Object.defineProperty(viewer.player, 'duration', { value: 100, configurable: true });
    viewer.player.currentTime = 40;
    viewer.recordWatchProgress();
    expect(userDataStore.setWatchProgress).toHaveBeenCalledWith(
      'video-1',
      expect.closeTo(0.4, 3),
      expect.objectContaining({ videoid: 'video-1' })
    );
  });

  it('prompts for playlist and handles subscription toggles', async () => {
    const viewer = new VideoViewer(services, 'video-1', 0);
    await viewer.init();
    viewer.handleSaveToPlaylist();
    expect(window.prompt).toHaveBeenCalled();
    expect(userDataStore.addToPlaylist).toHaveBeenCalledWith(
      'Favorites',
      'video-1',
      expect.any(Object)
    );

    const subscribeBtn = document.querySelector('.subscribe-btn');
    subscribeBtn.click();
    expect(userDataStore.toggleSubscription).toHaveBeenCalled();
    expect(subscribeBtn.classList.contains('subscribed')).toBe(true);
  });
});

describe('ShortsViewer', () => {
  let services;
  let userDataStore;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    services = createServices();
    userDataStore = {
      getReaction: jest.fn().mockReturnValue('none'),
      toggleLike: jest.fn(),
      toggleDislike: jest.fn(),
      addToPlaylist: jest.fn(),
      setWatchProgress: jest.fn(),
      markWatched: jest.fn()
    };
    window.userDataStore = userDataStore;
  });

  it('renders shorts player and toggles reactions', async () => {
    const viewer = new ShortsViewer(services, 'short-1');
    await viewer.init();
    const sources = Array.from(document.querySelectorAll('video source'));
    expect(sources[0].getAttribute('src')).toBe('/short-high');

    const like = document.querySelector('.shorts-action-btn.like-btn');
    const dislike = document.querySelector('.shorts-action-btn.dislike-btn');
    like.click();
    expect(userDataStore.toggleLike).toHaveBeenCalledWith('short-1', expect.any(Object));
    dislike.click();
    expect(userDataStore.toggleDislike).toHaveBeenCalledWith('short-1', expect.any(Object));
  });

  it('records watch progress and marks watched on end', async () => {
    const viewer = new ShortsViewer(services, 'short-1');
    await viewer.init();
    Object.defineProperty(viewer.player, 'duration', { value: 60, configurable: true });
    viewer.player.currentTime = 30;
    viewer.recordShortProgress();
    expect(userDataStore.setWatchProgress).toHaveBeenCalledWith(
      'short-1',
      0.5,
      expect.any(Object)
    );

    viewer.player.dispatchEvent(new window.Event('ended'));
    expect(userDataStore.markWatched).toHaveBeenCalledWith('short-1', expect.any(Object));
  });
});

describe('ViewerPage routing', () => {
  let services;
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    services = {
      ready: jest.fn().mockResolvedValue(),
      getVideo: jest.fn().mockResolvedValue(createVideoData()),
      getShort: jest.fn().mockResolvedValue({
        ...createVideoData(),
        videoid: 'short-1',
        sources: [{ width: 720, url: '/short', mimeType: 'video/mp4' }]
      }),
      getSubtitles: jest.fn().mockResolvedValue({ videoid: 'video-1', languages: [] }),
      getComments: jest.fn().mockResolvedValue([]),
      getCommentReplies: jest.fn().mockResolvedValue([])
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    window.history.pushState({}, '', '/');
  });

  it('loads VideoViewer for /watch routes and passes timestamp', async () => {
    window.history.pushState({}, '', '/watch?v=video-1&t=45');
    const viewerSpy = jest.spyOn(VideoViewer.prototype, 'init').mockResolvedValue();

    const page = new ViewerPage(services);
    await page.init();
    expect(viewerSpy).toHaveBeenCalled();
  });

  it('loads ShortsViewer for /shorts routes', async () => {
    window.history.pushState({}, '', '/shorts/short-1');
    const shortSpy = jest.spyOn(ShortsViewer.prototype, 'init').mockResolvedValue();

    const page = new ViewerPage(services);
    await page.init();
    expect(shortSpy).toHaveBeenCalled();
  });

  it('renders error for invalid routes', async () => {
    window.history.pushState({}, '', '/unknown');
    const page = new ViewerPage(services);
    await page.init();
    expect(document.querySelector('.error-page')).toBeTruthy();
  });
});
