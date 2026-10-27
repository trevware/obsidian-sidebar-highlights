import { Modal, App } from 'obsidian';
import { t } from '../i18n';
import type { StoredPluginData, Collection } from '../../main';

type BackupData = StoredPluginData;

export class BackupSelectorModal extends Modal {
    private backups: Array<{ path: string; filename: string; data: BackupData }>;
    private onRestore: (backupPath: string, collectionsCount: number, highlightsCount: number) => Promise<void>;
    private countHighlights: (collections: { [id: string]: Collection }) => number;
    private selectedBackup: { path: string; filename: string; data: BackupData } | null = null;
    private restoreButton: HTMLButtonElement | null = null;

    constructor(
        app: App,
        backups: Array<{ path: string; filename: string; data: BackupData }>,
        countHighlights: (collections: { [id: string]: Collection }) => number,
        onRestore: (backupPath: string, collectionsCount: number, highlightsCount: number) => Promise<void>
    ) {
        super(app);
        this.backups = backups;
        this.countHighlights = countHighlights;
        this.onRestore = onRestore;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        // Set the modal title
        contentEl.createDiv({
            cls: 'modal-title sh-modal-heading',
            text: t('modals.backupSelector.title')
        });

        // Add divider after title
        if (this.backups.length > 0) {
            contentEl.createDiv({ cls: 'sh-modal-divider' });
        }

        // Render backup list
        if (this.backups.length === 0) {
            const emptyState = contentEl.createDiv({ cls: 'setting-item-description sh-backup-empty' });
            emptyState.setText(t('settings.backupRestore.noBackups'));
        } else {
            this.renderBackupList(contentEl);
        }

        // Bottom buttons
        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container sh-modal-buttons' });

        const cancelBtn = buttonContainer.createEl('button', {
            text: t('settings.backupRestore.cancel')
        });
        cancelBtn.addEventListener('click', () => this.close());

        this.restoreButton = buttonContainer.createEl('button', {
            text: t('settings.backupRestore.restore'),
            cls: 'mod-cta'
        });
        this.restoreButton.disabled = true; // Disabled until selection is made

        this.restoreButton.addEventListener('click', () => void (async () => {
            if (!this.selectedBackup) return;

            const collectionsCount = Object.keys(this.selectedBackup.data.collections || {}).length;
            const highlightsCount = this.countHighlights(this.selectedBackup.data.collections || {});

            await this.onRestore(this.selectedBackup.path, collectionsCount, highlightsCount);
            this.close();
        })());
    }

    private renderBackupList(containerEl: HTMLElement) {
        const listContainer = containerEl.createDiv({ cls: 'backup-list sh-backup-list' });

        this.backups.forEach((backup) => {
            const collectionsCount = Object.keys(backup.data.collections || {}).length;
            const highlightsCount = this.countHighlights(backup.data.collections || {});

            const itemEl = listContainer.createDiv({ cls: 'backup-item sh-backup-item' });

            // Format the date
            const dateStr = this.formatBackupDate(backup.data.backupCreatedAt);

            // Get backup type label
            const typeLabel = this.getBackupTypeLabel(backup.data.backupReason);

            // Content container
            const contentDiv = itemEl.createDiv({ cls: 'sh-backup-item-body' });

            // Row 1: Date
            contentDiv.createDiv({ cls: 'sh-backup-date', text: dateStr });

            // Row 2: Type (Manual/Automatic)
            contentDiv.createDiv({ cls: 'sh-backup-meta', text: typeLabel });

            // Row 3: Stats, with the numbers in the normal text colour
            const statsLine = contentDiv.createDiv({ cls: 'sh-backup-meta' });
            statsLine.createSpan({ cls: 'sh-backup-count', text: collectionsCount.toString() });

            statsLine.appendText(' Collections • ');

            statsLine.createSpan({ cls: 'sh-backup-count', text: highlightsCount.toString() });

            statsLine.appendText(' Collection Highlights');

            // Click handler
            itemEl.addEventListener('click', () => {
                listContainer.querySelectorAll('.backup-item').forEach(item => item.removeClass('is-selected'));
                itemEl.addClass('is-selected');
                this.selectedBackup = backup;

                // Enable restore button
                if (this.restoreButton) {
                    this.restoreButton.disabled = false;
                }
            });
        });
    }

    private formatBackupDate(timestamp?: number): string {
        if (!timestamp) return t('settings.backupRestore.unknownDate');

        const date = new Date(timestamp);
        return date.toLocaleString();
    }

    private getBackupTypeLabel(backupReason?: string): string {
        if (backupReason === 'manual') {
            return t('modals.backupSelector.manual');
        }
        return t('modals.backupSelector.automatic');
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
