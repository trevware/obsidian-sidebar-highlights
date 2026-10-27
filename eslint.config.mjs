// The check the Obsidian community directory runs on every release. Run
// `npm run lint` before anything is pushed.
//
// The directory runs its own copy of these rules and never reads this file,
// so a rule turned off here still counts against the plugin there. Only turn
// rules off for files the directory skips (tests and the node build scripts);
// fix everything else at the source.
import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
	// Not plugin code: the build output, node scripts, the test setup and the
	// tests themselves. The directory skips tests too: the 1.43.0 scan's count
	// matches the source files alone.
	{
		ignores: [
			'**/*.test.ts',
			'main.js',
			'node_modules/**',
			'backups/**',
			'coverage/**',
			'esbuild.config.mjs',
			'version-bump.mjs',
			'jest.config.js',
			'jest.setup.js',
			'test-*.js',
		],
	},
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mjs', 'stylelint.config.mjs'],
				},
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
]);
