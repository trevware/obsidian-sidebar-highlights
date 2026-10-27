// The CSS half of the check the Obsidian community directory runs: its own
// rules (no !important, no :has(), no named colours, browser support). Run
// with `npm run lint`.
//
// Obsidian's config builds on stylelint-config-standard, whose formatting
// rules the directory doesn't report. Some of them would also break the
// plugin on iPhones: they strip the -webkit- prefixes Safari still needs and
// rewrite media queries in a syntax older iOS can't read. Those standard
// rules are off here; every rule of Obsidian's own stays on.
/** @type {import('stylelint').Config} */
export default {
	extends: ['stylelint-config-obsidianmd'],
	rules: {
		'alpha-value-notation': null,
		'color-function-alias-notation': null,
		'color-function-notation': null,
		'color-hex-length': null,
		'comment-empty-line-before': null,
		'custom-property-empty-line-before': null,
		'declaration-block-single-line-max-declarations': null,
		'declaration-empty-line-before': null,
		'keyframes-name-pattern': null,
		'media-feature-range-notation': null,
		'no-descending-specificity': null,
		'property-no-vendor-prefix': null,
		'rule-empty-line-before': null,
		'selector-not-notation': null,
		'value-keyword-case': null,
	},
};
