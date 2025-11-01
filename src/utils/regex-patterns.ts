/**
 * Shared regex patterns used across the plugin
 */

/**
 * Matches standard footnote references like [^1] or [^key]
 * Uses negative lookahead (?!:) to avoid matching footnote definitions [^key]: content
 */
export const STANDARD_FOOTNOTE_REGEX = /(\s*\[\^(\w+)\])(?!:)/g;

/**
 * Validates that a text segment contains only footnote references (standard or inline)
 * Used to determine if footnotes are in a valid sequence
 */
export const FOOTNOTE_VALIDATION_REGEX = /^(\s*(\[\^[a-zA-Z0-9_-]+\]|\^\[[^\]]+\])\s*)*\s*$/;
