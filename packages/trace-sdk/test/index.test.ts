import { describe, it, expect, vi } from 'vitest';
import { ErrorPlugin, TraceCore } from '../src';

describe('TraceCore', () => {
  it('should register with default config', () => {
    const core = new TraceCore();

    expect(() => {
      core.register({
        projectId: 'test',
        reportUrl: 'http://localhost/api',
      });
    }).not.toThrow();

    expect(core.getConfig()).toEqual(
      expect.objectContaining({
        projectId: 'test',
        sampleRate: 1,
        maxBufferSize: 50,
        flushInterval: 3000,
      }),
    );
  });

  it('should build and pass a stable event to the reporter', () => {
    const core = new TraceCore();
    const reporter = { report: vi.fn() };

    core.setReporter(reporter);
    core.register({
      projectId: 'test',
      reportUrl: 'http://localhost/api',
    });
    core.addCommonParams({ channel: 'web' });
    core.trackEvent('test_event', { foo: 'bar' });

    expect(reporter.report).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'test_event',
        projectId: 'test',
        priority: 'normal',
        customParams: { foo: 'bar' },
        commonParams: { channel: 'web' },
        timestamp: expect.any(Number),
        envInfo: expect.objectContaining({
          uid: expect.any(String),
        }),
      }),
    );
  });
});

// Error插件测试
describe('ErrorPlugin', () => {
  it('should track js-error events', () => {
    const plugin = new ErrorPlugin();
    const core = {
      trackEvent: vi.fn(),
    };
    const error = new Error('boom');

    plugin.install(core as any);
    window.dispatchEvent(
      new ErrorEvent('error', {
        message: error.message,
        filename: 'app.js',
        lineno: 10,
        colno: 20,
        error,
      }),
    );

    expect(core.trackEvent).toHaveBeenCalledWith(
      'js-error',
      expect.objectContaining({
        type: 'js-error',
        message: 'boom',
        filename: 'app.js',
        lineno: 10,
        colno: 20,
        errorName: 'Error',
        stack: error.stack,
      }),
    );

    plugin.uninstall();
  });

  it('should remove error listener on uninstall', () => {
    const plugin = new ErrorPlugin();
    const core = {
      trackEvent: vi.fn(),
    };

    plugin.install(core as any);
    plugin.uninstall();
    window.dispatchEvent(
      new ErrorEvent('error', {
        message: 'after uninstall',
      }),
    );

    expect(core.trackEvent).not.toHaveBeenCalled();
  });

  it('should track promise-error events', () => {
    const plugin = new ErrorPlugin();
    const core = {
      trackEvent: vi.fn(),
    };
    const error = new Error('promise boom');

    plugin.install(core as any);
    window.dispatchEvent(
      Object.defineProperty(new Event('unhandledrejection'), 'reason', {
        value: error,
      }),
    );

    expect(core.trackEvent).toHaveBeenCalledWith(
      'promise-error',
      expect.objectContaining({
        type: 'promise-error',
        message: 'promise boom',
        reasonType: 'Error',
        errorName: 'Error',
        stack: error.stack,
      }),
    );

    plugin.uninstall();
  });

  it('should track resource-error events', () => {
    const plugin = new ErrorPlugin();
    const core = {
      trackEvent: vi.fn(),
    };
    const image = document.createElement('img');

    image.src = 'https://cdn.example.com/missing.png';
    document.body.appendChild(image);

    plugin.install(core as any);
    image.dispatchEvent(new Event('error'));

    expect(core.trackEvent).toHaveBeenCalledWith(
      'resource-error',
      expect.objectContaining({
        type: 'resource-error',
        tagName: 'img',
        resourceUrl: 'https://cdn.example.com/missing.png',
      }),
    );

    plugin.uninstall();
    image.remove();
  });

  it('should track fetch http-error events', async () => {
    const plugin = new ErrorPlugin();
    const core = {
      trackEvent: vi.fn(),
    };
    const originalFetch = window.fetch;
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 500, statusText: 'Server Error' }));

    window.fetch = fetchMock as any;

    try {
      plugin.install(core as any);

      await window.fetch('/api/fail', {
        method: 'POST',
      });

      expect(core.trackEvent).toHaveBeenCalledWith(
        'http-error',
        expect.objectContaining({
          type: 'http-error',
          requestType: 'fetch',
          method: 'POST',
          requestUrl: '/api/fail',
          status: 500,
          statusText: 'Server Error',
        }),
      );
    } finally {
      plugin.uninstall();
      window.fetch = originalFetch;
    }
  });
});
