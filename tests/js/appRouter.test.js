const { App, DatabaseManager } = require('../../app');

function createPageClass(label) {
  const init = jest.fn().mockResolvedValue();
  const close = jest.fn();
  return {
    Class: class {
      constructor() {
        this.init = init;
        this.close = close;
        this.label = label;
      }
    },
    init,
    close
  };
}

describe('App router and loader', () => {
  let homePageMocks;
  let viewerPageMocks;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    jest.spyOn(DatabaseManager.prototype, 'init').mockResolvedValue(null);
    jest.spyOn(DatabaseManager.prototype, 'refreshFromApi').mockResolvedValue();
    homePageMocks = createPageClass('home');
    viewerPageMocks = createPageClass('viewer');
    global.HomePage = homePageMocks.Class;
    global.ViewerPage = viewerPageMocks.Class;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('changePage loads script once, updates title, and disposes previous page', async () => {
    const app = new App();
    const loadSpy = jest.spyOn(app, 'loadScript').mockResolvedValue();

    await app.changePage('home');
    expect(document.title).toBe('NewTube - Home');
    expect(homePageMocks.init).toHaveBeenCalledTimes(1);

    await app.changePage('watch');
    expect(loadSpy).toHaveBeenCalledWith('pageViewer.js');
    expect(homePageMocks.close).toHaveBeenCalledTimes(1);
    expect(viewerPageMocks.init).toHaveBeenCalledTimes(1);

    await app.changePage('home');
    expect(loadSpy).toHaveBeenCalledTimes(2); // pageHome + pageViewer

    await app.changePage('home');
    expect(loadSpy).toHaveBeenCalledTimes(2); // reusing loaded script
  });

  it('loadScript resolves immediately when script already exists', async () => {
    const app = new App();
    const promise = app.loadScript('/foo.js');
    const script = document.querySelector('script[src="/foo.js"]');
    expect(script).toBeTruthy();
    script.onload();
    await promise;

    const second = app.loadScript('/foo.js');
    await expect(second).resolves.toBeUndefined();
    expect(document.querySelectorAll('script[src="/foo.js"]').length).toBe(1);
  });
});
