module.exports = {
  testEnvironment: 'jsdom',
  testMatch: ['<rootDir>/tests/js/**/*.test.js'],
  setupFiles: ['fake-indexeddb/auto'],
  setupFilesAfterEnv: ['<rootDir>/tests/js/setupTests.js'],
  clearMocks: true,
  roots: ['<rootDir>/tests/js']
};
