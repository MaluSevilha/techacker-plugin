// Estado global por aba
const tabData = {};

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
      redirectAttempts: []
    },
    pageUrl: "",
    pageHost: ""
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

function isThirdParty(requestHost, pageHost) {
  if (!requestHost || !pageHost) return false;
  const getBaseDomain = host => {
    const parts = host.split(".");
    return parts.slice(-2).join(".");
  };
  return getBaseDomain(requestHost) !== getBaseDomain(pageHost);
}

// Lista de domínios conhecidos de tracking/ad networks para heurística de cookie syncing
const KNOWN_TRACKERS = new Set([
  "doubleclick.net", "googlesyndication.com", "googleadservices.com",
  "facebook.com", "fbcdn.net", "amazon-adsystem.com", "scorecardresearch.com",
  "quantserve.com", "outbrain.com", "taboola.com", "criteo.com",
  "rubiconproject.com", "pubmatic.com", "openx.net", "appnexus.com",
  "adsymptotic.com", "mediamath.com", "adform.net", "turn.com",
  "rlcdn.com", "nexac.com", "casalemedia.com", "adnxs.com", "adsrvr.org"
]);

function isKnownTracker(host) {
  for (const tracker of KNOWN_TRACKERS) {
    if (host === tracker || host.endsWith("." + tracker)) return true;
  }
  return false;
}

// Monitoramento de conexões de terceira parte
browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    const { tabId, url, type, originUrl } = details;
    if (tabId < 0) return;

    const pageHost = tabData[tabId]?.pageHost || getHostname(originUrl || "");
    const requestHost = getHostname(url);

    if (!tabData[tabId]) initTab(tabId);

    if (pageHost && isThirdParty(requestHost, pageHost)) {
      if (!tabData[tabId].thirdPartyDomains[requestHost]) {
        tabData[tabId].thirdPartyDomains[requestHost] = new Set();
      }
      tabData[tabId].thirdPartyDomains[requestHost].add(type);
    }

    // Detecção de redirecionamentos suspeitos (hijacking)
    if (type === "main_frame" && details.documentUrl && details.documentUrl !== url) {
      const origHost = getHostname(details.documentUrl);
      const newHost = getHostname(url);
      if (origHost && newHost && origHost !== newHost) {
        tabData[tabId].hijacking.redirectAttempts.push({
          from: details.documentUrl,
          to: url,
          timestamp: new Date().toISOString()
        });
      }
    }

    // Detecção de scripts suspeitos de terceira parte (hijacking)
    if (type === "script" && isThirdParty(requestHost, pageHost)) {
      if (isKnownTracker(requestHost)) {
        tabData[tabId].hijacking.suspiciousScripts.push({
          url: url,
          host: requestHost,
          reason: "Known tracker network"
        });
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["requestBody"]
);

// Monitoramento de cookies
browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    const { tabId, url, responseHeaders } = details;
    if (tabId < 0 || !tabData[tabId]) return;

    const pageHost = tabData[tabId].pageHost;
    const requestHost = getHostname(url);
    const thirdParty = isThirdParty(requestHost, pageHost);
    const now = Date.now() / 1000;

    for (const header of responseHeaders) {
      if (header.name.toLowerCase() !== "set-cookie") continue;

      const cookieStr = header.value;
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

      // Detecção de HSTS supercookies (via Strict-Transport-Security com includeSubDomains)
      for (const h of responseHeaders) {
        if (h.name.toLowerCase() === "strict-transport-security" &&
            /includesubdomains/i.test(h.value)) {
          tabData[tabId].cookies.supercookies.push({
            type: "HSTS",
            domain: requestHost,
            header: h.value
          });
        }
        // ETags como supercookies (presença de ETag em respostas de terceiros)
        if (h.name.toLowerCase() === "etag" && thirdParty) {
          tabData[tabId].cookies.supercookies.push({
            type: "ETag",
            domain: requestHost,
            value: h.value.substring(0, 64)
          });
        }
      }
    }

    // Detecção de cookie syncing: redirecionamentos entre dois trackers conhecidos com parâmetros de ID
    const syncParams = ["uid", "userid", "user_id", "id", "uuid", "sync", "match", "cm_id", "gdpr_consent"];
    try {
      const urlObj = new URL(url);
      const hasIdParam = syncParams.some(p => urlObj.searchParams.has(p));
      if (hasIdParam && thirdParty && isKnownTracker(requestHost)) {
        const referrer = details.responseHeaders.find(h => h.name.toLowerCase() === "referer");
        const refHost = referrer ? getHostname(referrer.value) : "";
        if (refHost && isKnownTracker(refHost) && refHost !== requestHost) {
          tabData[tabId].cookieSyncing.push({
            from: refHost,
            to: requestHost,
            url: url.substring(0, 200),
            timestamp: new Date().toISOString()
          });
        }
      }
    } catch {}
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

    case "STORAGE_DATA":
      tabData[tabId].storage.localStorage = message.localStorage || [];
      tabData[tabId].storage.sessionStorage = message.sessionStorage || [];
      tabData[tabId].storage.indexedDB = message.indexedDB || [];
      break;

    case "FINGERPRINTING_ATTEMPT":
      const { api, method } = message;
      if (api === "canvas") {
        tabData[tabId].fingerprinting.canvas.push({ method, timestamp: new Date().toISOString() });
      } else if (api === "webgl") {
        tabData[tabId].fingerprinting.webgl.push({ method, timestamp: new Date().toISOString() });
      } else if (api === "audioContext") {
        tabData[tabId].fingerprinting.audioContext.push({ method, timestamp: new Date().toISOString() });
      }
      break;
  }
});

// Inicializar aba ao navegar
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
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
 * Calcula o Privacy Score (0–100) baseado na metodologia definida pelo grupo.
 *
 * Metodologia (ver README para detalhes):
 *  - Começa com 100 pontos
 *  - Cada domínio de terceira parte exclusivo: -3 pts (máx -30)
 *  - Cada script de terceira parte suspeito: -5 pts (máx -20)
 *  - Cookies de terceira parte: -4 por cookie (máx -20)
 *  - Cookies persistentes de terceira parte: -2 extras por cookie (máx -10)
 *  - Supercookies: -5 por ocorrência (máx -15)
 *  - Itens em localStorage de terceiros: -3 por item (máx -15)
 *  - Itens em IndexedDB: -2 por item (máx -10)
 *  - Detecções de fingerprinting Canvas: -5 (máx -15)
 *  - Detecções de fingerprinting WebGL: -5 (máx -10)
 *  - Detecções de fingerprinting AudioContext: -5 (máx -10)
 *  - Cookie syncing detectado: -10 por par (máx -20)
 *  - Tentativas de redirecionamento: -10 por tentativa (máx -20)
 */
function computePrivacyScore(data) {
  let score = 100;
  const penalties = [];

  // Terceira parte
  const tpDomains = Object.keys(data.thirdPartyDomains).length;
  const tpPenalty = Math.min(tpDomains * 3, 30);
  if (tpPenalty > 0) penalties.push(`Domínios de terceira parte: -${tpPenalty}`);
  score -= tpPenalty;

  // Scripts suspeitos
  const suspPenalty = Math.min(data.hijacking.suspiciousScripts.length * 5, 20);
  if (suspPenalty > 0) penalties.push(`Scripts suspeitos: -${suspPenalty}`);
  score -= suspPenalty;

  // Cookies de terceira parte
  const tpCookiePenalty = Math.min(data.cookies.thirdParty.length * 4, 20);
  if (tpCookiePenalty > 0) penalties.push(`Cookies de terceira parte: -${tpCookiePenalty}`);
  score -= tpCookiePenalty;

  // Cookies persistentes de terceira parte
  const persistTp = data.cookies.persistent.filter(c => c.thirdParty).length;
  const persistPenalty = Math.min(persistTp * 2, 10);
  if (persistPenalty > 0) penalties.push(`Cookies persistentes de terceira parte: -${persistPenalty}`);
  score -= persistPenalty;

  // Supercookies
  const superPenalty = Math.min(data.cookies.supercookies.length * 5, 15);
  if (superPenalty > 0) penalties.push(`Supercookies: -${superPenalty}`);
  score -= superPenalty;

  // Web Storage
  const lsPenalty = Math.min(data.storage.localStorage.length * 3, 15);
  if (lsPenalty > 0) penalties.push(`localStorage: -${lsPenalty}`);
  score -= lsPenalty;

  const idbPenalty = Math.min(data.storage.indexedDB.length * 2, 10);
  if (idbPenalty > 0) penalties.push(`IndexedDB: -${idbPenalty}`);
  score -= idbPenalty;

  // Fingerprinting
  const canvasPenalty = Math.min(data.fingerprinting.canvas.length > 0 ? 5 : 0, 15);
  if (canvasPenalty > 0) penalties.push(`Canvas fingerprinting: -${canvasPenalty}`);
  score -= canvasPenalty;

  const webglPenalty = Math.min(data.fingerprinting.webgl.length > 0 ? 5 : 0, 10);
  if (webglPenalty > 0) penalties.push(`WebGL fingerprinting: -${webglPenalty}`);
  score -= webglPenalty;

  const audioPenalty = Math.min(data.fingerprinting.audioContext.length > 0 ? 5 : 0, 10);
  if (audioPenalty > 0) penalties.push(`AudioContext fingerprinting: -${audioPenalty}`);
  score -= audioPenalty;

  // Cookie syncing
  const syncPenalty = Math.min(data.cookieSyncing.length * 10, 20);
  if (syncPenalty > 0) penalties.push(`Cookie syncing: -${syncPenalty}`);
  score -= syncPenalty;

  // Redirecionamentos suspeitos
  const redirPenalty = Math.min(data.hijacking.redirectAttempts.length * 10, 20);
  if (redirPenalty > 0) penalties.push(`Redirecionamentos suspeitos: -${redirPenalty}`);
  score -= redirPenalty;

  score = Math.max(0, Math.min(100, score));

  let label, color;
  if (score >= 80) { label = "Boa privacidade"; color = "#27ae60"; }
  else if (score >= 60) { label = "Privacidade moderada"; color = "#f39c12"; }
  else if (score >= 40) { label = "Privacidade baixa"; color = "#e67e22"; }
  else { label = "Privacidade muito baixa"; color = "#e74c3c"; }

  return { score, label, color, penalties };
}

// Responde às consultas do popup
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_TAB_DATA") {
    browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
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
