// The apiclient is thin, but critical: malformed URLs or missing error handling
// would ripple through every fetch request. These tests pin the behavior down.
const { ApiClient } = require('../../app');

describe('ApiClient', () => {
  it('Calls fetch with encoded paths', async () => {
    const client = new ApiClient('/api');
    // Pretend the backend responds successfully so we can focus on the request
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ videoid: 'id' })
    });

    await client.fetchVideo('abc/123');
    // The encoded slash proves we are not leaking raw IDs into the URL
    expect(global.fetch).toHaveBeenCalledWith('/api/videos/abc%2F123', { cache: 'no-store' });
  });

  it('Throws on non ok responses', async () => {
    const client = new ApiClient('/api');
    // Simulate a 500 to guarantee consumers see a rejected promise
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(client.fetchVideos()).rejects.toThrow('Request failed (500)');
  });
});
