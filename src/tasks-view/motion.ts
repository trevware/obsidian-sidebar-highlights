/**
 * The Tasks tab's motion, in Oriko's vocabulary: one easing curve, short
 * durations, transform and opacity only, and nothing at all when the system
 * asks for reduced motion.
 *
 * The list is rebuilt on every change, so rows can't rely on CSS transitions
 * to move. Instead each change is a FLIP: positions are captured before the
 * rebuild, and after it every element that moved is played back from where it
 * was, while elements that are new fade in.
 *
 * Only what's on screen, give or take a margin, is measured and moved, so a
 * note with hundreds of rows costs the same as one with ten.
 */

/** Oriko's curve: a quick start that settles without overshoot. */
export const EASE = 'cubic-bezier(0.22, 0.9, 0.28, 1)';

export function motionAllowed(): boolean {
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The stretch of the page worth animating: the visible part of `view`, plus room for rows sliding in. */
interface Band {
    top: number;
    bottom: number;
}

function bandOf(view: HTMLElement): Band {
    const rect = view.getBoundingClientRect();
    return { top: rect.top - 400, bottom: rect.bottom + 200 };
}

/**
 * Calls `visit` with each element in `root` matching `selector` that sits in
 * the band, in page order. The elements run top to bottom, so it stops at the
 * first one below the band without measuring the rest.
 */
function eachInBand(root: HTMLElement, selector: string, band: Band, visit: (el: HTMLElement, rect: DOMRect) => void): void {
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
        const rect = el.getBoundingClientRect();
        if (rect.top > band.bottom) return;
        if (rect.bottom >= band.top) visit(el, rect);
    }
}

/** Where every `[data-flip]` element on screen in `view` sits right now, by its id. */
export function capture(root: HTMLElement, view: HTMLElement): Map<string, number> {
    const positions = new Map<string, number>();
    eachInBand(root, '[data-flip]', bandOf(view), (el, rect) => positions.set(el.dataset.flip ?? '', rect.top));
    return positions;
}

/** An element as it stood before a rebuild, kept so it can fade out where it was. */
export interface Placed {
    el: HTMLElement;
    rect: DOMRect;
}

/** The elements on screen in `view` matching `selector`, by flip id, with where each one stands. */
export function snapshot(root: HTMLElement, view: HTMLElement, selector: string): Map<string, Placed> {
    const placed = new Map<string, Placed>();
    eachInBand(root, selector, bandOf(view), (el, rect) => placed.set(el.dataset.flip ?? '', { el, rect }));
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
 * Plays the rebuilt elements on screen in `view` back from their captured
 * positions. Elements that weren't there before (or were off screen) fade in,
 * unless there was nothing before at all (a fresh list), which keeps a list
 * switch from animating every row.
 */
export function flip(root: HTMLElement, view: HTMLElement, before: Map<string, number>, options: FlipOptions = {}): void {
    if (!motionAllowed() || before.size === 0) return;
    const { move = 280, enterDelay = 0, leaving, dissolve } = options;
    const dissolved = new Set<string>();
    const shown = new Set<string>();
    eachInBand(root, '[data-flip]', bandOf(view), (el, rect) => {
        const id = el.dataset.flip ?? '';
        shown.add(id);
        const top = rect.top;
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
    // A row that left the screen without leaving the list fades out too:
    // there's nowhere on screen for it to slide to.
    const origin = root.getBoundingClientRect();
    for (const [id, placed] of leaving) {
        if (!shown.has(id) || dissolved.has(id)) fadeOutInPlace(root, placed, origin);
    }
}

/**
 * Leaves a copy of an element where it stood and fades it out, while the
 * rows around it are already moving. It goes in first, so the rows sliding
 * over its spot draw on top of it.
 */
function fadeOutInPlace(root: HTMLElement, { el, rect }: Placed, origin: DOMRect): void {
    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.removeAttribute('data-flip');
    ghost.removeAttribute('data-key');
    ghost.addClass('sh-flip-ghost');
    ghost.setAttr('aria-hidden', 'true');
    ghost.setCssProps({
        top: `${rect.top - origin.top}px`,
        left: `${rect.left - origin.left}px`,
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
