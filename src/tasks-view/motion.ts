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

/** An element as it stood before a rebuild, kept so it can fade out where it was. */
export interface Placed {
    el: HTMLElement;
    rect: DOMRect;
}

/** The elements matching `selector`, by flip id, with where each one stands. */
export function snapshot(root: HTMLElement, selector: string): Map<string, Placed> {
    const placed = new Map<string, Placed>();
    root.querySelectorAll<HTMLElement>(selector).forEach(el => {
        placed.set(el.dataset.flip ?? '', { el, rect: el.getBoundingClientRect() });
    });
    return placed;
}

export interface FlipOptions {
    /** How long a moved element takes to reach its new place. */
    move?: number;
    /** How long a new element waits before fading in, so the rows below have mostly made room. */
    enterDelay?: number;
    /** Elements from before the rebuild: any the rebuild dropped fade out where they stood. */
    leaving?: Map<string, Placed>;
    /** Ids that change places by fading out and back in, instead of sliding through their neighbours. */
    dissolve?: ReadonlySet<string>;
}

/**
 * Plays the rebuilt elements back from their captured positions. Elements
 * that weren't there before fade in, unless there was nothing before at all
 * (a fresh list), which keeps a list switch from animating every row.
 */
export function flip(root: HTMLElement, before: Map<string, number>, options: FlipOptions = {}): void {
    if (!motionAllowed() || before.size === 0) return;
    const { move = 280, enterDelay = 0, leaving, dissolve } = options;
    const viewport = root.getBoundingClientRect();
    const present = new Set<string>();
    const dissolved = new Set<string>();
    root.querySelectorAll<HTMLElement>('[data-flip]').forEach(el => {
        const id = el.dataset.flip ?? '';
        present.add(id);
        const top = el.getBoundingClientRect().top;
        // Off-screen elements would animate unseen and cost frames for nothing.
        if (top > viewport.bottom + 200 || top < viewport.top - 400) return;
        const old = before.get(id);
        const moved = old !== undefined && Math.abs(old - top) > 0.5;
        if (moved && dissolve?.has(id)) dissolved.add(id);
        if (old === undefined || dissolved.has(id)) {
            el.animate(
                [{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }],
                { duration: 200, delay: enterDelay, easing: EASE, fill: 'backwards' }
            );
        } else if (moved) {
            el.animate(
                [{ transform: `translateY(${old - top}px)` }, { transform: 'none' }],
                { duration: move, easing: EASE }
            );
        }
    });
    if (!leaving) return;
    for (const [id, placed] of leaving) {
        if (!present.has(id) || dissolved.has(id)) fadeOutInPlace(root, placed, viewport);
    }
}

/**
 * Leaves a copy of an element where it stood and fades it out, while the
 * rows around it are already moving. It goes in first, so the rows sliding
 * over its spot draw on top of it.
 */
function fadeOutInPlace(root: HTMLElement, { el, rect }: Placed, viewport: DOMRect): void {
    if (rect.top > viewport.bottom + 200 || rect.bottom < viewport.top - 400) return;
    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.removeAttribute('data-flip');
    ghost.removeAttribute('data-key');
    ghost.addClass('sh-flip-ghost');
    ghost.setAttr('aria-hidden', 'true');
    ghost.setCssProps({
        top: `${rect.top - viewport.top}px`,
        left: `${rect.left - viewport.left}px`,
        width: `${rect.width}px`
    });
    root.prepend(ghost);
    const animation = ghost.animate(
        [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.98)' }],
        { duration: 100, easing: EASE, fill: 'forwards' }
    );
    animation.onfinish = () => ghost.remove();
    animation.oncancel = () => ghost.remove();
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
