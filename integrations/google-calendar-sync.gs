/**
 * Google Calendar → Jude's Task Board (one way)
 * Runs inside judelyn@mysalonbooks.com's Google account every 15 minutes.
 * Copies upcoming calendar events onto the task board as tasks.
 *
 * ONE-TIME SETUP
 *  1. Project Settings (gear) → Script properties → Add property:
 *       Name:  SUPABASE_SECRET
 *       Value: your Supabase secret key (Supabase → Project Settings → API Keys → Secret keys → Copy)
 *  2. Choose "setup" in the function menu above and click Run. Allow the permissions Google asks for.
 */

const SUPABASE_URL = 'https://dhdxmisazbieajtmhbfm.supabase.co';
const DAYS_AHEAD = 14;                       // how far ahead to copy events
const DEFAULT_LIST = 'SC – Ronit'; // list used when no client name is found in the event title
const SKIP_TITLES = /^(busy|blocked|focus time|lunch|out of office|ooo)$/i;

function setup() {
  if (!PropertiesService.getScriptProperties().getProperty('SUPABASE_SECRET')) {
    throw new Error('Add the SUPABASE_SECRET script property first (Project Settings → Script properties).');
  }
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncCalendar')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncCalendar').timeBased().everyMinutes(15).create();
  syncCalendar();
  Logger.log('Done. Calendar events will sync to your task board every 15 minutes.');
}

function syncCalendar() {
  const key = PropertiesService.getScriptProperties().getProperty('SUPABASE_SECRET');
  const cal = CalendarApp.getDefaultCalendar();
  const calTz = cal.getTimeZone() || 'Asia/Manila';
  const entryTz = /^America\//.test(calTz) ? 'ET' : 'PH';

  // who owns the board, and which client lists exist
  const owner = (api_('GET', 'tasks?select=user_id&limit=1', key)[0] || api_('GET', 'lists?select=user_id&limit=1', key)[0] || {}).user_id;
  if (!owner) throw new Error('Sign in to your task board once (and add any task) so the board has an owner.');
  const listRow = api_('GET', 'lists?select=lists&user_id=eq.' + owner, key)[0];
  const lists = (listRow && listRow.lists && listRow.lists.length) ? listRow.lists.map(l => l.name)
    : ['Elite – Talat', 'SC – Ronit', 'Bill', 'Tiffany', 'Luke', 'Personal'];

  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + DAYS_AHEAD * 864e5);
  const fmt = (d, f) => Utilities.formatDate(d, 'Asia/Manila', f);

  // events → wanted tasks
  const wanted = {};
  cal.getEvents(start, end).forEach(ev => {
    const title = (ev.getTitle() || '').trim();
    if (!title || SKIP_TITLES.test(title)) return;
    try { if (ev.getMyStatus() === CalendarApp.GuestStatus.NO) return; } catch (e) {}
    const s = ev.getStartTime();
    const id = 'gcal_' + hex_(ev.getId() + '|' + s.getTime());
    const allDay = ev.isAllDayEvent();
    wanted[id] = {
      id, user_id: owner, title,
      category: pickList_(title + ' ' + (ev.getDescription() || ''), lists),
      due: allDay ? Utilities.formatDate(s, calTz, 'yyyy-MM-dd') : fmt(s, 'yyyy-MM-dd'),
      time: allDay ? null : fmt(s, 'HH:mm'),
      tz: allDay ? 'PH' : entryTz,
      priority: 'normal', repeat: 'none',
      notes: '📅 From Google Calendar' + (ev.getLocation() ? ' · ' + ev.getLocation() : ''),
      done: false, created_at: Date.now(), completions: []
    };
  });

  // what the board already has from the calendar
  const existing = api_('GET', 'tasks?select=id,title,due,time,tz,done&id=like.gcal_*&user_id=eq.' + owner, key);
  const have = {}; existing.forEach(t => have[t.id] = t);
  const firstDay = fmt(start, 'yyyy-MM-dd'), lastDay = fmt(end, 'yyyy-MM-dd');

  const toInsert = [];
  Object.keys(wanted).forEach(id => {
    const w = wanted[id], h = have[id];
    if (!h) { toInsert.push(w); return; }
    // keep Jude's own changes (done, client, priority); only follow title/time changes from the calendar
    if (h.title !== w.title || h.due !== w.due || (h.time || null) !== w.time || h.tz !== w.tz) {
      api_('PATCH', 'tasks?id=eq.' + encodeURIComponent(id), key, { title: w.title, due: w.due, time: w.time, tz: w.tz });
    }
  });
  if (toInsert.length) api_('POST', 'tasks', key, toInsert);

  // events that were cancelled or moved out: remove their unfinished tasks
  existing.forEach(t => {
    if (!wanted[t.id] && !t.done && t.due >= firstDay && t.due < lastDay) {
      api_('DELETE', 'tasks?id=eq.' + encodeURIComponent(t.id), key);
    }
  });
  Logger.log('Synced: %s new, %s on calendar, %s already on board.', toInsert.length, Object.keys(wanted).length, existing.length);
}

function pickList_(text, lists) {
  const t = ' ' + text.toLowerCase() + ' ';
  let best = null;
  lists.forEach(name => {
    const words = name.toLowerCase().split(/[\s–—\-&,()]+/).filter(w => w.length >= 3);
    const aliases = [name.toLowerCase()].concat(words);
    if (/salon cadence|\bsc\b/i.test(name)) aliases.push('salon cadence', 'cadence', 'sc');
    aliases.forEach(a => {
      if (new RegExp('\\b' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(t) && (!best || a.length > best.a.length)) best = { name, a };
    });
  });
  return best ? best.name : (lists.indexOf(DEFAULT_LIST) >= 0 ? DEFAULT_LIST : (lists.find(n => /salon cadence|\bsc\b/i.test(n)) || lists[0]));
}

function hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s)
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('').slice(0, 20);
}

function api_(method, path, key, body) {
  const res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method: method.toLowerCase(),
    headers: { apikey: key, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    payload: body ? JSON.stringify(body) : undefined,
    muteHttpExceptions: true
  });
  const code = res.getResponseCode(), text = res.getContentText();
  if (code >= 300) throw new Error('Task board error ' + code + ': ' + text);
  return text ? JSON.parse(text) : [];
}
