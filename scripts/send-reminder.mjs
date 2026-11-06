// Daily reminder: emails every unfinished task. Run by .github/workflows/reminder.yml
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const {
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GMAIL_USER, GMAIL_APP_PASSWORD,
  REMINDER_TO, SITE_URL, TZ_NAME = "Asia/Manila",
} = process.env;

for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GMAIL_USER, GMAIL_APP_PASSWORD, REMINDER_TO })) {
  if (!v) { console.error(`Missing secret: ${k}`); process.exit(1); }
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: rows, error } = await sb.from("tasks").select("*").eq("done", false);
if (error) { console.error(error); process.exit(1); }
const { data: listRows } = await sb.from("lists").select("lists");
const colors = {};
(listRows || []).forEach(r => (r.lists || []).forEach(c => (colors[c.name] = c.color)));

if (!rows.length) { console.log("No unfinished tasks — no email today."); process.exit(0); }

const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: TZ_NAME }).format(new Date()); // YYYY-MM-DD
const dayNum = s => Date.UTC(...s.split("-").map((n, i) => (i === 1 ? n - 1 : +n))) / 864e5;
const diff = s => dayNum(s) - dayNum(todayStr);
const pr = { high: 0, normal: 1, low: 2 };
rows.sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || (pr[a.priority] ?? 1) - (pr[b.priority] ?? 1));

const groups = [
  ["⚠️ Overdue", "#c2412d", rows.filter(t => t.due && diff(t.due) < 0)],
  ["📌 Due today", "#b7791f", rows.filter(t => t.due && diff(t.due) === 0)],
  ["🗓️ Next 7 days", "#7b3f6e", rows.filter(t => t.due && diff(t.due) > 0 && diff(t.due) <= 7)],
  ["📝 No due date", "#7a6f78", rows.filter(t => !t.due)],
];
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = s => new Date(s + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const etOf = (date, time) => { // stored date/time are Philippine time (UTC+8, no DST)
  const [y, m, d] = date.split("-").map(Number), [h, mi] = time.split(":").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d, h - 8, mi));
  const day = utc.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" });
  const hm = utc.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).replace(":00", "").replace(" ", "").toLowerCase();
  return `${day} ${hm} ET`;
};
const fmtTime = t => { if (!t) return ""; const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""}${h >= 12 ? "pm" : "am"}`; };

const [nOver, nToday, nWeek] = groups.map(g => g[2].length);
let html = `<div style="font-family:Arial,sans-serif;max-width:560px;color:#2b2230">
  <h2 style="margin:0 0 4px">Good morning, Jude ☀️</h2>
  <p style="color:#7a6f78;margin:0 0 18px">${nOver} overdue · ${nToday} due today · ${nWeek} in the next 7 days</p>`;
let text = `Good morning, Jude!\n${nOver} overdue · ${nToday} due today · ${nWeek} in the next 7 days\n`;
for (const [label, color, items] of groups) {
  if (!items.length) continue;
  html += `<h3 style="color:${color};font-size:15px;margin:18px 0 8px">${label} (${items.length})</h3>`;
  text += `\n${label}\n`;
  for (const t of items) {
    const d = t.due ? diff(t.due) : null;
    const when = t.due ? fmt(t.due) + (t.time ? ` · ${fmtTime(t.time)} PH (${etOf(t.due, t.time)})` : "") : "";
    const late = d !== null && d < 0 ? ` (${-d}d late)` : "";
    html += `<div style="border-left:4px solid ${colors[t.category] || "#ccc"};background:#faf6f1;padding:8px 12px;margin-bottom:6px;border-radius:6px">
      <b>${esc(t.title)}</b>${t.priority === "high" ? ' <span style="color:#c2412d;font-size:12px">● High</span>' : ""}<br>
      <span style="font-size:13px;color:#7a6f78">${esc(t.category)}${when ? " · " + when : ""}${late ? `<b style="color:#c2412d">${late}</b>` : ""}</span></div>`;
    text += `- ${t.title} [${t.category}]${when ? " — " + when : ""}${late}${t.priority === "high" ? " (High)" : ""}\n`;
  }
}
if (SITE_URL) {
  html += `<p style="margin-top:20px"><a href="${SITE_URL}" style="background:#7b3f6e;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">Open my task board</a></p>`;
  text += `\nOpen your board: ${SITE_URL}\n`;
}
html += `</div>`;

const dateLabel = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: TZ_NAME });
const subject = `${nOver ? "⚠️ " : ""}Your tasks for ${dateLabel} — ${nOver + nToday} need attention`;

const mail = nodemailer.createTransport({ service: "gmail", auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD.replace(/\s/g, "") } });
await mail.sendMail({ from: `"Jude's Task Board" <${GMAIL_USER}>`, to: REMINDER_TO, subject, html, text });
console.log(`Sent: ${subject}`);
