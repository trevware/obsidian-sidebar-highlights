import { App, Notice, moment } from 'obsidian';
import type { Setting, SettingDefinitionItem, SettingGroupItem } from 'obsidian';
import type HighlightCommentsPlugin from '../../main';
import { PLUS_CHECKOUT, PLUS_PAGE, calendarAvailable } from '../plus/plus-client';
import type { PlusStatus } from '../plus/plus-client';
import { CalDavModal } from './caldav-modal';
import { providerName } from './calendar-sync';
import { confirmAction } from '../modals/confirm-modal';
import { t } from '../i18n';

/** Event lengths offered, in minutes. */
export const EVENT_LENGTHS = [15, 30, 45, 60, 90, 120];

interface Tab {
    app: App;
    update(): void;
    label(path: string): { name: string; desc: string };
}

/** The license's state as a line under the key field. */
function plusLine(status: PlusStatus | null): string {
    if (!status) return t('settings.plus.states.checking');
    return status.state === 'offline' && status.message
        ? `${t('settings.plus.states.offline')}`
        : t(`settings.plus.states.${status.state}`);
}

function syncLine(plugin: HighlightCommentsPlugin): string {
    const status = plugin.calendarSync.getStatus();
    if (status.state === 'syncing') return t('calendar.status.syncing');
    if (status.state === 'problem' && status.message) return status.message;
    if (status.at) return t('calendar.status.synced', { when: moment(status.at).fromNow() });
    return t('calendar.status.never');
}

/** The Trevware Plus and Calendar groups of the settings tab. */
export function plusAndCalendarGroups(tab: Tab, plugin: HighlightCommentsPlugin, plusStatus: PlusStatus | null): SettingDefinitionItem[] {
    if (!calendarAvailable(tab.app)) return [];
    const sync = plugin.calendarSync;
    const plus = sync.plus;
    const connection = sync.connection();
    const active = plusStatus?.state === 'active';
    let keyTimer = 0;

    const needsPlus = (): boolean => {
        if (active) return false;
        new Notice(t('calendar.errors.noPlus'));
        return true;
    };

    const connectOAuth = async (provider: 'google' | 'microsoft', button: { setDisabled(v: boolean): unknown; setButtonText(v: string): unknown }) => {
        if (needsPlus()) return;
        button.setDisabled(true);
        button.setButtonText(t('settings.calendar.connect.waiting'));
        try {
            if (!(await sync.connectOAuth(provider))) new Notice(t('calendar.errors.signInFailed'));
        } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error));
        }
        tab.update();
    };

    const connectCalDav = (kind: 'icloud' | 'caldav') => {
        if (needsPlus()) return;
        new CalDavModal(tab.app, kind, async (details) => {
            await sync.connectCalDav(kind, details.server, details.username, details.password);
            tab.update();
        }, { username: connection?.provider === kind ? connection.account : '', server: connection?.server }).open();
    };

    const plusItems: SettingGroupItem[] = [
        {
            name: t('settings.plus.license.name'),
            desc: `${t('settings.plus.license.desc')} ${plusLine(plusStatus)}`,
            render: (setting: Setting) => {
                setting.addText(text => {
                    text.inputEl.type = 'password';
                    text.setPlaceholder(t('settings.plus.license.placeholder')).setValue(plus.licenseKey() ?? '');
                    text.onChange(value => {
                        window.clearTimeout(keyTimer);
                        keyTimer = window.setTimeout(() => {
                            plus.setLicenseKey(value);
                            void plugin.refreshPlusStatus(true).then(() => tab.update());
                        }, 600);
                    });
                });
            }
        }
    ];
    if (!active) {
        plusItems.push({
            ...tab.label('settings.plus.subscribe'),
            render: (setting: Setting) => {
                setting
                    .addButton(button => button.setButtonText(t('settings.plus.subscribe.button')).setCta().onClick(() => window.open(PLUS_CHECKOUT)))
                    .addButton(button => button.setButtonText(t('settings.plus.subscribe.learnMore')).onClick(() => window.open(PLUS_PAGE)));
            }
        });
    }

    const calendarItems: SettingGroupItem[] = [];
    if (!connection) {
        calendarItems.push({
            ...tab.label('settings.calendar.connect'),
            render: (setting: Setting) => {
                setting
                    .addButton(button => button.setButtonText(t('settings.calendar.connect.google')).onClick(() => void connectOAuth('google', button)))
                    .addButton(button => button.setButtonText(t('settings.calendar.connect.outlook')).onClick(() => void connectOAuth('microsoft', button)))
                    .addButton(button => button.setButtonText(t('settings.calendar.connect.icloud')).onClick(() => connectCalDav('icloud')))
                    .addButton(button => button.setButtonText(t('settings.calendar.connect.other')).onClick(() => connectCalDav('caldav')));
            }
        });
    } else {
        const who = [providerName(connection.provider), connection.calendarName, connection.account].filter(Boolean).join(' · ');
        const here = sync.signedInHere();
        calendarItems.push({
            name: t('settings.calendar.connected.name'),
            desc: `${who}. ${here ? syncLine(plugin) : t('settings.calendar.connected.notHere')}`,
            render: (setting: Setting) => {
                if (!here) {
                    setting.addButton(button => button.setButtonText(t('settings.calendar.connected.signInHere')).setCta().onClick(() => {
                        if (connection.provider === 'google' || connection.provider === 'microsoft') void connectOAuth(connection.provider, button);
                        else connectCalDav(connection.provider);
                    }));
                } else {
                    setting.addButton(button => button.setButtonText(t('settings.calendar.connected.syncNow')).onClick(async () => {
                        button.setDisabled(true);
                        await sync.syncNow();
                        tab.update();
                    }));
                }
                setting.addButton(button => button.setButtonText(t('settings.calendar.connected.disconnect')).setDestructive().onClick(async () => {
                    const confirmed = await confirmAction(tab.app, {
                        title: t('settings.calendar.disconnectConfirm.title'),
                        message: t('settings.calendar.disconnectConfirm.body'),
                        confirm: t('settings.calendar.disconnectConfirm.confirm'),
                        cancel: t('settings.calendar.disconnectConfirm.cancel')
                    });
                    if (!confirmed) return;
                    await sync.disconnect();
                    tab.update();
                }));
            }
        });
    }
    calendarItems.push(
        { ...tab.label('settings.calendar.timedOnly'), control: { type: 'toggle', key: 'calendarTimedOnly' } },
        {
            ...tab.label('settings.calendar.eventLength'),
            control: {
                type: 'dropdown',
                key: 'calendarEventMinutes',
                options: Object.fromEntries(EVENT_LENGTHS.map(minutes => [String(minutes), t(`settings.calendar.eventLength.m${minutes}`)]))
            }
        },
        {
            ...tab.label('settings.calendar.onDelete'),
            control: {
                type: 'dropdown',
                key: 'calendarClearOnDelete',
                options: { clear: t('settings.calendar.onDelete.clear'), restore: t('settings.calendar.onDelete.restore') }
            }
        },
        { ...tab.label('settings.calendar.showIds'), control: { type: 'toggle', key: 'showCalendarIds' } }
    );

    return [
        { type: 'group', heading: t('settings.plus.heading'), items: plusItems },
        { type: 'group', heading: t('settings.calendar.heading'), items: calendarItems }
    ];
}
