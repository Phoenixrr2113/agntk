vi.mock('@agntk/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { extractContent } from '../extract.js';

describe('extractContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('extracts content from HTML page', async () => {
    const html = `
      <html>
        <head><title>Test Page</title></head>
        <body>
          <nav>Navigation</nav>
          <article>
            <p>This is the main content of the article.</p>
          </article>
          <footer>Footer</footer>
        </body>
      </html>
    `;

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    );

    const result = await extractContent('https://example.com/article');

    expect(result.title).toBe('Test Page');
    expect(result.content).toContain('main content');
    expect(result.content).not.toContain('Navigation');
    expect(result.content).not.toContain('Footer');
    expect(result.url).toBe('https://example.com/article');
    expect(result.estimatedTokens).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('falls back to body when no content selectors match', async () => {
    const html = `
      <html>
        <head><title>Simple</title></head>
        <body>
          <div>Some body content here.</div>
        </body>
      </html>
    `;

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );

    const result = await extractContent('https://example.com');
    expect(result.content).toContain('body content');
  });

  it('handles non-HTML content', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{"key": "value"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const result = await extractContent('https://api.example.com/data');
    expect(result.content).toBe('{"key": "value"}');
    expect(result.title).toBe('https://api.example.com/data');
  });

  it('respects maxLength', async () => {
    const longContent = 'a'.repeat(1000);
    const html = `<html><body><article>${longContent}</article></body></html>`;

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );

    const result = await extractContent('https://example.com', { maxLength: 100 });
    expect(result.content.length).toBeLessThanOrEqual(100);
  });

  it('throws on HTTP error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Not Found', { status: 404, statusText: 'Not Found' }),
    );

    await expect(extractContent('https://example.com/missing')).rejects.toThrow('404');
  });

  it('extracts meta description', async () => {
    const html = `
      <html>
        <head>
          <title>Test</title>
          <meta name="description" content="A meta description">
        </head>
        <body><article>Content</article></body>
      </html>
    `;

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );

    const result = await extractContent('https://example.com');
    expect(result.description).toBe('A meta description');
  });
});
