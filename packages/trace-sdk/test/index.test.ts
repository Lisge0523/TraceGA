import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Reporter } from '../src/reporter/index';

describe('Reporter exports', () => {
  let reporter: Reporter;

  beforeEach(() => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0',
      sendBeacon: vi.fn().mockReturnValue(true),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    ));
    reporter = new Reporter();
  });

  afterEach(() => {
    reporter.destroy();
    vi.unstubAllGlobals();
  });

  it('should register without error', () => {
    expect(() => {
      reporter.register({
        projectId: 'test',
        reportUrl: 'http://localhost/api',
        sampleRate: 0.5,
      });
    }).not.toThrow();
  });

  it('should call trackEvent without error', () => {
    reporter.register({
      projectId: 'test',
      reportUrl: 'http://localhost/api',
      sampleRate: 1,
    });
    expect(() => {
      reporter.trackEvent('test_event', { foo: 'bar' });
    }).not.toThrow();
  });
});