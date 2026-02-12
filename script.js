const state = {
  rows: [],
  analytics: {
    heatmapGrid: Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0)),
    heatmapMax: 1,
    topSenders: [],
    typeItems: [],
  },
  google: {
    accessToken: null,
    gapiInitDone: false,
    currentApiKey: "",
  },
};

const dayLabels = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const colors = ["#72d6ff", "#61e3ff", "#96f2ff", "#b8e6ff", "#7dd6ff", "#6ef9ff"];

const GOOGLE_DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest"];
const GOOGLE_GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_QUERY = "in:inbox newer_than:365d";
const GMAIL_MAX_MESSAGES = 50;

const fileInput = document.getElementById("fileInput");
const dropzone = document.getElementById("dropzone");
const loadSample = document.getElementById("loadSample");
const openCsvGuide = document.getElementById("openCsvGuide");
const closeCsvGuide = document.getElementById("closeCsvGuide");
const csvGuideModal = document.getElementById("csvGuideModal");

const connectGoogleBtn = document.getElementById("connectGoogle");
const disconnectGoogleBtn = document.getElementById("disconnectGoogle");
const googleStatusEl = document.getElementById("googleStatus");

fileInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  readCsv(file);
});

["dragenter", "dragover"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
});

["dragleave", "drop"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  });
});

dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  readCsv(file);
});

loadSample.addEventListener("click", () => {
  state.rows = buildSampleData();
  render();
});

openCsvGuide.addEventListener("click", () => {
  csvGuideModal.classList.add("is-open");
  csvGuideModal.setAttribute("aria-hidden", "false");
});

closeCsvGuide.addEventListener("click", hideCsvGuideModal);

csvGuideModal.addEventListener("click", (e) => {
  if (e.target === csvGuideModal) hideCsvGuideModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideCsvGuideModal();
});

document.querySelectorAll(".export-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const chart = btn.dataset.chart;
    const format = btn.dataset.format;
    if (!chart || !format) return;
    exportChart(chart, format);
  });
});

connectGoogleBtn.addEventListener("click", connectGoogleInbox);
disconnectGoogleBtn.addEventListener("click", disconnectGoogleInbox);

initGoogleUi();

function initGoogleUi() {
  const configClientId = String(window.APP_CONFIG?.googleClientId || "").trim();
  const configApiKey = String(window.APP_CONFIG?.googleApiKey || "").trim();

  if (!configClientId || !configApiKey) {
    connectGoogleBtn.disabled = true;
    setGoogleStatus("Missing GOOGLE_CLIENT_ID / GOOGLE_API_KEY in .env.", true);
    return;
  }

  if (window.google && window.gapi) {
    setGoogleStatus("Google libraries loaded. Ready to connect.");
    return;
  }

  // External scripts load async; this gives clear status if they are still loading.
  setGoogleStatus("Waiting for Google libraries to load...");
}

function setGoogleStatus(message, isError = false) {
  googleStatusEl.textContent = `Google status: ${message}`;
  googleStatusEl.style.color = isError ? "#ffb4b4" : "#9cb79a";
}

async function connectGoogleInbox() {
  const clientId = String(window.APP_CONFIG?.googleClientId || "").trim();
  const apiKey = String(window.APP_CONFIG?.googleApiKey || "").trim();

  if (!clientId || !apiKey) {
    setGoogleStatus("Missing GOOGLE_CLIENT_ID / GOOGLE_API_KEY in .env.", true);
    return;
  }

  if (!window.gapi || !window.google?.accounts?.oauth2) {
    setGoogleStatus("Google scripts not available. Reload and try again.", true);
    return;
  }

  connectGoogleBtn.disabled = true;
  connectGoogleBtn.textContent = "Connecting...";

  try {
    await ensureGapiClient(apiKey);
    await requestGoogleToken(clientId);
    setGoogleStatus("Connected. Reading Gmail metadata...");

    const rows = await fetchGmailRows();
    state.rows = rows;
    render();

    setGoogleStatus(`Connected and loaded ${rows.length} emails from Gmail.`);
  } catch (error) {
    setGoogleStatus(normalizeError(error), true);
  } finally {
    connectGoogleBtn.disabled = false;
    connectGoogleBtn.textContent = "Connect Google Inbox";
  }
}

function disconnectGoogleInbox() {
  const token = window.gapi?.client?.getToken?.();
  if (token?.access_token && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(token.access_token, () => {});
  }

  if (window.gapi?.client) {
    window.gapi.client.setToken(null);
  }

  state.google.accessToken = null;
  setGoogleStatus("Disconnected.");
}

function ensureGapiClient(apiKey) {
  if (state.google.gapiInitDone && state.google.currentApiKey === apiKey) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    window.gapi.load("client", async () => {
      try {
        await window.gapi.client.init({
          apiKey,
          discoveryDocs: GOOGLE_DISCOVERY_DOCS,
        });
        state.google.gapiInitDone = true;
        state.google.currentApiKey = apiKey;
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

function requestGoogleToken(clientId) {
  return new Promise((resolve, reject) => {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_GMAIL_SCOPE,
      callback: (response) => {
        if (response.error) {
          reject(new Error(response.error_description || response.error));
          return;
        }
        state.google.accessToken = response.access_token;
        window.gapi.client.setToken({ access_token: response.access_token });
        resolve();
      },
    });

    tokenClient.requestAccessToken({ prompt: "consent" });
  });
}

async function fetchGmailRows() {
  let collected = [];
  let nextPageToken = "";

  while (collected.length < GMAIL_MAX_MESSAGES) {
    const listResponse = await window.gapi.client.gmail.users.messages.list({
      userId: "me",
      maxResults: 100,
      pageToken: nextPageToken || undefined,
      q: GMAIL_QUERY,
    });

    const messages = listResponse.result.messages || [];
    if (!messages.length) break;

    const remaining = GMAIL_MAX_MESSAGES - collected.length;
    const pageIds = messages.slice(0, remaining).map((m) => m.id);

    for (const batch of chunk(pageIds, 20)) {
      const result = await Promise.all(batch.map((id) => fetchGmailMessageMetadata(id)));
      collected = collected.concat(result.filter(Boolean));
      setGoogleStatus(`Reading Gmail metadata... ${collected.length} messages`);
    }

    nextPageToken = listResponse.result.nextPageToken;
    if (!nextPageToken || collected.length >= GMAIL_MAX_MESSAGES) break;
  }

  return collected;
}

async function fetchGmailMessageMetadata(messageId) {
  try {
    const response = await window.gapi.client.gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "metadata",
      metadataHeaders: ["Date", "From", "Subject"],
    });

    const headers = response.result.payload?.headers || [];
    const dateHeader = getHeader(headers, "date");
    const fromHeader = getHeader(headers, "from");
    const subjectHeader = getHeader(headers, "subject");

    const date = new Date(dateHeader || "");
    if (Number.isNaN(date.getTime())) return null;

    const from = normalizeFromHeader(fromHeader);
    const subject = subjectHeader || "";

    return {
      date,
      from,
      subject,
      category: detectCategory(subject, from),
    };
  } catch {
    return null;
  }
}

function getHeader(headers, key) {
  const match = headers.find((h) => (h.name || "").toLowerCase() === key);
  return match?.value || "";
}

function normalizeFromHeader(fromHeader) {
  if (!fromHeader) return "unknown";
  const match = fromHeader.match(/<([^>]+)>/);
  if (match && match[1]) return match[1].trim();
  return fromHeader.trim();
}

function normalizeError(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  return error.message || "Request failed";
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}

function readCsv(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = String(e.target?.result || "");
    state.rows = parseCsv(text);
    render();
  };
  reader.readAsText(file);
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const dateIdx = headers.findIndex((h) => h === "date" || h.includes("date"));
  const fromIdx = headers.findIndex((h) => h === "from" || h.includes("sender"));
  const subjectIdx = headers.findIndex((h) => h === "subject" || h.includes("subject"));

  const out = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]);
    const dateRaw = cols[dateIdx] || "";
    const from = (cols[fromIdx] || "unknown").trim();
    const subject = (cols[subjectIdx] || "").trim();

    const d = new Date(dateRaw);
    if (Number.isNaN(d.getTime())) continue;

    out.push({
      date: d,
      from,
      subject,
      category: detectCategory(subject, from),
    });
  }

  return out;
}

function splitCsvLine(line) {
  const out = [];
  let curr = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      curr += '"';
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (ch === "," && !inQuotes) {
      out.push(curr);
      curr = "";
      continue;
    }

    curr += ch;
  }

  out.push(curr);
  return out;
}

function detectCategory(subject, from) {
  const str = `${subject} ${from}`.toLowerCase();
  if (/invoice|receipt|payment|bill/.test(str)) return "Finance";
  if (/meeting|calendar|schedule|zoom/.test(str)) return "Meetings";
  if (/sale|offer|deal|newsletter|promo/.test(str)) return "Promotions";
  if (/github|deploy|server|error|alert/.test(str)) return "Work";
  return "General";
}

function hideCsvGuideModal() {
  csvGuideModal.classList.remove("is-open");
  csvGuideModal.setAttribute("aria-hidden", "true");
}

function render() {
  renderMetrics();
  renderHeatmap();
  renderSenders();
  renderPie();
}

function renderMetrics() {
  const totalEl = document.getElementById("totalEmails");
  const topSenderEl = document.getElementById("topSender");
  const peakHourEl = document.getElementById("peakHour");

  totalEl.textContent = String(state.rows.length);

  const senderCount = countBy(state.rows, (r) => r.from);
  const topSender = topEntry(senderCount);
  topSenderEl.textContent = topSender ? `${topSender[0]} (${topSender[1]})` : "-";

  const hourCount = Array.from({ length: 24 }, () => 0);
  state.rows.forEach((r) => {
    hourCount[r.date.getHours()] += 1;
  });
  const peak = hourCount.reduce(
    (acc, curr, idx) => (curr > acc.count ? { hour: idx, count: curr } : acc),
    { hour: -1, count: -1 }
  );
  peakHourEl.textContent = peak.hour >= 0 ? `${String(peak.hour).padStart(2, "0")}:00` : "-";
}

function renderHeatmap() {
  const axisEl = document.getElementById("heatmapAxis");
  const rowsEl = document.getElementById("heatmapRows");
  const legendEl = document.getElementById("heatmapLegend");

  axisEl.innerHTML = "";
  rowsEl.innerHTML = "";
  legendEl.innerHTML = "";

  const spacer = document.createElement("span");
  spacer.textContent = "";
  axisEl.appendChild(spacer);

  for (let hour = 0; hour < 24; hour += 1) {
    const tick = document.createElement("span");
    tick.textContent = String(hour);
    axisEl.appendChild(tick);
  }

  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  state.rows.forEach((r) => {
    grid[r.date.getDay()][r.date.getHours()] += 1;
  });

  const max = Math.max(1, ...grid.flat());
  state.analytics.heatmapGrid = grid;
  state.analytics.heatmapMax = max;

  for (let day = 0; day < 7; day += 1) {
    const row = document.createElement("div");
    row.className = "heat-row";

    const label = document.createElement("div");
    label.className = "heat-day";
    label.textContent = dayLabels[day];
    row.appendChild(label);

    for (let hour = 0; hour < 24; hour += 1) {
      const value = grid[day][hour];
      const cell = document.createElement("div");
      cell.className = `heat-cell ${heatLevelClass(value, max)}`.trim();
      cell.dataset.tip = `${dayNames[day]} ${String(hour).padStart(2, "0")}:00 • ${value}`;
      row.appendChild(cell);
    }

    rowsEl.appendChild(row);
  }

  appendLegendChip(legendEl, "legend-chip");
  appendLegendChip(legendEl, "", "0");
  for (let i = 1; i <= 7; i += 1) {
    appendLegendChip(legendEl, `legend-chip level-${i}`);
  }
  appendLegendChip(legendEl, "", "11+");
  appendLegendChip(legendEl, "legend-chip level-7");
}

function appendLegendChip(root, className, text = "") {
  const el = document.createElement(text ? "span" : "div");
  if (className) el.className = className;
  if (text) el.textContent = text;
  root.appendChild(el);
}

function heatLevelClass(value, max) {
  if (value <= 0) return "";
  const normalized = value / max;
  const level = Math.min(7, Math.max(1, Math.ceil(normalized * 7)));
  return `level-${level}`;
}

function renderSenders() {
  const senderList = document.getElementById("senderList");
  senderList.innerHTML = "";

  const counts = countBy(state.rows, (r) => r.from);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  state.analytics.topSenders = top;

  if (!top.length) {
    const li = document.createElement("li");
    li.textContent = "Upload data to see sender ranking.";
    senderList.appendChild(li);
    return;
  }

  top.forEach(([sender, count], idx) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${idx + 1}. ${escapeHtml(sender)}</span><strong>${count}</strong>`;
    senderList.appendChild(li);
  });
}

function renderPie() {
  const canvas = document.getElementById("typeChart");
  const legend = document.getElementById("typeLegend");
  legend.innerHTML = "";

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const counts = countBy(state.rows, (r) => r.category);
  const items = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  state.analytics.typeItems = items;

  if (!items.length) {
    ctx.fillStyle = "#9cb79a";
    ctx.font = "16px Space Grotesk";
    ctx.textAlign = "center";
    ctx.fillText("No data yet", canvas.width / 2, canvas.height / 2);
    return;
  }

  const total = items.reduce((sum, [, n]) => sum + n, 0);
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const radius = 125;

  let start = -Math.PI / 2;
  items.forEach(([label, value], i) => {
    const angle = (value / total) * Math.PI * 2;
    const end = start + angle;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = colors[i % colors.length];
    ctx.fill();

    start = end;

    const li = document.createElement("li");
    li.innerHTML = `<span><span class="dot" style="background:${colors[i % colors.length]}"></span>${label}</span><strong>${Math.round((value / total) * 100)}%</strong>`;
    legend.appendChild(li);
  });

  ctx.beginPath();
  ctx.arc(cx, cy, 52, 0, Math.PI * 2);
  ctx.fillStyle = "#0d130d";
  ctx.fill();

  ctx.fillStyle = "#72d6ff";
  ctx.font = "700 16px Space Grotesk";
  ctx.textAlign = "center";
  ctx.fillText("Email", cx, cy - 4);
  ctx.fillStyle = "#9cb79a";
  ctx.font = "13px Space Grotesk";
  ctx.fillText("Types", cx, cy + 16);
}

function exportChart(chart, format) {
  const exportCanvas = buildExportCanvas(chart);
  if (!exportCanvas) return;

  const fileBase = `inboxzero-${chart}-${new Date().toISOString().slice(0, 10)}`;
  if (format === "png") {
    downloadCanvasAsPng(exportCanvas, `${fileBase}.png`);
    return;
  }

  if (format === "pdf") {
    openPrintPdf(exportCanvas, chartTitle(chart));
  }
}

function buildExportCanvas(chart) {
  if (chart === "heatmap") return drawHeatmapExportCanvas();
  if (chart === "senders") return drawSendersExportCanvas();
  if (chart === "types") return drawTypesExportCanvas();
  return null;
}

function drawHeatmapExportCanvas() {
  const grid = state.analytics.heatmapGrid;
  const max = state.analytics.heatmapMax || 1;
  const width = 1320;
  const height = 560;
  const canvas = createExportCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  paintCanvasBg(ctx, width, height, "Email Activity Heatmap");

  const left = 120;
  const top = 92;
  const cell = 44;
  const gap = 6;

  ctx.fillStyle = "#9cb79a";
  ctx.font = "14px Space Grotesk";

  for (let h = 0; h < 24; h += 1) {
    if (h % 2 !== 0) continue;
    const x = left + h * (cell + gap) + 6;
    ctx.fillText(String(h), x, top - 12);
  }

  for (let d = 0; d < 7; d += 1) {
    ctx.fillText(dayLabels[d], 56, top + d * (cell + gap) + 28);
    for (let h = 0; h < 24; h += 1) {
      const value = grid[d][h];
      const level = heatLevelClass(value, max);
      const x = left + h * (cell + gap);
      const y = top + d * (cell + gap);

      ctx.fillStyle = heatLevelColor(level);
      roundRect(ctx, x, y, cell, cell, 8, true, false);
    }
  }

  return canvas;
}

function heatLevelColor(level) {
  const map = {
    "": "rgba(8, 12, 18, 0.9)",
    "level-1": "rgba(9, 30, 56, 0.95)",
    "level-2": "rgba(13, 52, 86, 0.95)",
    "level-3": "rgba(18, 78, 120, 0.96)",
    "level-4": "rgba(30, 100, 145, 0.96)",
    "level-5": "rgba(38, 124, 170, 0.98)",
    "level-6": "rgba(52, 152, 198, 0.98)",
    "level-7": "rgba(70, 186, 232, 1)",
  };
  return map[level] || map[""];
}

function drawSendersExportCanvas() {
  const top = state.analytics.topSenders;
  const width = 1200;
  const height = 700;
  const canvas = createExportCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  paintCanvasBg(ctx, width, height, "Who Wastes Most of Your Time");

  if (!top.length) {
    ctx.fillStyle = "#9cb79a";
    ctx.font = "24px Space Grotesk";
    ctx.fillText("No sender data yet. Upload a CSV first.", 70, 150);
    return canvas;
  }

  const max = Math.max(...top.map(([, n]) => n), 1);
  const chartLeft = 70;
  const chartTop = 110;
  const chartWidth = width - 140;
  const rowH = 62;

  top.forEach(([sender, count], i) => {
    const y = chartTop + i * (rowH + 14);
    const barW = Math.max(6, (count / max) * (chartWidth - 260));

    ctx.fillStyle = "#9cb79a";
    ctx.font = "20px Space Grotesk";
    ctx.fillText(`${i + 1}. ${truncate(sender, 44)}`, chartLeft, y + 24);

    ctx.fillStyle = "rgba(114, 214, 255,0.18)";
    roundRect(ctx, chartLeft, y + 30, chartWidth - 210, 20, 10, true, false);

    ctx.fillStyle = "#72d6ff";
    roundRect(ctx, chartLeft, y + 30, barW, 20, 10, true, false);

    ctx.fillStyle = "#efffec";
    ctx.font = "700 20px Space Grotesk";
    ctx.fillText(String(count), chartLeft + chartWidth - 190, y + 46);
  });

  return canvas;
}

function drawTypesExportCanvas() {
  const items = state.analytics.typeItems;
  const width = 980;
  const height = 640;
  const canvas = createExportCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  paintCanvasBg(ctx, width, height, "Email Types");

  if (!items.length) {
    ctx.fillStyle = "#9cb79a";
    ctx.font = "24px Space Grotesk";
    ctx.fillText("No type data yet. Upload a CSV first.", 70, 150);
    return canvas;
  }

  const total = items.reduce((sum, [, n]) => sum + n, 0);
  const cx = 280;
  const cy = 340;
  const radius = 180;

  let start = -Math.PI / 2;
  items.forEach(([label, value], i) => {
    const angle = (value / total) * Math.PI * 2;
    const end = start + angle;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = colors[i % colors.length];
    ctx.fill();

    start = end;

    const legendY = 170 + i * 56;
    ctx.fillStyle = colors[i % colors.length];
    roundRect(ctx, 530, legendY, 24, 24, 8, true, false);

    ctx.fillStyle = "#efffec";
    ctx.font = "20px Space Grotesk";
    ctx.fillText(label, 564, legendY + 20);

    ctx.fillStyle = "#9cb79a";
    ctx.fillText(`${Math.round((value / total) * 100)}%`, 860, legendY + 20);
  });

  ctx.beginPath();
  ctx.arc(cx, cy, 74, 0, Math.PI * 2);
  ctx.fillStyle = "#0d130d";
  ctx.fill();

  ctx.fillStyle = "#72d6ff";
  ctx.font = "700 26px Space Grotesk";
  ctx.textAlign = "center";
  ctx.fillText("Email", cx, cy - 8);
  ctx.fillStyle = "#9cb79a";
  ctx.font = "19px Space Grotesk";
  ctx.fillText("Types", cx, cy + 20);
  ctx.textAlign = "left";

  return canvas;
}

function paintCanvasBg(ctx, width, height, title) {
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, "#111911");
  grad.addColorStop(1, "#0a0f0a");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(114, 214, 255,0.2)";
  ctx.lineWidth = 1;
  ctx.strokeRect(10.5, 10.5, width - 21, height - 21);

  ctx.fillStyle = "#72d6ff";
  ctx.font = "700 34px Space Grotesk";
  ctx.fillText(title, 46, 56);

  ctx.fillStyle = "#9cb79a";
  ctx.font = "16px Space Grotesk";
  ctx.fillText("InboxZero Heatmap", 48, 84);
}

function downloadCanvasAsPng(canvas, filename) {
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = filename;
  a.click();
}

function openPrintPdf(canvas, title) {
  const dataUrl = canvas.toDataURL("image/png");
  const safeTitle = escapeHtml(title);
  const win = window.open("", "_blank");
  if (!win) {
    window.alert("Popup blocked. Please allow popups for PDF export.");
    return;
  }

  win.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${safeTitle}</title>
    <style>
      body {
        margin: 0;
        background: #060806;
        color: #efffec;
        font-family: "Space Grotesk", sans-serif;
        display: grid;
        place-items: center;
        min-height: 100vh;
      }
      main {
        width: min(1000px, calc(100% - 2rem));
      }
      img {
        width: 100%;
        border: 1px solid rgba(114, 214, 255, 0.3);
        border-radius: 12px;
      }
      @media print {
        body {
          background: white;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <img src="${dataUrl}" alt="${safeTitle}" />
    </main>
    <script>
      window.onload = () => window.print();
    </script>
  </body>
</html>`);
  win.document.close();
}

function createExportCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function chartTitle(chart) {
  if (chart === "heatmap") return "Email Activity Heatmap";
  if (chart === "senders") return "Who Wastes Most of Your Time";
  if (chart === "types") return "Email Types";
  return "Chart";
}

function truncate(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}...`;
}

function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

function countBy(rows, keyFn) {
  const map = new Map();
  rows.forEach((r) => {
    const key = keyFn(r) || "Unknown";
    map.set(key, (map.get(key) || 0) + 1);
  });
  return map;
}

function topEntry(map) {
  let top = null;
  map.forEach((v, k) => {
    if (!top || v > top[1]) top = [k, v];
  });
  return top;
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildSampleData() {
  const senders = [
    "team@asana.com",
    "alerts@github.com",
    "promo@store.com",
    "calendar@google.com",
    "newsletter@producthunt.com",
    "finance@bank.com",
    "ops@company.io",
  ];

  const subjects = [
    "Meeting moved to 2PM",
    "Invoice #3102",
    "50% off promo",
    "Deployment alert",
    "Your weekly newsletter",
    "Payment receipt",
    "Schedule update",
  ];

  const now = new Date();
  const rows = [];

  for (let i = 0; i < 240; i += 1) {
    const d = new Date(now);
    const offsetDay = Math.floor(Math.random() * 21);
    d.setDate(d.getDate() - offsetDay);
    d.setHours(Math.floor(Math.random() * 24));
    d.setMinutes(Math.floor(Math.random() * 60));

    const from = senders[Math.floor(Math.random() * senders.length)];
    const subject = subjects[Math.floor(Math.random() * subjects.length)];
    rows.push({
      date: d,
      from,
      subject,
      category: detectCategory(subject, from),
    });
  }

  return rows;
}

render();
