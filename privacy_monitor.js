// Estado global por aba
const tabData = {};

// Lista de domínios conhecidos de tracking/ad networks para heurísticas adicionais
const KNOWN_TRACKERS = new Set([
  "doubleclick.net", "googlesyndication.com", "googleadservices.com",
  "facebook.com", "fbcdn.net", "amazon-adsystem.com", "scorecardresearch.com",
  "quantserve.com", "outbrain.com", "taboola.com", "criteo.com",
  "rubiconproject.com", "pubmatic.com", "openx.net", "appnexus.com",
  "adsymptotic.com", "mediamath.com", "adform.net", "turn.com",
  "rlcdn.com", "nexac.com", "casalemedia.com", "adnxs.com", "adsrvr.org"
]);

const COOKIE_SYNC_ID_PARAMS_EXACT = new Set([
  "id", "uid", "uuid", "userid", "user_id", "partnerid", "deviceid",
  "cm_id", "cid", "sid", "guid", "gaid", "gclid", "fbclid", "matchid"
]);

const COOKIE_SYNC_ID_PARAMS_PARTIAL = [
  "sync", "match", "token", "redirect", "redir", "exchange"
];

const PIXEL_RESOURCE_TYPES = new Set(["image", "imageset", "ping", "beacon", "other"]);
const PIXEL_PATH_HINTS = ["pixel", "track", "sync", "match", "collect", "beacon", "cm", "redirect"];

function initTab(tabId) {
  tabData[tabId] = {
    thirdPartyDomains: {},
    cookies: {
      firstParty: [],
      thirdParty: [],
      session: [],
      persistent: [],
      supercookies: []
    },
    storage: {
      localStorage: [],
      sessionStorage: [],
      indexedDB: []
    },
    fingerprinting: {
      canvas: [],
      webgl: [],
      audioContext: []
    },
    cookieSyncing: [],
    hijacking: {
      suspiciousScripts: [],
      redirectAttempts: [],
      hookingAttempts: []
    },
    pageUrl: "",
    pageHost: "",
    _syncKeys: new Set(),
    _hookKeys: new Set(),
    _supercookieKeys: new Set(),
    _storageByFrame: {}
  };
}

// Utils
function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function getBaseDomain(host) {
  if (!host) return "";
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  return parts.slice(-2).join(".");
}

function isThirdParty(requestHost, pageHost) {
  if (!requestHost || !pageHost) return false;
  return getBaseDomain(requestHost) !== getBaseDomain(pageHost);
}

function isKnownTracker(host) {
  for (const tracker of KNOWN_TRACKERS) {
    if (host === tracker || host.endsWith("." + tracker)) return true;
  }
  return false;
}

function hasLikelyIdParam(searchParams) {
  for (const [rawKey, rawValue] of searchParams.entries()) {
    const key = rawKey.toLowerCase();
    const value = String(rawValue || "");

    if (COOKIE_SYNC_ID_PARAMS_EXACT.has(key)) return true;
    if (key.endsWith("_id") || key.endsWith("id")) {
      if (!["width", "height", "grid", "fluid"].includes(key)) return true;
    }
    if (COOKIE_SYNC_ID_PARAMS_PARTIAL.some((token) => key.includes(token))) return true;

    if (value.length >= 10 && /^[a-zA-Z0-9._%-]+$/.test(value)) {
      if (key.includes("id") || key.includes("token")) return true;
    }
  }

  return false;
}

function looksLikeTrackingPixel(details, urlObj) {
  if (!PIXEL_RESOURCE_TYPES.has(details.type)) return false;

  const params = urlObj.searchParams;
  const width = (params.get("w") || params.get("width") || "").trim();
  const height = (params.get("h") || params.get("height") || "").trim();
  const size = (params.get("size") || params.get("sz") || "").toLowerCase().trim();
  const pixelParam = (params.get("pixel") || params.get("px") || "").trim();

  const hasOneByOne =
    (width === "1" && height === "1") ||
    size === "1x1" ||
    size === "1*1" ||
    pixelParam === "1";

  const path = urlObj.pathname.toLowerCase();
  const hasPixelPathHint = PIXEL_PATH_HINTS.some((hint) => path.includes(hint));

  return hasOneByOne || hasPixelPathHint;
}

function addCookieSyncAttempt(tabId, attempt) {
  const key = [attempt.from, attempt.to, attempt.reason, attempt.url].join("|").substring(0, 500);
  if (tabData[tabId]._syncKeys.has(key)) return;

  tabData[tabId]._syncKeys.add(key);
  tabData[tabId].cookieSyncing.push(attempt);
}

function addHookingAttempt(tabId, attempt) {
  const key = [attempt.target, attempt.reason, attempt.frameHost || ""].join("|");
  if (tabData[tabId]._hookKeys.has(key)) return;

  tabData[tabId]._hookKeys.add(key);
  tabData[tabId].hijacking.hookingAttempts.push(attempt);
}

function addSupercookie(tabId, item) {
  const fingerprint = [item.type, item.domain, item.header || "", item.value || ""].join("|").substring(0, 400);
  if (tabData[tabId]._supercookieKeys.has(fingerprint)) return;

  tabData[tabId]._supercookieKeys.add(fingerprint);
  tabData[tabId].cookies.supercookies.push(item);
}

function sanitizeKVStorageItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => item && typeof item.key === "string")
    .map((item) => ({
      key: item.key,
      size: Number(item.size) || 0,
      domain: item.domain || "unknown"
    }));
}

function normalizeStoreRecord(record) {
  return {
    key: String(record?.key ?? "(unknown)"),
    size: Number(record?.size) || 0
  };
}

function normalizeIndexedDBStore(store) {
  const records = Array.isArray(store?.records)
    ? store.records.map(normalizeStoreRecord)
    : [];

  return {
    name: store?.name || "(sem nome)",
    keyPath: store?.keyPath ?? null,
    autoIncrement: Boolean(store?.autoIncrement),
    recordCount: Number(store?.recordCount) || 0,
    estimatedBytes: Number(store?.estimatedBytes) || 0,
    records: records.slice(0, 100),
    error: store?.error || undefined
  };
}

function normalizeIndexedDBEntry(entry) {
  const stores = Array.isArray(entry?.stores)
    ? entry.stores.map(normalizeIndexedDBStore)
    : [];

  const totalRecords = stores.reduce((acc, store) => acc + store.recordCount, 0);
  const totalEstimatedBytes = stores.reduce((acc, store) => acc + store.estimatedBytes, 0);

  return {
    name: entry?.name || "(sem nome)",
    version: entry?.version ?? null,
    domain: entry?.domain || "unknown",
    stores,
    totalRecords,
    totalEstimatedBytes,
    error: entry?.error || undefined
  };
}

function mergeStoreRecords(existingRecords, incomingRecords) {
  const recordsMap = new Map();

  for (const record of [...existingRecords, ...incomingRecords]) {
    const normalized = normalizeStoreRecord(record);
    const key = `${normalized.key}::${normalized.size}`;
    if (!recordsMap.has(key)) {
      recordsMap.set(key, normalized);
    }
  }

  return [...recordsMap.values()].slice(0, 100);
}

function mergeIndexedDBEntries(entries) {
  const dbMap = new Map();

  for (const rawEntry of entries) {
    const db = normalizeIndexedDBEntry(rawEntry);
    const dbKey = `${db.domain}::${db.name}::${db.version ?? "null"}`;

    if (!dbMap.has(dbKey)) {
      dbMap.set(dbKey, db);
      continue;
    }

    const existingDb = dbMap.get(dbKey);
    if (!existingDb.error && db.error) {
      existingDb.error = db.error;
    }

    const storeMap = new Map(existingDb.stores.map((store) => [store.name, store]));

    for (const incomingStore of db.stores) {
      const currentStore = storeMap.get(incomingStore.name);
      if (!currentStore) {
        storeMap.set(incomingStore.name, incomingStore);
        continue;
      }

      currentStore.keyPath = currentStore.keyPath ?? incomingStore.keyPath;
      currentStore.autoIncrement = currentStore.autoIncrement || incomingStore.autoIncrement;
      currentStore.recordCount = Math.max(currentStore.recordCount, incomingStore.recordCount);
      currentStore.estimatedBytes = Math.max(currentStore.estimatedBytes, incomingStore.estimatedBytes);
      currentStore.records = mergeStoreRecords(currentStore.records, incomingStore.records);
      currentStore.error = currentStore.error || incomingStore.error;
    }

    existingDb.stores = [...storeMap.values()];
    existingDb.totalRecords = existingDb.stores.reduce((acc, store) => acc + store.recordCount, 0);
    existingDb.totalEstimatedBytes = existingDb.stores.reduce((acc, store) => acc + store.estimatedBytes, 0);
  }

  return [...dbMap.values()].sort((a, b) => {
    const domainComp = a.domain.localeCompare(b.domain);
    if (domainComp !== 0) return domainComp;
    return a.name.localeCompare(b.name);
  });
}

function dedupeKVStorage(items) {
  const map = new Map();

  for (const item of items) {
    const normalized = {
      key: item.key,
      size: Number(item.size) || 0,
      domain: item.domain || "unknown"
    };

    const id = `${normalized.domain}::${normalized.key}`;
    const current = map.get(id);

    if (!current || normalized.size > current.size) {
      map.set(id, normalized);
    }
  }

  return [...map.values()];
}

function rebuildStorageForTab(tabId) {
  const frameSnapshots = Object.values(tabData[tabId]._storageByFrame);
  const localStorageItems = [];
  const sessionStorageItems = [];
  const indexedDbEntries = [];

  for (const snapshot of frameSnapshots) {
    localStorageItems.push(...snapshot.localStorage);
    sessionStorageItems.push(...snapshot.sessionStorage);
    indexedDbEntries.push(...snapshot.indexedDB);
  }

  tabData[tabId].storage.localStorage = dedupeKVStorage(localStorageItems);
  tabData[tabId].storage.sessionStorage = dedupeKVStorage(sessionStorageItems);
  tabData[tabId].storage.indexedDB = mergeIndexedDBEntries(indexedDbEntries);
}

function detectCookieSyncFromPixel(tabId, details) {
  const pageHost = tabData[tabId].pageHost;
  const requestHost = getHostname(details.url);
  if (!requestHost || !pageHost || !isThirdParty(requestHost, pageHost)) return;

  let urlObj;
  try {
    urlObj = new URL(details.url);
  } catch {
    return;
  }

  if (!hasLikelyIdParam(urlObj.searchParams)) return;
  if (!looksLikeTrackingPixel(details, urlObj)) return;

  const sourceUrl = details.originUrl || details.documentUrl || "";
  const sourceHost = getHostname(sourceUrl);
  if (!sourceHost || sourceHost === requestHost) return;

  // Cookie syncing entre terceiros: origem e destino são ambos terceiras partes da página
  if (!isThirdParty(sourceHost, pageHost) || !isThirdParty(requestHost, pageHost)) return;

  addCookieSyncAttempt(tabId, {
    from: sourceHost,
    to: requestHost,
    url: details.url.substring(0, 240),
    type: details.type,
    reason: "Pixel de rastreamento com parâmetros de ID",
    timestamp: new Date().toISOString()
  });
}

// Monitoramento de conexões de terceira parte
browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    const { tabId, url, type, originUrl } = details;
    if (tabId < 0) return;

    if (!tabData[tabId]) initTab(tabId);

    const pageHost = tabData[tabId].pageHost || getHostname(originUrl || details.documentUrl || "");
    const requestHost = getHostname(url);

    if (pageHost && requestHost && isThirdParty(requestHost, pageHost)) {
      if (!tabData[tabId].thirdPartyDomains[requestHost]) {
        tabData[tabId].thirdPartyDomains[requestHost] = new Set();
      }
      tabData[tabId].thirdPartyDomains[requestHost].add(type);
    }

    // Detecção de scripts suspeitos de terceira parte (hijacking)
    if (type === "script" && requestHost && isThirdParty(requestHost, pageHost) && isKnownTracker(requestHost)) {
      tabData[tabId].hijacking.suspiciousScripts.push({
        url,
        host: requestHost,
        reason: "Known tracker network",
        timestamp: new Date().toISOString()
      });
    }

    detectCookieSyncFromPixel(tabId, details);
  },
  { urls: ["<all_urls>"] },
  ["requestBody"]
);

browser.webRequest.onBeforeRedirect.addListener(
  (details) => {
    const { tabId, url, redirectUrl, type } = details;
    if (tabId < 0 || !redirectUrl) return;
    if (!tabData[tabId]) initTab(tabId);

    // Mantemos o foco em redirecionamentos de navegação/frame
    if (type !== "main_frame" && type !== "sub_frame") return;

    const fromHost = getHostname(url);
    const toHost = getHostname(redirectUrl);
    if (fromHost && toHost && fromHost !== toHost) {
      tabData[tabId].hijacking.redirectAttempts.push({
        from: url,
        to: redirectUrl,
        timestamp: new Date().toISOString()
      });
    }
  },
  { urls: ["<all_urls>"] }
);

// Monitoramento de cookies
browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    const { tabId, url } = details;
    const responseHeaders = details.responseHeaders || [];

    if (tabId < 0 || !tabData[tabId]) return;

    const pageHost = tabData[tabId].pageHost;
    const requestHost = getHostname(url);
    const thirdParty = isThirdParty(requestHost, pageHost);

    const setCookieHeaders = responseHeaders.filter(
      (header) => header.name && header.name.toLowerCase() === "set-cookie"
    );

    for (const header of setCookieHeaders) {
      const cookieStr = header.value || "";
      const isSession = !/expires|max-age/i.test(cookieStr);
      const cookieEntry = {
        raw: cookieStr.substring(0, 200),
        domain: requestHost,
        thirdParty,
        session: isSession,
        timestamp: new Date().toISOString()
      };

      if (thirdParty) {
        tabData[tabId].cookies.thirdParty.push(cookieEntry);
      } else {
        tabData[tabId].cookies.firstParty.push(cookieEntry);
      }

      if (isSession) {
        tabData[tabId].cookies.session.push(cookieEntry);
      } else {
        tabData[tabId].cookies.persistent.push(cookieEntry);
      }
    }

    const hstsHeader = responseHeaders.find(
      (header) => header.name && header.name.toLowerCase() === "strict-transport-security"
    );

    if (hstsHeader && /includesubdomains/i.test(hstsHeader.value || "")) {
      addSupercookie(tabId, {
        type: "HSTS",
        domain: requestHost,
        header: (hstsHeader.value || "").substring(0, 120)
      });
    }

    const etagHeaders = responseHeaders.filter(
      (header) => header.name && header.name.toLowerCase() === "etag"
    );

    if (thirdParty) {
      for (const etagHeader of etagHeaders) {
        addSupercookie(tabId, {
          type: "ETag",
          domain: requestHost,
          value: (etagHeader.value || "").substring(0, 64)
        });
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// Receber mensagens do content script
browser.runtime.onMessage.addListener((message, sender) => {
  const tabId = sender.tab?.id;
  if (!tabId || tabId < 0) return;
  if (!tabData[tabId]) initTab(tabId);

  switch (message.type) {
    case "PAGE_LOAD":
      tabData[tabId].pageUrl = message.url;
      tabData[tabId].pageHost = getHostname(message.url);
      break;

    case "STORAGE_DATA": {
      const frameKey = message.frameUrl || sender.url || `frame_${sender.frameId ?? "unknown"}`;
      tabData[tabId]._storageByFrame[frameKey] = {
        localStorage: sanitizeKVStorageItems(message.localStorage),
        sessionStorage: sanitizeKVStorageItems(message.sessionStorage),
        indexedDB: Array.isArray(message.indexedDB) ? message.indexedDB.map(normalizeIndexedDBEntry) : []
      };

      rebuildStorageForTab(tabId);
      break;
    }

    case "FINGERPRINTING_ATTEMPT": {
      const { api, method } = message;
      const event = { method, timestamp: new Date().toISOString() };

      if (api === "canvas") {
        tabData[tabId].fingerprinting.canvas.push(event);
      } else if (api === "webgl") {
        tabData[tabId].fingerprinting.webgl.push(event);
      } else if (api === "audioContext") {
        tabData[tabId].fingerprinting.audioContext.push(event);
      }
      break;
    }

    case "HOOKING_ATTEMPT": {
      addHookingAttempt(tabId, {
        target: message.target || "desconhecido",
        reason: message.reason || "Substituição de função detectada",
        frameUrl: message.frameUrl || sender.url || "",
        frameHost: getHostname(message.frameUrl || sender.url || ""),
        timestamp: new Date().toISOString()
      });
      break;
    }
  }
});

// Inicializar aba ao navegar
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" && changeInfo.url) {
    initTab(tabId);
    tabData[tabId].pageUrl = changeInfo.url;
    tabData[tabId].pageHost = getHostname(changeInfo.url);
  }
});

browser.tabs.onRemoved.addListener((tabId) => {
  delete tabData[tabId];
});

// API para o popup

/**
 * Calcula o Privacy Score (0–100) e retorna também um breakdown por categoria.
 */
function computePrivacyScore(data) {
  const breakdown = [];

  function addBreakdown(id, label, count, unitPenalty, cap) {
    const penalty = Math.min((count || 0) * unitPenalty, cap);
    breakdown.push({
      id,
      label,
      count: count || 0,
      unitPenalty,
      cap,
      penalty
    });
    return penalty;
  }

  const tpDomains = Object.keys(data.thirdPartyDomains).length;
  const thirdPartyCookies = data.cookies.thirdParty.length;
  const persistentTpCookies = data.cookies.persistent.filter((cookie) => cookie.thirdParty).length;
  const supercookies = data.cookies.supercookies.length;
  const localStorageItems = data.storage.localStorage.length;
  const indexedDbRecords = data.storage.indexedDB.reduce(
    (acc, db) => acc + (Number(db.totalRecords) || 0),
    0
  );

  const canvasEvents = data.fingerprinting.canvas.length;
  const webglEvents = data.fingerprinting.webgl.length;
  const audioEvents = data.fingerprinting.audioContext.length;

  const cookieSyncing = data.cookieSyncing.length;
  const redirectAttempts = data.hijacking.redirectAttempts.length;
  const suspiciousScripts = data.hijacking.suspiciousScripts.length;
  const hookingAttempts = data.hijacking.hookingAttempts.length;

  let totalPenalty = 0;
  totalPenalty += addBreakdown("third_party_domains", "Domínios de terceira parte", tpDomains, 3, 30);
  totalPenalty += addBreakdown("suspicious_scripts", "Scripts suspeitos", suspiciousScripts, 5, 20);
  totalPenalty += addBreakdown("third_party_cookies", "Cookies de terceira parte", thirdPartyCookies, 4, 20);
  totalPenalty += addBreakdown("persistent_tp_cookies", "Cookies persistentes de terceira parte", persistentTpCookies, 2, 10);
  totalPenalty += addBreakdown("supercookies", "Supercookies", supercookies, 5, 15);
  totalPenalty += addBreakdown("local_storage", "localStorage", localStorageItems, 3, 15);
  totalPenalty += addBreakdown("indexeddb_records", "Registros IndexedDB", indexedDbRecords, 1, 10);
  totalPenalty += addBreakdown("canvas_fp", "Canvas fingerprinting", canvasEvents, 5, 15);
  totalPenalty += addBreakdown("webgl_fp", "WebGL fingerprinting", webglEvents, 5, 10);
  totalPenalty += addBreakdown("audio_fp", "AudioContext fingerprinting", audioEvents, 5, 10);
  totalPenalty += addBreakdown("cookie_sync", "Cookie syncing", cookieSyncing, 10, 20);
  totalPenalty += addBreakdown("redirects", "Redirecionamentos suspeitos", redirectAttempts, 10, 20);
  totalPenalty += addBreakdown("hooking", "Hooking de APIs críticas", hookingAttempts, 8, 20);

  const score = Math.max(0, Math.min(100, 100 - totalPenalty));

  let label;
  let color;
  if (score >= 80) {
    label = "Boa privacidade";
    color = "#27ae60";
  } else if (score >= 60) {
    label = "Privacidade moderada";
    color = "#f39c12";
  } else if (score >= 40) {
    label = "Privacidade baixa";
    color = "#e67e22";
  } else {
    label = "Privacidade muito baixa";
    color = "#e74c3c";
  }

  const penalties = breakdown
    .filter((item) => item.penalty > 0)
    .map((item) => `${item.label}: -${item.penalty}`);

  return {
    score,
    label,
    color,
    penalties,
    breakdown,
    totalPenalty
  };
}

// Responde às consultas do popup
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_TAB_DATA") {
    browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      const tabId = tabs[0]?.id;
      if (!tabId || !tabData[tabId]) {
        sendResponse({ error: "Sem dados para esta aba." });
        return;
      }

      const data = tabData[tabId];

      // Serializar Sets para arrays
      const thirdPartyDomains = {};
      for (const [domain, types] of Object.entries(data.thirdPartyDomains)) {
        thirdPartyDomains[domain] = [...types];
      }

      const privacyScore = computePrivacyScore(data);

      sendResponse({
        pageUrl: data.pageUrl,
        thirdPartyDomains,
        cookies: data.cookies,
        storage: data.storage,
        fingerprinting: data.fingerprinting,
        cookieSyncing: data.cookieSyncing,
        hijacking: data.hijacking,
        privacyScore
      });
    });

    return true; // resposta assíncrona
  }
});
