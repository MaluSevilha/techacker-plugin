// Tabs
for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => {
    for (const t of document.querySelectorAll(".tab")) t.classList.remove("active");
    for (const p of document.querySelectorAll(".panel")) p.classList.remove("active");
    tab.classList.add("active");
    document.getElementById(tab.dataset.panel).classList.add("active");
  });
}

// Utilitários
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

function badge(text, type) {
  return `<span class="item-tag tag-${type}">${escapeHtml(text)}</span>`;
}

function empty(icon, msg) {
  return `<div class="empty"><span class="empty-icon">${icon}</span>${msg}</div>`;
}

function setBadge(id, count, warnThreshold = 1) {
  const b = document.getElementById(id);
  b.textContent = count;
  b.className = "badge" + (count >= warnThreshold ? "" : " ok");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatBytes(size) {
  const value = Number(size) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

// Renderização
function renderScore(scoreData) {
  const { score, label, color, penalties, breakdown = [] } = scoreData;
  const scoreBar = document.getElementById("scoreBar");

  const rows = breakdown
    .filter((item) => item.penalty > 0)
    .sort((a, b) => b.penalty - a.penalty)
    .slice(0, 8)
    .map((item) => {
      const pct = item.cap > 0 ? Math.round((item.penalty / item.cap) * 100) : 0;
      return `
        <div class="score-break-row">
          <div class="score-break-label">${escapeHtml(item.label)}</div>
          <div class="score-break-value">-${item.penalty}</div>
          <div class="score-break-track">
            <div class="score-break-fill" style="width:${pct}%;background:${color}"></div>
          </div>
        </div>`;
    })
    .join("");

  scoreBar.innerHTML = `
    <div class="score-circle" style="color:${color};border-color:${color}">${score}</div>
    <div class="score-info">
      <div class="score-label" style="color:${color}">${escapeHtml(label)}</div>
      <div class="score-track"><div class="score-fill" style="width:${score}%;background:${color}"></div></div>
      ${rows ? `<div class="score-breakdown">${rows}</div>` : '<div style="color:#56d364;font-size:11px;margin-top:6px">✓ Nenhuma penalidade detectada</div>'}
      ${penalties.length > 8 ? `<div class="penalty-item" style="color:#8b949e">... e mais ${penalties.length - 8} fator(es)</div>` : ""}
    </div>`;
}

function renderThirdParty(domains) {
  const panel = document.getElementById("panel-tp");
  const keys = Object.keys(domains);
  setBadge("badge-tp", keys.length);

  if (!keys.length) {
    panel.innerHTML = empty("✅", "Nenhum domínio de terceira parte detectado.");
    return;
  }

  panel.innerHTML = `<div class="section-title">${keys.length} domínio(s) de terceira parte</div>`;
  for (const [domain, types] of Object.entries(domains)) {
    const item = el("div", "item");
    item.innerHTML = `<div class="item-domain">${escapeHtml(domain)}</div>
      <div class="item-meta">${[...types].map((t) => badge(t, "blue")).join("")}</div>`;
    panel.appendChild(item);
  }
}

function renderCookies(cookies) {
  const panel = document.getElementById("panel-cookies");
  const total = cookies.firstParty.length + cookies.thirdParty.length;
  setBadge("badge-ck", total);

  let html = "";

  if (cookies.supercookies.length) {
    html += `<div class="section-title">⚠️ Supercookies (${cookies.supercookies.length})</div>`;
    for (const sc of cookies.supercookies) {
      html += `<div class="item"><div class="item-domain">${escapeHtml(sc.domain)}</div>
        <div class="item-meta">${badge(sc.type, "red")} ${escapeHtml(sc.header || sc.value || "")}</div></div>`;
    }
  }

  html += `<div class="section-title">Cookies de terceira parte (${cookies.thirdParty.length})</div>`;
  if (!cookies.thirdParty.length) {
    html += empty("✅", "Nenhum cookie de terceira parte.");
  } else {
    for (const c of cookies.thirdParty.slice(0, 20)) {
      html += `<div class="item"><div class="item-domain">${escapeHtml(c.domain)}</div>
        <div class="item-meta">
          ${c.session ? badge("Sessão", "yellow") : badge("Persistente", "red")}
          ${badge("Terceira parte", "red")}
        </div></div>`;
    }
    if (cookies.thirdParty.length > 20) {
      html += `<div class="item-meta" style="padding:4px 0;color:#8b949e">... e mais ${cookies.thirdParty.length - 20}</div>`;
    }
  }

  html += `<div class="section-title">Cookies de primeira parte (${cookies.firstParty.length})</div>`;
  if (!cookies.firstParty.length) {
    html += empty("✅", "Nenhum cookie de primeira parte.");
  } else {
    for (const c of cookies.firstParty.slice(0, 10)) {
      html += `<div class="item"><div class="item-domain">${escapeHtml(c.domain)}</div>
        <div class="item-meta">
          ${c.session ? badge("Sessão", "green") : badge("Persistente", "yellow")}
          ${badge("Primeira parte", "green")}
        </div></div>`;
    }
    if (cookies.firstParty.length > 10) {
      html += `<div class="item-meta" style="padding:4px 0;color:#8b949e">... e mais ${cookies.firstParty.length - 10}</div>`;
    }
  }

  panel.innerHTML = html;
}

function renderStorage(storage) {
  const panel = document.getElementById("panel-storage");

  const idbRecords = storage.indexedDB.reduce((acc, db) => acc + (Number(db.totalRecords) || 0), 0);
  const total = storage.localStorage.length + storage.sessionStorage.length + idbRecords;
  setBadge("badge-st", total, 5);

  let html = "";

  html += `<div class="section-title">localStorage (${storage.localStorage.length} chave(s))</div>`;
  if (!storage.localStorage.length) {
    html += empty("📦", "localStorage vazio.");
  } else {
    for (const item of storage.localStorage.slice(0, 20)) {
      html += `<div class="item"><div class="item-domain">${escapeHtml(item.key)}</div>
        <div class="item-meta">${badge(item.domain, "blue")} ${formatBytes(item.size)}</div></div>`;
    }
    if (storage.localStorage.length > 20) {
      html += `<div class="item-meta" style="padding:4px 0;color:#8b949e">... e mais ${storage.localStorage.length - 20}</div>`;
    }
  }

  html += `<div class="section-title">sessionStorage (${storage.sessionStorage.length} chave(s))</div>`;
  if (!storage.sessionStorage.length) {
    html += empty("📦", "sessionStorage vazio.");
  } else {
    for (const item of storage.sessionStorage.slice(0, 20)) {
      html += `<div class="item"><div class="item-domain">${escapeHtml(item.key)}</div>
        <div class="item-meta">${badge(item.domain, "yellow")} ${formatBytes(item.size)}</div></div>`;
    }
    if (storage.sessionStorage.length > 20) {
      html += `<div class="item-meta" style="padding:4px 0;color:#8b949e">... e mais ${storage.sessionStorage.length - 20}</div>`;
    }
  }

  const dbCount = storage.indexedDB.length;
  html += `<div class="section-title">IndexedDB (${dbCount} banco(s), ${idbRecords} registro(s))</div>`;

  if (!dbCount) {
    html += empty("🗄️", "Nenhum banco IndexedDB encontrado.");
  } else {
    for (const db of storage.indexedDB) {
      html += `<div class="item">
        <div class="item-domain">${escapeHtml(db.name)} ${badge(db.domain, "blue")}</div>
        <div class="item-meta">versão ${escapeHtml(db.version ?? "?")} • ${db.stores.length} store(s) • ${db.totalRecords} registro(s) • ${formatBytes(db.totalEstimatedBytes)}</div>
      </div>`;

      if (db.error) {
        html += `<div class="item-meta" style="color:#f0883e;padding:2px 0 8px">⚠️ ${escapeHtml(db.error)}</div>`;
      }

      for (const store of db.stores) {
        html += `<div class="item" style="margin-left:8px">
          <div class="item-domain">Store: ${escapeHtml(store.name)}</div>
          <div class="item-meta">${store.recordCount} registro(s) • ${formatBytes(store.estimatedBytes)} • keyPath: ${escapeHtml(store.keyPath === null ? "null" : JSON.stringify(store.keyPath))}</div>
        </div>`;

        if (store.records && store.records.length) {
          for (const record of store.records.slice(0, 10)) {
            html += `<div class="item" style="margin-left:16px;padding:6px 8px">
              <div class="item-domain">Chave: ${escapeHtml(record.key)}</div>
              <div class="item-meta">Tamanho estimado: ${formatBytes(record.size)}</div>
            </div>`;
          }

          if (store.records.length > 10) {
            html += `<div class="item-meta" style="padding:2px 0 8px 16px;color:#8b949e">... e mais ${store.records.length - 10} chave(s)</div>`;
          }
        }
      }
    }
  }

  panel.innerHTML = html;
}

function renderFingerprinting(fp, cookieSyncing) {
  const panel = document.getElementById("panel-fp");
  const total = fp.canvas.length + fp.webgl.length + fp.audioContext.length + cookieSyncing.length;
  setBadge("badge-fp", total);

  let html = "";

  const sections = [
    { title: "Canvas Fingerprinting", items: fp.canvas, icon: "🖼️" },
    { title: "WebGL Fingerprinting", items: fp.webgl, icon: "🎮" },
    { title: "AudioContext Fingerprinting", items: fp.audioContext, icon: "🔊" }
  ];

  for (const section of sections) {
    html += `<div class="section-title">${section.title} (${section.items.length})</div>`;
    if (!section.items.length) {
      html += `<div class="item-meta" style="color:#56d364;padding:4px 0">✓ Não detectado</div>`;
    } else {
      const methods = [...new Set(section.items.map((i) => i.method))];
      html += `<div class="item"><div class="item-domain">${section.icon} ${section.items.length} chamada(s) detectada(s)</div>
        <div class="item-meta">${methods.map((m) => badge(m, "red")).join(" ")}</div></div>`;
    }
  }

  html += `<div class="section-title">Cookie Syncing (${cookieSyncing.length})</div>`;
  if (!cookieSyncing.length) {
    html += `<div class="item-meta" style="color:#56d364;padding:4px 0">✓ Não detectado</div>`;
  } else {
    for (const cs of cookieSyncing) {
      html += `<div class="item"><div class="item-domain">🔗 Sincronismo detectado</div>
        <div class="item-meta">${badge(cs.from, "red")} → ${badge(cs.to, "red")}</div>
        <div class="item-meta">${escapeHtml(cs.reason || "Heurística de sincronismo")}</div></div>`;
    }
  }

  panel.innerHTML = html;
}

function renderHijacking(hijacking) {
  const panel = document.getElementById("panel-hijack");
  const suspicious = hijacking.suspiciousScripts || [];
  const redirects = hijacking.redirectAttempts || [];
  const hooks = hijacking.hookingAttempts || [];

  const total = suspicious.length + redirects.length + hooks.length;
  setBadge("badge-hj", total);

  let html = "";

  html += `<div class="section-title">Hooking dinâmico (${hooks.length})</div>`;
  if (!hooks.length) {
    html += `<div class="item-meta" style="color:#56d364;padding:4px 0">✓ Nenhuma sobrescrita detectada</div>`;
  } else {
    for (const hook of hooks.slice(0, 20)) {
      html += `<div class="item"><div class="item-domain">${escapeHtml(hook.target)}</div>
        <div class="item-meta">${badge("Hook detectado", "red")} ${escapeHtml(hook.reason || "")}</div>
        ${hook.frameHost ? `<div class="item-meta">Frame: ${badge(hook.frameHost, "yellow")}</div>` : ""}
      </div>`;
    }
  }

  html += `<div class="section-title">Scripts suspeitos (${suspicious.length})</div>`;
  if (!suspicious.length) {
    html += `<div class="item-meta" style="color:#56d364;padding:4px 0">✓ Nenhum detectado</div>`;
  } else {
    for (const script of suspicious.slice(0, 15)) {
      html += `<div class="item"><div class="item-domain">${escapeHtml(script.host)}</div>
        <div class="item-meta">${badge(script.reason, "red")}<br><span style="font-size:10px;color:#8b949e;word-break:break-all">${escapeHtml(script.url)}</span></div></div>`;
    }
  }

  html += `<div class="section-title">Redirecionamentos suspeitos (${redirects.length})</div>`;
  if (!redirects.length) {
    html += `<div class="item-meta" style="color:#56d364;padding:4px 0">✓ Nenhum detectado</div>`;
  } else {
    for (const redirect of redirects.slice(0, 15)) {
      html += `<div class="item"><div class="item-domain">⚠️ Redirecionamento</div>
        <div class="item-meta"><span style="color:#8b949e">De:</span> ${escapeHtml(redirect.from.substring(0, 80))}<br>
        <span style="color:#8b949e">Para:</span> ${escapeHtml(redirect.to.substring(0, 80))}</div></div>`;
    }
  }

  panel.innerHTML = html;
}

// Init
browser.runtime.sendMessage({ type: "GET_TAB_DATA" }).then((data) => {
  if (!data || data.error) {
    document.getElementById("scoreBar").innerHTML =
      `<div style="color:#f85149;padding:10px">${escapeHtml(data?.error || "Erro ao obter dados.")}</div>`;
    return;
  }

  const normalized = {
    pageUrl: data.pageUrl || "—",
    thirdPartyDomains: data.thirdPartyDomains || {},
    cookies: {
      firstParty: data.cookies?.firstParty || [],
      thirdParty: data.cookies?.thirdParty || [],
      session: data.cookies?.session || [],
      persistent: data.cookies?.persistent || [],
      supercookies: data.cookies?.supercookies || []
    },
    storage: {
      localStorage: data.storage?.localStorage || [],
      sessionStorage: data.storage?.sessionStorage || [],
      indexedDB: data.storage?.indexedDB || []
    },
    fingerprinting: {
      canvas: data.fingerprinting?.canvas || [],
      webgl: data.fingerprinting?.webgl || [],
      audioContext: data.fingerprinting?.audioContext || []
    },
    cookieSyncing: data.cookieSyncing || [],
    hijacking: {
      suspiciousScripts: data.hijacking?.suspiciousScripts || [],
      redirectAttempts: data.hijacking?.redirectAttempts || [],
      hookingAttempts: data.hijacking?.hookingAttempts || []
    },
    privacyScore: data.privacyScore || {
      score: 0,
      label: "Indisponível",
      color: "#8b949e",
      penalties: [],
      breakdown: []
    }
  };

  document.getElementById("pageUrl").textContent = normalized.pageUrl;
  document.getElementById("tabBar").style.display = "flex";

  renderScore(normalized.privacyScore);
  renderThirdParty(normalized.thirdPartyDomains);
  renderCookies(normalized.cookies);
  renderStorage(normalized.storage);
  renderFingerprinting(normalized.fingerprinting, normalized.cookieSyncing);
  renderHijacking(normalized.hijacking);
}).catch((err) => {
  document.getElementById("scoreBar").innerHTML =
    `<div style="color:#f85149;padding:10px">Erro: ${escapeHtml(err.message)}</div>`;
});
