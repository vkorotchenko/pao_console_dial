module.exports = {
  transform: {
    '^.+\\.[jt]sx?$': 'babel-jest',
  },
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
};
