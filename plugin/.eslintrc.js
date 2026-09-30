module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    // Read-only mode depends on every request to Readwise going through readwiseFetch() in
    // src/readwise/client.ts, which checks src/readwise/writeGuard.ts. Do not call fetch elsewhere.
    'no-restricted-globals': [
      'error',
      {
        name: 'fetch',
        message:
          'Use the Readwise client (src/readwise/client.ts): it enforces read-only mode. See plans/read-only-mode.md.',
      },
    ],
  },
};
