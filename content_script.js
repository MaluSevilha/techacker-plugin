(function () {
  "use strict";

  const IDB_MAX_RECORDS_PER_STORE = 50;

  function safeSendMessage(payload) {
    browser.runtime.sendMessage(payload).catch(() => {});
  }

  // Notifica o background script sobre uso de página (só se for o frame principal)
  if (window === window.top) {
    safeSendMessage({ type: "PAGE_LOAD", url: window.location.href });
  }

  // Hook de Fingerprinting e integridade de APIs críticas via script injetado na página
  const script = document.createElement("script");
  script.textContent = `(function() {
    "use strict";

    const sendEvent = (eventName, detail) => {
      window.dispatchEvent(new CustomEvent(eventName, { detail }));
    };

    const sendFingerprint = (data) => sendEvent("__pm_fp__", data);
    const sendHooking = (data) => sendEvent("__pm_hook__", data);

    // Canvas fingerprinting
    if (window.HTMLCanvasElement && window.HTMLCanvasElement.prototype && window.HTMLCanvasElement.prototype.toDataURL) {
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(...args) {
        sendFingerprint({ api: "canvas", method: "toDataURL" });
        return origToDataURL.apply(this, args);
      };
    }

    if (window.CanvasRenderingContext2D && window.CanvasRenderingContext2D.prototype && window.CanvasRenderingContext2D.prototype.getImageData) {
      const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = function(...args) {
        sendFingerprint({ api: "canvas", method: "getImageData" });
        return origGetImageData.apply(this, args);
      };
    }

    // WebGL fingerprinting
    if (window.WebGLRenderingContext && window.WebGLRenderingContext.prototype) {
      const origGetParameter = WebGLRenderingContext.prototype.getParameter;
      if (origGetParameter) {
        WebGLRenderingContext.prototype.getParameter = function(param) {
          // RENDERER (0x1F01), VENDOR (0x1F00) e valores da extensão debug renderer
          if (param === 0x1F01 || param === 0x1F00 || param === 0x9245 || param === 0x9246) {
            sendFingerprint({ api: "webgl", method: "getParameter(RENDERER/VENDOR)" });
          }
          return origGetParameter.apply(this, arguments);
        };
      }

      const origGetExtension = WebGLRenderingContext.prototype.getExtension;
      if (origGetExtension) {
        WebGLRenderingContext.prototype.getExtension = function(name) {
          if (name === "WEBGL_debug_renderer_info") {
            sendFingerprint({ api: "webgl", method: "getExtension(WEBGL_debug_renderer_info)" });
          }
          return origGetExtension.apply(this, arguments);
        };
      }
    }

    // AudioContext fingerprinting
    if (window.AudioContext || window.webkitAudioContext) {
      const AC = window.AudioContext || window.webkitAudioContext;
      const origCreateOscillator = AC.prototype.createOscillator;
      AC.prototype.createOscillator = function(...args) {
        sendFingerprint({ api: "audioContext", method: "createOscillator" });
        return origCreateOscillator.apply(this, args);
      };
      const origCreateDynamicsCompressor = AC.prototype.createDynamicsCompressor;
      AC.prototype.createDynamicsCompressor = function(...args) {
        sendFingerprint({ api: "audioContext", method: "createDynamicsCompressor" });
        return origCreateDynamicsCompressor.apply(this, args);
      };
    }

    // Baseline para detectar sobrescrita de funções críticas (hooking)
    const original = {
      documentWrite: document.write,
      windowOpen: window.open,
      pushState: history.pushState,
      cookieDescriptor: Object.getOwnPropertyDescriptor(Document.prototype, "cookie")
    };

    const alreadyReported = new Set();
    function reportHook(target, reason) {
      const key = target + "::" + reason;
      if (alreadyReported.has(key)) return;
      alreadyReported.add(key);
      sendHooking({ target, reason });
    }

    function detectHookingChanges() {
      try {
        if (document.write !== original.documentWrite) {
          reportHook("document.write", "Função substituída por implementação customizada");
        }

        if (window.open !== original.windowOpen) {
          reportHook("window.open", "Função substituída por implementação customizada");
        }

        if (history.pushState !== original.pushState) {
          reportHook("history.pushState", "Função substituída por implementação customizada");
        }

        const currentCookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
        if (!currentCookieDescriptor || !original.cookieDescriptor) {
          if (currentCookieDescriptor !== original.cookieDescriptor) {
            reportHook("document.cookie setter", "Descriptor de document.cookie alterado");
          }
        } else if (currentCookieDescriptor.set !== original.cookieDescriptor.set) {
          reportHook("document.cookie setter", "Setter de document.cookie substituído");
        }
      } catch (err) {
        reportHook("hook-detector", "Erro no monitoramento: " + (err && err.message ? err.message : "desconhecido"));
      }
    }

    detectHookingChanges();
    const intervalId = setInterval(detectHookingChanges, 500);
    setTimeout(() => clearInterval(intervalId), 20000);
  })();`;

  (document.head || document.documentElement).appendChild(script);
  script.remove();

  // Ouve os eventos emitidos pelo script injetado
  window.addEventListener("__pm_fp__", (event) => {
    safeSendMessage({
      type: "FINGERPRINTING_ATTEMPT",
      api: event.detail.api,
      method: event.detail.method
    });
  });

  window.addEventListener("__pm_hook__", (event) => {
    safeSendMessage({
      type: "HOOKING_ATTEMPT",
      target: event.detail.target,
      reason: event.detail.reason,
      frameUrl: window.location.href
    });
  });

  function estimateSizeBytes(value) {
    if (value === null || value === undefined) return 0;
    if (typeof value === "string") return value.length;
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
      return String(value).length;
    }
    if (value instanceof ArrayBuffer) return value.byteLength;
    if (ArrayBuffer.isView(value)) return value.byteLength;
    if (typeof Blob !== "undefined" && value instanceof Blob) return value.size;

    try {
      return JSON.stringify(value).length;
    } catch {
      return 0;
    }
  }

  function formatKeyPreview(key) {
    try {
      if (typeof key === "string") return key.substring(0, 80);
      if (typeof key === "number" || typeof key === "boolean" || typeof key === "bigint") {
        return String(key);
      }
      if (key instanceof Date) return key.toISOString();
      return JSON.stringify(key).substring(0, 80);
    } catch {
      return String(key).substring(0, 80);
    }
  }

  function openDatabase(name, version) {
    return new Promise((resolve, reject) => {
      let request;
      try {
        request = typeof version === "number" && Number.isFinite(version)
          ? indexedDB.open(name, version)
          : indexedDB.open(name);
      } catch (err) {
        reject(err);
        return;
      }

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Falha ao abrir IndexedDB"));
      request.onblocked = () => reject(new Error("Abertura do IndexedDB bloqueada"));
    });
  }

  function scanObjectStore(db, storeName) {
    return new Promise((resolve) => {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);

      const summary = {
        name: storeName,
        keyPath: store.keyPath ?? null,
        autoIncrement: Boolean(store.autoIncrement),
        recordCount: 0,
        estimatedBytes: 0,
        records: []
      };

      let captured = 0;
      const cursorRequest = store.openCursor();
      cursorRequest.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) return;

        const recordSize = estimateSizeBytes(cursor.key) + estimateSizeBytes(cursor.value);
        summary.recordCount += 1;
        summary.estimatedBytes += recordSize;

        if (captured < IDB_MAX_RECORDS_PER_STORE) {
          summary.records.push({
            key: formatKeyPreview(cursor.key),
            size: recordSize
          });
          captured += 1;
        }

        cursor.continue();
      };

      cursorRequest.onerror = () => {
        summary.error = "Falha ao iterar registros";
      };

      tx.oncomplete = () => resolve(summary);
      tx.onerror = () => {
        summary.error = summary.error || "Falha na transação do object store";
        resolve(summary);
      };
      tx.onabort = () => {
        summary.error = summary.error || "Transação abortada";
        resolve(summary);
      };
    });
  }

  async function collectIndexedDBData(domain) {
    if (!window.indexedDB || !window.indexedDB.databases) return [];

    let dbList;
    try {
      dbList = await window.indexedDB.databases();
    } catch {
      return [];
    }

    const results = [];
    for (const meta of dbList) {
      if (!meta.name) continue;

      try {
        const db = await openDatabase(meta.name, meta.version);
        const storeNames = Array.from(db.objectStoreNames);
        const stores = [];

        for (const storeName of storeNames) {
          // Ler cada object store em sequência evita estourar recursos em páginas grandes
          const storeSummary = await scanObjectStore(db, storeName);
          stores.push(storeSummary);
        }

        const totalRecords = stores.reduce((acc, store) => acc + store.recordCount, 0);
        const totalEstimatedBytes = stores.reduce((acc, store) => acc + store.estimatedBytes, 0);

        results.push({
          name: db.name || meta.name,
          version: db.version ?? meta.version ?? null,
          domain,
          stores,
          totalRecords,
          totalEstimatedBytes
        });

        db.close();
      } catch (err) {
        results.push({
          name: meta.name,
          version: meta.version ?? null,
          domain,
          stores: [],
          totalRecords: 0,
          totalEstimatedBytes: 0,
          error: err && err.message ? err.message : "Falha ao coletar banco"
        });
      }
    }

    return results;
  }

  // Coleta de Web Storage e IndexedDB
  async function collectStorageData() {
    const domain = window.location.hostname;
    const ls = [];
    const ss = [];

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const val = localStorage.getItem(key);
        ls.push({
          key,
          size: estimateSizeBytes(key) + estimateSizeBytes(val),
          domain
        });
      }
    } catch {}

    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        const val = sessionStorage.getItem(key);
        ss.push({
          key,
          size: estimateSizeBytes(key) + estimateSizeBytes(val),
          domain
        });
      }
    } catch {}

    const indexedDBData = await collectIndexedDBData(domain);

    safeSendMessage({
      type: "STORAGE_DATA",
      frameUrl: window.location.href,
      localStorage: ls,
      sessionStorage: ss,
      indexedDB: indexedDBData
    });
  }

  // Coleta após carregamento
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", collectStorageData, { once: true });
  } else {
    collectStorageData();
  }

  // Recoleta para capturar storage dinâmico
  setTimeout(collectStorageData, 3000);
})();
