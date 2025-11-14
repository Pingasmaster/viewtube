// Validates the watch page (regular videos) with mocked API responses so we can
// assert UI state and local-storage driven actions
describe('Watch page', () => {
  beforeEach(function () {
    cy.viewport(1280, 720);

    // Base IndexedDB bootstrap always runs before watchers render
    cy.intercept('GET', '/metadata.db', {
      statusCode: 200,
      body: 'stub'
    }).as('metadata');

    cy.fixture('bootstrap.json').then((payload) => {
      this.bootstrapData = payload;
      cy.intercept('GET', '/api/bootstrap', { body: payload }).as('bootstrap');
      cy.intercept('GET', '/api/videos', { body: payload.videos });
      cy.intercept('GET', '/api/shorts', { statusCode: 200, body: [] });
      cy.intercept('GET', '/api/shorts/*/comments', { body: [] });
    });

    cy.fixture('video_abc123.json').then((video) => {
      this.videoDetail = video;
      cy.intercept('GET', '/api/videos/abc123', { statusCode: 200, body: video }).as('fetchVideo');
    });
    cy.fixture('comments_abc123.json').then((comments) => {
      this.comments = comments;
      cy.intercept('GET', '/api/videos/abc123/comments', { statusCode: 200, body: comments }).as('fetchComments');
    });

    cy.visit('/watch?v=abc123');
    cy.wait(['@bootstrap', '@fetchVideo', '@fetchComments']);
  });

  it('Renders player metadata and comments', function () {
    cy.get('.video-title').should('contain', this.videoDetail.title);
    cy.get('.video-channel').should('contain', this.videoDetail.author);
    cy.get('.video-stats').should('contain', 'views');
    cy.get('.comments-section h3').should('contain', `${this.comments.length} Comments`);
    cy.get('#commentsList').within(() => {
      cy.contains('Great video!').should('be.visible');
    });
  });

  it('Toggles like/dislike/subscription state', () => {
    cy.window().then((win) => {
      cy.stub(win, 'alert').as('alert');
    });

    cy.get('.like-btn').as('like');
    cy.get('.dislike-btn').as('dislike');
    cy.get('.subscribe-btn').as('subscribe');

    cy.get('@like').click().should('have.class', 'active');
    cy.get('@dislike').should('not.have.class', 'active');

    cy.get('@dislike').click().should('have.class', 'active');
    cy.get('@like').should('not.have.class', 'active');

    cy.get('@subscribe').click().should('have.class', 'subscribed').and('contain', 'Subscribed');
    cy.get('@alert').should('have.been.called');
    cy.get('@subscribe').click().should('not.have.class', 'subscribed');
  });
});
