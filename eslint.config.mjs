import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'node_modules/**/*', 'src/**/*', 'server.ts', 'server.js', 'scripts/**/*', 'electron/**/*', 'api/**/*']
  },
  firebaseRulesPlugin.configs['flat/recommended']
];
