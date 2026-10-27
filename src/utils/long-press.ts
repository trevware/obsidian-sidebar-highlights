/** How long a finger rests before it counts as a press and hold. */
const LONG_PRESS_MS = 500;
/** How far a finger can drift and still be holding, not scrolling. */
const MOVE_TOLERANCE_PX = 10;

/**
 * Runs `callback` when a finger rests on `el`: the touch stand-in for a
 * right-click. iOS never sends contextmenu for a long press, so anything
 * behind a right-click needs this to be reachable on a phone. Returns a
 * function that removes the listeners.
 */
export function onLongPress(el: HTMLElement, callback: (event: PointerEvent) => void, delay = LONG_PRESS_MS): () => void {
    let timer: number | null = null;
    let start: PointerEvent | null = null;
    // Set once the press has fired, until the next finger or button comes down.
    let fired = false;

    const cancel = () => {
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
        start = null;
    };

    const down = (event: PointerEvent) => {
        cancel();
        fired = false;
        if (event.pointerType !== 'touch' || !event.isPrimary) return;
        start = event;
        timer = window.setTimeout(() => {
            const pressed = start;
            cancel();
            if (!pressed) return;
            fired = true;
            callback(pressed);
        }, delay);
    };

    const move = (event: PointerEvent) => {
        if (!start || event.pointerId !== start.pointerId) return;
        if (Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) > MOVE_TOLERANCE_PX) cancel();
    };

    // Cancelling the touchend that ends a press stops the phone sending the
    // mousedown and click it would otherwise follow up with. Those land on
    // whatever is under the finger, which by now is the menu's backdrop, and
    // close the menu the press just opened.
    const lift = (event: Event) => {
        if (fired && event.cancelable) event.preventDefault();
    };

    // The press already opened its menu, so the tap that ends it goes no further.
    const click = (event: Event) => {
        if (!fired) return;
        fired = false;
        event.preventDefault();
        event.stopImmediatePropagation();
    };

    // Android sends its own contextmenu partway through a long press. If it
    // arrives first it opens the menu and the press stands down; if it
    // arrives after, the press already did, and it's swallowed.
    const contextMenu = (event: Event) => {
        if (start) {
            cancel();
            return;
        }
        if (!fired) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('touchend', lift, { passive: false });
    el.addEventListener('click', click, true);
    el.addEventListener('contextmenu', contextMenu, true);

    return () => {
        cancel();
        el.removeEventListener('pointerdown', down);
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', cancel);
        el.removeEventListener('pointercancel', cancel);
        el.removeEventListener('touchend', lift);
        el.removeEventListener('click', click, true);
        el.removeEventListener('contextmenu', contextMenu, true);
    };
}
