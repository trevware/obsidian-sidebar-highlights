import { moment } from 'obsidian';

interface Translations {
	[key: string]: string | Translations;
}

class I18n {
	private locale: string = 'en';
	private translations: Translations = {};
	private fallbackTranslations: Translations = {};

	/**
	 * Initialize the i18n system
	 */
	async init(): Promise<void> {
		try {
			// Detect locale from Obsidian's moment.js locale setting
			this.locale = this.normalizeLocale(moment.locale());
			console.log(`[i18n] Detected locale: ${moment.locale()} -> ${this.locale}`);

			// Always load English as fallback
			this.fallbackTranslations = await this.loadTranslations('en');

			// Load the detected locale if it's not English
			if (this.locale !== 'en') {
				try {
					this.translations = await this.loadTranslations(this.locale);
				} catch (error) {
					console.warn(`[i18n] Failed to load translations for locale "${this.locale}", falling back to English:`, error);
					this.translations = this.fallbackTranslations;
					this.locale = 'en';
				}
			} else {
				this.translations = this.fallbackTranslations;
			}

			console.log(`[i18n] Initialization complete. Active locale: ${this.locale}`);
		} catch (error) {
			console.error('[i18n] Critical error during initialization:', error);
			// Provide empty fallback to prevent plugin from crashing
			this.fallbackTranslations = {};
			this.translations = {};
			this.locale = 'en';
		}
	}

	/**
	 * Normalize locale codes to our supported format
	 * e.g., "zh-CN" -> "zh-cn", "zh" -> "zh-cn"
	 */
	private normalizeLocale(locale: string): string {
		const normalized = locale.toLowerCase();

		// Map Chinese locales to simplified Chinese
		if (normalized.startsWith('zh')) {
			return 'zh-cn';
		}

		// Default to English for unsupported locales
		return 'en';
	}

	/**
	 * Load translation file for a given locale
	 */
	private async loadTranslations(locale: string): Promise<Translations> {
		try {
			// Use Obsidian's file adapter to read the locale file
			const adapter = (window as any).app.vault.adapter;
			const localePath = `.obsidian/plugins/sidebar-highlights/locale/${locale}.json`;

			console.log(`[i18n] Loading translations from: ${localePath}`);

			// Read the file using Obsidian's adapter
			const fileContents = await adapter.read(localePath);
			const translations = JSON.parse(fileContents);

			console.log(`[i18n] Successfully loaded ${locale} translations`);
			return translations;
		} catch (error) {
			console.error(`[i18n] Failed to load locale file for "${locale}":`, error);
			throw new Error(`Failed to load locale file for "${locale}": ${error.message}`);
		}
	}

	/**
	 * Get nested value from object using dot notation
	 * e.g., "settings.display.showTitles" -> translations.settings.display.showTitles
	 */
	private getNestedValue(obj: Translations, path: string): string | undefined {
		const keys = path.split('.');
		let current: any = obj;

		for (const key of keys) {
			if (current && typeof current === 'object' && key in current) {
				current = current[key];
			} else {
				return undefined;
			}
		}

		return typeof current === 'string' ? current : undefined;
	}

	/**
	 * Translate a key with optional variable interpolation
	 * @param key - Translation key using dot notation (e.g., "settings.display.showTitles")
	 * @param vars - Optional object with variables to interpolate (e.g., { count: 5, name: "foo" })
	 * @returns Translated string with variables interpolated
	 *
	 * Examples:
	 *   t('settings.display.showTitles') -> "Show note titles"
	 *   t('notices.refreshed', { count: 3 }) -> "Refreshed 3 feeds"
	 */
	t(key: string, vars?: Record<string, any>): string {
		// Try to get translation from current locale
		let translation = this.getNestedValue(this.translations, key);

		// Fall back to English if not found
		if (translation === undefined) {
			translation = this.getNestedValue(this.fallbackTranslations, key);

			// If still not found, return the key itself as a last resort
			if (translation === undefined) {
				console.warn(`Translation key not found: "${key}"`);
				return key;
			}
		}

		// Perform variable interpolation if vars are provided
		if (vars) {
			return this.interpolate(translation, vars);
		}

		return translation;
	}

	/**
	 * Interpolate variables in a translation string
	 * Supports {{variable}} syntax
	 */
	private interpolate(str: string, vars: Record<string, any>): string {
		return str.replace(/\{\{(\w+)\}\}/g, (match, key) => {
			return vars[key] !== undefined ? String(vars[key]) : match;
		});
	}

	/**
	 * Get the current locale
	 */
	getLocale(): string {
		return this.locale;
	}
}

// Export a singleton instance
export const i18n = new I18n();

// Export the translation function for convenience
export const t = (key: string, vars?: Record<string, any>) => i18n.t(key, vars);
