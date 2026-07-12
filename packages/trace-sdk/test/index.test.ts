import { describe, it, expect, vi } from 'vitest';
import { TraceCore } from '../src';

describe('TraceCore skeleton', () => {
  it('should register without error', () => {
    const core = new TraceCore();

    expect(() => {
      core.register({
        projectId: 'test',
        reportUrl: 'http://localhost/api',
        sampleRate: 0.5,
      });
    }).not.toThrow();
  });

  it('should call trackEvent and log', () => {
    const core = new TraceCore();
    const spy = vi.spyOn(console, 'log');

    core.register({
      projectId: 'test',
      reportUrl: 'http://localhost/api',
      sampleRate: 1,
    });
    spy.mockClear();
    core.trackEvent('test_event', { foo: 'bar' });

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('should drop events when sampleRate is not hit', () => {
    const core = new TraceCore();
    const logSpy = vi.spyOn(console, 'log');
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.8);

    core.register({
      projectId: 'test',
      reportUrl: 'http://localhost/api',
      sampleRate: 0.5,
    });
    logSpy.mockClear();
    core.trackEvent('sampled_out_event');

    expect(logSpy).not.toHaveBeenCalled();

    randomSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('should keep events when sampleRate is hit', () => {
    const core = new TraceCore();
    const logSpy = vi.spyOn(console, 'log');
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.2);

    core.register({
      projectId: 'test',
      reportUrl: 'http://localhost/api',
      sampleRate: 0.5,
    });
    logSpy.mockClear();
    core.trackEvent('sampled_in_event');

    expect(logSpy).toHaveBeenCalledWith(
      '[TraceGA SDK] Event tracked:',
      expect.objectContaining({
        eventName: 'sampled_in_event',
        envInfo: expect.objectContaining({
          url: window.location.href,
          userAgent: navigator.userAgent,
        }),
      }),
    );

    randomSpy.mockRestore();
    logSpy.mockRestore();
  });
});
