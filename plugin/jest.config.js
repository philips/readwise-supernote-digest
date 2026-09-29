module.exports = {
  preset: 'react-native',
  testMatch: ['<rootDir>/__tests__/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/build/', '/android/'],
  // Real SQL against an in-memory SQLite (node:sqlite) instead of the native module.
  moduleNameMapper: {
    '^react-native-sqlite-storage$': '<rootDir>/__tests__/helpers/sqliteMock.ts',
  },
};
