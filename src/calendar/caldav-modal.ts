import { App, Modal, Setting } from 'obsidian';
import { t } from '../i18n';

export interface CalDavDetails {
    server: string;
    username: string;
    password: string;
}

/**
 * Asks for iCloud or CalDAV sign-in details, then hands them to `connect`,
 * showing its error in the dialog when it fails so the user can fix a typo
 * without starting over.
 */
export class CalDavModal extends Modal {
    private details: CalDavDetails;

    constructor(
        app: App,
        private kind: 'icloud' | 'caldav',
        private connect: (details: CalDavDetails) => Promise<void>,
        prefill: Partial<CalDavDetails> = {}
    ) {
        super(app);
        this.details = { server: prefill.server ?? '', username: prefill.username ?? '', password: '' };
    }

    onOpen(): void {
        const icloud = this.kind === 'icloud';
        this.setTitle(t(icloud ? 'calendar.caldav.icloudTitle' : 'calendar.caldav.otherTitle'));
        const { contentEl } = this;

        if (!icloud) {
            new Setting(contentEl).setName(t('calendar.caldav.server')).addText(text => text
                .setPlaceholder(t('calendar.caldav.serverPlaceholder'))
                .setValue(this.details.server)
                .onChange(value => { this.details.server = value.trim(); }));
        }
        new Setting(contentEl).setName(t(icloud ? 'calendar.caldav.appleId' : 'calendar.caldav.username')).addText(text => text
            .setValue(this.details.username)
            .onChange(value => { this.details.username = value.trim(); }));
        new Setting(contentEl)
            .setName(t(icloud ? 'calendar.caldav.appPassword' : 'calendar.caldav.password'))
            .setDesc(icloud ? t('calendar.caldav.icloudHelp') : '')
            .addText(text => {
                text.inputEl.type = 'password';
                text.onChange(value => { this.details.password = value; });
            });

        contentEl.createEl('p', { cls: 'setting-item-description', text: t('calendar.caldav.privacy') });
        const error = contentEl.createEl('p', { cls: 'sh-calendar-error' });

        new Setting(contentEl).addButton(button => button
            .setButtonText(t('calendar.caldav.connect'))
            .setCta()
            .onClick(async () => {
                button.setDisabled(true).setButtonText(t('calendar.caldav.connecting'));
                error.setText('');
                try {
                    await this.connect(this.details);
                    this.close();
                } catch (failure) {
                    error.setText(failure instanceof Error ? failure.message : String(failure));
                    button.setDisabled(false).setButtonText(t('calendar.caldav.connect'));
                }
            }));
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
