// ============================================================
// HouseBot v2 - bot.js (clean UI)
// ============================================================
require("dotenv").config();
const TelegramBot    = require("node-telegram-bot-api");
const cron           = require("node-cron");
const express        = require("express");
const path           = require("path");
const db             = require("./db");
const scheduler      = require("./scheduler");

const TOKEN          = process.env.BOT_TOKEN;
const WEBAPP_URL     = process.env.WEBAPP_URL;
const OWNER_ID       = process.env.OWNER_ID;
const GROUP_ID       = process.env.GROUP_ID;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const GROUP_LINK     = process.env.GROUP_LINK || "";

// ── Bot ──────────────────────────────────────────────────────
const bot = new TelegramBot(TOKEN, {
  polling: { interval: 2000, autoStart: true, params: { timeout: 10 } },
});
bot.on("polling_error", (err) => {
  const m = err.message || "";
  if (m.includes("ETIMEDOUT") || m.includes("ECONNRESET") || m.includes("ENOTFOUND")) {
    console.log("⚠️  Network timeout — retrying...");
  } else if (m.includes("409")) {
    console.log("⚠️  409 Conflict — stop other bot instance.");
  } else {
    console.error("Polling error:", m);
  }
});
bot.on("error", (err) => console.error("Bot error:", err.message));

// ── Express ──────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "webapp")));

app.get("/api/users",    (req, res) => res.json(db.getUsers()));
app.get("/api/schedule", (req, res) => res.json(db.getSchedule()));

app.post("/api/spin-result", (req, res) => {
  const { type, selected } = req.body;
  if (!selected || !type) return res.status(400).json({ error: "Missing fields" });
  const names = Array.isArray(selected) ? selected : [selected];
  if (type === "cleaning") db.recordCleaningPick(names[0]);
  else db.recordShoppingPick(names);
  scheduler.notifySpinResult(bot, GROUP_ID, type, names);
  scheduler.generateSchedule();
  res.json({ ok: true });
});

app.post("/api/register", (req, res) => {
  const { name, telegramId, password } = req.body;
  if (!password || password !== ADMIN_PASSWORD)
    return res.status(403).json({ error: "Wrong password." });
  if (!name || !name.trim()) return res.status(400).json({ error: "Name required" });
  if (db.getUsers().length >= 4) return res.status(400).json({ error: "Already 4 roommates!" });
  const result = db.addUser({ name: name.trim(), telegramId: telegramId || `user_${Date.now()}` });
  if (result.ok) notifyAllIfFull();
  res.json({ ok: true, ...result });
});

app.post("/api/remove", (req, res) => {
  const { name, password } = req.body;
  if (!password || password !== ADMIN_PASSWORD)
    return res.status(403).json({ error: "Wrong password." });
  const result = db.removeUserByName(name);
  if (!result.ok) return res.status(404).json({ error: "User not found" });
  res.json({ ok: true });
});

app.listen(3001, () => console.log("🌐 Web server → http://localhost:3001"));

// ── Notify all when squad full ───────────────────────────────
function notifyAllIfFull() {
  const users = db.getUsers();
  if (users.length !== 4) return;
  for (const u of users) {
    bot.sendMessage(u.telegramId,
      `🎉 <b>All 4 roommates are in!</b>\nThe squad is complete. Open the app to spin the wheel!`,
      { parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[
          { text: "🎰 Open HouseBot App", web_app: { url: WEBAPP_URL } }
        ]]}
      }
    ).catch(() => {});
  }
}

// ── Build keyboard based on user role ───────────────────────
function buildKeyboard(userId) {
  const isOwner = String(userId) === String(OWNER_ID);

  // Row 1: Open app
  const keyboard = [
    [{ text: "🏠 Open HouseBot App", web_app: { url: WEBAPP_URL } }],
  ];

  // Row 2: Owner gets Add + Remove
  if (isOwner) {
    keyboard.push([
      { text: "➕ Add Roommate",    callback_data: "owner_add" },
      { text: "➖ Remove Roommate", callback_data: "owner_remove" },
    ]);
  }

  // Row 3: Group link (if set)
  if (GROUP_LINK) {
    keyboard.push([{ text: "👥 Go to Group Chat", url: GROUP_LINK }]);
  }

  // Row 4: Exit
  keyboard.push([{ text: "❌ Exit", callback_data: "exit" }]);

  return keyboard;
}

// ── Send home message ────────────────────────────────────────
function sendHome(chatId, userId) {
  const users   = db.getUsers();
  const isOwner = String(userId) === String(OWNER_ID);
  const user    = users.find(u => String(u.telegramId) === String(userId));
  const userName = user ? user.name : "Guest";

  const status = users.length < 4
    ? `Registered Users: ${users.length}/4`
    : `All 4 roommates ready!`;

  // Big reply keyboard buttons at bottom of chat
  const replyRows = [
    [{ text: "🏠 Open HouseBot App" }],
    [{ text: "👥 View Users" }, { text: "📅 View Schedule" }],
    [{ text: "🎰 Spin the Wheel" }],
  ];
  if (isOwner) {
    replyRows.push([{ text: "➕ Add Roommate" }, { text: "➖ Remove Roommate" }]);
  }
  if (GROUP_LINK) {
    replyRows.push([{ text: "👥 Go to Group Chat" }]);
  }
  replyRows.push([{ text: "❌ Exit" }]);

  // Welcome message with reply keyboard
  bot.sendMessage(chatId,
    `🏠 <b>Welcome to HouseBot!</b>\n\n` +
    `👤 User: ${userName}\n` +
    `🔢 ${status}\n\n` +
    `Use the buttons below to manage:\n` +
    `🛒 Weekly shopping\n` +
    `🧹 House cleaning & trash`,
    {
      parse_mode: "HTML",
      reply_markup: {
        keyboard: replyRows,
        resize_keyboard: true,
        persistent: true,
      }
    }
  );

  // Inline web app button
  bot.sendMessage(chatId, `Tap below to open the app 👇`, {
    reply_markup: { inline_keyboard: buildKeyboard(userId) }
  });
}

// ── /start ───────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // Cache username
  if (msg.from.username) db.cacheUsername(msg.from.username, userId);

  // Only register once
  const users        = db.getUsers();
  const isRegistered = users.some(u => String(u.telegramId) === String(userId));

  if (!isRegistered && users.length < 4) {
    const name = msg.from.first_name + (msg.from.last_name ? " " + msg.from.last_name : "");
    db.addUser({ name, telegramId: userId, username: msg.from.username || null });
    notifyAllIfFull();
  }

  sendHome(chatId, userId);
});

// ── Callbacks ────────────────────────────────────────────────
bot.on("callback_query", async (query) => {
  const chatId  = query.message.chat.id;
  const msgId   = query.message.message_id;
  const userId  = query.from.id;
  const isOwner = String(userId) === String(OWNER_ID);

  // ── Open App ──
  if (query.data === "open_app") {
    bot.answerCallbackQuery(query.id);
  }

  // ── Owner: Add ──
  if (query.data === "owner_add") {
    if (!isOwner) return bot.answerCallbackQuery(query.id, { text: "Owner only.", show_alert: true });
    bot.answerCallbackQuery(query.id);
    bot.sendMessage(chatId,
      `➕ <b>Add a Roommate</b>\n\n` +
      `The person must send /start to this bot first.\n\n` +
      `Then type:\n<code>/adduser FirstName @username</code>`,
      { parse_mode: "HTML" }
    );
  }

  // ── Owner: Remove ──
  if (query.data === "owner_remove") {
    if (!isOwner) return bot.answerCallbackQuery(query.id, { text: "Owner only.", show_alert: true });
    bot.answerCallbackQuery(query.id);
    const users = db.getUsers();
    if (users.length === 0) {
      return bot.sendMessage(chatId, "No roommates to remove.");
    }
    // Show list with remove buttons
    const keyboard = users.map(u => ([{
      text: `❌ Remove ${u.name}`,
      callback_data: `remove_${u.name}`
    }]));
    keyboard.push([{ text: "← Back", callback_data: "back_home" }]);
    bot.sendMessage(chatId, `➖ <b>Remove a Roommate</b>\n\nTap to remove:`,
      { parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard } }
    );
  }

  // ── Remove specific user ──
  if (query.data.startsWith("remove_")) {
    if (!isOwner) return bot.answerCallbackQuery(query.id, { text: "Owner only.", show_alert: true });
    const name   = query.data.replace("remove_", "");
    const result = db.removeUserByName(name);
    if (result.ok) {
      bot.answerCallbackQuery(query.id, { text: `✅ ${name} removed!` });
      bot.editMessageText(
        `✅ <b>${name}</b> has been removed. (${db.getUsers().length}/4 roommates)`,
        { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }
      );
    } else {
      bot.answerCallbackQuery(query.id, { text: "User not found.", show_alert: true });
    }
  }

  // ── Exit ──
  if (query.data === "exit") {
    bot.answerCallbackQuery(query.id);
    bot.editMessageText(
      `👋 <b>HouseBot closed.</b>\nSend /start anytime to reopen.`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML",
        reply_markup: { inline_keyboard: [] }
      }
    );
  }

  // ── Back to home ──
  if (query.data === "back_home") {
    bot.answerCallbackQuery(query.id);
    bot.deleteMessage(chatId, msgId).catch(() => {});
    sendHome(chatId, userId);
  }
});

// ── /adduser (owner only) ────────────────────────────────────
bot.onText(/\/adduser (.+)/, (msg, match) => {
  if (String(msg.from.id) !== String(OWNER_ID))
    return bot.sendMessage(msg.chat.id, "❌ Only owner can add roommates.");
  const parts    = match[1].trim().split(" ");
  if (parts.length < 2)
    return bot.sendMessage(msg.chat.id, "Usage: /adduser Name @username");
  const username = parts[parts.length - 1].replace("@", "");
  const name     = parts.slice(0, parts.length - 1).join(" ");
  if (db.getUsers().length >= 4)
    return bot.sendMessage(msg.chat.id, "❌ Already 4 roommates!");
  const cachedId = db.getUserIdByUsername(username);
  if (!cachedId)
    return bot.sendMessage(msg.chat.id,
      `⚠️ <b>${name}</b> must send /start to this bot first, then try again.`,
      { parse_mode: "HTML" });
  if (db.getUsers().some(u => String(u.telegramId) === String(cachedId)))
    return bot.sendMessage(msg.chat.id, `⚠️ ${name} is already registered!`);
  db.addUser({ name, telegramId: cachedId, username });
  bot.sendMessage(msg.chat.id,
    `✅ Added <b>${name}</b> (${db.getUsers().length}/4 roommates)`,
    { parse_mode: "HTML" }
  );
  // Notify added user
  bot.sendMessage(cachedId,
    `🏠 <b>You've been added to HouseBot!</b>`,
    { parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[
        { text: "🎰 Open HouseBot App", web_app: { url: WEBAPP_URL } }
      ]]}
    }
  ).catch(() => {});
  notifyAllIfFull();
});

// ── /status ──────────────────────────────────────────────────
bot.onText(/\/status/, (msg) => {
  const users = db.getUsers();
  if (!users.length) return bot.sendMessage(msg.chat.id, "No roommates yet. Send /start to register!");
  const lines = users.map((u, i) =>
    `${i+1}. <b>${u.name}</b>${u.username ? ` @${u.username}` : ""} — 🧹${u.cleaningCount||0} 🛒${u.shoppingCount||0}`
  ).join("\n");
  bot.sendMessage(msg.chat.id, `👥 <b>Roommates (${users.length}/4)</b>\n\n${lines}`, { parse_mode: "HTML" });
});

// ── Track usernames + handle reply keyboard buttons ──────────
bot.on("message", (msg) => {
  if (msg.from?.username) db.cacheUsername(msg.from.username, msg.from.id);

  const chatId  = msg.chat.id;
  const userId  = msg.from.id;
  const isOwner = String(userId) === String(OWNER_ID);
  const text    = msg.text || "";

  if (text === "🏠 Open HouseBot App") {
    bot.sendMessage(chatId, "Tap below to open the app 👇", {
      reply_markup: { inline_keyboard: [[
        { text: "🎰 Open HouseBot App", web_app: { url: WEBAPP_URL } }
      ]]}
    });
  }

  if (text === "👥 View Users") {
    const users = db.getUsers();
    if (!users.length) return bot.sendMessage(chatId, "No roommates yet.");
    const lines = users.map((u,i) =>
      `${i+1}. <b>${u.name}</b>${u.username ? ` @${u.username}` : ""} — 🧹${u.cleaningCount||0} 🛒${u.shoppingCount||0}`
    ).join("\n");
    bot.sendMessage(chatId, `👥 <b>Roommates (${users.length}/4)</b>\n\n${lines}`, { parse_mode: "HTML" });
  }

  if (text === "📅 View Schedule") {
    const schedule = db.getSchedule();
    if (!schedule || schedule.length === 0)
      return bot.sendMessage(chatId, "No schedule yet. Spin the wheel first!");
    const lines = schedule.map((s,i) =>
      `${i+1}. <b>${s.name}</b>\n   🧹 ${s.cleaningDate} (${s.cleaningDay||""})\n   🛒 ${s.shoppingDate} (${s.shoppingDay||""})`
    ).join("\n\n");
    bot.sendMessage(chatId, `📅 <b>Schedule</b>\n\n${lines}`, { parse_mode: "HTML" });
  }

  if (text === "🎰 Spin the Wheel") {
    bot.sendMessage(chatId, "Tap below to open the app and spin! 🎰", {
      reply_markup: { inline_keyboard: [[
        { text: "🎰 Open HouseBot App", web_app: { url: WEBAPP_URL } }
      ]]}
    });
  }

  if (text === "➕ Add Roommate") {
    if (!isOwner) return bot.sendMessage(chatId, "❌ Owner only.");
    bot.sendMessage(chatId,
      `➕ <b>Add a Roommate</b>\n\nThe person must send /start first.\n\nThen type:\n<code>/adduser Name @username</code>`,
      { parse_mode: "HTML" }
    );
  }

  if (text === "➖ Remove Roommate") {
    if (!isOwner) return bot.sendMessage(chatId, "❌ Owner only.");
    const users = db.getUsers();
    if (!users.length) return bot.sendMessage(chatId, "No roommates to remove.");
    const keyboard = users.map(u => ([{
      text: `❌ Remove ${u.name}`, callback_data: `remove_${u.name}`
    }]));
    keyboard.push([{ text: "← Cancel", callback_data: "back_home" }]);
    bot.sendMessage(chatId, `➖ <b>Remove a Roommate</b>\n\nTap to remove:`,
      { parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard } }
    );
  }

  if (text === "👥 Go to Group Chat" && GROUP_LINK) {
    bot.sendMessage(chatId, `👥 Join the group: ${GROUP_LINK}`);
  }

  if (text === "❌ Exit") {
    bot.sendMessage(chatId, "👋 Bye! Send /start anytime.", {
      reply_markup: { remove_keyboard: true }
    });
  }
});

// ── Weekly reminders ─────────────────────────────────────────
cron.schedule("0 20 * * 0", () => scheduler.sendWeeklyCleaningReminder(bot, GROUP_ID));
cron.schedule("0 20 * * 3", () => scheduler.sendWeeklyShoppingReminder(bot, GROUP_ID));

console.log("🤖 HouseBot v2 running!");
console.log(`👑 Owner:  ${OWNER_ID}`);
console.log(`👥 Group:  ${GROUP_ID}`);
console.log(`🌐 WebApp: ${WEBAPP_URL}`);
