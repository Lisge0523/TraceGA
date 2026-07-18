class EventBuffer {
  /**
   * 创建一个指定最大容量的缓冲区。
   *
   * @param maxSize - 缓冲区最大容量，必须为正整数
   */
  constructor(maxSize) {
    if (maxSize <= 0) {
      throw new Error("maxSize must be greater than 0");
    }
    this.maxSize = maxSize;
    this.items = [];
  }
  /**
   * 向缓冲区添加一条数据。
   * 若当前数量已达到最大容量，会先移除最旧的一条数据，再添加新数据。
   *
   * @param item - 待添加的数据
   */
  push(item) {
    if (this.items.length >= this.maxSize) {
      this.pop();
    }
    this.items.push(item);
  }
  /**
   * 移除并返回缓冲区中最旧的一条数据。
   *
   * @returns 最旧的数据，若缓冲区为空则返回 `undefined`
   */
  pop() {
    return this.items.shift();
  }
  /**
   * 返回当前缓冲区中的数据条数。
   *
   * @returns 缓冲区中元素的数量
   */
  size() {
    return this.items.length;
  }
  /**
   * 清空缓冲区中的所有数据。
   */
  clear() {
    this.items = [];
  }
  /**
   * 取出缓冲区中全部数据并以数组形式返回，同时清空缓冲区。
   * 适用于批量上报场景。
   *
   * @returns 包含缓冲区中所有数据的数组（按入队顺序排列）
   */
  takeAll() {
    const all = this.items;
    this.items = [];
    return all;
  }
}

class PriorityScheduler {
  constructor(config) {
    var _a, _b;
    this.maxBufferSize = config.maxBufferSize;
    this.urgentMaxSize = (_a = config.urgentMaxSize) !== null && _a !== void 0 ? _a : config.maxBufferSize;
    this.flushInterval = config.flushInterval;
    this.onFlush = config.onFlush;
    this.idleTimeoutFallback = (_b = config.idleTimeoutFallback) !== null && _b !== void 0 ? _b : 3e3;
    this.timerId = null;
    this.idleId = null;
    this.flushing = false;
    this.persister = config.persister;
    this.limiter = config.limiter;
    this.urgentBuffer = new EventBuffer(this.urgentMaxSize);
    this.highBuffer = new EventBuffer(this.maxBufferSize);
    this.normalBuffer = new EventBuffer(this.maxBufferSize);
    this.scheduleNext();
    this.scheduleIdle();
    this.recoverFailedCache();
  }
  /**
   * 按优先级向对应队列添加一条事件。
   * 若该队列达到容量上限，立即触发全量上报并重置定时器。
   *
   * @param priority - 优先级：`'urgent'` | `'high'` | `'normal'`
   * @param event - 待添加的埋点事件
   */
  add(priority, event) {
    const buffer = this.getBuffer(priority);
    buffer.push(event);
    if (this.shouldThresholdFlush(priority)) {
      this.clearTimer();
      this.doFlushAndSchedule();
    }
  }
  /**
   * 手动立即触发全量上报，取出所有队列数据合并后传递给 `onFlush`。
   * 执行后重置定时器。
   */
  flush() {
    this.clearTimer();
    this.doFlushAndSchedule();
  }
  /**
   * 暂停调度器定时器（不清空缓冲区），供页面隐藏时使用。
   */
  pause() {
    this.clearTimer();
  }
  /**
   * 取出所有队列中的全部数据（不触发上报），用于页面隐藏时通过 sendBeacon 发送。
   *
   * @returns 按 urgent → high → normal 顺序拼接的事件数组
   */
  takeAll() {
    return [
      ...this.urgentBuffer.takeAll(),
      ...this.highBuffer.takeAll(),
      ...this.normalBuffer.takeAll()
    ];
  }
  /**
   * 销毁调度器，清除定时器、空闲回调并清空所有缓冲区。
   */
  destroy() {
    this.clearTimer();
    this.cancelIdle();
    this.urgentBuffer.clear();
    this.highBuffer.clear();
    this.normalBuffer.clear();
  }
  // ─── 定时器 ────────────────────────────────────────
  /**
   * 安排下一次定时全量上报。
   */
  scheduleNext() {
    this.timerId = setTimeout(() => {
      this.doScheduledFlush();
    }, this.flushInterval);
  }
  /**
   * 清除当前定时器。
   */
  clearTimer() {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }
  /**
   * 初始化时检查 localStorage 残留缓存，若存在则立即以 urgent 优先级补发。
   * 补发后清除缓存，防止重复上报。
   */
  recoverFailedCache() {
    if (!this.persister)
      return;
    const cached = this.persister.load("trace_failed_cache");
    if (!cached)
      return;
    const events = Array.isArray(cached) ? cached : [cached];
    for (const event of events) {
      this.urgentBuffer.push(event);
    }
    this.persister.clear("trace_failed_cache");
    if (this.urgentBuffer.size() > 0) {
      this.clearTimer();
      this.doFlushAndSchedule();
    }
  }
  /**
   * 定时触发的全量上报，完成后安排下一次。
   * 上报失败静默处理（已在 transporter 中完成重试/缓存）。
   */
  async doScheduledFlush() {
    try {
      await this.doFlush();
    } catch (_a) {
    }
    this.scheduleNext();
  }
  /**
   * 阈值/手动触发后的全量上报，完成后重新安排定时器。
   * 上报失败静默处理（已在 transporter 中完成重试/缓存）。
   */
  async doFlushAndSchedule() {
    try {
      await this.doFlush();
    } catch (_a) {
    }
    this.scheduleNext();
  }
  // ─── 空闲调度 ──────────────────────────────────────
  /**
   * 注册空闲回调：使用 `requestIdleCallback`，降级为 `setTimeout`。
   */
  scheduleIdle() {
    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      this.idleId = window.requestIdleCallback((deadline) => this.onIdle(deadline), { timeout: this.idleTimeoutFallback });
    } else {
      this.idleId = setTimeout(() => {
        this.onIdleFallback();
      }, this.idleTimeoutFallback);
    }
  }
  /**
   * 取消当前空闲回调。
   */
  cancelIdle() {
    if (this.idleId !== null) {
      if (typeof window !== "undefined" && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(this.idleId);
      } else {
        clearTimeout(this.idleId);
      }
      this.idleId = null;
    }
  }
  /**
   * 空闲回调：仅取出 normal 队列数据上报，upper 级别不受影响。
   */
  async onIdle(_deadline) {
    await this.flushNormalOnly();
    this.scheduleIdle();
  }
  /**
   * 降级方案的空闲回调（setTimeout 模式）。
   */
  async onIdleFallback() {
    await this.flushNormalOnly();
    this.scheduleIdle();
  }
  /**
   * 仅上报 normal 队列数据，不触及 urgent/high。
   */
  async flushNormalOnly() {
    var _a, _b;
    if (this.flushing)
      return;
    const events = this.normalBuffer.takeAll();
    if (events.length === 0)
      return;
    this.flushing = true;
    try {
      await ((_a = this.limiter) === null || _a === void 0 ? void 0 : _a.acquire());
      try {
        await this.onFlush(events);
      } finally {
        (_b = this.limiter) === null || _b === void 0 ? void 0 : _b.release();
      }
    } finally {
      this.flushing = false;
    }
  }
  // ─── 全量上报 ──────────────────────────────────────
  /**
   * 执行全量上报：按 urgent → high → normal 顺序拼接所有队列数据。
   * 使用 `flushing` 锁防止并发。
   */
  async doFlush() {
    var _a, _b;
    if (this.flushing)
      return;
    const events = [
      ...this.urgentBuffer.takeAll(),
      ...this.highBuffer.takeAll(),
      ...this.normalBuffer.takeAll()
    ];
    if (events.length === 0)
      return;
    this.flushing = true;
    try {
      await ((_a = this.limiter) === null || _a === void 0 ? void 0 : _a.acquire());
      try {
        await this.onFlush(events);
      } finally {
        (_b = this.limiter) === null || _b === void 0 ? void 0 : _b.release();
      }
    } finally {
      this.flushing = false;
    }
  }
  // ─── 辅助 ──────────────────────────────────────────
  /**
   * 根据优先级返回对应的缓冲区。
   */
  getBuffer(priority) {
    switch (priority) {
      case "urgent":
        return this.urgentBuffer;
      case "high":
        return this.highBuffer;
      case "normal":
        return this.normalBuffer;
    }
  }
  /**
   * 判断对应优先级队列是否已达到阈值，应触发全量上报。
   */
  shouldThresholdFlush(priority) {
    switch (priority) {
      case "urgent":
        return this.urgentBuffer.size() >= this.urgentMaxSize;
      case "high":
        return this.highBuffer.size() >= this.maxBufferSize;
      case "normal":
        return this.normalBuffer.size() >= this.maxBufferSize;
    }
  }
}

class TimeoutError extends Error {
  constructor(timeout) {
    super(`\u8BF7\u6C42\u8D85\u65F6\uFF1A${timeout}ms`);
    this.name = "TimeoutError";
  }
}
class HttpTransporter {
  constructor(config) {
    var _a, _b;
    this.baseURL = config.baseURL;
    this.headers = (_a = config.headers) !== null && _a !== void 0 ? _a : {};
    this.timeout = (_b = config.timeout) !== null && _b !== void 0 ? _b : 1e4;
    this.maxRetries = 3;
    this.retryDelays = [1e3, 2e3, 4e3];
    this.persister = config.persister;
    this.listeners = /* @__PURE__ */ new Map();
  }
  /**
   * 注册事件监听器。
   *
   * @param event - 事件类型：`'success'` | `'failed'` | `'retry'`
   * @param callback - 回调函数，接收事件元数据
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }
  /**
   * 移除事件监听器。
   *
   * @param event - 事件类型
   * @param callback - 要移除的回调函数引用
   */
  off(event, callback) {
    const cbs = this.listeners.get(event);
    if (!cbs)
      return;
    const idx = cbs.indexOf(callback);
    if (idx !== -1)
      cbs.splice(idx, 1);
  }
  /**
   * 发送数据到服务端，失败时自动重试。
   *
   * @param data - 待发送的 JSON 数据
   * @param eventCount - 本次上报的事件数量，用于 success 钩子，默认 1
   * @returns 请求成功时 resolve 的 Promise
   * @throws 全部重试失败后 reject 最终错误
   */
  send(data, eventCount = 1) {
    const startTime = Date.now();
    return this.requestWithRetry(data, 0, startTime, eventCount);
  }
  /**
   * 触发事件，通知所有注册的监听器。
   */
  emit(event, meta) {
    const cbs = this.listeners.get(event);
    if (!cbs)
      return;
    for (const cb of cbs) {
      try {
        cb(meta);
      } catch (_a) {
      }
    }
  }
  /**
   * 带重试的请求执行。
   *
   * @param data - 待发送的数据
   * @param attempt - 当前尝试次数（从 0 开始）
   * @param startTime - 请求开始时间戳
   * @param eventCount - 事件数量
   */
  async requestWithRetry(data, attempt, startTime, eventCount) {
    var _a;
    try {
      await this.doRequest(data);
      this.emit("success", {
        eventCount,
        duration: Date.now() - startTime
      });
    } catch (error) {
      if (attempt < this.maxRetries) {
        const delay = this.retryDelays[attempt];
        this.emit("retry", {
          currentRetry: attempt + 1,
          delay
        });
        await this.delay(delay);
        return this.requestWithRetry(data, attempt + 1, startTime, eventCount);
      }
      this.emit("failed", {
        error,
        retryTimes: this.maxRetries
      });
      (_a = this.persister) === null || _a === void 0 ? void 0 : _a.save("trace_failed_cache", data);
      throw error;
    }
  }
  /**
   * 执行单次 HTTP 请求，带超时控制。
   *
   * @param data - 待发送的 JSON 数据
   */
  async doRequest(data) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    try {
      const response = await fetch(this.baseURL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.headers
        },
        body: JSON.stringify(data),
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      if (error.name === "AbortError") {
        throw new TimeoutError(this.timeout);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  /**
   * 返回一个在指定毫秒后 resolve 的 Promise。
   *
   * @param ms - 延迟毫秒数
   */
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

const MAX_BEACON_PAYLOAD = 60 * 1024;
class LifecycleManager {
  constructor(config) {
    this.reportUrl = config.reportUrl;
    this.getRemainingEvents = config.getRemainingEvents;
    this.pauseScheduler = config.pauseScheduler;
    this.destroyScheduler = config.destroyScheduler;
    this.onVisibilityChange = null;
    this.onPageHide = null;
    this.bindEvents();
  }
  /**
   * 绑定 visibilitychange 和 pagehide 事件。
   */
  bindEvents() {
    if (typeof document === "undefined")
      return;
    this.onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        this.handlePageHidden();
      }
    };
    this.onPageHide = () => {
      this.handlePageHidden();
    };
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    window.addEventListener("pagehide", this.onPageHide);
  }
  /**
   * 页面隐藏时的处理逻辑：暂停调度器 → 取出剩余数据 → 通过 sendBeacon/keepalive 发送。
   */
  handlePageHidden() {
    this.pauseScheduler();
    const events = this.getRemainingEvents();
    if (events.length === 0)
      return;
    this.sendWithBeacon(events);
  }
  /**
   * 使用 sendBeacon 发送事件数据，超长时分片。
   * 若 sendBeacon 不可用，降级为 fetch + keepalive。
   */
  sendWithBeacon(events) {
    const isBeaconAvailable = typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function";
    const json = JSON.stringify(events);
    if (json.length <= MAX_BEACON_PAYLOAD) {
      if (isBeaconAvailable) {
        navigator.sendBeacon(this.reportUrl, new Blob([json], { type: "application/json" }));
      } else {
        this.sendKeepalive(json);
      }
      return;
    }
    const chunks = this.chunkEvents(events);
    for (const chunk of chunks) {
      const chunkJson = JSON.stringify(chunk);
      if (isBeaconAvailable) {
        navigator.sendBeacon(this.reportUrl, new Blob([chunkJson], { type: "application/json" }));
      } else {
        this.sendKeepalive(chunkJson);
      }
    }
  }
  /**
   * 将事件数组按 60KB 限制分片。
   * 每个分片尽量装填事件，直到加上下一条会超出 60KB 为止。
   */
  chunkEvents(events) {
    const chunks = [];
    let current = [];
    let currentSize = 0;
    for (const event of events) {
      const eventSize = JSON.stringify(event).length;
      if (currentSize + eventSize > MAX_BEACON_PAYLOAD && current.length > 0) {
        chunks.push(current);
        current = [];
        currentSize = 0;
      }
      current.push(event);
      currentSize += eventSize;
    }
    if (current.length > 0) {
      chunks.push(current);
    }
    return chunks;
  }
  /**
   * 降级方案：使用 fetch + keepalive 发送数据。
   */
  sendKeepalive(json) {
    try {
      fetch(this.reportUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: json,
        keepalive: true
      });
    } catch (_a) {
    }
  }
  /**
   * 解绑事件并销毁调度器。
   */
  destroy() {
    if (typeof document !== "undefined") {
      if (this.onVisibilityChange) {
        document.removeEventListener("visibilitychange", this.onVisibilityChange);
      }
      if (this.onPageHide) {
        window.removeEventListener("pagehide", this.onPageHide);
      }
    }
    this.destroyScheduler();
  }
}

class StoragePersister {
  /**
   * 将数据序列化为 JSON 并存入 localStorage。
   *
   * @param key - 存储键名
   * @param data - 待存储的数据（需可序列化）
   * @returns 存储成功返回 `true`，QuotaExceeded 或序列化异常时返回 `false`
   */
  save(key, data) {
    try {
      const json = JSON.stringify(data);
      localStorage.setItem(key, json);
      return true;
    } catch (error) {
      if (error.name === "QuotaExceededError" || error.code === 22) {
        return false;
      }
      return false;
    }
  }
  /**
   * 从 localStorage 读取并反序列化数据。
   *
   * @param key - 存储键名
   * @returns 反序列化后的数据，不存在或异常时返回 `null`
   */
  load(key) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null)
        return null;
      return JSON.parse(raw);
    } catch (_a) {
      return null;
    }
  }
  /**
   * 删除指定键的数据。
   *
   * @param key - 存储键名
   */
  clear(key) {
    try {
      localStorage.removeItem(key);
    } catch (_a) {
    }
  }
}

class ConcurrencyLimiter {
  /**
   * @param maxConcurrent - 最大并发数（必须 >= 1）
   */
  constructor(maxConcurrent) {
    if (maxConcurrent < 1) {
      throw new Error("maxConcurrent must be at least 1");
    }
    this.maxConcurrent = maxConcurrent;
    this.active = 0;
    this.waitQueue = [];
  }
  /**
   * 获取一个执行槽位。
   * 若当前活跃数已满，则返回一个 pending 的 Promise，等待释放后唤醒。
   *
   * @returns 获取到槽位时 resolve 的 Promise
   */
  acquire() {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waitQueue.push(() => {
        this.active++;
        resolve();
      });
    });
  }
  /**
   * 释放一个执行槽位，并唤醒等待队列中的下一个（若存在）。
   */
  release() {
    if (this.active > 0) {
      this.active--;
    }
    const next = this.waitQueue.shift();
    if (next) {
      next();
    }
  }
  /**
   * 返回当前活跃的请求数。
   */
  getActiveCount() {
    return this.active;
  }
  /**
   * 返回当前排队等待的请求数。
   */
  getWaitingCount() {
    return this.waitQueue.length;
  }
}

const DEFAULT_CONFIG = {
  sampleRate: 1,
  maxBufferSize: 30,
  flushInterval: 5e3
};
class Reporter {
  constructor(config) {
    this.commonParams = {};
    this.listeners = /* @__PURE__ */ new Map();
    this.registered = false;
    if (config) {
      this.register(config);
    }
  }
  /**
   * 注册（或重新注册）Reporter，初始化所有子模块。
   * 若已注册会先销毁旧实例。
   */
  register(config) {
    if (this.registered) {
      this.destroy();
    }
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.commonParams = {};
    this.envInfo = this.collectEnvInfo();
    this.persister = new StoragePersister();
    this.limiter = new ConcurrencyLimiter(5);
    this.transporter = new HttpTransporter({
      baseURL: this.config.reportUrl,
      timeout: 1e4,
      persister: this.persister
    });
    this.transporter.on("success", (meta) => this.emit("success", meta));
    this.transporter.on("failed", (meta) => this.emit("failed", meta));
    this.transporter.on("retry", (meta) => this.emit("retry", meta));
    this.scheduler = new PriorityScheduler({
      maxBufferSize: this.config.maxBufferSize,
      flushInterval: this.config.flushInterval,
      onFlush: async (events) => {
        await this.transporter.send(events, events.length);
      },
      persister: this.persister,
      limiter: this.limiter
    });
    this.lifecycle = new LifecycleManager({
      reportUrl: this.config.reportUrl,
      getRemainingEvents: () => this.scheduler.takeAll(),
      pauseScheduler: () => this.scheduler.pause(),
      destroyScheduler: () => this.scheduler.destroy()
    });
    this.registered = true;
  }
  /**
   * 注册事件监听器，支持 `'success'`、`'failed'`、`'retry'` 三种事件。
   *
   * @param event - 事件类型
   * @param callback - 回调函数
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }
  /**
   * 移除事件监听器。
   */
  off(event, callback) {
    const cbs = this.listeners.get(event);
    if (!cbs)
      return;
    const idx = cbs.indexOf(callback);
    if (idx !== -1)
      cbs.splice(idx, 1);
  }
  /**
   * 触发事件，通知所有注册的监听器。
   */
  emit(event, meta) {
    const cbs = this.listeners.get(event);
    if (!cbs)
      return;
    for (const cb of cbs) {
      try {
        cb(meta);
      } catch (_a) {
      }
    }
  }
  /**
   * 埋点上报：组装 TrackEventData 并以 normal 优先级入队。
   *
   * @param eventName - 事件名称
   * @param params - 自定义参数
   */
  trackEvent(eventName, params) {
    if (!this.registered)
      return;
    if (this.config.sampleRate !== void 0 && this.config.sampleRate < 1 && Math.random() > this.config.sampleRate) {
      return;
    }
    const event = {
      eventName,
      timestamp: Date.now(),
      customParams: params !== null && params !== void 0 ? params : {},
      commonParams: { ...this.commonParams },
      envInfo: this.envInfo
    };
    this.scheduler.add("normal", event);
  }
  /**
   * 添加公共参数，后续所有 trackEvent 调用都会携带。
   */
  addCommonParams(params) {
    Object.assign(this.commonParams, params);
  }
  /**
   * 移除指定 key 的公共参数。
   */
  removeCommonParams(keys) {
    for (const key of keys) {
      delete this.commonParams[key];
    }
  }
  /**
   * 设置用户 ID，会同时更新 envInfo 和公共参数。
   */
  setUser(userId) {
    this.envInfo.uid = userId;
    this.commonParams["uid"] = userId;
  }
  /**
   * 获取当前环境信息。
   */
  getEnvInfo() {
    return { ...this.envInfo };
  }
  /**
   * 手动立即刷新上报所有缓冲数据。
   */
  flush() {
    var _a;
    (_a = this.scheduler) === null || _a === void 0 ? void 0 : _a.flush();
  }
  /**
   * 销毁 Reporter 及所有子模块。
   */
  destroy() {
    var _a;
    (_a = this.lifecycle) === null || _a === void 0 ? void 0 : _a.destroy();
    this.registered = false;
  }
  /**
   * 采集当前浏览器环境信息。
   */
  collectEnvInfo() {
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    return {
      browser: this.detectBrowser(ua),
      os: this.detectOS(ua),
      screen: typeof screen !== "undefined" ? `${screen.width}x${screen.height}` : "",
      viewport: typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : "",
      uid: "",
      url: typeof location !== "undefined" ? location.href : "",
      userAgent: ua
    };
  }
  /**
   * 简易浏览器检测。
   */
  detectBrowser(ua) {
    if (ua.includes("Edg/"))
      return "Edge";
    if (ua.includes("Chrome/"))
      return "Chrome";
    if (ua.includes("Firefox/"))
      return "Firefox";
    if (ua.includes("Safari/") && !ua.includes("Chrome/"))
      return "Safari";
    return "Unknown";
  }
  /**
   * 简易操作系统检测。
   */
  detectOS(ua) {
    if (ua.includes("Windows"))
      return "Windows";
    if (ua.includes("Mac OS"))
      return "macOS";
    if (ua.includes("Linux"))
      return "Linux";
    if (ua.includes("Android"))
      return "Android";
    if (ua.includes("iPhone") || ua.includes("iPad"))
      return "iOS";
    return "Unknown";
  }
}

const reporterVersion = "0.0.1";
const pluginVersion = "0.0.1";
const utilsVersion = "0.0.1";

export { Reporter, pluginVersion, reporterVersion, utilsVersion };
//# sourceMappingURL=index.esm.js.map
