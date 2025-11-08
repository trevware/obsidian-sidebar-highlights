import { Modal, App, Notice } from 'obsidian';
import { t } from '../i18n';

export class BackupSelectorModal extends Modal {
    private backups: Array<{ path: string; filename: string; data: any }>;
    private onRestore: (backupPath: string, collectionsCount: number, highlightsCount: number) => Promise<void>;
    private countHighlights: (collections: { [id: string]: any }) => number;
    private selectedBackup: { path: string; filename: string; data: any } | null = null;
    private restoreButton: HTMLButtonElement | null = null;

    constructor(
        app: App,
        backups: Array<{ path: string; filename: string; data: any }>,
        countHighlights: (collections: { [id: string]: any }) => number,
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
        const titleEl = contentEl.createEl('div', {
            cls: 'modal-title',
            text: t('modals.backupSelector.title')
        });
        titleEl.style.marginBottom = '20px';

        // Add divider after title
        if (this.backups.length > 0) {
            const divider = contentEl.createDiv();
            divider.style.borderTop = '1px solid var(--background-modifier-border)';
            divider.style.marginBottom = '20px';
        }

        // Render backup list
        if (this.backups.length === 0) {
            const emptyState = contentEl.createDiv({ cls: 'setting-item-description' });
            emptyState.setText(t('settings.backupRestore.noBackups'));
            emptyState.style.textAlign = 'center';
            emptyState.style.padding = '20px';
        } else {
            this.renderBackupList(contentEl);
        }

        // Bottom buttons
        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
        buttonContainer.style.display = 'flex';
        buttonContainer.style.justifyContent = 'flex-end';
        buttonContainer.style.gap = '10px';
        buttonContainer.style.marginTop = '20px';

        const cancelBtn = buttonContainer.createEl('button', {
            text: t('settings.backupRestore.cancel')
        });
        cancelBtn.addEventListener('click', () => this.close());

        this.restoreButton = buttonContainer.createEl('button', {
            text: t('settings.backupRestore.restore'),
            cls: 'mod-cta'
        });
        this.restoreButton.disabled = true; // Disabled until selection is made

        this.restoreButton.addEventListener('click', async () => {
            if (!this.selectedBackup) return;

            const collectionsCount = Object.keys(this.selectedBackup.data.collections || {}).length;
            const highlightsCount = this.countHighlights(this.selectedBackup.data.collections || {});

            await this.onRestore(this.selectedBackup.path, collectionsCount, highlightsCount);
            this.close();
        });
    }

    private renderBackupList(containerEl: HTMLElement) {
        const listContainer = containerEl.createDiv({ cls: 'backup-list' });
        listContainer.style.maxHeight = '400px';
        listContainer.style.overflowY = 'auto';

        this.backups.forEach((backup) => {
            const collectionsCount = Object.keys(backup.data.collections || {}).length;
            const highlightsCount = this.countHighlights(backup.data.collections || {});

            const itemEl = listContainer.createDiv({ cls: 'backup-item' });
            itemEl.style.padding = '6px 8px';
            itemEl.style.cursor = 'pointer';
            itemEl.style.borderRadius = '4px';
            itemEl.style.marginBottom = '2px';
            itemEl.style.display = 'flex';
            itemEl.style.justifyContent = 'space-between';
            itemEl.style.alignItems = 'center';
            itemEl.style.transition = 'background-color 0.1s ease';

            // Format the date
            const dateStr = this.formatBackupDate(backup.data.backupCreatedAt);

            // Get backup type label
            const typeLabel = this.getBackupTypeLabel(backup.data.backupReason);

            // Content container
            const contentDiv = itemEl.createDiv();
            contentDiv.style.flex = '1';

            // Row 1: Date
            const dateLine = contentDiv.createDiv();
            dateLine.setText(dateStr);
            dateLine.style.fontWeight = '500';

            // Row 2: Type (Manual/Automatic)
            const typeLine = contentDiv.createDiv();
            typeLine.setText(typeLabel);
            typeLine.style.fontSize = 'var(--font-ui-small)';
            typeLine.style.color = 'var(--text-muted)';
            typeLine.style.marginTop = '2px';

            // Row 3: Stats
            const statsLine = contentDiv.createDiv();
            statsLine.style.fontSize = 'var(--font-ui-small)';
            statsLine.style.color = 'var(--text-muted)';
            statsLine.style.marginTop = '2px';

            // Create stats with highlighted numbers
            const collectionsSpan = statsLine.createSpan();
            collectionsSpan.style.color = 'var(--text-normal)';
            collectionsSpan.setText(collectionsCount.toString());

            statsLine.appendText(' Collections • ');

            const highlightsSpan = statsLine.createSpan();
            highlightsSpan.style.color = 'var(--text-normal)';
            highlightsSpan.setText(highlightsCount.toString());

            statsLine.appendText(' Collection Highlights');

            // Click handler
            itemEl.addEventListener('click', () => {
                // Deselect all items
                listContainer.querySelectorAll('.backup-item').forEach(item => {
                    (item as HTMLElement).style.backgroundColor = '';
                });

                // Select this item
                itemEl.style.backgroundColor = 'var(--background-modifier-hover)';
                this.selectedBackup = backup;

                // Enable restore button
                if (this.restoreButton) {
                    this.restoreButton.disabled = false;
                }
            });

            // Hover effect
            itemEl.addEventListener('mouseenter', () => {
                if (this.selectedBackup !== backup) {
                    itemEl.style.backgroundColor = 'var(--background-modifier-hover)';
                }
            });

            itemEl.addEventListener('mouseleave', () => {
                if (this.selectedBackup !== backup) {
                    itemEl.style.backgroundColor = '';
                }
            });
        });
    }

    private formatBackupDate(timestamp: number): string {
        if (!timestamp) return t('settings.backupRestore.unknownDate');

        const date = new Date(timestamp);
        return date.toLocaleString();
    }

    private getBackupTypeLabel(backupReason: string): string {
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
