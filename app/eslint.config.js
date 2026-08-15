// https://docs.expo.dev/guides/using-eslint/
//
// This file did not exist until now, and its absence was not harmless: the
// `lint` script in package.json runs `eslint .`, and ESLint 9 exits with code 2
// when it cannot find a flat config. CI runs `npm run lint --if-present`, the
// script *was* present, so the lint job had been failing on every push for a
// reason that had nothing to do with the code.

const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'node_modules/*'],
  },
  {
    rules: {
      // A web rule that does not apply here. It exists because a bare
      // apostrophe in HTML JSX can collide with attribute quoting — but this
      // app renders to <Text>, not to HTML, and there is no such collision.
      //
      // Left on, it demands "Couldn&apos;t load your results" in every string
      // of user-facing copy on a screen. That makes the copy hard to read and
      // hard to review, on files whose entire job is copy, to prevent a class
      // of bug React Native does not have.
      'react/no-unescaped-entities': 'off',
    },
  },
]);
