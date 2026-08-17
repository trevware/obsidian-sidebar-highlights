/**
 * State rules for the toolbar's "Toggle highlight comments" button.
 *
 * The button reads the live data where it can: if any highlight's comments are
 * currently open, a click closes all of them, whichever way the button was last
 * clicked. That keeps it in step with comments expanded one at a time from a
 * highlight's comment count.
 *
 * That reading only works while there is something to read. A vault whose
 * highlights carry no comments has nothing expandable, so "is anything expanded"
 * is permanently false and a button driven by it alone computes `!false` on every
 * click — it turns on and can never turn off. With nothing to inspect, the button
 * falls back to flipping its own remembered state.
 *
 * Kept free of Obsidian imports so it can be unit tested directly.
 */

/**
 * Whether the button should read as on — lit, and showing the collapse icon.
 *
 * @param commentsExpanded  the button's own remembered state, persisted per tab
 * @param anyCommentExpanded  any highlight currently showing its comments
 * @param hasToggleableComments  any highlight that could show comments at all
 */
export function isCommentsToggleOn(
    commentsExpanded: boolean,
    anyCommentExpanded: boolean,
    hasToggleableComments: boolean
): boolean {
    return hasToggleableComments ? anyCommentExpanded : commentsExpanded;
}

/** The state a click moves the button to. */
export function nextCommentsToggleState(
    commentsExpanded: boolean,
    anyCommentExpanded: boolean,
    hasToggleableComments: boolean
): boolean {
    return !isCommentsToggleOn(commentsExpanded, anyCommentExpanded, hasToggleableComments);
}
