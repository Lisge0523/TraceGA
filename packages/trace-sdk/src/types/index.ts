export type CommonParams = Record<string, unknown>;

export type TrackEventParams = Record<string, unknown>;

export type EventPriority = 'urgent' | 'high' | 'normal';

export interface TraceConfig {
  projectId: string;
  reportUrl: string;
  sampleRate?: number;
  maxBufferSize?: number;
  flushInterval?: number;
  maxConcurrentRequests?: number;
  enableAutoError?: boolean;
  enableAutoPerformance?: boolean;
  enableDebug?: boolean;
  hooks?: TraceLifecycleHooks;
}

export interface ResolvedTraceConfig {
  projectId: string;
  reportUrl: string;
  sampleRate: number;
  maxBufferSize: number;
  flushInterval: number;
  maxConcurrentRequests: number;
  enableAutoError: boolean;
  enableAutoPerformance: boolean;
  enableDebug: boolean;
  hooks: TraceLifecycleHooks;
}

export interface EnvInfo {
  userAgent: string;
  browser: string;
  browserVersion: string;
  os: string;
  osVersion: string;
  screenWidth: number;
  screenHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  referrer: string;
  url: string;
  uid: string;
}

export interface TrackEventData {
  eventName: string;
  timestamp: number;
  projectId: string;
  priority: EventPriority;
  customParams: TrackEventParams;
  commonParams: CommonParams;
  envInfo: EnvInfo;
}

export interface TraceLifecycleHooks {
  onReady?: (config: Readonly<ResolvedTraceConfig>) => void;
  onBeforeTrack?: (event: TrackEventData) => TrackEventData | false | void;
  onTrack?: (event: TrackEventData) => void;
  onError?: (error: unknown, context?: string) => void;
}

export interface TraceReporter {
  report(event: TrackEventData): void | Promise<void>;
}

export interface ITraceCore {
  register(config: TraceConfig): void;
  trackEvent(eventName: string, params?: TrackEventParams, priority?: EventPriority): void;
  addCommonParams(params: CommonParams): void;
  removeCommonParams(keys: string[]): void;
  getCommonParams(): CommonParams;
  setUser(userId: string): void;
  getEnvInfo(): EnvInfo | null;
  getConfig(): Readonly<ResolvedTraceConfig> | null;
  setReporter(reporter: TraceReporter | null): void;
}

export interface TracePlugin {
  name: string;
  install(core: ITraceCore): void;
  uninstall(): void;
}
