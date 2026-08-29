import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as Handlebars from 'handlebars';

export type EmailTemplateDelegate = Handlebars.TemplateDelegate;

const DEFAULT_LOCALE = 'en';

// Renders `{{#> base}}...{{/base}}` blocks inside the locale's base layout,
// which exposes the block via `{{> @partial-block}}` (plain Handlebars).
const BASE_FALLBACK_SOURCE = '{{#> base}}<p>{{message}}</p>{{/base}}';

/**
 * EmailTemplateService
 *
 * Locale-aware renderer for the Handlebars templates in
 * src/common/email/templates/<locale>/. Locale resolution follows the
 * user's preference with a guaranteed English fallback:
 *
 *   1. templates/<locale>/<name>.html        — user's preferred locale
 *   2. templates/en/<name>.html              — English variant
 *   3. templates/en/base.html + message text — last resort, never errors
 *
 * Template names are the lowercased notification type (e.g. `payment_released`).
 * Compiled templates are cached per (locale, name).
 */
@Injectable()
export class EmailTemplateService {
  private readonly logger = new Logger(EmailTemplateService.name);
  private readonly templatesDir: string;
  private readonly compiledCache = new Map<string, EmailTemplateDelegate>();
  private readonly baseCache = new Map<string, EmailTemplateDelegate>();
  private readonly baseFallback: EmailTemplateDelegate = Handlebars.compile(BASE_FALLBACK_SOURCE);

  constructor(templatesDir?: string) {
    this.templatesDir = templatesDir ?? this.resolveTemplatesDir();
    this.logger.log(`Email templates directory: ${this.templatesDir}`);
  }

  /**
   * Render an email template for a locale, falling back to English when the
   * requested locale has no variant (and to the base layout + message text
   * when no template exists for the name at all). Never throws for a missing
   * translation.
   */
  render(
    templateName: string,
    locale?: string | null,
    context: Record<string, any> = {},
  ): string {
    const localeDir = this.resolveLocaleDir(templateName, locale);
    if (localeDir) {
      const compiled = this.getCompiled(templateName, localeDir);
      const base = this.getCompiledBase(localeDir);
      return compiled(context, { partials: { base } });
    }

    // No dedicated template in any locale — render the English base layout
    // with the plain message text so emailing never errors.
    const base = this.getCompiledBase(DEFAULT_LOCALE);
    return this.baseFallback(context, { partials: { base } });
  }

  /**
   * The locale directory that has a variant of `templateName` (preferred
   * locale first, then English), or null when neither exists.
   */
  private resolveLocaleDir(templateName: string, locale?: string | null): string | null {
    const normalized = this.normalizeLocale(locale);
    const candidates = normalized && normalized !== DEFAULT_LOCALE
      ? [normalized, DEFAULT_LOCALE]
      : [DEFAULT_LOCALE];

    for (const candidate of candidates) {
      if (fs.existsSync(this.templatePath(templateName, candidate))) {
        return candidate;
      }
    }
    return null;
  }

  private getCompiled(templateName: string, localeDir: string): EmailTemplateDelegate {
    const cacheKey = `${localeDir}/${templateName}`;
    const cached = this.compiledCache.get(cacheKey);
    if (cached) return cached;

    const source = fs.readFileSync(this.templatePath(templateName, localeDir), 'utf-8');
    const compiled = Handlebars.compile(source);
    this.compiledCache.set(cacheKey, compiled);
    return compiled;
  }

  private getCompiledBase(localeDir: string): EmailTemplateDelegate {
    const cached = this.baseCache.get(localeDir);
    if (cached) return cached;

    // The base layout itself falls back to English when the locale has none.
    const baseLocale = fs.existsSync(this.templatePath('base', localeDir))
      ? localeDir
      : DEFAULT_LOCALE;
    const source = fs.readFileSync(this.templatePath('base', baseLocale), 'utf-8');
    const compiled = Handlebars.compile(source);
    this.baseCache.set(localeDir, compiled);
    return compiled;
  }

  private templatePath(templateName: string, localeDir: string): string {
    return path.join(this.templatesDir, localeDir, `${templateName}.html`);
  }

  private normalizeLocale(locale?: string | null): string | null {
    if (!locale) return null;
    return locale.trim().toLowerCase();
  }

  private resolveTemplatesDir(): string {
    const candidates = [
      path.join(process.cwd(), 'src', 'common', 'email', 'templates'),
      path.join(process.cwd(), 'dist', 'common', 'email', 'templates'),
    ];
    return candidates.find((dir) => fs.existsSync(dir)) ?? candidates[0];
  }
}
