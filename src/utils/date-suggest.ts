import { App, AbstractInputSuggest, moment } from "obsidian";
import { t } from '../i18n';

interface DateSuggestion {
    label: string;
    date: moment.Moment;
}

/**
 * DateSuggest class.
 * This class extends AbstractInputSuggest to provide date suggestions for quick selection.
 */
export class DateSuggest extends AbstractInputSuggest<DateSuggestion> {
    private inputEl: HTMLInputElement;
    private dateFormat: string;
    private dateSuggestions: DateSuggestion[];

    constructor(app: App, inputEl: HTMLInputElement, dateFormat: string) {
        super(app, inputEl);
        this.inputEl = inputEl;
        this.dateFormat = dateFormat;

        // Define date suggestions
        this.dateSuggestions = [
            { label: t('dateSuggestions.today'), date: moment() },
            { label: t('dateSuggestions.tomorrow'), date: moment().add(1, 'day') },
            { label: t('dateSuggestions.endOfWeek'), date: moment().endOf('week') },
            { label: t('dateSuggestions.inOneWeek'), date: moment().add(1, 'week') },
            { label: t('dateSuggestions.inTwoWeeks'), date: moment().add(2, 'weeks') },
        ];
    }

    /**
     * Returns the suggestions to display based on the user's input.
     */
    getSuggestions(inputStr: string): DateSuggestion[] {
        const inputLower = inputStr.toLowerCase().trim();

        // Don't show suggestions if input looks like a date format
        // This prevents suggestions from appearing when editing existing dates
        // Matches formats like: 2025-01-15, 2025/01/15, 2025-01, 01-15, etc.
        if (inputLower && /^\d{1,4}[-/]\d/.test(inputLower)) {
            return [];
        }

        // Always show all suggestions by default for empty input or natural language
        if (!inputLower) {
            return this.dateSuggestions;
        }

        // Start with base suggestions that match
        const filtered = this.dateSuggestions.filter(suggestion =>
            suggestion.label.toLowerCase().includes(inputLower)
        );

        // Generate dynamic suggestions based on input patterns
        const dynamicSuggestions = this.generateDynamicSuggestions(inputLower);

        // Combine filtered base suggestions with dynamic ones
        const combined = [...filtered, ...dynamicSuggestions];

        // If no matches, still show base suggestions
        return combined.length > 0 ? combined : this.dateSuggestions;
    }

    /**
     * Generate dynamic date suggestions based on user input patterns
     */
    private generateDynamicSuggestions(input: string): DateSuggestion[] {
        const suggestions: DateSuggestion[] = [];

        // Pattern 1: Number at start - suggest relative dates
        const numberMatch = input.match(/^(\d+)\s*(.*)/);
        if (numberMatch) {
            const num = parseInt(numberMatch[1]);
            const rest = numberMatch[2];

            if (!rest || 'd'.startsWith(rest) || 'day'.includes(rest)) {
                suggestions.push({
                    label: t(num === 1 ? 'dateSuggestions.dayFromNow' : 'dateSuggestions.daysFromNow', { count: num }),
                    date: moment().add(num, 'days')
                });
                if (num > 0) {
                    suggestions.push({
                        label: t(num === 1 ? 'dateSuggestions.dayAgo' : 'dateSuggestions.daysAgo', { count: num }),
                        date: moment().subtract(num, 'days')
                    });
                }
            }

            if (!rest || 'w'.startsWith(rest) || 'week'.includes(rest)) {
                suggestions.push({
                    label: t(num === 1 ? 'dateSuggestions.weekFromNow' : 'dateSuggestions.weeksFromNow', { count: num }),
                    date: moment().add(num, 'weeks')
                });
                if (num > 0) {
                    suggestions.push({
                        label: t(num === 1 ? 'dateSuggestions.weekAgo' : 'dateSuggestions.weeksAgo', { count: num }),
                        date: moment().subtract(num, 'weeks')
                    });
                }
            }

            if (!rest || 'm'.startsWith(rest) || 'month'.includes(rest)) {
                suggestions.push({
                    label: t(num === 1 ? 'dateSuggestions.monthFromNow' : 'dateSuggestions.monthsFromNow', { count: num }),
                    date: moment().add(num, 'months')
                });
                if (num > 0) {
                    suggestions.push({
                        label: t(num === 1 ? 'dateSuggestions.monthAgo' : 'dateSuggestions.monthsAgo', { count: num }),
                        date: moment().subtract(num, 'months')
                    });
                }
            }
        }

        // Pattern 2: "next" or "last" - suggest weekdays
        if (input.startsWith('next') || input.startsWith('last')) {
            const direction = input.startsWith('next') ? 'next' : 'last';
            const directionLabel = t(`dateSuggestions.${direction}`);
            const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

            dayKeys.forEach(dayKey => {
                const dayName = t(`dateSuggestions.${dayKey}`);
                const fullLabel = `${directionLabel} ${dayName}`;
                if (fullLabel.toLowerCase().includes(input)) {
                    const date = this.getNamedDayDate(direction, dayKey);
                    if (date) {
                        suggestions.push({ label: fullLabel, date });
                    }
                }
            });
        }

        // Pattern 3: "this" - suggest weekdays
        if (input.startsWith('this')) {
            const directionLabel = t('dateSuggestions.this');
            const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

            dayKeys.forEach(dayKey => {
                const dayName = t(`dateSuggestions.${dayKey}`);
                const fullLabel = `${directionLabel} ${dayName}`;
                if (fullLabel.toLowerCase().includes(input)) {
                    const date = this.getNamedDayDate('this', dayKey);
                    if (date) {
                        suggestions.push({ label: fullLabel, date });
                    }
                }
            });
        }

        // Pattern 4: Just a day name - suggest this/next occurrence
        const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        dayKeys.forEach(dayKey => {
            const dayName = t(`dateSuggestions.${dayKey}`);
            // Check if the day name matches the input (either full name or partial)
            if (dayName.toLowerCase().includes(input) || dayKey.includes(input)) {
                // Calculate this/next occurrence
                const thisDate = this.getNamedDayDate('this', dayKey);
                const nextDate = this.getNamedDayDate('next', dayKey);

                if (thisDate) {
                    const today = moment();
                    const currentDay = today.day();
                    const dayIndex = dayKeys.indexOf(dayKey);

                    // If the day is today or later this week, show "This [Day]"
                    if (dayIndex >= currentDay) {
                        suggestions.push({
                            label: `${t('dateSuggestions.this')} ${dayName}`,
                            date: thisDate
                        });
                    }

                    // Always show "Next [Day]" as an option
                    if (nextDate) {
                        suggestions.push({
                            label: `${t('dateSuggestions.next')} ${dayName}`,
                            date: nextDate
                        });
                    }
                }
            }
        });

        return suggestions;
    }

    /**
     * Calculate date for named day references like "next Monday"
     */
    private getNamedDayDate(direction: string, dayKey: string): moment.Moment | null {
        const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const targetDay = dayKeys.indexOf(dayKey);
        if (targetDay === -1) return null;

        const today = moment();
        const currentDay = today.day();

        if (direction === 'last') {
            const daysAgo = currentDay >= targetDay ? currentDay - targetDay : 7 - (targetDay - currentDay);
            return moment().subtract(daysAgo === 0 ? 7 : daysAgo, 'days');
        } else if (direction === 'next') {
            const daysAhead = targetDay > currentDay ? targetDay - currentDay : 7 - (currentDay - targetDay);
            return moment().add(daysAhead === 0 ? 7 : daysAhead, 'days');
        } else if (direction === 'this') {
            if (targetDay >= currentDay) {
                return moment().add(targetDay - currentDay, 'days');
            } else {
                return moment().add(7 + (targetDay - currentDay), 'days');
            }
        }

        return null;
    }

    /**
     * Renders a suggestion in the dropdown.
     */
    renderSuggestion(suggestion: DateSuggestion, el: HTMLElement): void {
        el.addClass('date-suggestion-item');

        el.createSpan({
            text: suggestion.label,
            cls: 'date-suggestion-label'
        });

        el.createSpan({
            text: suggestion.date.format(this.dateFormat),
            cls: 'date-suggestion-date'
        });
    }

    /**
     * Handles the selection of a suggestion.
     */
    selectSuggestion(suggestion: DateSuggestion): void {
        this.inputEl.value = suggestion.date.format(this.dateFormat);
        const event = new Event("input");
        this.inputEl.dispatchEvent(event);
        this.close();
    }
}
