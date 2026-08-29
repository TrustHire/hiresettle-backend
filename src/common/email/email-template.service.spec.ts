import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EmailTemplateService } from './email-template.service';

describe('EmailTemplateService', () => {
  let fixturesDir: string;

  const write = (relPath: string, content: string) => {
    const full = path.join(fixturesDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
  };

  beforeEach(() => {
    fixturesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'email-templates-'));
    // English set — full coverage.
    write(
      'en/base.html',
      '<html><body><p>Dear User,</p>{{> @partial-block}}{{#if ctaLink}}<a href="{{ctaLink}}">View Details</a>{{/if}}<p>The HireSettle Team</p></body></html>',
    );
    write('en/payment_released.html', '{{#> base}}<p>A payment of {{amount}} was released.</p>{{/base}}');
    write('en/milestone_confirmed.html', '{{#> base}}<p>Milestone {{milestoneIndex}} was confirmed.</p>{{/base}}');
    // Spanish set — intentionally missing `milestone_confirmed` to exercise the fallback.
    write('es/base.html', '<html><body><p>Estimado usuario,</p>{{> @partial-block}}{{#if ctaLink}}<a href="{{ctaLink}}">Ver detalles</a>{{/if}}<p>El equipo de HireSettle</p></body></html>');
    write('es/payment_released.html', '{{#> base}}<p>Se ha liberado un pago de {{amount}}.</p>{{/base}}');
  });

  afterEach(() => {
    fs.rmSync(fixturesDir, { recursive: true, force: true });
  });

  const createService = () => new EmailTemplateService(fixturesDir);

  it('renders the English template when no locale is given', () => {
    const html = createService().render('payment_released', undefined, { amount: '100' });
    expect(html).toContain('Dear User,');
    expect(html).toContain('A payment of 100 was released.');
  });

  it('renders the English template for the "en" locale', () => {
    const html = createService().render('payment_released', 'en', { amount: '100' });
    expect(html).toContain('A payment of 100 was released.');
  });

  it('renders the Spanish template for the "es" locale', () => {
    const html = createService().render('payment_released', 'es', { amount: '100' });
    expect(html).toContain('Estimado usuario,');
    expect(html).toContain('Se ha liberado un pago de 100.');
    expect(html).not.toContain('Dear User,');
  });

  it('falls back to English when the requested locale has no variant', () => {
    const html = createService().render('milestone_confirmed', 'es', { milestoneIndex: 2 });
    expect(html).toContain('Milestone 2 was confirmed.');
    expect(html).toContain('Dear User,');
    expect(html).not.toContain('Estimado usuario,');
  });

  it('falls back to English for an unknown locale without erroring', () => {
    const html = createService().render('payment_released', 'fr', { amount: '100' });
    expect(html).toContain('A payment of 100 was released.');
  });

  it('normalizes locale casing before resolution', () => {
    const html = createService().render('payment_released', 'ES', { amount: '100' });
    expect(html).toContain('Se ha liberado un pago de 100.');
  });

  it('renders the base layout with the plain message when no template exists for the type', () => {
    const html = createService().render('nonexistent_type', 'es', { message: 'Fallback message body' });
    expect(html).toContain('Fallback message body');
    expect(html).toContain('Dear User,');
  });

  it('renders the localized base layout for the matched locale', () => {
    const html = createService().render('payment_released', 'es', { amount: '50', ctaLink: 'https://example.com' });
    expect(html).toContain('Estimado usuario,');
    expect(html).toContain('https://example.com');
  });
});
