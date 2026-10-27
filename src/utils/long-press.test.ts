import { onLongPress } from './long-press';

function pointer(type: string, init: { pointerType?: string; x?: number; y?: number; id?: number } = {}): Event {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, {
        pointerType: init.pointerType ?? 'touch',
        isPrimary: true,
        pointerId: init.id ?? 1,
        clientX: init.x ?? 10,
        clientY: init.y ?? 10
    });
    return event;
}

describe('long press', () => {
    let el: HTMLElement;
    let pressed: jest.Mock;

    beforeEach(() => {
        jest.useFakeTimers();
        el = document.createElement('div');
        document.body.appendChild(el);
        pressed = jest.fn();
        onLongPress(el, pressed);
    });

    afterEach(() => {
        el.remove();
        jest.useRealTimers();
    });

    test('a finger held still opens it', () => {
        el.dispatchEvent(pointer('pointerdown'));
        jest.advanceTimersByTime(600);
        expect(pressed).toHaveBeenCalledTimes(1);
    });

    test('a quick tap does not', () => {
        el.dispatchEvent(pointer('pointerdown'));
        jest.advanceTimersByTime(150);
        el.dispatchEvent(pointer('pointerup'));
        jest.advanceTimersByTime(600);
        expect(pressed).not.toHaveBeenCalled();
    });

    test('a finger that starts scrolling does not', () => {
        el.dispatchEvent(pointer('pointerdown', { y: 10 }));
        el.dispatchEvent(pointer('pointermove', { y: 40 }));
        jest.advanceTimersByTime(600);
        expect(pressed).not.toHaveBeenCalled();
    });

    test('a mouse never does, since it has a right button', () => {
        el.dispatchEvent(pointer('pointerdown', { pointerType: 'mouse' }));
        jest.advanceTimersByTime(600);
        expect(pressed).not.toHaveBeenCalled();
    });

    test('the tap that ends the press goes no further', () => {
        const clicked = jest.fn();
        el.addEventListener('click', clicked);
        el.dispatchEvent(pointer('pointerdown'));
        jest.advanceTimersByTime(600);
        el.dispatchEvent(pointer('pointerup'));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(clicked).not.toHaveBeenCalled();
    });

    test('lifting the finger after a press sends no stray tap to what lies beneath', () => {
        el.dispatchEvent(pointer('pointerdown'));
        jest.advanceTimersByTime(600);
        const lift = new Event('touchend', { bubbles: true, cancelable: true });
        el.dispatchEvent(lift);
        expect(lift.defaultPrevented).toBe(true);
    });

    test('lifting after a plain tap is left alone', () => {
        el.dispatchEvent(pointer('pointerdown'));
        jest.advanceTimersByTime(100);
        const lift = new Event('touchend', { bubbles: true, cancelable: true });
        el.dispatchEvent(lift);
        expect(lift.defaultPrevented).toBe(false);
    });

    test("the next tap still works", () => {
        const clicked = jest.fn();
        el.addEventListener('click', clicked);
        el.dispatchEvent(pointer('pointerdown'));
        jest.advanceTimersByTime(600);
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        el.dispatchEvent(pointer('pointerdown'));
        el.dispatchEvent(pointer('pointerup'));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(clicked).toHaveBeenCalledTimes(1);
    });

    test('a right-click sent for the same press opens only one menu', () => {
        const menu = jest.fn();
        el.addEventListener('contextmenu', menu);
        el.dispatchEvent(pointer('pointerdown'));
        jest.advanceTimersByTime(600);
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        expect(pressed).toHaveBeenCalledTimes(1);
        expect(menu).not.toHaveBeenCalled();
    });

    test('when the phone sends its own right-click first, that one wins', () => {
        const menu = jest.fn();
        el.addEventListener('contextmenu', menu);
        el.dispatchEvent(pointer('pointerdown'));
        jest.advanceTimersByTime(300);
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        jest.advanceTimersByTime(600);
        expect(menu).toHaveBeenCalledTimes(1);
        expect(pressed).not.toHaveBeenCalled();
    });
});
