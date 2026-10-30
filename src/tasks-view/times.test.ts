import { displayTime, formatTime, parseTime, readTimeAfter } from './times';

const plain = (s: string) => s.replace(/\s/g, ' ');

describe('parseTime', () => {
    it('reads 24-hour and 12-hour times', () => {
        expect(parseTime('15:00')).toBe('15:00');
        expect(parseTime('9:05')).toBe('09:05');
        expect(parseTime('3pm')).toBe('15:00');
        expect(parseTime('3:30 PM')).toBe('15:30');
        expect(parseTime('12am')).toBe('00:00');
        expect(parseTime('12pm')).toBe('12:00');
        expect(parseTime('9 a.m.')).toBe('09:00');
        expect(parseTime('noon')).toBe('12:00');
        expect(parseTime('midnight')).toBe('00:00');
    });
    it('refuses what is not a time', () => {
        for (const word of ['3', '15', '24:00', '13pm', '3:5pm', '0pm', '3:60', 'pm', '']) expect(parseTime(word)).toBeUndefined();
    });
});

describe('readTimeAfter', () => {
    it('reads a time one space after the date', () => {
        expect(readTimeAfter('Call 2026-10-30 15:00', 15)).toEqual({ time: '15:00', text: '15:00', end: 21 });
        expect(readTimeAfter('Call 2026-10-30 3 pm today', 15)).toEqual({ time: '15:00', text: '3 pm', end: 20 });
        expect(readTimeAfter('Call 30/10/2026 3:30pm', 15)).toEqual({ time: '15:30', text: '3:30pm', end: 22 });
    });
    it('leaves words that are not a time', () => {
        for (const text of ['Buy 2026-10-30 3 apples', 'Buy 2026-10-30 10', 'Buy 2026-10-30 25:00', 'Buy 2026-10-30 3:5pm', 'Buy 2026-10-30  15:00', 'Buy 2026-10-30 15:00x', 'Buy 2026-10-30']) {
            expect(readTimeAfter(text, 14)).toBeUndefined();
        }
    });
});

describe('readTimeAfter, with words after the time', () => {
    it('reads the time when the next word starts like am or pm', () => {
        expect(readTimeAfter('Call 2026-10-30 15:00 Amsterdam office', 15)).toEqual({ time: '15:00', text: '15:00', end: 21 });
        expect(readTimeAfter('2026-10-30 9:00 amend contract', 10)).toEqual({ time: '09:00', text: '9:00', end: 15 });
        expect(readTimeAfter('2026-10-30 10:00 AMA prep', 10)).toEqual({ time: '10:00', text: '10:00', end: 16 });
        expect(readTimeAfter('2026-10-30 15:00 pmo sync', 10)).toEqual({ time: '15:00', text: '15:00', end: 16 });
        expect(readTimeAfter('2026-10-30 07:00 ampm', 10)).toEqual({ time: '07:00', text: '07:00', end: 16 });
    });

    it('reads a 24-hour time that has a stray pm after it', () => {
        expect(readTimeAfter('2026-10-30 14:00 PM standup', 10)).toEqual({ time: '14:00', text: '14:00', end: 16 });
        expect(readTimeAfter('2026-10-30 15:00 pm', 10)).toEqual({ time: '15:00', text: '15:00', end: 16 });
    });
});

describe('formatTime', () => {
    it('writes the setting\'s form', () => {
        expect(formatTime('15:00', 'HH:mm')).toBe('15:00');
        expect(formatTime('09:05', 'HH:mm')).toBe('09:05');
        expect(formatTime('15:00', 'h:mma')).toBe('3pm');
        expect(formatTime('15:30', 'h:mma')).toBe('3:30pm');
        expect(formatTime('12:00', 'h:mma')).toBe('12pm');
        expect(formatTime('00:00', 'h:mma')).toBe('12am');
        expect(formatTime('09:05', 'h:mma')).toBe('9:05am');
    });
});

describe('displayTime', () => {
    it('shows a time for a row', () => {
        expect(plain(displayTime('15:00', false, 'en-US'))).toBe('15:00');
        expect(plain(displayTime('15:00', true, 'en-US'))).toBe('3 PM');
        expect(plain(displayTime('15:30', true, 'en-US'))).toBe('3:30 PM');
    });
});
