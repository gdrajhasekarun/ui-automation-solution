'use strict';

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js', '**/tests/**/*.spec.js'],
  testTimeout: 60000,
  setupFilesAfterFramework: [],
  verbose: true,
};
