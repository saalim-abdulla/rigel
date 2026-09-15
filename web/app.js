/*
 * PROTOTYPE: three pricing-browser layouts, switchable with ?variant=A|B|C.
 * Question: which information hierarchy makes Copilot pricing easiest to explore?
 */

const DATA_URL = "../data/copilot-pricing.json";
const VARIANTS = {
  A: "Analyst table",
  B: "Model gallery",
  C: "Cost map",
};
const PROVIDER_COLORS = {
  openai: "#c8ff63",
  anthropic: "#ffad66",
  google: "#68e4ff",
  microsoft: "#b39bff",
  xai: "#ff7eb6",
  moonshot_ai: "#f6df73",
  github: "#e9e9e9",
};

const state = {
  data: null,
  query: "",
  provider: "all",
  category: "all",
  tier: "all",
  maxOutput: 75,
  sort: "output-asc",
  selected: null,
};

const app = document.querySelector("#app");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value) {
  if (value === null || value === undefined) return "—";
  return `$${Number(value).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`;
}

function threshold(row) {
  if (!row.threshold_operator || !row.threshold_tokens) return "Any context";
  const symbol = { lte: "≤", lt: "<", gt: ">", gte: "≥" }[row.threshold_operator];
  const amount = row.threshold_tokens >= 1_000_000
    ? `${row.threshold_tokens / 1_000_000}M`
    : `${row.threshold_tokens / 1_000}K`;
  return `${symbol} ${amount} input`;
}

function unique(field) {
  return [...new Set(state.data.prices.map((row) => row[field]).filter(Boolean))].sort();
}

function variant() {
  const value = new URLSearchParams(window.location.search).get("variant")?.toUpperCase();
  return VARIANTS[value] ? value : "A";
}

function filteredRows() {
  const query = state.query.trim().toLowerCase();
  const rows = state.data.prices.filter((row) => {
    const text = `${row.provider} ${row.model} ${row.category} ${row.tier}`.toLowerCase();
    return (!query || text.includes(query))
      && (state.provider === "all" || row.provider === state.provider)
      && (state.category === "all" || row.category === state.category)
      && (state.tier === "all" || row.tier === state.tier)
      && row.output_usd_per_million_tokens <= state.maxOutput;
  });

  const sorters = {
    "output-asc": (a, b) => a.output_usd_per_million_tokens - b.output_usd_per_million_tokens,
    "input-asc": (a, b) => a.input_usd_per_million_tokens - b.input_usd_per_million_tokens,
    "model-asc": (a, b) => a.model.localeCompare(b.model),
    "provider-asc": (a, b) => a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model),
  };
  return rows.sort(sorters[state.sort]);
}

function optionList(values, selected, allLabel) {
  return [`<option value="all">${allLabel}</option>`]
    .concat(values.map((value) => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`))
    .join("");
}

function headerMarkup(rows) {
  const modelCount = new Set(rows.map((row) => `${row.provider}:${row.model}`)).size;
  return `
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">R</div>
        <div class="brand-copy"><strong>Rigel</strong><span>MODEL PRICE INDEX</span></div>
      </div>
      <a class="source-link" href="${escapeHtml(state.data.source.url)}" target="_blank" rel="noreferrer">VIEW PRIMARY SOURCE ↗</a>
    </header>
    <section class="hero">
      <div>
        <p class="eyebrow">GITHUB COPILOT / ALL PROVIDERS</p>
        <h1>Find the right model.<br><em>Know the rate.</em></h1>
        <p class="hero-copy">A normalized view of every published Copilot pricing tier. Filter the field now; task-quality and benchmark evidence come next.</p>
      </div>
      <div class="catalog-stamp"><strong>${modelCount}</strong><span>visible models · ${rows.length} price tiers</span></div>
    </section>`;
}

function filtersMarkup() {
  return `
    <section class="filter-strip" aria-label="Pricing filters">
      <div class="field search-field">
        <label for="search">Search</label>
        <input id="search" type="search" value="${escapeHtml(state.query)}" placeholder="Model, provider, category…" autocomplete="off" />
      </div>
      <div class="field">
        <label for="provider">Provider</label>
        <select id="provider">${optionList(unique("provider"), state.provider, "All providers")}</select>
      </div>
      <div class="field">
        <label for="category">Category</label>
        <select id="category">${optionList(unique("category"), state.category, "All categories")}</select>
      </div>
      <div class="field">
        <label for="tier">Context tier</label>
        <select id="tier">${optionList(unique("tier"), state.tier, "All tiers")}</select>
      </div>
      <div class="field">
        <label for="sort">Sort by</label>
        <select id="sort">
          <option value="output-asc" ${state.sort === "output-asc" ? "selected" : ""}>Lowest output price</option>
          <option value="input-asc" ${state.sort === "input-asc" ? "selected" : ""}>Lowest input price</option>
          <option value="model-asc" ${state.sort === "model-asc" ? "selected" : ""}>Model name</option>
          <option value="provider-asc" ${state.sort === "provider-asc" ? "selected" : ""}>Provider</option>
        </select>
      </div>
      <div class="range-field">
        <div class="range-head"><label class="range-label" for="max-output">Max output price</label><output>${money(state.maxOutput)}</output></div>
        <input id="max-output" type="range" min="1" max="75" step="1" value="${state.maxOutput}" />
      </div>
    </section>`;
}

function summaryMarkup(rows) {
  return `<div class="summary-row"><span>Showing <strong>${rows.length}</strong> of ${state.data.prices.length} price tiers</span><button class="clear-button" id="clear-filters">Reset filters</button></div>`;
}

function tableVariant(rows) {
  const providerCounts = Object.fromEntries(unique("provider").map((provider) => [provider, state.data.prices.filter((row) => row.provider === provider).length]));
  const providerButtons = Object.entries(providerCounts).map(([provider, count]) => `
    <button class="provider-toggle ${state.provider === provider ? "active" : ""}" data-provider="${provider}">
      <span>${escapeHtml(provider.replace("_", " "))}</span><span>${count}</span>
    </button>`).join("");
  const body = rows.map((row) => `
    <tr>
      <td class="model-cell"><strong>${escapeHtml(row.model)}</strong><small>${escapeHtml(row.provider)}</small></td>
      <td>${escapeHtml(row.category)}</td>
      <td><span class="pill ${row.tier === "Long context" ? "long" : ""}">${escapeHtml(row.tier)}</span></td>
      <td>${escapeHtml(threshold(row))}</td>
      <td class="number money">${money(row.input_usd_per_million_tokens)}</td>
      <td class="number money">${money(row.cached_input_usd_per_million_tokens)}</td>
      <td class="number money">${money(row.cache_write_usd_per_million_tokens)}</td>
      <td class="number money output">${money(row.output_usd_per_million_tokens)}</td>
    </tr>`).join("");

  return `
    <div class="table-workspace">
      <aside class="provider-rail"><h2>Provider index</h2><button class="provider-toggle ${state.provider === "all" ? "active" : ""}" data-provider="all"><span>All providers</span><span>${state.data.prices.length}</span></button>${providerButtons}</aside>
      <div class="table-scroll">
        ${rows.length ? `<table class="pricing-table"><thead><tr><th>Model</th><th>Category</th><th>Tier</th><th>Threshold</th><th class="number">Input</th><th class="number">Cached</th><th class="number">Write</th><th class="number">Output</th></tr></thead><tbody>${body}</tbody></table>` : emptyMarkup()}
      </div>
    </div>`;
}

function galleryVariant(rows) {
  if (!rows.length) return `<div class="gallery-shell">${emptyMarkup()}</div>`;
  const grouped = Map.groupBy
    ? Map.groupBy(rows, (row) => row.provider)
    : rows.reduce((map, row) => map.set(row.provider, [...(map.get(row.provider) || []), row]), new Map());
  return `<div class="gallery-shell">${[...grouped].map(([provider, providerRows]) => `
    <section class="provider-section provider-${provider}">
      <div class="provider-heading"><h2>${escapeHtml(provider.replace("_", " "))}</h2><span>${providerRows.length} PRICE TIERS</span></div>
      <div class="card-grid">${providerRows.map((row) => `
        <article class="model-card">
          <div class="card-top"><div><h3>${escapeHtml(row.model)}</h3><div class="category-label">${escapeHtml(row.category)} · ${escapeHtml(threshold(row))}</div></div><span class="pill ${row.tier === "Long context" ? "long" : ""}">${escapeHtml(row.tier)}</span></div>
          <div class="price-hero"><strong>${money(row.output_usd_per_million_tokens)}</strong><span>output / 1M tokens</span></div>
          <div class="price-pair"><div><b>${money(row.input_usd_per_million_tokens)}</b><small>input</small></div><div><b>${money(row.cached_input_usd_per_million_tokens)}</b><small>cached input</small></div></div>
        </article>`).join("")}</div>
    </section>`).join("")}</div>`;
}

function costMapVariant(rows) {
  if (!rows.length) return `<div class="map-shell">${emptyMarkup()}</div>`;
  const maxInput = Math.max(...rows.map((row) => row.input_usd_per_million_tokens));
  const maxOutput = Math.max(...rows.map((row) => row.output_usd_per_million_tokens));
  const scale = (value, max) => 5 + (Math.log10(value + 1) / Math.log10(max + 1)) * 90;
  const dots = rows.map((row, index) => {
    const id = `${row.provider}-${row.model}-${row.tier}-${index}`;
    const left = scale(row.input_usd_per_million_tokens, maxInput);
    const bottom = scale(row.output_usd_per_million_tokens, maxOutput);
    return `<span class="plot-dot provider-${row.provider} ${state.selected === id ? "active" : ""}" style="left:${left}%;bottom:${bottom}%" data-label="${escapeHtml(`${row.model}: ${money(row.input_usd_per_million_tokens)} input, ${money(row.output_usd_per_million_tokens)} output`)}" aria-hidden="true"></span>`;
  }).join("");
  const list = rows.map((row, index) => {
    const id = `${row.provider}-${row.model}-${row.tier}-${index}`;
    return `<button class="map-row provider-${row.provider} ${state.selected === id ? "active" : ""}" data-model-id="${escapeHtml(id)}"><span class="dot-key"></span><span>${escapeHtml(row.model)}<small>${escapeHtml(row.provider)} · ${escapeHtml(row.tier)}</small></span><b>${money(row.output_usd_per_million_tokens)}</b></button>`;
  }).join("");
  return `
    <div class="map-shell">
      <section class="cost-map" aria-label="Input versus output price plot"><span class="axis y">Output price →</span><div class="plot">${dots}</div><span class="axis x">Input price →</span></section>
      <aside class="map-list"><h2>Price points</h2>${list}</aside>
    </div>`;
}

function emptyMarkup() {
  return `<div class="empty-state"><p class="eyebrow">NO MATCHES</p><h2>Nothing in this slice.</h2><p>Relax one or more filters to bring models back into view.</p></div>`;
}

function switcherMarkup(current) {
  return `<nav class="prototype-switcher" aria-label="Prototype layouts"><button id="previous-variant" aria-label="Previous layout">←</button><span class="variant-label">${current} · ${VARIANTS[current]}</span><button id="next-variant" aria-label="Next layout">→</button></nav>`;
}

function render(focusId = null) {
  const rows = filteredRows();
  const current = variant();
  const variantMarkup = current === "A" ? tableVariant(rows) : current === "B" ? galleryVariant(rows) : costMapVariant(rows);
  app.innerHTML = `${headerMarkup(rows)}<main>${filtersMarkup()}${summaryMarkup(rows)}${variantMarkup}</main>${switcherMarkup(current)}`;
  bindEvents();
  if (focusId) {
    const field = document.getElementById(focusId);
    field?.focus();
    if (field?.setSelectionRange) field.setSelectionRange(field.value.length, field.value.length);
  }
}

function setVariant(direction) {
  const keys = Object.keys(VARIANTS);
  const currentIndex = keys.indexOf(variant());
  const next = keys[(currentIndex + direction + keys.length) % keys.length];
  const url = new URL(window.location.href);
  url.searchParams.set("variant", next);
  history.replaceState({}, "", url);
  render();
}

function bindEvents() {
  document.getElementById("search")?.addEventListener("input", (event) => {
    state.query = event.target.value;
    render("search");
  });
  document.getElementById("provider")?.addEventListener("change", (event) => { state.provider = event.target.value; render(); });
  document.getElementById("category")?.addEventListener("change", (event) => { state.category = event.target.value; render(); });
  document.getElementById("tier")?.addEventListener("change", (event) => { state.tier = event.target.value; render(); });
  document.getElementById("sort")?.addEventListener("change", (event) => { state.sort = event.target.value; render(); });
  document.getElementById("max-output")?.addEventListener("input", (event) => { state.maxOutput = Number(event.target.value); render("max-output"); });
  document.getElementById("clear-filters")?.addEventListener("click", () => {
    Object.assign(state, { query: "", provider: "all", category: "all", tier: "all", maxOutput: 75, sort: "output-asc" });
    render();
  });
  document.querySelectorAll("[data-provider]").forEach((button) => button.addEventListener("click", () => { state.provider = button.dataset.provider; render(); }));
  document.querySelectorAll("[data-model-id]").forEach((button) => button.addEventListener("click", () => { state.selected = button.dataset.modelId; render(); }));
  document.getElementById("previous-variant")?.addEventListener("click", () => setVariant(-1));
  document.getElementById("next-variant")?.addEventListener("click", () => setVariant(1));
}

window.addEventListener("keydown", (event) => {
  const tag = document.activeElement?.tagName;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(tag) || document.activeElement?.isContentEditable) return;
  if (event.key === "ArrowLeft") setVariant(-1);
  if (event.key === "ArrowRight") setVariant(1);
});

function loadData(data) {
  state.data = data;
  state.maxOutput = Math.ceil(Math.max(...data.prices.map((row) => row.output_usd_per_million_tokens)));
  render();
}

if (window.RIGEL_PRICING) {
  loadData(window.RIGEL_PRICING);
} else {
  fetch(DATA_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`Pricing data returned ${response.status}`);
      return response.json();
    })
    .then(loadData)
    .catch((error) => {
      app.innerHTML = `<main class="error-shell"><p class="eyebrow">DATA LOAD FAILED</p><h1>Could not open the pricing catalog.</h1><p>${escapeHtml(error.message)}</p></main>`;
    });
}
