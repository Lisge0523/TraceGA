import type { EnvInfo } from '../types';
import { generateUUID, parseUserAgent } from '../utils';

const UID_STORAGE_KEY = '__tracega_uid__';
let memoryUid = '';

function getUid(): string {
  if (memoryUid) {
    return memoryUid;
  }

  try {
    const storedUid = globalThis.localStorage?.getItem(UID_STORAGE_KEY);
    if (storedUid) {
      memoryUid = storedUid;
      return storedUid;
    }

    memoryUid = generateUUID();
    globalThis.localStorage?.setItem(UID_STORAGE_KEY, memoryUid);
    return memoryUid;
  } catch {
    if (!memoryUid) {
      memoryUid = generateUUID();
    }
    return memoryUid;
  }
}

export function collectEnvInfo(): EnvInfo {
  const hasWindow = typeof window !== 'undefined';
  const hasDocument = typeof document !== 'undefined';
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const parsedUserAgent = parseUserAgent(userAgent);

  return {
    userAgent,
    browser: parsedUserAgent.browser,
    browserVersion: parsedUserAgent.browserVersion,
    os: parsedUserAgent.os,
    osVersion: parsedUserAgent.osVersion,
    screenWidth: hasWindow ? window.screen?.width ?? 0 : 0,
    screenHeight: hasWindow ? window.screen?.height ?? 0 : 0,
    viewportWidth: hasWindow ? window.innerWidth ?? 0 : 0,
    viewportHeight: hasWindow ? window.innerHeight ?? 0 : 0,
    referrer: hasDocument ? document.referrer : '',
    url: hasWindow ? window.location?.href ?? '' : '',
    uid: getUid(),
  };
}
