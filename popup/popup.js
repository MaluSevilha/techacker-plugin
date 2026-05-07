// Tabs
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(tab.dataset.panel).classList.add("active");
  });
});

// Utilitários
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}
function badge(text, type) {
  return `<span class="item-tag tag-${type}">${text}</span>`;
}
function empty(icon, msg) {
  return `<div class="empty"><span class="empty-icon">${icon}</span>${msg}</div>`;
}
function setBadge(id, count, warnThreshold = 1) {
  const b = document.getElementById(id);
  b.textContent = count;
  b.className = "badge" + (count >= warnThreshold ? "" : " ok");
}

// Renderização
function renderScore(scoreData) {
  const { score, label, color, penalties } = scoreData;
  const scoreBar = document.getElementById("scoreBar");
  scoreBar.innerHTML = `
    <div class="score-circle" style="color:${color};border-color:${color}">${score}</div>
    <div class="score-info">
      <div class="score-label" style="color:${color}">${label}</div>
      <div class="score-track"><div class="score-fill" style="width:${score}%;background:${color}"></div></div>
      ${penalties.length ? `<div style="margin-top:5px">${penalties.slice(0,3).map(p => `<div class="penalty-item">▼ ${p}</div>`).join("")}${penalties.length > 3 ? `<div class="penalty-item" style="color:#8b949e">... e mais ${penalties.length-3} fatores</div>` : ""}</div>` : '<div style="color:#56d364;font-size:11px;margin-top:4px">✓ Nenhuma penalidade detectada</div>'}
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
    item.innerHTML = `<div class="item-domain">${domain}</div>
      <div class="item-meta">${[...types].map(t => badge(t, "blue")).join("")}</div>`;
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
      html += `<div class="item"><div class="item-domain">${sc.domain}</div>
        <div class="item-meta">${badge(sc.type, "red")} ${sc.header || sc.value || ""}</div></div>`;
    }
  }

  html += `<div class="section-title">Cookies de terceira parte (${cookies.thirdParty.length})</div>`;
  if (!cookies.thirdParty.length) {
    html += empty("✅", "Nenhum cookie de terceira parte.");
  } else {
    for (const c of cookies.thirdParty.slice(0, 20)) {
      html += `<div class="item"><div class="item-domain">${c.domain}</div>
        <div class="item-meta">
          ${c.session ? badge("Sessão","yellow") : badge("Persistente","red")}
          ${badge("Terceira parte","red")}
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
      html += `<div class="item"><div class="item-domain">${c.domain}</div>
        <div class="item-meta">
          ${c.session ? badge("Sessão","green") : badge("Persistente","yellow")}
          ${badge("Primeira parte","green")}
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
  const total = storage.localStorage.length + storage.sessionStorage.length + storage.indexedDB.length;
  setBadge("badge-st", total, 5);

  let html = "";

  html += `<div class="section-title">localStorage (${storage.localStorage.length} chave(s))</div>`;
  if (!storage.localStorage.length) {
    html += empty("📦", "localStorage vazio.");
  } else {
    for (const item of storage.localStorage.slice(0, 15)) {
      html += `<div class="item"><div class="item-domain">${escapeHtml(item.key)}</div>
        <div class="item-meta">${badge(item.domain, "blue")} ${item.size} bytes</div></div>`;
    }
    if (storage.localStorage.length > 15) {
      html += `<div class="item-meta" style="padding:4px 0;color:#8b949e">... e mais ${storage.localStorage.length - 15}</div>`;
    }
  }

  html += `<div class="section-title">sessionStorage (${storage.sessionStorage.length} chave(s))</div>`;
  if (!storage.sessionStorage.length) {
    html += empty("📦", "sessionStorage vazio.");
  } else {
    for (const item of storage.sessionStorage.slice(0, 15)) {
      html += `<div class="item"><div class="item-domain">${escapeHtml(item.key)}</div>
        <div class="item-meta">${badge(item.domain, "yellow")} ${item.size} bytes</div></div>`;
    }
  }

  html += `<div class="section-title">IndexedDB (${storage.indexedDB.length} banco(s))</div>`;
  if (!storage.indexedDB.length) {
    html += empty("🗄️", "Nenhum banco IndexedDB encontrado.");
  } else {
    for (const db of storage.indexedDB) {
      html += `<div class="item"><div class="item-domain">${escapeHtml(db.name)}</div>
        <div class="item-meta">${badge(db.domain, "blue")} versão ${db.version}</div></div>`;
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

  for (const s of sections) {
    html += `<div class="section-title">${s.title} (${s.items.length})</div>`;
    if (!s.items.length) {
      html += `<div class="item-meta" style="color:#56d364;padding:4px 0">✓ Não detectado</div>`;
    } else {
      const methods = [...new Set(s.items.map(i => i.method))];
      html += `<div class="item"><div class="item-domain">${s.icon} ${s.items.length} chamada(s) detectada(s)</div>
        <div class="item-meta">${methods.map(m => badge(m, "red")).join(" ")}</div></div>`;
    }
  }

  html += `<div class="section-title">Cookie Syncing (${cookieSyncing.length})</div>`;
  if (!cookieSyncing.length) {
    html += `<div class="item-meta" style="color:#56d364;padding:4px 0">✓ Não detectado</div>`;
  } else {
    for (const cs of cookieSyncing) {
      html += `<div class="item"><div class="item-domain">🔗 Sincronismo detectado</div>
        <div class="item-meta">${badge(cs.from,"red")} → ${badge(cs.to,"red")}</div></div>`;
    }
  }

  panel.innerHTML = html;
}

function renderHijacking(hijacking) {
  const panel = document.getElementById("panel-hijack");
  const total = hijacking.suspiciousScripts.length + hijacking.redirectAttempts.length;
  setBadge("badge-hj", total);

  let html = "";

  html += `<div class="section-title">Scripts suspeitos (${hijacking.suspiciousScripts.length})</div>`;
  if (!hijacking.suspiciousScripts.length) {
    html += `<div class="item-meta" style="color:#56d364;padding:4px 0">✓ Nenhum detectado</div>`;
  } else {
    for (const s of hijacking.suspiciousScripts.slice(0, 15)) {
      html += `<div class="item"><div class="item-domain">${s.host}</div>
        <div class="item-meta">${badge(s.reason,"red")}<br><span style="font-size:10px;color:#8b949e;word-break:break-all">${s.url}</span></div></div>`;
    }
  }

  html += `<div class="section-title">Redirecionamentos suspeitos (${hijacking.redirectAttempts.length})</div>`;
  if (!hijacking.redirectAttempts.length) {
    html += `<div class="item-meta" style="color:#56d364;padding:4px 0">✓ Nenhum detectado</div>`;
  } else {
    for (const r of hijacking.redirectAttempts) {
      html += `<div class="item"><div class="item-domain">⚠️ Redirecionamento</div>
        <div class="item-meta"><span style="color:#8b949e">De:</span> ${escapeHtml(r.from.substring(0,60))}<br>
        <span style="color:#8b949e">Para:</span> ${escapeHtml(r.to.substring(0,60))}</div></div>`;
    }
  }

  panel.innerHTML = html;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Init
browser.runtime.sendMessage({ type: "GET_TAB_DATA" }).then(data => {
  if (!data || data.error) {
    document.getElementById("scoreBar").innerHTML =
      `<div style="color:#f85149;padding:10px">${data?.error || "Erro ao obter dados."}</div>`;
    return;
  }

  document.getElementById("pageUrl").textContent = data.pageUrl || "—";
  document.getElementById("tabBar").style.display = "flex";

  renderScore(data.privacyScore);
  renderThirdParty(data.thirdPartyDomains);
  renderCookies(data.cookies);
  renderStorage(data.storage);
  renderFingerprinting(data.fingerprinting, data.cookieSyncing);
  renderHijacking(data.hijacking);
}).catch(err => {
  document.getElementById("scoreBar").innerHTML =
    `<div style="color:#f85149;padding:10px">Erro: ${err.message}</div>`;
});
