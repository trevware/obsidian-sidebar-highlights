import { App, Notice, moment } from 'obsidian';
import type { Setting, SettingDefinitionItem, SettingGroupItem } from 'obsidian';
import type HighlightCommentsPlugin from '../../main';
import { thingsAvailable, thingsVisible } from '../plus/plus-client';
import type { PlusStatus } from '../plus/plus-client';
import { confirmAction } from '../modals/confirm-modal';
import { t } from '../i18n';
import type { ThingsSync } from './things-sync';

interface Tab {
    app: App;
    update(): void;
    label(path: string): { name: string; desc: string };
}

interface Button {
    setDisabled(disabled: boolean): unknown;
    setButtonText(text: string): unknown;
}

/** The last round, in a line: what's happening, what went wrong, or when it last synced. */
function statusLine(sync: ThingsSync): string {
    const status = sync.getStatus();
    if (status.state === 'syncing') return t('things.status.syncing');
    if ((status.state === 'problem' || status.state === 'closed') && status.message) return status.message;
    if (status.at) return t('things.status.synced', { when: moment(status.at).fromNow() });
    return t('things.status.never');
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The Things group of the settings tab. Off a Mac it only says where Things
 * sync runs (and which Mac syncs this vault). On a Mac: the token and
 * Connect, with a count to confirm before the first sync; once connected,
 * the last round, Sync now and Disconnect; on a Mac that isn't the syncing
 * one, Sync from this Mac instead.
 */
export function thingsGroup(tab: Tab, plugin: HighlightCommentsPlugin, plusStatus: PlusStatus | null): SettingDefinitionItem[] {
    if (!thingsVisible(tab.app)) return [];
    const sync = plugin.thingsSync;
    const connection = plugin.settings.things;
    const items: SettingGroupItem[] = [];
    const group = (): SettingDefinitionItem[] => [{ type: 'group', heading: t('settings.things.heading'), items }];

    if (!thingsAvailable(tab.app)) {
        const desc = t('settings.things.macOnly.desc');
        items.push({
            name: t('settings.things.macOnly.name'),
            desc: connection ? `${desc} ${t('things.status.elsewhere', { device: connection.device.name })}` : desc
        });
        return group();
    }

    const owner = connection ? null : sync.ownerElsewhere();
    if (owner) {
        items.push({ name: t('settings.things.otherVault.name'), desc: t('settings.things.otherVault.desc', { vault: owner }) });
        return group();
    }

    let tokenValue = sync.token() ?? '';
    let tokenTimer = 0;
    const tokenItem: SettingGroupItem = {
        ...tab.label('settings.things.token'),
        render: (setting: Setting) => {
            setting.addText(text => {
                text.inputEl.type = 'password';
                text.setPlaceholder(t('settings.things.token.placeholder')).setValue(tokenValue);
                text.onChange(value => {
                    tokenValue = value.trim();
                    window.clearTimeout(tokenTimer);
                    tokenTimer = window.setTimeout(() => sync.setToken(tokenValue), 400);
                });
            });
        }
    };

    const disconnect = async () => {
        const confirmed = await confirmAction(tab.app, {
            title: t('settings.things.disconnectConfirm.title'),
            message: t('settings.things.disconnectConfirm.body'),
            confirm: t('settings.things.disconnectConfirm.confirm'),
            cancel: t('settings.things.disconnectConfirm.cancel')
        });
        if (!confirmed) return;
        await sync.disconnect();
        tab.update();
    };

    if (!connection) {
        const connect = async (button: Button) => {
            if (!tokenValue) {
                new Notice(t('things.errors.noToken'));
                return;
            }
            const status = await plugin.refreshPlusStatus(true);
            if (status.state !== 'active') {
                new Notice(status.state === 'none' ? t('things.errors.noPlus') : status.message ?? t(`settings.plus.states.${status.state}`));
                tab.update();
                return;
            }
            button.setDisabled(true);
            button.setButtonText(t('settings.things.connect.reading'));
            try {
                const counts = await sync.preview();
                const confirmed = await confirmAction(tab.app, {
                    title: t('settings.things.confirm.title'),
                    message: t('settings.things.confirm.body', counts),
                    confirm: t('settings.things.confirm.confirm'),
                    cancel: t('settings.things.confirm.cancel')
                });
                if (confirmed) await sync.connect(tokenValue);
            } catch (error) {
                new Notice(errorText(error));
            }
            tab.update();
        };
        const connectDesc = t('settings.things.connect.desc');
        items.push(tokenItem, {
            name: t('settings.things.connect.name'),
            desc: plusStatus?.state === 'active' ? connectDesc : `${connectDesc} ${t('things.errors.noPlus')}`,
            render: (setting: Setting) => {
                setting.addButton(button => button.setButtonText(t('settings.things.connect.button')).setCta().onClick(() => void connect(button)));
            }
        });
        return group();
    }

    if (!sync.isSyncingDevice()) {
        items.push({
            name: t('settings.things.elsewhere.name'),
            desc: t('settings.things.elsewhere.desc', { device: connection.device.name }),
            render: (setting: Setting) => {
                setting
                    .addButton(button => button.setButtonText(t('settings.things.elsewhere.takeOver')).onClick(async () => {
                        if (!tokenValue) {
                            new Notice(t('things.errors.noToken'));
                            return;
                        }
                        try {
                            sync.setToken(tokenValue);
                            button.setDisabled(true);
                            button.setButtonText(t('settings.things.connect.reading'));
                            const counts = await sync.preview(true);
                            const confirmed = await confirmAction(tab.app, {
                                title: t('settings.things.confirm.title'),
                                message: t('settings.things.confirm.body', counts),
                                confirm: t('settings.things.confirm.confirm'),
                                cancel: t('settings.things.confirm.cancel')
                            });
                            if (confirmed) await sync.takeOver();
                        } catch (error) {
                            new Notice(errorText(error));
                        }
                        tab.update();
                    }))
                    .addButton(button => button.setButtonText(t('settings.things.connected.disconnect')).setDestructive().onClick(() => void disconnect()));
            }
        }, tokenItem);
    } else {
        const status = sync.getStatus();
        items.push({
            name: t('settings.things.connected.name'),
            desc: statusLine(sync),
            render: (setting: Setting) => {
                if (status.missing?.side === 'vault') {
                    setting.addButton(button => button.setButtonText(t('settings.things.connected.sendToTrash')).setDestructive().setCta().onClick(async () => {
                        button.setDisabled(true);
                        await sync.confirmMissing();
                        tab.update();
                    }));
                }
                setting
                    .addButton(button => button.setButtonText(t('settings.things.connected.syncNow')).onClick(async () => {
                        button.setDisabled(true);
                        await sync.syncNow();
                        tab.update();
                    }))
                    .addButton(button => button.setButtonText(t('settings.things.connected.disconnect')).setDestructive().onClick(() => void disconnect()));
            }
        }, tokenItem);
    }
    items.push({ ...tab.label('settings.things.showIds'), control: { type: 'toggle', key: 'showThingsIds' } });
    return group();
}
