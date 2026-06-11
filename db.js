// ============================================================
// db.js — JSON persistent storage
// ============================================================
const fs   = require("fs");
const path = require("path");
const DATA_FILE = path.join(__dirname, "data.json");

function load() {
  if (!fs.existsSync(DATA_FILE)) {
    const init = { users: [], schedule: [], usernameCache: {} };
    fs.writeFileSync(DATA_FILE, JSON.stringify(init, null, 2));
    return init;
  }
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch (e) { return { users: [], schedule: [], usernameCache: {} }; }
}

function save(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getUsers() { return load().users; }

function addUser({ name, telegramId, username }) {
  const data = load();
  if (data.users.find(u => String(u.telegramId) === String(telegramId)))
    return { ok: false, error: "Already registered" };
  if (data.users.length >= 4) return { ok: false, error: "Max 4 users" };
  data.users.push({
    id: Date.now(), name,
    telegramId: String(telegramId),
    username: username || null,
    cleaningCount: 0, shoppingCount: 0,
    registered: new Date().toISOString(),
  });
  save(data);
  return { ok: true };
}

function removeUserByName(name) {
  const data = load();
  const idx = data.users.findIndex(u => u.name === name);
  if (idx === -1) return { ok: false };
  const removed = data.users.splice(idx, 1)[0];
  save(data);
  return { ok: true, name: removed.name };
}

function removeUserByUsername(username) {
  const data = load();
  const idx = data.users.findIndex(u => u.username === username);
  if (idx === -1) return { ok: false };
  const removed = data.users.splice(idx, 1)[0];
  save(data);
  return { ok: true, name: removed.name };
}

function getSchedule() { return load().schedule; }
function setSchedule(schedule) {
  const data = load(); data.schedule = schedule; save(data);
}

function recordCleaningPick(name) {
  const data = load();
  const u = data.users.find(u => u.name === name);
  if (u) { u.cleaningCount = (u.cleaningCount || 0) + 1; u.lastCleaning = new Date().toISOString(); }
  save(data);
}

function recordShoppingPick(names) {
  const data = load();
  for (const name of names) {
    const u = data.users.find(u => u.name === name);
    if (u) { u.shoppingCount = (u.shoppingCount || 0) + 1; u.lastShopping = new Date().toISOString(); }
  }
  save(data);
}

function cacheUsername(username, telegramId) {
  const data = load();
  data.usernameCache = data.usernameCache || {};
  data.usernameCache[username.toLowerCase()] = String(telegramId);
  save(data);
}

function getUserIdByUsername(username) {
  return (load().usernameCache || {})[username.toLowerCase()] || null;
}

module.exports = {
  getUsers, addUser, removeUserByName, removeUserByUsername,
  getSchedule, setSchedule, recordCleaningPick, recordShoppingPick,
  cacheUsername, getUserIdByUsername,
};
