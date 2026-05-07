(function () {
  "use strict";

  // Notifica o background script sobre uso de página (só se for o frame principal)
  if (window === window.top) {
    browser.runtime.sendMessage({ type: "PAGE_LOAD", url: window.location.href });
  }

  // Hook de Fingerprinting via script injetado na página (intercepta as APIs)
  const script = document.createElement("script");
  script.textContent = `(function() {
    "use strict";
    const _send = (data) => window.dispatchEvent(new CustomEvent("__pm_fp__", { detail: data }));

    // Canvas fingerprinting
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(...args) {
      _send({ api: "canvas", method: "toDataURL" });
      return origToDataURL.apply(this, args);
    };
    const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function(...args) {
      _send({ api: "canvas", method: "getImageData" });
      return origGetImageData.apply(this, args);
    };

    // WebGL fingerprinting
    const origGetParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(param) {
      // RENDERER (0x1F01) e VENDOR (0x1F00) são usados para fingerprinting
      if (param === 0x1F01 || param === 0x1F00 || param === 0x9245 || param === 0x9246) {
        _send({ api: "webgl", method: "getParameter(RENDERER/VENDOR)" });
      }
      return origGetParameter.apply(this, arguments);
    };

    // WEBGL_debug_renderer_info
    const origGetExtension = WebGLRenderingContext.prototype.getExtension;
    WebGLRenderingContext.prototype.getExtension = function(name) {
      if (name === "WEBGL_debug_renderer_info") {
        _send({ api: "webgl", method: "getExtension(WEBGL_debug_renderer_info)" });
      }
      return origGetExtension.apply(this, arguments);
    };

    // AudioContext fingerprinting
    if (window.AudioContext || window.webkitAudioContext) {
      const AC = window.AudioContext || window.webkitAudioContext;
      const origCreateOscillator = AC.prototype.createOscillator;
      AC.prototype.createOscillator = function(...args) {
        _send({ api: "audioContext", method: "createOscillator" });
        return origCreateOscillator.apply(this, args);
      };
      const origCreateDynamicsCompressor = AC.prototype.createDynamicsCompressor;
      AC.prototype.createDynamicsCompressor = function(...args) {
        _send({ api: "audioContext", method: "createDynamicsCompressor" });
        return origCreateDynamicsCompressor.apply(this, args);
      };
    }
  })();`;

  (document.head || document.documentElement).appendChild(script);
  script.remove();

  // Ouve os eventos emitidos
  window.addEventListener("__pm_fp__", (event) => {
    browser.runtime.sendMessage({
      type: "FINGERPRINTING_ATTEMPT",
      api: event.detail.api,
      method: event.detail.method
    });
  });

  // Coleta de Web Storage e IndexedDB
  function collectStorageData() {
    const ls = [];
    const ss = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const val = localStorage.getItem(key);
      ls.push({ key, size: (key + val).length, domain: window.location.hostname });
    }
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      const val = sessionStorage.getItem(key);
      ss.push({ key, size: (key + val).length, domain: window.location.hostname });
    }

    // IndexedDB: lista apenas os bancos disponíveis
    const idbList = [];
    if (window.indexedDB && window.indexedDB.databases) {
      window.indexedDB.databases().then(dbs => {
        for (const db of dbs) {
          idbList.push({ name: db.name, version: db.version, domain: window.location.hostname });
        }
        browser.runtime.sendMessage({
          type: "STORAGE_DATA",
          localStorage: ls,
          sessionStorage: ss,
          indexedDB: idbList
        });
      });
    } else {
      browser.runtime.sendMessage({
        type: "STORAGE_DATA",
        localStorage: ls,
        sessionStorage: ss,
        indexedDB: []
      });
    }
  }

  // Coleta após carregamento
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", collectStorageData);
  } else {
    collectStorageData();
  }

  // Recoleta periodicamente para capturar storage dinâmico
  setTimeout(collectStorageData, 3000);
})();
