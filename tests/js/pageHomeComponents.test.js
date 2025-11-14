require('../../pageHome.js');

function setupUserDataStore(overrides = {}) {
  window.userDataStore = {
    getStats: jest.fn().mockReturnValue({
      likes: 1,
      dislikes: 0,
      playlists: 1,
      subscriptions: 1,
      watched: 0
    }),
    getWatchProgress: jest.fn().mockReturnValue(0),
    isWatched: jest.fn().mockReturnValue(false),
    ...overrides
  };
}

function mountHomePage() {
  const appRoot = document.createElement('div');
  appRoot.id = 'app';
  document.body.appendChild(appRoot);
  const home = new window.HomePage({
    ready: () => Promise.resolve(),
    getVideos: () => Promise.resolve([]),
    getShorts: () => Promise.resolve([])
  });
  home.container = appRoot;
  const element = home.render();
  appRoot.appendChild(element);
  return { home, sidebar: home.sidebar, content: home.content };
}

describe('Sidebar component', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    setupUserDataStore();
    window.innerWidth = 500;
  });

  it('derives state per viewport and notifies listeners', () => {
    const { sidebar } = mountHomePage();
    const onStateChange = jest.fn();
    sidebar.onStateChange = onStateChange;
    sidebar.render();
    expect(sidebar.state).toBe('none');
    expect(onStateChange).toHaveBeenCalledWith('none');
    expect(sidebar.element.classList.contains('state-none')).toBe(true);

    window.innerWidth = 1400;
    sidebar.handleResize();
    expect(sidebar.state).toBe('normal');

    sidebar.toggle();
    expect(sidebar.state).toBe('reduced');
    expect(onStateChange).toHaveBeenCalledWith('reduced');
  });
});

describe('MainContent layout', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    setupUserDataStore();
  });

  it('applies responsive margins based on viewport and sidebar state', () => {
    window.innerWidth = 700;
    const { content } = mountHomePage();
    const element = content.element;
    expect(element.classList.contains('margin-none')).toBe(true);

    window.innerWidth = 900;
    content.setSidebarState('reduced');
    content.updateMargin();
    expect(element.classList.contains('margin-reduced')).toBe(true);

    window.innerWidth = 1200;
    content.setSidebarState('normal');
    content.updateMargin();
    expect(element.classList.contains('margin-normal')).toBe(true);
  });
});

describe('Chips control', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    setupUserDataStore();
    window.innerWidth = 1200;
  });

  it('shows scroll controls when content overflows and toggles active chip', () => {
    const { content } = mountHomePage();
    const chips = content.chips;
    const left = content.element.querySelector('.chip-scroll-btn.left');
    const right = content.element.querySelector('.chip-scroll-btn.right');

    Object.defineProperty(chips.chipsWrapper, 'scrollWidth', {
      value: 500,
      configurable: true
    });
    Object.defineProperty(chips.chipsWrapper, 'clientWidth', {
      value: 100,
      configurable: true
    });
    chips.updateScrollButtons();
    expect(left.style.display).toBe('none');
    expect(right.style.display).toBe('flex');

    const secondChip = content.element.querySelectorAll('.chip')[1];
    secondChip.click();
    expect(content.element.querySelector('.chip.active').textContent).toBe(secondChip.textContent);
  });
});

describe('VideoGrid rendering', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    setupUserDataStore();
  });

  it('shows placeholders and renders video cards', () => {
    const { content } = mountHomePage();
    const grid = content.videoGrid;
    expect(content.element.textContent).toContain('Loading videos');

    grid.setVideos([]);
    expect(content.element.textContent).toContain('No videos available yet.');

    grid.setVideos([
      {
        videoid: 'abc',
        title: 'Example',
        author: 'Channel',
        views: 1000,
        uploadDate: '2024-01-01T00:00:00Z',
        durationText: '10:00',
        thumbnails: ['thumb.jpg']
      }
    ]);
    expect(content.element.querySelectorAll('.video-card').length).toBe(1);
    expect(content.element.querySelector('.video-title').textContent).toBe('Example');
  });
});
