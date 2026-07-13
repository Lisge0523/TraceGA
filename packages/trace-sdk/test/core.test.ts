import { describe, expect, it, vi } from 'vitest';
import { TraceCore } from '../src';
import type { CommonParams, ResolvedTraceConfig, TraceLifecycleHooks } from '../src';

describe('TraceCore behavior', () => {
  it('silently ignores events before register', () => {
    const core = new TraceCore();
    const reporter = { report: vi.fn() };

    core.setReporter(reporter);
    expect(() => core.trackEvent('click')).not.toThrow();
    expect(reporter.report).not.toHaveBeenCalled();
  });

  it('returns a copy of common params', () => {
    const core = new TraceCore();
    core.addCommonParams({ nested: { value: 1 } });

    const copy = core.getCommonParams();
    (copy.nested as { value: number }).value = 2;

    expect(core.getCommonParams()).toEqual({ nested: { value: 1 } });
  });

  it('isolates common params with __proto__ keys and mutable nested values', () => {
    const core = new TraceCore();
    const protoParams = Object.create(null) as CommonParams;
    Object.defineProperty(protoParams, '__proto__', {
      configurable: true,
      enumerable: true,
      value: { polluted: true },
      writable: true,
    });
    const endpoint = new URL('https://tracega.dev/initial');

    core.addCommonParams({ ...protoParams, endpoint });
    const firstCopy = core.getCommonParams();
    const secondCopy = core.getCommonParams();
    (firstCopy.endpoint as URL).pathname = '/changed';
    firstCopy.externalMutation = true;

    expect(firstCopy).not.toBe(secondCopy);
    expect(Object.getPrototypeOf(secondCopy)).not.toEqual({ polluted: true });
    expect((secondCopy.endpoint as URL).pathname).toBe('/initial');
    expect(core.getCommonParams()).not.toHaveProperty('externalMutation');
  });

  it('merges, overwrites, and removes common params', () => {
    const core = new TraceCore();

    core.addCommonParams({ channel: 'web', version: 1 });
    core.addCommonParams({ version: 2, region: 'cn' });
    core.removeCommonParams(['channel']);
    core.setUser('user-1');

    expect(core.getCommonParams()).toEqual({
      version: 2,
      region: 'cn',
      user_id: 'user-1',
    });
  });

  it('initializes environment information during register', () => {
    const core = new TraceCore();

    expect(core.getEnvInfo()).toBeNull();
    core.register({ projectId: 'test', reportUrl: '/api/track' });

    expect(core.getEnvInfo()).toEqual(
      expect.objectContaining({
        userAgent: expect.any(String),
        browser: expect.any(String),
        os: expect.any(String),
        screenWidth: expect.any(Number),
        viewportWidth: expect.any(Number),
        url: expect.any(String),
        uid: expect.any(String),
      }),
    );
  });

  it('does not report when sampleRate is zero', () => {
    const core = new TraceCore();
    const reporter = { report: vi.fn() };

    core.setReporter(reporter);
    core.register({
      projectId: 'test',
      reportUrl: '/api/track',
      sampleRate: 0,
    });
    core.trackEvent('click');

    expect(reporter.report).not.toHaveBeenCalled();
  });

  it('uses random sampling for rates between zero and one', () => {
    const core = new TraceCore();
    const reporter = { report: vi.fn() };
    const random = vi.spyOn(Math, 'random');

    core.setReporter(reporter);
    core.register({
      projectId: 'test',
      reportUrl: '/api/track',
      sampleRate: 0.5,
    });

    random.mockReturnValueOnce(0.8).mockReturnValueOnce(0.2);
    core.trackEvent('discarded');
    core.trackEvent('accepted');

    expect(reporter.report).toHaveBeenCalledTimes(1);
    expect(reporter.report).toHaveBeenCalledWith(expect.objectContaining({ eventName: 'accepted' }));
    random.mockRestore();
  });

  it('contains invalid input and reports it through onError', () => {
    const onError = vi.fn();
    const core = new TraceCore();

    core.register({
      projectId: 'test',
      reportUrl: '/api/track',
      hooks: { onError },
    });

    expect(() => core.trackEvent('', [])).not.toThrow();
    expect(onError).toHaveBeenCalledWith(expect.any(TypeError), 'trackEvent');
  });

  it('contains exceptions from config accessors during register', () => {
    const onError = vi.fn();
    const core = new TraceCore();
    core.register({ projectId: 'test', reportUrl: '/api/track', hooks: { onError } });
    const invalidConfig = { projectId: 'next', reportUrl: '/next' };
    Object.defineProperty(invalidConfig, 'hooks', {
      get() {
        throw new Error('getter boom');
      },
    });

    expect(() => core.register(invalidConfig)).not.toThrow();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'register');
  });

  it('isolates stored configuration from hooks and later hook replacement', () => {
    const core = new TraceCore();
    const reporter = { report: vi.fn() };
    const hooks: TraceLifecycleHooks = {
      onReady(config) {
        const mutableConfig = config as ResolvedTraceConfig;
        mutableConfig.projectId = 'mutated';
        mutableConfig.sampleRate = 0;
      },
    };

    core.setReporter(reporter);
    core.register({ projectId: 'original', reportUrl: '/api/track', hooks });
    hooks.onBeforeTrack = () => false;
    core.trackEvent('still-reported');

    expect(core.getConfig()).toEqual(expect.objectContaining({ projectId: 'original', sampleRate: 1 }));
    expect(reporter.report).toHaveBeenCalledWith(expect.objectContaining({ eventName: 'still-reported' }));
  });

  it('contains reporter and lifecycle errors', () => {
    const core = new TraceCore();
    const onTrack = vi.fn(() => {
      throw new Error('hook failed');
    });
    const onError = vi.fn(() => {
      throw new Error('error hook failed');
    });

    core.register({
      projectId: 'test',
      reportUrl: '/api/track',
      hooks: { onTrack, onError },
    });
    core.setReporter({
      report() {
        throw new Error('report failed');
      },
    });

    expect(() => core.trackEvent('safe_event')).not.toThrow();
    expect(onTrack).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalled();
  });

  it('overwrites config on repeated register', () => {
    const core = new TraceCore();

    core.register({ projectId: 'first', reportUrl: '/first' });
    core.register({ projectId: 'second', reportUrl: '/second', sampleRate: 0.5 });

    expect(core.getConfig()).toEqual(
      expect.objectContaining({
        projectId: 'second',
        reportUrl: '/second',
        sampleRate: 0.5,
      }),
    );
  });
});
