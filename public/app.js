const state = {
  version: "",
  mode: "",
  user: null,
  weekKey: "",
  week: null,
  options: [],
  account: null,
  rate: 0,
  loadedAt: "",
  settings: null,
  users: [],
  tab: "tasks",
  editing: null,
  addTask: false,
  optionType: "homework",
  scheduleOpen: false,
  error: "",
  notice: "",
  busy: false
};

const ROLE_RANK = { student: 1, parent: 2, admin: 3 };
const ERROR_TEXT = {
  invalid_credentials: "用户名或密码不对",
  invalid_setup_token: "设置码不对",
  unauthorized: "登录已过期，请重新登录",
  forbidden: "当前账号没有这个权限",
  not_done_yet: "学生还没点完成",
  already_confirmed: "已经确认过了",
  last_admin: "至少要保留一个启用状态的管理员",
  cannot_lock_self: "不能停用或降级自己",
  confirmed_locked: "已确认的作业只有家长能改",
  username_taken: "用户名已存在",
  invalid_password: "密码至少 6 位",
  invalid_username: "用户名只能用小写字母、数字、下划线、点和连字符",
  invalid_url: "地址必须以 http:// 或 https:// 开头",
  invalid_confirm: "确认文字不对，已取消",
  setup_disabled: "服务端未配置 SETUP_TOKEN，无法初始化",
  database_not_configured: "数据库未绑定",
  invalid_rate: "折现比例要在 0–100 之间",
  invalid_checklist: "清单截止时间不对",
  invalid_early: "提前分第一档时间不对",
  invalid_mid: "提前分第二档时间不对",
  invalid_hard: "提前分第三档时间不对",
  invalid_week_end: "收工截止时间不对",
  invalid_range: "放假起止日期不对",
  invalid_schedule_order: "时间先后不对：清单截止 ≤ 提前分三档 ≤ 收工截止",
  insufficient_points: "积分不够，先驳回或确认透支",
  server_error: "服务端出错，稍后重试"
};

const STATUS_LABEL = { pending: "待完成", done: "待家长确认", confirmed: "已确认" };
const ROLE_TEXT = { student: "学生", parent: "家长", admin: "管理员" };

const view = document.getElementById("view");

let pendingButton = null;

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

function errorText(code) {
  return ERROR_TEXT[code] || code || "请求失败";
}

async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error = new Error(errorText(data?.error || `HTTP ${response.status}`));
    if (data?.detail) error.detail = data.detail;
    error.code = data?.error || "";
    throw error;
  }
  return data;
}

function can(role) {
  return (ROLE_RANK[state.user?.role] || 0) >= ROLE_RANK[role];
}

function fmtTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const shifted = new Date(date.getTime() + 8 * 3600 * 1000);
  const pad = (value) => String(value).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

function fmtMinutes(total) {
  const value = Number(total) || 0;
  if (!value) return "0 分钟";
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (!hours) return `${minutes} 分钟`;
  return minutes ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
}

function fmtMoney(points, rate) {
  const value = (Number(points) || 0) * (Number(rate) || 0);
  if (!value) return "";
  return `¥${value.toFixed(2).replace(/\.?0+$/, "")}`;
}

function moneyOf(points, rate) {
  const amount = fmtMoney(points, rate === null || rate === undefined ? state.rate : rate);
  return amount ? ` ≈ ${amount}` : "";
}

function fmtClock(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const DONE_PRAISE = [
  "搞定一条，继续保持 ⚡",
  "漂亮，进度条又长了一截 📈",
  "干得利索，给自己鼓个掌 👏",
  "完成一条，离自由时间更近了 🏖️",
  "稳得很，接着来 ✅"
];

const CONFETTI_COLORS = ["#4c7cf3", "#f2994a", "#27ae60", "#eb5757", "#9b51e0", "#f2c94c"];

function pickPraise() {
  return DONE_PRAISE[Math.floor(Math.random() * DONE_PRAISE.length)];
}

function celebrate(count = 70) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  for (let index = 0; index < count; index += 1) {
    const piece = document.createElement("i");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.width = `${6 + Math.random() * 6}px`;
    piece.style.height = `${8 + Math.random() * 8}px`;
    piece.style.background = CONFETTI_COLORS[index % CONFETTI_COLORS.length];
    piece.style.animationDelay = `${(Math.random() * 0.5).toFixed(2)}s`;
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 3200);
  }
}

function fmtDay(ms) {
  const date = new Date(Number(ms));
  if (Number.isNaN(date.getTime())) return "";
  const shifted = new Date(date.getTime() + 8 * 3600 * 1000);
  const pad = (value) => String(value).padStart(2, "0");
  return `${shifted.getUTCMonth() + 1}/${shifted.getUTCDate()} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

function deadlinesOf(week = state.week) {
  const schedule = week?.schedule;
  if (schedule?.deadlines) return schedule.deadlines;
  if (schedule && ["fridayChecklist", "saturdayEarly", "saturdayMid", "saturdayHard", "weekEnd"].some((key) => Number.isFinite(Number(schedule[key])))) {
    const base = weekDeadlinesClient(week.weekKey);
    for (const key of Object.keys(base)) {
      if (Number.isFinite(Number(schedule[key]))) base[key] = Number(schedule[key]);
    }
    return base;
  }
  return weekDeadlinesClient(week?.weekKey || state.weekKey);
}

function weekDeadlinesClient(weekKey) {
  const start = Date.parse(`${weekKey}T00:00:00+08:00`);
  if (!Number.isFinite(start)) return { fridayChecklist: 0, saturdayEarly: 0, saturdayMid: 0, saturdayHard: 0, weekEnd: 0 };
  return {
    fridayChecklist: start + 21 * 3600000,
    saturdayEarly: start + 39 * 3600000,
    saturdayMid: start + 42 * 3600000,
    saturdayHard: start + 45 * 3600000,
    weekEnd: start + 3 * 86400000
  };
}

// 跟服务端 worker/holidays.js 的推导保持一致的假期时间：提前分三档挪到假期最后一天，收工截止是最后一天 24:00。
function deriveFromRangeClient(weekKey, rangeStart, rangeEnd) {
  const weekStart = Date.parse(`${weekKey}T00:00:00+08:00`);
  const start = Date.parse(`${rangeStart}T00:00:00+08:00`);
  const end = Date.parse(`${rangeEnd}T00:00:00+08:00`);
  if (!Number.isFinite(weekStart) || !Number.isFinite(start) || !Number.isFinite(end) || end < start || end < weekStart) return null;
  return {
    fridayChecklist: Math.min(weekStart + 21 * 3600000, end + 15 * 3600000),
    saturdayEarly: end + 15 * 3600000,
    saturdayMid: end + 18 * 3600000,
    saturdayHard: end + 21 * 3600000,
    weekEnd: end + 86400000
  };
}

function msFromLocalInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return NaN;
  return Date.parse(`${raw.slice(0, 16)}:00+08:00`);
}

function deadlineHint(week = state.week) {
  if (!week) return "";
  const deadlines = deadlinesOf(week);
  if (!Number.isFinite(deadlines.fridayChecklist) || !deadlines.fridayChecklist) return week.hint || "";
  return `清单截止 ${fmtDay(deadlines.fridayChecklist)} · 提前分三档 ${fmtDay(deadlines.saturdayEarly)} / ${fmtDay(deadlines.saturdayMid)} / ${fmtDay(deadlines.saturdayHard)} · 收工截止 ${fmtDay(deadlines.weekEnd)}`;
}

function toLocalInput(iso) {
  if (!iso) return "";
  const ms = typeof iso === "number" ? iso : Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const shifted = new Date(ms + 8 * 3600000);
  const pad = (value) => String(value).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

function fromLocalInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = Date.parse(`${raw.length === 16 ? raw : raw.slice(0, 16)}:00+08:00`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function earlyPraise(week = state.week) {
  const deadlines = deadlinesOf(week);
  const now = Date.now();
  if (!Number.isFinite(deadlines.saturdayHard)) return "等家长确认后计入完成率";
  if (now <= deadlines.saturdayEarly) return `提前分能拿满 +10 🚀（${fmtDay(deadlines.saturdayEarly)} 前）`;
  if (now <= deadlines.saturdayMid) return `提前分 +8 ⚡（${fmtDay(deadlines.saturdayMid)} 前）`;
  if (now <= deadlines.saturdayHard) return `赶在 ${fmtDay(deadlines.saturdayHard)} 收工，提前分 +5 👌`;
  return "虽然踩线晚了一点，但全部完成就是硬实力 💪";
}

function cheerText(summary) {
  if (!summary.total) return "先加一条作业，开个好头 ✏️";
  const handled = summary.total - summary.pending;
  if (!handled) return `还有 ${summary.total} 条，先挑最顺手的开工 🚀`;
  if (!summary.pending) return "全部作业都打卡完成，等家长确认后完成率拉满 🎉";
  return `已搞定 ${handled}/${summary.total}，剩下的接着冲 💪`;
}

function rewardNudge() {
  const balance = Number(state.week.account?.balance) || 0;
  const rewards = state.options.filter((option) => option.type === "reward" && option.active && option.points);
  const next = rewards.filter((option) => option.points > balance).sort((a, b) => a.points - b.points)[0];
  if (next) return `再攒 ${next.points - balance} 分就能换「${esc(next.title)}」，冲一把 🎯`;
  if (rewards.length) return "积分够用，想换哪个直接申请 🎁";
  return "";
}

function totalMinutes(key) {
  return state.week.tasks.reduce((sum, task) => sum + (Number(task[key]) || 0), 0);
}

function inlineMinutes(taskId) {
  const input = document.getElementById(`done-min-${taskId}`);
  if (!input || input.value === "") return null;
  const value = Number(input.value);
  return Number.isFinite(value) ? Math.max(0, Math.min(600, Math.round(value))) : null;
}

function doneBody(taskId) {
  const actualMinutes = inlineMinutes(taskId);
  return actualMinutes === null ? {} : { actualMinutes };
}

function timeSummary() {
  const estimate = totalMinutes("estMinutes");
  const actual = totalMinutes("actualMinutes");
  if (!estimate && !actual) return "";
  const gap = actual && estimate ? actual - estimate : 0;
  const parts = [estimate ? `预估 ${fmtMinutes(estimate)}` : "", actual ? `实际 ${fmtMinutes(actual)}` : "", gap ? `差 ${gap > 0 ? "+" : ""}${gap} 分钟` : ""].filter(Boolean);
  return parts.length ? `<div class="small muted">用时：${parts.join(" · ")}</div>` : "";
}

function shiftWeekKey(weekKey, delta) {
  const start = Date.parse(`${weekKey}T00:00:00.000+08:00`);
  const shifted = new Date(start + delta * 7 * 24 * 3600 * 1000 + 8 * 3600 * 1000);
  return Number.isNaN(shifted.getTime()) ? weekKey : shifted.toISOString().slice(0, 10);
}

async function loadSession() {
  const me = await api("/api/me");
  state.user = me.user;
  state.weekKey = me.weekKey;
  state.version = me.version;
}

async function loadWeek(weekKey = state.weekKey) {
  state.week = await api(`/api/week?week=${encodeURIComponent(weekKey)}`);
  state.weekKey = state.week.weekKey;
  state.rate = Number(state.week.rate) || 0;
  state.loadedAt = new Date().toISOString();
}

async function loadOptions() {
  const all = can("parent") ? "&all=1" : "";
  state.options = (await api(`/api/options?${all}`)).options;
}

async function loadAdmin() {
  if (!can("admin")) return;
  const [settings, users] = await Promise.all([api("/api/settings"), api("/api/users")]);
  state.settings = settings.webdav;
  state.log = settings.log;
  state.users = users.users;
}

async function refreshAll() {
  await Promise.all([loadWeek(), loadOptions(), loadAdmin()]);
  state.account = await api("/api/account");
}

function setNotice(notice) {
  state.notice = notice;
  state.error = "";
}

async function run(action, successMessage) {
  if (state.busy) return;
  state.busy = true;
  state.error = "";
  const button = pendingButton;
  pendingButton = null;
  if (button) {
    button.disabled = true;
    button.classList.add("loading");
  }
  document.body.classList.add("busy");
  try {
    await action();
    if (successMessage) setNotice(successMessage);
  } catch (error) {
    state.error = String(error.message || error);
    state.notice = "";
  } finally {
    state.busy = false;
    document.body.classList.remove("busy");
    render();
  }
}

function optionsOf(type) {
  return state.options.filter((option) => option.type === type && option.active);
}

function currentDetail() {
  const week = state.week;
  if (week.score) return week.score.detail;
  const detail = {};
  for (const item of week.scoreKeys) {
    const auto = week.auto[item.key] || 0;
    detail[item.key] = item.key === "F" || item.key === "G" ? Math.max(auto, item.max) : auto;
  }
  detail.bonus = week.auto.bonus || 0;
  detail.deduction = week.auto.deduction || 0;
  return detail;
}

function detailTotal(detail) {
  const keys = state.week.scoreKeys.map((item) => item.key);
  const sum = keys.reduce((total, key) => total + (Number(detail[key]) || 0), 0);
  return Math.max(0, sum + (Number(detail.bonus) || 0) - (Number(detail.deduction) || 0));
}

const BRAND_SVG = `<svg class="brand" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><defs><linearGradient id="whLogoBg" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2563eb" /><stop offset="1" stop-color="#06b6d4" /></linearGradient></defs><rect width="48" height="48" fill="url(#whLogoBg)" /><rect x="9.5" y="8" width="29" height="32" rx="7" fill="#ffffff" /><rect x="15" y="14.5" width="18" height="2.8" rx="1.4" fill="#cbd5e1" /><rect x="15" y="21" width="12" height="2.8" rx="1.4" fill="#cbd5e1" /><path d="M15.5 30.2l4.6 4.6 9.6-10.2" fill="none" stroke="#10b981" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round" /></svg>`;

function render() {
  if (state.mode === "setup") return renderSetup();
  if (state.mode === "closed") return renderClosed();
  if (!state.user) return renderLogin();

  const tabs = [
    ["tasks", "作业"],
    ["rewards", "奖励"]
  ];
  if (can("parent")) tabs.push(["settle", "结算"]);
  tabs.push(["account", "账户"]);
  tabs.push(["options", "选项库"]);
  if (can("admin")) tabs.push(["admin", "设置"]);

  view.innerHTML = `
    <header class="appbar">
      <div class="appbar-row">
        <h1>${BRAND_SVG}周末作业打卡</h1>
        <div class="who">
          ${esc(state.user.displayName)} · ${ROLE_TEXT[state.user.role]}<br />
          <button class="link small" data-act="refresh">刷新</button>
          <button class="link small" data-act="logout">退出</button>
          <span class="small">v${esc(state.version)}</span>
          ${state.loadedAt ? `<br /><span class="small muted">更新于 ${fmtClock(state.loadedAt)}</span>` : ""}
        </div>
      </div>
      <nav class="tabs">
        ${tabs.map(([key, label]) => `<button data-act="tab" data-tab="${key}" aria-current="${state.tab === key}">${label}</button>`).join("")}
      </nav>
    </header>
    ${banner()}
    ${renderTab()}
  `;
}

function banner() {
  if (state.error) return `<div class="notice error">${esc(state.error)}</div>`;
  if (state.notice) return `<div class="notice ok">${esc(state.notice)}</div>`;
  return `<div class="notice info small">${esc(deadlineHint())}</div>`;
}

function renderTab() {
  if (!state.week) return `<div class="card">加载中…</div>`;
  switch (state.tab) {
    case "rewards":
      return renderRewards();
    case "settle":
      return renderSettle();
    case "account":
      return renderAccount();
    case "options":
      return renderOptions();
    case "admin":
      return renderAdmin();
    default:
      return renderTasks();
  }
}

function weekBar() {
  return `
    <div class="card plain">
      <div style="text-align:center">
        <strong>${esc(state.week.label)}</strong>
        ${state.week.isCurrent ? '<span class="tag">本周</span>' : ""}
        ${state.week.score ? `<div class="small muted">已结算 ${state.week.score.total} 分${moneyOf(state.week.score.total, state.week.score.rate)} · ${fmtTime(state.week.score.settledAt)}</div>` : ""}
      </div>
      <div class="row between" style="margin-top:8px">
        <button class="tiny" data-act="week" data-delta="-1">← 上一周</button>
        <button class="tiny" data-act="week" data-delta="1" ${state.week.isCurrent ? "disabled" : ""}>下一周 →</button>
      </div>
    </div>
  `;
}

function renderTasks() {
  const summary = state.week.summary;
  const percent = summary.total ? Math.round(((summary.done + summary.confirmed) / summary.total) * 100) : 0;
  const detail = currentDetail();
  return `
    ${weekBar()}
    <div class="card">
      <div class="stat-main">
        <div class="num mono">${summary.done + summary.confirmed}/${summary.total}</div>
        <div class="small muted">${summary.total ? `已搞定 · 进度 ${percent}%` : "本周一条作业都还没有"}</div>
      </div>
      <div class="stat-grid">
        <div><div class="num mono">${summary.pending}</div><div class="small muted">待完成</div></div>
        <div><div class="num mono">${summary.done}</div><div class="small muted">等家长确认</div></div>
        <div><div class="num mono">${summary.confirmed}</div><div class="small muted">已确认</div></div>
        <div><div class="num mono">${detailTotal(detail)}</div><div class="small muted">本周得分（暂算）</div></div>
      </div>
      <div class="bar" style="margin-top:10px"><i style="width:${percent}%"></i></div>
      <div class="small muted" style="margin-top:6px">${cheerText(summary)}</div>
      ${timeSummary() ? `<div style="margin-top:10px">${timeSummary()}</div>` : ""}
    </div>
    <div class="card">
      <div class="row between">
        <strong>作业清单</strong>
        ${can("parent") ? `<button class="tiny" data-act="confirm-all">全部确认已完成</button>` : ""}
      </div>
    </div>
    ${state.week.tasks.map(taskCard).join("") || '<div class="card muted">这周还没有任务，先点下面的按钮加一条。</div>'}
    ${state.addTask ? addTaskForm() : '<button class="primary" data-act="toggle-add" style="width:100%">+ 添加作业</button>'}
  `;
}

function taskCard(task) {
  const isParent = can("parent");
  const actions = [];
  if (task.status === "pending") {
    actions.push(`<label class="inline-min"><span>实际用时（分钟）</span>
      <input id="done-min-${task.id}" type="number" min="0" max="600" inputmode="numeric"
        value="${task.actualMinutes ?? task.estMinutes ?? ""}" placeholder="${task.estMinutes ?? "？"}" /></label>`);
    actions.push('<button class="primary" data-act="task-done" data-id="' + task.id + '">我完成了</button>');
    if (isParent) actions.push('<button class="ok" data-act="task-complete" data-id="' + task.id + '">直接完成并确认</button>');
  }
  if (task.status === "done") {
    if (isParent) actions.push('<button class="ok" data-act="task-confirm" data-id="' + task.id + '">确认</button>');
    if (isParent) actions.push('<button class="ghost" data-act="task-reopen" data-id="' + task.id + '">撤销</button>');
  }
  if (task.status === "confirmed" && isParent) {
    actions.push('<button class="ghost" data-act="task-reopen" data-id="' + task.id + '">撤销确认</button>');
  }
  if (isParent || task.status !== "confirmed") {
    actions.push('<button class="tiny" data-act="task-edit" data-id="' + task.id + '">编辑</button>');
  }
  if (isParent) {
    actions.push('<button class="tiny danger" data-act="task-delete" data-id="' + task.id + '">删除</button>');
  }

  const who = [];
  if (task.doneAt) who.push(`${task.doneVia === "parent" ? "家长代办" : "学生完成"} ${fmtTime(task.doneAt)}`);
  if (task.confirmedAt) who.push(`家长确认 ${fmtTime(task.confirmedAt)}`);
  const minutes = `预估 ${task.estMinutes ? fmtMinutes(task.estMinutes) : "未填"}${task.actualMinutes ? ` · 实际 ${fmtMinutes(task.actualMinutes)}` : ""}`;

  const quality = isParent && task.status !== "pending"
    ? `<div class="quality"><span class="small muted">质量分（每科算平均，未评按满分 4 分）</span>
        <div class="seg">
          ${[0, 1, 2, 3, 4].map((value) => `<span class="seg-btn" role="button" tabindex="0" data-act="task-quality" data-id="${task.id}" data-value="${value}" aria-pressed="${Number(task.quality ?? 4) === value}">${value}</span>`).join("")}
        </div></div>`
    : "";

  return `
    <article class="card task ${task.status}">
      <div class="row between">
        <div class="grow">
          <h3>${esc(task.title)}</h3>
          <div class="small muted" style="margin-top:3px">
            ${task.sourceOptionId ? '<span class="tag">固定</span>' : ""}
            ${task.subject ? `<span class="tag">${esc(task.subject)}</span>` : ""}
            <span class="tag">${esc(minutes)}</span>
            ${task.planSlot ? `<span class="tag">${esc(task.planSlot)}</span>` : ""}
            ${who.length ? esc(who.join(" · ")) : ""}
          </div>
          ${task.note ? `<p class="note">${esc(task.note)}</p>` : ""}
        </div>
        <span class="pill ${task.status}">${STATUS_LABEL[task.status]}</span>
      </div>
      <div class="actions">${actions.join("")}</div>
      ${state.editing === task.id ? editForm(task) : ""}
      ${quality}
    </article>
  `;
}

function editForm(task) {
  return `
    <form class="editor" data-form="task-edit" data-id="${task.id}">
      <label class="field"><span>标题</span><input name="title" value="${esc(task.title)}" required maxlength="120" /></label>
      <div class="grid3">
        <label class="field"><span>科目</span><input name="subject" value="${esc(task.subject || "")}" maxlength="20" /></label>
        <label class="field"><span>预估分钟</span><input name="estMinutes" type="number" min="0" max="600" value="${task.estMinutes ?? ""}" /></label>
        <label class="field"><span>实际分钟</span><input name="actualMinutes" type="number" min="0" max="600" value="${task.actualMinutes ?? ""}" /></label>
      </div>
      <label class="field"><span>计划时段</span><input name="planSlot" value="${esc(task.planSlot || "")}" maxlength="40" /></label>
      <label class="field"><span>备注</span><textarea name="note" maxlength="500">${esc(task.note || "")}</textarea></label>
      <div class="actions">
        <button class="primary" type="submit">保存</button>
        <button type="button" class="ghost" data-act="task-edit" data-id="${task.id}">取消</button>
      </div>
    </form>
  `;
}

function addTaskForm() {
  const templates = optionsOf("homework");
  return `
    <form class="card" data-form="task-add">
      ${templates.length ? `<label class="field"><span>从常用作业里选</span>
        <select data-act="fill-template">
          <option value="">不选，手动填写</option>
          ${templates.map((option) => `<option value="${option.id}">${esc(option.title)}${option.subject ? ` · ${esc(option.subject)}` : ""}</option>`).join("")}
        </select></label>` : ""}
      <label class="field"><span>标题</span><input name="title" required maxlength="120" placeholder="例如：数学卷子 P32–P35" /></label>
      <div class="grid3">
        <label class="field"><span>科目</span><input name="subject" maxlength="20" placeholder="数学" /></label>
        <label class="field"><span>预估分钟（自己估）</span><input name="estMinutes" type="number" min="0" max="600" placeholder="40" /></label>
        <label class="field"><span>计划时段</span><input name="planSlot" maxlength="40" placeholder="周六上午" /></label>
      </div>
      <label class="field"><span>备注</span><input name="note" maxlength="500" placeholder="选填" /></label>
      <label class="row small" style="gap:6px;margin-bottom:10px">
        <input type="checkbox" name="saveAsOption" style="width:auto" /> 存进常用作业，下次直接选
      </label>
      <div class="actions">
        <button class="primary" type="submit">添加</button>
        <button type="button" class="ghost" data-act="toggle-add">取消</button>
      </div>
    </form>
  `;
}

function renderRewards() {
  const balance = state.week.account.balance;
  const rewards = optionsOf("reward");
  const redemptions = state.week.redemptions;
  const nudge = rewardNudge();
  return `
    ${weekBar()}
    <div class="card row between">
      <div><div class="num mono" style="font-size:20px">${balance}</div><div class="small muted">可用积分</div></div>
      <div class="small muted" style="text-align:right">
        累计 ${state.week.account.earned} · 已兑换 ${state.week.account.spent}<br />
        待审批 ${state.week.account.pending}
      </div>
    </div>
    ${balance < 0 ? '<div class="notice info small">兑换已经批准、积分先欠着，下次结算补上就行。</div>' : ""}
    ${nudge ? `<div class="small muted" style="margin:-2px 2px 10px">${nudge}</div>` : ""}
    <h2>奖励目录</h2>
    ${rewards.map((option) => `
      <div class="card row between">
        <div class="grow">
          <strong>${esc(option.title)}</strong>
          <div class="small muted">${option.points ? `${option.points} 积分` : "价格待定，申请时填"}</div>
        </div>
        <button class="primary tiny" data-act="redeem" data-id="${option.id}" data-points="${option.points ?? ""}" data-title="${esc(option.title)}">申请兑换</button>
      </div>
    `).join("") || '<div class="card muted">还没有奖励，去「选项库」里加。</div>'}
    <form class="card" data-form="redeem-custom">
      <strong>自定义兑换</strong>
      <div class="grid2" style="margin-top:9px">
        <label class="field"><span>奖励内容</span><input name="title" required maxlength="120" placeholder="周六晚多玩 40 分钟" /></label>
        <label class="field"><span>花费积分</span><input name="points" type="number" min="1" required placeholder="20" /></label>
      </div>
      <button class="primary" type="submit">提交申请</button>
    </form>
    <h2>本周兑换记录</h2>
    <div class="list">
      ${redemptions.map((item) => `
        <div class="item">
          <div class="grow">
            <strong>${esc(item.title)}</strong>
            <div class="small muted">${item.points} 分 · ${fmtTime(item.requestedAt)}</div>
          </div>
          ${item.status === "pending" && can("parent")
            ? `<button class="ok tiny" data-act="redeem-decide" data-id="${item.id}" data-status="approved">批准</button>
               <button class="tiny" data-act="redeem-decide" data-id="${item.id}" data-status="rejected">驳回</button>`
            : `<span class="pill ${item.status}">${item.status === "approved" ? "已批准" : item.status === "rejected" ? "已驳回" : "待审批"}</span>`}
        </div>
      `).join("") || '<div class="item muted">这周还没有兑换记录</div>'}
    </div>
  `;
}

function renderSchedule() {
  const schedule = state.week.schedule || {};
  const deadlines = deadlinesOf();
  const holiday = schedule.source === "auto" ? schedule.holiday : null;
  return `
    <div class="card">
      <div class="row between">
        <strong>本周时间设置</strong>
        <button class="tiny" data-act="schedule-toggle">${state.scheduleOpen ? "收起" : "修改"}</button>
      </div>
      ${holiday ? `<div class="small" style="margin-top:6px">按${esc(holiday.name)}（${esc(holiday.start)} ~ ${esc(holiday.end)}）自动排的时间，可以直接改，改完保存就按你填的算。</div>` : ""}
      <div class="small muted" style="margin-top:6px">${esc(deadlineHint())}</div>
      ${schedule.note ? `<div class="small" style="margin-top:4px">备注：${esc(schedule.note)}</div>` : ""}
      ${state.scheduleOpen ? `
        <form class="editor" data-form="schedule">
          <div class="small muted" style="margin-bottom:8px">放假不一定在周五到周日。填了放假起止日期，提前分三档按假期最后一天 15:00 / 18:00 / 21:00、收工截止按最后一天 24:00 算；不填就走默认（清单周五 21:00、提前分周六 15:00 / 18:00 / 21:00、收工周日 24:00）。</div>
          <div class="grid2">
            <label class="field"><span>放假开始日期（可选）</span><input name="rangeStart" type="date" value="${esc(schedule.rangeStart || "")}" /></label>
            <label class="field"><span>放假结束日期（可选）</span><input name="rangeEnd" type="date" value="${esc(schedule.rangeEnd || "")}" /></label>
          </div>
          <label class="field"><span>清单截止</span><input name="fridayChecklist" type="datetime-local" value="${toLocalInput(deadlines.fridayChecklist)}" /></label>
          <label class="field"><span>提前分：满分档</span><input name="saturdayEarly" type="datetime-local" value="${toLocalInput(deadlines.saturdayEarly)}" /></label>
          <label class="field"><span>提前分：+8 档</span><input name="saturdayMid" type="datetime-local" value="${toLocalInput(deadlines.saturdayMid)}" /></label>
          <label class="field"><span>提前分：+5 档 / 收工</span><input name="saturdayHard" type="datetime-local" value="${toLocalInput(deadlines.saturdayHard)}" /></label>
          <label class="field"><span>收工截止</span><input name="weekEnd" type="datetime-local" value="${toLocalInput(deadlines.weekEnd)}" /></label>
          <label class="field"><span>备注（可选）</span><input name="note" maxlength="60" value="${esc(schedule.note || "")}" placeholder="例如：国庆放假 10-01 到 10-08" /></label>
          <div class="actions">
            <button class="primary" type="submit">保存时间</button>
            <button type="button" class="ghost" data-act="schedule-default">清空手动设置</button>
          </div>
        </form>` : ""}
    </div>`;
}

function renderSettle() {
  const detail = currentDetail();
  const settled = Boolean(state.week.score);
  return `
    ${weekBar()}
    ${can("parent") ? renderSchedule() : ""}
    <div class="card">
      <strong>本周结算</strong>
      <div class="small muted" style="margin:4px 0 12px">灰字是系统按规则算出的值，可以直接改成最终分。总扣分不超过 30 分。</div>
      <div class="score-grid">
        ${state.week.scoreKeys.map((item) => `
          <span>${item.label}</span>
          <span class="auto">系统算 ${state.week.auto[item.key] ?? 0} / ${item.max}</span>
          <input id="score-${item.key}" type="number" min="0" max="${item.max}" value="${detail[item.key] ?? 0}" style="width:86px" />
        `).join("")}
        <span>加分</span><span class="auto">共 ${state.week.auto.bonus || 0} 分（见下方清单）</span>
        <input id="score-bonus" type="number" min="0" value="${detail.bonus ?? 0}" style="width:86px" />
        <span>扣分</span><span class="auto">共 ${state.week.auto.deduction || 0} 分（上限 30）</span>
        <input id="score-deduction" type="number" min="0" max="30" value="${detail.deduction ?? 0}" style="width:86px" />
      </div>
      <label class="field" style="margin-top:12px"><span>结算备注</span>
        <input id="settle-note" maxlength="300" value="${esc(state.week.score?.note || "")}" placeholder="例如：这周数学卡在函数，下周补" /></label>
      <div class="total-line"><span>本周总分</span><span><span id="settle-total" class="mono">${settled ? state.week.score.total : detailTotal(detail)}</span><span id="settle-money" class="mono muted">${moneyOf(settled ? state.week.score.total : detailTotal(detail), settled ? state.week.score.rate ?? null : state.rate)}</span></span></div>
      <div class="row between small muted" style="margin-top:8px">
        <span>折现比例：1 积分 = <input id="rate-input" type="number" min="0" max="100" step="0.05" value="${state.rate}" style="width:72px" /> 元（0 = 不折现）</span>
        <button class="tiny" data-act="rate-save">保存比例</button>
      </div>
      ${timeSummary() ? `<div class="small muted" style="margin-top:8px">${timeSummary()}</div>` : ""}
      <div class="actions">
        <button class="primary" data-act="settle-save">${settled ? "重新结算" : "确认结算"}</button>
        ${settled && can("admin") ? '<button class="danger tiny" data-act="settle-clear">撤销结算</button>' : ""}
      </div>
    </div>
    <h2>加分 / 扣分项</h2>
    <div class="list">
      ${state.week.bonusItems.map((item) => `
        <div class="item">
          <div class="grow"><strong>${item.kind === "bonus" ? "+" : "-"}${item.points}</strong> ${esc(item.title)}</div>
          <button class="tiny danger" data-act="bonus-del" data-id="${item.id}">删除</button>
        </div>
      `).join("") || '<div class="item muted">还没有加分或扣分项</div>'}
    </div>
    <form class="card" data-form="bonus-add" style="margin-top:10px">
      <div class="grid3">
        <label class="field"><span>类型</span>
          <select name="kind">
            <option value="bonus">加分</option>
            <option value="deduction">扣分</option>
          </select></label>
        <label class="field"><span>分数</span><input name="points" type="number" min="1" max="100" required placeholder="3" /></label>
        <label class="field"><span>说明</span><input name="title" required maxlength="120" placeholder="主动加练 30 分钟" /></label>
      </div>
      ${optionsOf("bonus").length || optionsOf("deduction").length ? `<div class="small muted" style="margin-bottom:8px">常用项：${
        [...optionsOf("bonus"), ...optionsOf("deduction")].map((option) => `<button type="button" class="tiny" data-act="bonus-quick" data-kind="${option.type}" data-points="${option.points ?? 3}" data-title="${esc(option.title)}">${esc(option.title)}</button>`).join(" ")
      }</div>` : ""}
      <button class="primary" type="submit">添加</button>
    </form>
  `;
}

function renderAccount() {
  const account = state.account?.account || state.week.account;
  const weeks = state.account?.weeks || [];
  const balanceMoney = fmtMoney(account.balance, state.account?.rate ?? state.rate);
  return `
    <div class="card row between">
      <div><div class="num mono" style="font-size:22px">${account.balance}</div><div class="small muted">可用积分</div>${balanceMoney ? `<div class="small muted">≈ ${balanceMoney}</div>` : ""}</div>
      <div class="small muted" style="text-align:right">累计得分 ${account.earned}<br />已兑换 ${account.spent} · 待审批 ${account.pending}</div>
    </div>
    <h2>每周结算记录</h2>
    <table>
      <thead><tr><th>周</th><th>得分</th><th>结算时间</th></tr></thead>
      <tbody>
        ${weeks.map((row) => `<tr><td>${esc(row.weekKey)}</td><td class="mono">${row.total}${moneyOf(row.total, row.rate)}</td><td class="small muted">${fmtTime(row.settledAt)}</td></tr>`).join("") || '<tr><td colspan="3" class="muted">还没有结算记录</td></tr>'}
      </tbody>
    </table>
  `;
}

function renderOptions() {
  const types = [["homework", "常用作业"], ["reward", "奖励"], ["bonus", "加分项"], ["deduction", "扣分项"]];
  const list = state.options.filter((option) => option.type === state.optionType);
  const withPoints = state.optionType !== "homework";
  return `
    <div class="tabs" style="margin:0 0 12px">
      ${types.map(([key, label]) => `<button data-act="option-type" data-type="${key}" aria-current="${state.optionType === key}">${label}</button>`).join("")}
    </div>
    <form class="card" data-form="option-add">
      <div class="${withPoints ? "grid3" : "grid2"}">
        <label class="field"><span>名称</span><input name="title" required maxlength="120" /></label>
        ${state.optionType === "homework"
          ? `<label class="field"><span>科目</span><input name="subject" maxlength="20" /></label>
             <label class="field"><span>预估分钟</span><input name="estMinutes" type="number" min="0" max="600" /></label>`
          : `<label class="field"><span>积分数</span><input name="points" type="number" min="1" max="200" /></label>`}
      </div>
      ${state.optionType === "homework" ? `
      <label class="row small" style="gap:6px;margin:8px 0 10px">
        <input type="checkbox" name="weekly" style="width:auto" /> 设为每周固定作业（本周第一条作业时自动带出）
      </label>` : ""}
      <input type="hidden" name="type" value="${state.optionType}" />
      <button class="primary" type="submit">添加选项</button>
    </form>
    <div class="list">
      ${list.map((option) => `
        <div class="item">
          <div class="grow">
            <strong>${esc(option.title)}</strong>${option.weekly ? ' <span class="tag">每周固定</span>' : ""}
            <div class="small muted">
              ${option.subject ? `${esc(option.subject)} · ` : ""}${option.estMinutes ? `${option.estMinutes} 分钟 · ` : ""}${option.points ? `${option.points} 分 · ` : ""}${option.active ? "启用" : "停用"}
            </div>
          </div>
          ${can("parent") ? `
            ${option.type === "homework" ? `<button class="tiny" data-act="option-weekly" data-id="${option.id}" data-weekly="${option.weekly}">${option.weekly ? "取消固定" : "设为固定"}</button>` : ""}
            <button class="tiny" data-act="option-toggle" data-id="${option.id}" data-active="${option.active}">${option.active ? "停用" : "启用"}</button>
            <button class="tiny danger" data-act="option-del" data-id="${option.id}">删除</button>` : ""}
        </div>
      `).join("") || '<div class="item muted">还没有选项</div>'}
    </div>
  `;
}

function renderAdmin() {
  const webdav = state.settings || { url: "", username: "", path: "weekend-homework", keep: 14, enabled: false, hasSavedPassword: false, hasEnvPassword: false };
  return `
    <h2>用户</h2>
    <div class="list">
      ${state.users.map((user) => `
        <div class="item">
          <div class="grow">
            <strong>${esc(user.displayName)}</strong>
            <div class="small muted">@${esc(user.username)} · ${ROLE_TEXT[user.role]} · ${user.active ? "启用" : "停用"}</div>
          </div>
          <select data-act="user-role" data-id="${user.id}" style="width:auto">
            ${["student", "parent", "admin"].map((role) => `<option value="${role}" ${user.role === role ? "selected" : ""}>${ROLE_TEXT[role]}</option>`).join("")}
          </select>
          <button class="tiny" data-act="user-toggle" data-id="${user.id}" data-active="${user.active}">${user.active ? "停用" : "启用"}</button>
          <button class="tiny" data-act="user-password" data-id="${user.id}">改密码</button>
        </div>
      `).join("")}
    </div>
    <form class="card" data-form="user-add" style="margin-top:10px">
      <strong>新增用户</strong>
      <div class="grid2" style="margin-top:9px">
        <label class="field"><span>用户名</span><input name="username" required maxlength="40" placeholder="xiaoming" /></label>
        <label class="field"><span>显示名</span><input name="displayName" required maxlength="40" placeholder="小明" /></label>
        <label class="field"><span>角色</span>
          <select name="role">
            <option value="student">学生</option>
            <option value="parent">家长</option>
            <option value="admin">管理员</option>
          </select></label>
        <label class="field"><span>初始密码</span><input name="password" required minlength="6" /></label>
      </div>
      <button class="primary" type="submit">创建</button>
    </form>

    <h2>WebDAV 定时备份</h2>
    <form class="card" data-form="settings" data-password="${webdav.hasSavedPassword}">
      <label class="field"><span>WebDAV 地址</span><input name="url" value="${esc(webdav.url)}" placeholder="https://dav.jianguoyun.com/dav/" /></label>
      <div class="grid2">
        <label class="field"><span>用户名</span><input name="username" value="${esc(webdav.username)}" /></label>
        <label class="field"><span>密码${webdav.hasEnvPassword ? "（已用 Secret 覆盖）" : webdav.hasSavedPassword ? "（留空表示不改）" : ""}</span><input name="password" type="password" autocomplete="new-password" /></label>
        <label class="field"><span>目录</span><input name="path" value="${esc(webdav.path)}" /></label>
        <label class="field"><span>保留份数</span><input name="keep" type="number" min="1" max="100" value="${webdav.keep}" /></label>
      </div>
      <label class="row small" style="gap:6px;margin-bottom:10px">
        <input type="checkbox" name="enabled" style="width:auto" ${webdav.enabled ? "checked" : ""} /> 每天定时备份（Cloudflare Cron，默认 02:00）
      </label>
      <div class="actions">
        <button class="primary" type="submit">保存</button>
        <button type="button" class="ok" data-act="backup-run">立即备份</button>
        <button type="button" class="tiny" data-act="backup-reload">刷新日志</button>
        <a class="btn tiny" href="/api/export">导出 JSON</a>
      </div>
    </form>
    <div class="list" style="margin-top:10px">
      ${(state.log || []).map((row) => `
        <div class="item">
          <div class="grow">
            <strong>${row.ok ? "成功" : "失败"}</strong> ${esc(row.message || "")}
            <div class="small muted">${fmtTime(row.at)}${row.filename ? ` · ${esc(row.filename)}` : ""}${row.bytes ? ` · ${Math.round(row.bytes / 1024)} KB` : ""}</div>
          </div>
        </div>
      `).join("") || '<div class="item muted">还没有备份记录</div>'}
    </div>
    <h2>初始化</h2>
    <div class="card">
      <div class="small muted" style="margin-bottom:10px">清空全部作业、加扣分、每周结算和兑换记录，积分账户归零；账号、选项库、折现比例和备份配置保留。适合开学或重新开始，操作不可撤销。</div>
      <button class="danger" data-act="reset-all">一键初始化作业与分数</button>
    </div>
  `;
}

function renderLogin() {
  view.innerHTML = `
    <div class="login">
      <div class="card">
        <h1>${BRAND_SVG}周末作业打卡</h1>
        <div class="small muted" style="margin-bottom:14px">学生点完成，家长确认，周末结算积分。</div>
        ${state.error ? `<div class="notice error">${esc(state.error)}</div>` : ""}
        <form data-form="login">
          <label class="field"><span>用户名</span><input name="username" required autocomplete="username" /></label>
          <label class="field"><span>密码</span><input name="password" type="password" required autocomplete="current-password" /></label>
          <button class="primary" type="submit" style="width:100%">登录</button>
        </form>
      </div>
      <div class="small muted" style="text-align:center">v${esc(state.version || "")}</div>
    </div>
  `;
}

function renderSetup() {
  view.innerHTML = `
    <div class="login">
      <div class="card">
        <h1>首次设置</h1>
        <div class="small muted" style="margin-bottom:14px">输入部署日志里的设置码，创建管理员账号。</div>
        ${state.error ? `<div class="notice error">${esc(state.error)}</div>` : ""}
        <form data-form="setup">
          <label class="field"><span>设置码（SETUP_TOKEN）</span><input name="setupToken" required autocomplete="off" /></label>
          <label class="field"><span>管理员用户名</span><input name="username" required value="admin" maxlength="40" /></label>
          <label class="field"><span>密码（至少 6 位）</span><input name="password" type="password" required minlength="6" autocomplete="new-password" /></label>
          <button class="primary" type="submit" style="width:100%">创建</button>
        </form>
      </div>
    </div>
  `;
}

function renderClosed() {
  view.innerHTML = `
    <div class="login">
      <div class="card">
        <h1>还没初始化</h1>
        <p class="small muted">数据库里没有用户，服务端也没有配置 <code>SETUP_TOKEN</code>。请执行 <code>npm run deploy</code> 重新部署以获取设置码，或在 Cloudflare 后台手动添加该 Secret。</p>
      </div>
    </div>
  `;
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const target = event.target.closest(".seg-btn[data-act]");
  if (!target) return;
  event.preventDefault();
  target.click();
});

// 改了放假起止日期，就把还没动过的时间框刷成新区间对应的时间
document.addEventListener("change", (event) => {
  const target = event.target;
  if (!target || (target.name !== "rangeStart" && target.name !== "rangeEnd")) return;
  const form = target.closest("form[data-form=schedule]");
  if (!form) return;
  const rangeStart = form.elements.namedItem("rangeStart").value;
  const rangeEnd = form.elements.namedItem("rangeEnd").value;
  const derived = (rangeStart && rangeEnd ? deriveFromRangeClient(state.weekKey, rangeStart, rangeEnd) : null) || weekDeadlinesClient(state.weekKey);
  const previous = deadlinesOf();
  for (const key of ["fridayChecklist", "saturdayEarly", "saturdayMid", "saturdayHard", "weekEnd"]) {
    const input = form.elements.namedItem(key);
    const current = msFromLocalInput(input.value);
    if (!Number.isFinite(current) || current === Number(previous[key])) input.value = toLocalInput(derived[key]);
  }
});

document.addEventListener("submit", (event) => {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  pendingButton = event.submitter || null;
  const data = Object.fromEntries(new FormData(form).entries());
  const name = form.dataset.form;

  if (name === "login") {
    run(async () => {
      await api("/api/login", { method: "POST", body: { username: data.username.trim(), password: data.password } });
      await loadSession();
      await refreshAll();
      state.tab = "tasks";
      setNotice("登录成功");
    });
  }

  if (name === "setup") {
    run(async () => {
      await api("/api/setup", { method: "POST", body: data });
      state.mode = "login";
      await loadSession();
      await refreshAll();
    });
  }

  if (name === "task-add") {
    run(async () => {
      await api("/api/tasks", {
        method: "POST",
        body: {
          weekKey: state.weekKey,
          title: data.title,
          subject: data.subject,
          estMinutes: data.estMinutes || null,
          planSlot: data.planSlot,
          note: data.note,
          saveAsOption: data.saveAsOption === "on"
        }
      });
      await Promise.all([loadWeek(), loadOptions()]);
      state.addTask = false;
      setNotice("已添加");
    });
  }

  if (name === "task-edit") {
    const id = Number(form.dataset.id);
    run(async () => {
      await api(`/api/tasks/${id}`, {
        method: "PATCH",
        body: {
          title: data.title,
          subject: data.subject,
          estMinutes: data.estMinutes === "" ? null : Number(data.estMinutes),
          actualMinutes: data.actualMinutes === "" ? null : Number(data.actualMinutes),
          planSlot: data.planSlot,
          note: data.note
        }
      });
      state.editing = null;
      await loadWeek();
      setNotice("已保存");
    });
  }

  if (name === "schedule") {
    run(async () => {
      const schedule = state.week.schedule || {};
      const rangeStart = data.rangeStart || null;
      const rangeEnd = data.rangeEnd || null;
      const holiday = schedule.source === "auto" ? schedule.holiday : null;
      const keepAutoRange = Boolean(holiday && rangeStart === holiday.start && rangeEnd === holiday.end);
      // 只提交跟“按放假区间推算 / 默认时间”不一样的值，剩下的交给服务端自动算，免得把自动时间固化下来。
      const derived = (rangeStart && rangeEnd ? deriveFromRangeClient(state.weekKey, rangeStart, rangeEnd) : null) || weekDeadlinesClient(state.weekKey);
      const payload = {
        weekKey: state.weekKey,
        rangeStart: keepAutoRange ? null : rangeStart,
        rangeEnd: keepAutoRange ? null : rangeEnd,
        note: data.note || null
      };
      for (const key of ["fridayChecklist", "saturdayEarly", "saturdayMid", "saturdayHard", "weekEnd"]) {
        const value = data[key] ? fromLocalInput(data[key]) : null;
        const ms = value ? Date.parse(value) : NaN;
        payload[key] = Number.isFinite(ms) && ms !== Number(derived[key]) ? value : null;
      }
      await api("/api/schedule", { method: "PUT", body: payload });
      await loadWeek();
      state.scheduleOpen = false;
      setNotice("本周时间已保存");
    });
  }

  if (name === "bonus-add") {
    run(async () => {
      await api("/api/bonus", { method: "POST", body: { weekKey: state.weekKey, kind: data.kind, title: data.title, points: data.points } });
      await loadWeek();
    });
  }

  if (name === "redeem-custom") {
    run(async () => {
      await api("/api/redemptions", { method: "POST", body: { weekKey: state.weekKey, title: data.title, points: data.points } });
      await loadWeek();
      setNotice("已提交，等家长批准");
    });
  }

  if (name === "option-add") {
    run(async () => {
      await api("/api/options", {
        method: "POST",
        body: {
          type: data.type,
          title: data.title,
          subject: data.subject,
          estMinutes: data.estMinutes || null,
          points: data.points || null,
          weekly: data.weekly === "on"
        }
      });
      await loadOptions();
      setNotice("已添加选项");
    });
  }

  if (name === "user-add") {
    run(async () => {
      await api("/api/users", { method: "POST", body: data });
      await loadAdmin();
      setNotice("用户已创建");
    });
  }

  if (name === "settings") {
    const body = {
      url: data.url,
      username: data.username,
      path: data.path,
      keep: Number(data.keep),
      enabled: data.enabled === "on"
    };
    if (data.password) body.password = data.password;
    run(async () => {
      await api("/api/settings", { method: "PUT", body });
      await loadAdmin();
      setNotice("已保存");
    });
  }
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (target.dataset.act === "fill-template") {
    const option = state.options.find((item) => item.id === Number(target.value));
    const form = target.closest("form");
    if (!option || !form) return;
    form.elements.namedItem("title").value = option.title;
    form.elements.namedItem("subject").value = option.subject || "";
    form.elements.namedItem("estMinutes").value = option.estMinutes ?? "";
  }
  if (target.dataset.act === "user-role") {
    const id = Number(target.dataset.id);
    run(async () => {
      await api(`/api/users/${id}`, { method: "PATCH", body: { role: target.value } });
      await loadAdmin();
      setNotice("已更新角色");
    });
  }
});

document.addEventListener("input", (event) => {
  const target = event.target;
  if (!target.id || !target.id.startsWith("score-")) return;
  const totalEl = document.getElementById("settle-total");
  if (!totalEl) return;
  const detail = {};
  for (const item of state.week.scoreKeys) detail[item.key] = Number(document.getElementById(`score-${item.key}`).value);
  detail.bonus = Number(document.getElementById("score-bonus").value);
  detail.deduction = Number(document.getElementById("score-deduction").value);
  const total = detailTotal(detail);
  totalEl.textContent = total;
  const moneyEl = document.getElementById("settle-money");
  if (moneyEl) moneyEl.textContent = moneyOf(total, state.rate);
});

document.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-act]");
  if (!trigger) return;
  const act = trigger.dataset.act;
  const id = Number(trigger.dataset.id);

  const actions = {
    refresh: () => run(async () => {
      await refreshAll();
      setNotice("已刷新");
    }),
    tab: () => {
      state.tab = trigger.dataset.tab;
      state.editing = null;
      state.error = "";
      state.notice = "";
      render();
    },
    "option-type": () => {
      state.optionType = trigger.dataset.type;
      render();
    },
    logout: () => run(async () => {
      await api("/api/logout", { method: "POST" });
      state.user = null;
      state.week = null;
      state.tab = "tasks";
      state.mode = "login";
    }),
    week: () => run(async () => {
      await loadWeek(shiftWeekKey(state.weekKey, Number(trigger.dataset.delta)));
      await loadOptions();
    }),
    "schedule-toggle": () => {
      state.scheduleOpen = !state.scheduleOpen;
      render();
    },
    "schedule-default": () => {
      const form = document.querySelector("form[data-form=schedule]");
      if (!form) return;
      for (const key of ["fridayChecklist", "saturdayEarly", "saturdayMid", "saturdayHard", "weekEnd", "rangeStart", "rangeEnd", "note"]) {
        form.elements.namedItem(key).value = "";
      }
      const auto = state.week?.schedule?.source === "auto";
      setNotice(auto ? "已清空，保存后回到节假日自动时间" : "已清空，保存后回到默认周五到周日");
    },
    "toggle-add": () => {
      state.addTask = !state.addTask;
      render();
    },
    "task-quality": () => {
      const value = Number(trigger.dataset.value);
      run(async () => {
        await api(`/api/tasks/${id}`, { method: "PATCH", body: { quality: value } });
        await loadWeek();
        setNotice(`质量分已记 ${value} 分`);
      });
    },
    "task-edit": () => {
      state.editing = state.editing === id ? null : id;
      render();
    },
    "task-done": () => run(async () => {
      state.week = (await api(`/api/tasks/${id}/done`, { method: "POST", body: doneBody(id) })).week;
      const summary = state.week.summary;
      if (summary.pending) {
        setNotice(`${pickPraise()} 还剩 ${summary.pending} 条`);
      } else {
        celebrate(90);
        setNotice(`🎉 全部作业搞定！${earlyPraise()}，喊家长来验收`);
      }
    }),
    "task-confirm": () => run(async () => {
      state.week = (await api(`/api/tasks/${id}/confirm`, { method: "POST" })).week;
      setNotice("已确认");
    }),
    "task-complete": () => run(async () => {
      state.week = (await api(`/api/tasks/${id}/complete`, { method: "POST", body: doneBody(id) })).week;
      setNotice("已直接完成并确认");
    }),
    "task-reopen": () => run(async () => {
      state.week = (await api(`/api/tasks/${id}/reopen`, { method: "POST" })).week;
      setNotice("已撤销");
    }),
    "task-delete": () => {
      if (!confirm("删除这条作业？")) return;
      run(async () => {
        state.week = (await api(`/api/tasks/${id}`, { method: "DELETE" })).week;
        setNotice("已删除");
      });
    },
    "confirm-all": () => run(async () => {
      state.week = (await api("/api/tasks/confirm-done", { method: "POST", body: { weekKey: state.weekKey } })).week;
      setNotice("已完成的任务都确认了");
    }),
    "bonus-del": () => run(async () => {
      state.week = (await api(`/api/bonus/${id}`, { method: "DELETE" })).week;
    }),
    "bonus-quick": () => {
      run(async () => {
        await api("/api/bonus", {
          method: "POST",
          body: { weekKey: state.weekKey, kind: trigger.dataset.kind, title: trigger.dataset.title, points: Number(trigger.dataset.points) }
        });
        await loadWeek();
      });
    },
    redeem: () => {
      const points = trigger.dataset.points || prompt("这条奖励花多少积分？");
      if (!points) return;
      run(async () => {
        await api("/api/redemptions", { method: "POST", body: { weekKey: state.weekKey, title: trigger.dataset.title, points: Number(points) } });
        await loadWeek();
        setNotice("已提交申请");
      });
    },
    "redeem-decide": () => run(async () => {
      const status = trigger.dataset.status;
      const decide = (allowNegative) => api(`/api/redemptions/${id}/decide`, { method: "POST", body: { status, allowNegative } });
      try {
        state.week = (await decide(false)).week;
        setNotice(status === "approved" ? "已批准，积分已扣" : "已驳回");
      } catch (error) {
        if (error.code !== "insufficient_points") throw error;
        const missing = error.detail?.missing ?? 0;
        const balance = error.detail?.balance ?? 0;
        if (status !== "approved" || !confirm(`可用积分只剩 ${balance} 分，还差 ${missing} 分。确认要批准这笔兑换？积分会变成负数（先欠着）。`)) {
          throw new Error(`积分不够：可用 ${balance} 分，还差 ${missing} 分，先驳回或者等积分到手`);
        }
        state.week = (await decide(true)).week;
        setNotice("已批准（积分先欠着）");
      }
    }),
    "settle-save": () => {
      const detail = {};
      for (const item of state.week.scoreKeys) detail[item.key] = Number(document.getElementById(`score-${item.key}`).value);
      detail.bonus = Number(document.getElementById("score-bonus").value);
      detail.deduction = Number(document.getElementById("score-deduction").value);
      const note = document.getElementById("settle-note").value;
      run(async () => {
        const result = await api("/api/settle", { method: "POST", body: { weekKey: state.weekKey, detail, note } });
        state.week = result.week;
        state.account = await api("/api/account");
        setNotice(`结算完成：${result.total} 分${moneyOf(result.total, state.rate)}`);
      });
    },
    "rate-save": () => {
      const value = Number(document.getElementById("rate-input").value);
      run(async () => {
        const result = await api("/api/rate", { method: "PUT", body: { rate: value } });
        state.rate = result.rate;
        state.account = await api("/api/account");
        setNotice(result.rate ? `已保存：1 积分 = ${result.rate} 元` : "已关闭折现");
      });
    },
    "settle-clear": () => {
      if (!confirm("撤销本周结算？")) return;
      run(async () => {
        state.week = (await api(`/api/settle?week=${encodeURIComponent(state.weekKey)}`, { method: "DELETE" })).week;
        setNotice("已撤销结算");
      });
    },
    "option-toggle": () => run(async () => {
      await api(`/api/options/${id}`, { method: "PATCH", body: { active: trigger.dataset.active !== "true" } });
      await loadOptions();
    }),
    "option-weekly": () => run(async () => {
      const weekly = trigger.dataset.weekly !== "true";
      await api(`/api/options/${id}`, { method: "PATCH", body: { weekly } });
      await loadOptions();
      setNotice(weekly ? "已设为每周固定" : "已取消固定");
    }),
    "option-del": () => {
      if (!confirm("删除这个选项？")) return;
      run(async () => {
        await api(`/api/options/${id}`, { method: "DELETE" });
        await loadOptions();
      });
    },
    "user-toggle": () => run(async () => {
      await api(`/api/users/${id}`, { method: "PATCH", body: { active: trigger.dataset.active !== "true" } });
      await loadAdmin();
    }),
    "user-password": () => {
      const password = prompt("输入新密码（至少 6 位）");
      if (!password) return;
      run(async () => {
        await api(`/api/users/${id}`, { method: "PATCH", body: { password } });
        setNotice("密码已更新");
      });
    },
    "backup-run": () => run(async () => {
      const result = await api("/api/backup/run", { method: "POST" });
      await loadAdmin();
      setNotice(result.ok ? `备份成功：${result.filename}` : `备份失败：${result.message}`);
    }),
    "backup-reload": () => run(async () => {
      await loadAdmin();
    }),
    "reset-all": () => {
      if (!confirm("将清空全部作业、加扣分、结算和兑换记录，且无法恢复。继续？")) return;
      const answer = prompt("输入「初始化」两个字确认");
      if (answer !== "初始化") return;
      run(async () => {
        await api("/api/reset", { method: "POST", body: { confirm: answer } });
        await refreshAll();
        setNotice("已初始化，作业和分数已清空");
      });
    }
  };

  const handler = actions[act];
  if (handler) {
    pendingButton = trigger;
    handler();
  }
});

async function boot() {
  const status = await api("/api/status");
  state.version = status.version;
  state.mode = status.mode;
  if (status.mode === "setup" || status.mode === "closed") return render();
  try {
    await loadSession();
    await refreshAll();
  } catch {
    state.user = null;
  }
  render();
}

boot().catch((error) => {
  state.error = String(error.message || error);
  render();
});
