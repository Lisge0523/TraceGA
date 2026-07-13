import type {
  CommonParams,
  EnvInfo,
  EventPriority,
  ITraceCore,
  ResolvedTraceConfig,
  TraceConfig,
  TraceLifecycleHooks,
  TraceReporter,
  TrackEventData,
  TrackEventParams,
} from '../types';
import { deepClone, isPlainObject } from '../utils';
import { collectEnvInfo } from './env';

const DEFAULT_CONFIG = {
  sampleRate: 1,
  maxBufferSize: 50,
  flushInterval: 3000,
  maxConcurrentRequests: 3,
  enableAutoError: false,
  enableAutoPerformance: false,
  enableDebug: false,
} as const;

export class TraceCore implements ITraceCore {
  private config: ResolvedTraceConfig | null = null;
  private commonParams: CommonParams = Object.create(null) as CommonParams;
  private envInfo: EnvInfo | null = null;
  private reporter: TraceReporter | null = null;

  register(config: TraceConfig): void {
    let hooks: TraceLifecycleHooks | undefined;

    try {
      hooks = this.resolveHooks(config);
      this.assertConfig(config);

      const resolvedConfig = Object.freeze({
        ...DEFAULT_CONFIG,
        projectId: config.projectId.trim(),
        reportUrl: config.reportUrl.trim(),
        sampleRate: this.resolveNumber(config.sampleRate, DEFAULT_CONFIG.sampleRate),
        maxBufferSize: this.resolvePositiveNumber(config.maxBufferSize, DEFAULT_CONFIG.maxBufferSize),
        flushInterval: this.resolvePositiveNumber(config.flushInterval, DEFAULT_CONFIG.flushInterval),
        maxConcurrentRequests: this.resolvePositiveNumber(config.maxConcurrentRequests, DEFAULT_CONFIG.maxConcurrentRequests),
        enableAutoError: config.enableAutoError ?? DEFAULT_CONFIG.enableAutoError,
        enableAutoPerformance: config.enableAutoPerformance ?? DEFAULT_CONFIG.enableAutoPerformance,
        enableDebug: config.enableDebug ?? DEFAULT_CONFIG.enableDebug,
        hooks: Object.freeze(hooks),
      }) as ResolvedTraceConfig;

      this.config = resolvedConfig;
      this.envInfo = collectEnvInfo();
      const configSnapshot = deepClone(resolvedConfig);
      this.runHook(() => resolvedConfig.hooks.onReady?.(configSnapshot), 'onReady');
    } catch (error) {
      // Do not read config again here: an accessor on the caller's object may
      // be the original failure and must never escape the SDK boundary.
      this.handleError(error, 'register', hooks);
    }
  }

  trackEvent(eventName: string, params: TrackEventParams = {}, priority: EventPriority = 'normal'): void {
    try {
      if (!this.config || !this.envInfo) {
        return;
      }

      const normalizedEventName = eventName?.trim();
      if (!normalizedEventName) {
        throw new TypeError('eventName must be a non-empty string');
      }
      if (!isPlainObject(params)) {
        throw new TypeError('params must be a plain object');
      }
      if (!['urgent', 'high', 'normal'].includes(priority)) {
        throw new TypeError('priority must be urgent, high, or normal');
      }
      if (!this.shouldSample()) {
        return;
      }

      let event: TrackEventData = {
        eventName: normalizedEventName,
        timestamp: Date.now(),
        projectId: this.config.projectId,
        priority,
        customParams: deepClone(params),
        commonParams: this.getCommonParams(),
        envInfo: deepClone(this.envInfo),
      };

      const beforeTrackResult = this.config.hooks.onBeforeTrack?.(event);
      if (beforeTrackResult === false) {
        return;
      }
      if (beforeTrackResult) {
        event = beforeTrackResult;
      }

      this.report(event);
      this.runHook(() => this.config?.hooks.onTrack?.(event), 'onTrack');
    } catch (error) {
      this.handleError(error, 'trackEvent');
    }
  }

  addCommonParams(params: CommonParams): void {
    try {
      if (!isPlainObject(params)) {
        throw new TypeError('common params must be a plain object');
      }
      const clonedParams = deepClone(params);
      Object.keys(clonedParams).forEach(key => {
        const descriptor = Object.getOwnPropertyDescriptor(clonedParams, key);
        if (!descriptor || !('value' in descriptor)) {
          throw new TypeError('common params cannot contain accessor properties');
        }

        Object.defineProperty(this.commonParams, key, {
          configurable: true,
          enumerable: true,
          value: descriptor.value,
          writable: true,
        });
      });
    } catch (error) {
      this.handleError(error, 'addCommonParams');
    }
  }

  removeCommonParams(keys: string[]): void {
    try {
      if (!Array.isArray(keys)) {
        throw new TypeError('keys must be an array');
      }
      keys.forEach(key => {
        if (typeof key === 'string') {
          delete this.commonParams[key];
        }
      });
    } catch (error) {
      this.handleError(error, 'removeCommonParams');
    }
  }

  getCommonParams(): CommonParams {
    try {
      return deepClone(this.commonParams);
    } catch (error) {
      this.handleError(error, 'getCommonParams');
      return Object.create(null) as CommonParams;
    }
  }

  setUser(userId: string): void {
    try {
      if (typeof userId !== 'string') {
        throw new TypeError('userId must be a string');
      }
      this.commonParams.user_id = userId;
    } catch (error) {
      this.handleError(error, 'setUser');
    }
  }

  getEnvInfo(): EnvInfo | null {
    try {
      return this.envInfo ? deepClone(this.envInfo) : null;
    } catch (error) {
      this.handleError(error, 'getEnvInfo');
      return null;
    }
  }

  getConfig(): Readonly<ResolvedTraceConfig> | null {
    try {
      return this.config ? deepClone(this.config) : null;
    } catch (error) {
      this.handleError(error, 'getConfig');
      return null;
    }
  }

  setReporter(reporter: TraceReporter | null): void {
    try {
      if (reporter !== null && typeof reporter.report !== 'function') {
        throw new TypeError('reporter must implement report(event)');
      }
      this.reporter = reporter;
    } catch (error) {
      this.handleError(error, 'setReporter');
    }
  }

  private shouldSample(): boolean {
    const sampleRate = this.config?.sampleRate ?? 0;
    if (sampleRate <= 0) {
      return false;
    }
    if (sampleRate >= 1) {
      return true;
    }
    return Math.random() < sampleRate;
  }

  private report(event: TrackEventData): void {
    try {
      const reportResult = this.reporter?.report(event);
      if (reportResult) {
        void Promise.resolve(reportResult).catch(error => {
          this.handleError(error, 'report');
        });
      }
    } catch (error) {
      this.handleError(error, 'report');
    }
  }

  private assertConfig(config: TraceConfig): void {
    if (!config || typeof config !== 'object') {
      throw new TypeError('config is required');
    }
    if (typeof config.projectId !== 'string' || !config.projectId.trim()) {
      throw new TypeError('projectId must be a non-empty string');
    }
    if (typeof config.reportUrl !== 'string' || !config.reportUrl.trim()) {
      throw new TypeError('reportUrl must be a non-empty string');
    }

    const parsedUrl = new URL(config.reportUrl, 'http://tracega.local');
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new TypeError('reportUrl must use http or https');
    }
  }

  private resolveHooks(config: unknown): TraceLifecycleHooks {
    if (!config || typeof config !== 'object') {
      return {};
    }

    const rawHooks = (config as { hooks?: unknown }).hooks;
    if (rawHooks === undefined || rawHooks === null) {
      return {};
    }
    if (!isPlainObject(rawHooks)) {
      throw new TypeError('hooks must be a plain object');
    }

    const { onReady, onBeforeTrack, onTrack, onError } = rawHooks as Partial<TraceLifecycleHooks>;
    const hookEntries = [onReady, onBeforeTrack, onTrack, onError];
    if (hookEntries.some(hook => hook !== undefined && typeof hook !== 'function')) {
      throw new TypeError('hooks must be functions');
    }

    return { onReady, onBeforeTrack, onTrack, onError };
  }

  private resolveNumber(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  private resolvePositiveNumber(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private runHook(callback: () => void, context: string): void {
    try {
      callback();
    } catch (error) {
      this.handleError(error, context);
    }
  }

  private handleError(error: unknown, context: string, hooks?: TraceLifecycleHooks): void {
    try {
      (hooks ?? this.config?.hooks)?.onError?.(error, context);
    } catch {
      // Lifecycle errors must never escape the SDK boundary.
    }
  }
}

export const traceCore = new TraceCore();
