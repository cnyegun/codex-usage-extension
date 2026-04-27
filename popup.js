const SNAPSHOT_KEY = "codexUsageSnapshotV3";
const AUTH_SESSION_URL = "https://chatgpt.com/api/auth/session";
const USAGE_API_URL = "https://chatgpt.com/backend-api/wham/usage";
const USAGE_API_PATH = "/backend-api/wham/usage";

const extensionApi = globalThis.browser || globalThis.chrome;
const usesPromiseApi = Boolean(globalThis.browser);

const statusEl = document.querySelector("#status");
const skeletonEl = document.querySelector("#skeleton");
const snapshotEl = document.querySelector("#snapshot");
const quotaGridEl = document.querySelector("#quota-grid");
const planValueEl = document.querySelector("#plan-value");
const creditsValueEl = document.querySelector("#credits-value");
const refreshButton = document.querySelector("#refresh");
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

function runtimeError() {
  return usesPromiseApi ? null : extensionApi.runtime.lastError;
}

function storageGet(keys) {
  if (usesPromiseApi) return extensionApi.storage.local.get(keys);

  return new Promise((resolve, reject) => {
    extensionApi.storage.local.get(keys, (result) => {
      const error = runtimeError();
      if (error) reject(new Error(error.message));
      else resolve(result);
    });
  });
}

function storageSet(value) {
  if (usesPromiseApi) return extensionApi.storage.local.set(value);

  return new Promise((resolve, reject) => {
    extensionApi.storage.local.set(value, () => {
      const error = runtimeError();
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function showOnly(element) {
  statusEl.hidden = element !== statusEl;
  skeletonEl.hidden = element !== skeletonEl;
  snapshotEl.hidden = element !== snapshotEl;
}

function setStatus(message) {
  statusEl.textContent = message;
  showOnly(statusEl);
}

function setRefreshBusy(isBusy) {
  refreshButton.disabled = isBusy;
  refreshButton.textContent = isBusy ? "Refreshing..." : "Refresh";
}

function formatDateTime(value) {
  return dateTimeFormatter.format(new Date(value));
}

function formatTimeRemaining(value) {
  const minutes = Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 60000));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours > 0 && remainingMinutes > 0) return `${hours}h ${remainingMinutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${remainingMinutes}m`;
}

function formatPercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${Math.round(value * 10) / 10}%`;
}

function quotaWindowName(quota) {
  const seconds = quota?.limit_window_seconds;
  if (seconds <= 6 * 60 * 60) return "5-hour";
  if (seconds >= 6 * 24 * 60 * 60) return "Weekly";
  return "Usage";
}

function toResetDate(quota) {
  const resetAt = quota?.reset_at;
  if (typeof resetAt !== "number") return null;
  return new Date(resetAt > 10 ** 11 ? resetAt : resetAt * 1000);
}

function decodeJwtPayload(token) {
  const payload = token.split(".")[1];
  if (!payload) return null;

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function findAccessToken(value) {
  if (!value || typeof value !== "object") return null;

  for (const [key, entry] of Object.entries(value)) {
    if (/^access_?token$/i.test(key) && typeof entry === "string" && entry.split(".").length === 3) {
      return entry;
    }
  }

  for (const entry of Object.values(value)) {
    const token = findAccessToken(entry);
    if (token) return token;
  }

  return null;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "include",
    redirect: "follow",
    ...options,
    headers: {
      accept: "application/json",
      ...options.headers
    }
  });

  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("json") ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof body === "object" && body?.detail ? body.detail : `HTTP ${response.status}`;
    throw new Error(message);
  }

  if (typeof body !== "object" || body == null) {
    throw new Error("ChatGPT returned a non-JSON response. Make sure you are signed in.");
  }

  return body;
}

async function getChatGptSession() {
  const session = await fetchJson(AUTH_SESSION_URL);
  const accessToken = findAccessToken(session);

  if (!accessToken) {
    throw new Error("Could not read ChatGPT access token. Sign in to ChatGPT in this Firefox profile, then try again.");
  }

  const claims = decodeJwtPayload(accessToken);
  const authClaims = claims?.["https://api.openai.com/auth"] || {};

  return {
    accessToken,
    accountId: authClaims.chatgpt_account_id || null
  };
}

async function fetchCodexUsage() {
  const { accessToken, accountId } = await getChatGptSession();

  const headers = {
    authorization: `Bearer ${accessToken}`,
    "oai-language": navigator.language || "en-US",
    "x-openai-target-path": USAGE_API_PATH,
    "x-openai-target-route": USAGE_API_PATH
  };

  if (accountId) headers["chatgpt-account-id"] = accountId;

  return fetchJson(USAGE_API_URL, { headers });
}

function normalizeWindow(quota) {
  if (!quota || typeof quota !== "object") return null;

  const usedPercent = Number(quota.used_percent);
  return {
    name: quotaWindowName(quota),
    remainingPercent: Number.isFinite(usedPercent) ? Math.max(0, 100 - usedPercent) : 0,
    resetAt: toResetDate(quota)
  };
}

function normalizeUsage(data) {
  const rateLimit = data.rate_limit || {};
  const windows = ["primary_window", "secondary_window"]
    .map((key) => normalizeWindow(rateLimit[key]))
    .filter(Boolean);

  return {
    planType: data.plan_type || "unknown",
    credits: data.credits || {},
    windows
  };
}

function creditBalance(credits) {
  if (credits?.unlimited) return "Unlimited";
  return String(credits?.balance ?? 0);
}

function titleCase(value) {
  return String(value)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function clampPercent(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(value, 100)) : 0;
}

function textElement(tagName, className, text) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function createQuotaCard(quota) {
  const card = document.createElement("article");
  card.className = "quota-card";

  const meter = document.createElement("div");
  meter.className = "meter";

  const fill = document.createElement("div");
  fill.className = "meter-fill";
  fill.style.setProperty("--fill", `${clampPercent(quota.remainingPercent)}%`);
  meter.append(fill);

  const footer = document.createElement("div");
  footer.className = "quota-footer";
  const resetText = quota.resetAt
    ? quota.name === "5-hour"
      ? `Resets in ${formatTimeRemaining(quota.resetAt)}`
      : `Resets ${formatDateTime(quota.resetAt)}`
    : "Reset unknown";

  footer.append(
    textElement("strong", "quota-value", `${formatPercent(quota.remainingPercent)} left`),
    textElement("span", "quota-reset", resetText)
  );

  card.append(textElement("span", "quota-title", `${quota.name} limit`), meter, footer);

  return card;
}

function renderSnapshot(snapshot) {
  if (!snapshot?.windows?.length) {
    setStatus("No Codex usage data yet. Click Refresh to fetch it directly from ChatGPT.");
    return;
  }

  showOnly(snapshotEl);
  quotaGridEl.replaceChildren(...snapshot.windows.map(createQuotaCard));

  planValueEl.textContent = titleCase(snapshot.planType);
  creditsValueEl.textContent = creditBalance(snapshot.credits);
}

async function load() {
  const state = await storageGet(SNAPSHOT_KEY);
  const snapshot = state[SNAPSHOT_KEY];

  if (snapshot?.windows?.length) {
    renderSnapshot(snapshot);
  } else {
    showOnly(skeletonEl);
  }

  await refresh({ quiet: Boolean(snapshot?.windows?.length) });
}

async function refresh({ quiet = false } = {}) {
  try {
    setRefreshBusy(true);
    if (!quiet) showOnly(skeletonEl);
    const rawUsage = await fetchCodexUsage();
    const snapshot = normalizeUsage(rawUsage);
    await storageSet({ [SNAPSHOT_KEY]: snapshot });
    renderSnapshot(snapshot);
  } catch (error) {
    if (!quiet) {
      setStatus(`${error.message} If this persists, open ChatGPT once in this Firefox profile and sign in again.`);
    }
  } finally {
    setRefreshBusy(false);
  }
}

refreshButton.addEventListener("click", () => refresh());

load().catch((error) => setStatus(error.message));
