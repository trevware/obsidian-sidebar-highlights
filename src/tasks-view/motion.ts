/**
 * The Tasks tab's motion, in Oriko's vocabulary: one easing curve, short
 * durations, transform and opacity only, and nothing at all when the system
 * asks for reduced motion.
 *
 * The list is rebuilt on every change, so rows can't rely on CSS transitions
 * to move. Instead each change is a FLIP: positions are captured before the
 * rebuild, and after it every element that moved is played back from where it
 * was, while elements that are new fade in.
 */

/** Oriko's curve: a quick start that settles without overshoot. */
export const EASE = 'cubic-bezier(0.22, 0.9, 0.28, 1)';

export function motionAllowed(): boolean {
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Where every `[data-flip]` element sits right now, by its id. */
export function capture(root: HTMLElement): Map<string, number> {
    const positions = new Map<string, number>();
    root.querySelectorAll<HTMLElement>('[data-flip]').forEach(el => {
        positions.set(el.dataset.flip ?? '', el.getBoundingClientRect().top);
    });
    return positions;
}

/**
 * Plays the rebuilt elements back from their captured positions. Elements
 * that weren't there before fade in, unless there was nothing before at all
 * (a fresh list), which keeps a list switch from animating every row.
 */
export function flip(root: HTMLElement, before: Map<string, number>): void {
    if (!motionAllowed() || before.size === 0) return;
    const viewport = root.getBoundingClientRect();
    root.querySelectorAll<HTMLElement>('[data-flip]').forEach(el => {
        const top = el.getBoundingClientRect().top;
        // Off-screen elements would animate unseen and cost frames for nothing.
        if (top > viewport.bottom + 200 || top < viewport.top - 400) return;
        const old = before.get(el.dataset.flip ?? '');
        if (old === undefined) {
            el.animate(
                [{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }],
                { duration: 200, easing: EASE }
            );
        } else if (Math.abs(old - top) > 0.5) {
            el.animate(
                [{ transform: `translateY(${old - top}px)` }, { transform: 'none' }],
                { duration: 280, easing: EASE }
            );
        }
    });
}

/** Brings an element in with a short fade and settle. Transform and opacity only. */
export function reveal(el: HTMLElement, duration = 180): void {
    if (!motionAllowed()) return;
    el.animate(
        [{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }],
        { duration, easing: EASE }
    );
}

/**
 * Fades elements out, then calls back once they're gone from view. No height
 * animation: resizing a row relays out every row after it on every frame,
 * which is what made a long list stutter.
 */
export function collapse(els: HTMLElement[], done: () => void, duration = 140): void {
    if (!motionAllowed() || els.length === 0) {
        done();
        return;
    }
    let pending = els.length;
    const finish = () => {
        pending--;
        if (pending === 0) done();
    };
    for (const el of els) {
        const animation = el.animate(
            [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.98)' }],
            { duration, easing: EASE, fill: 'forwards' }
        );
        animation.onfinish = finish;
        animation.oncancel = finish;
    }
}

/** The gentle arrival a list gets when you switch to it. */
export function arrive(el: HTMLElement): void {
    if (!motionAllowed()) return;
    el.animate(
        [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
        { duration: 220, easing: EASE }
    );
}

/** Fades a set of elements between two opacities, for the list dimming behind an open card. */
export function fade(els: HTMLElement[], from: number, to: number, duration = 200): void {
    if (!motionAllowed()) return;
    for (const el of els) {
        el.animate([{ opacity: from }, { opacity: to }], { duration, easing: EASE });
    }
}
