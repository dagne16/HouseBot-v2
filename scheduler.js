// ============================================================
// scheduler.js — Schedule & reminders
// Cleaning: Monday(1), Thursday(4), Saturday(6) rotating
// Shopping: Saturday(6)
// ============================================================
const db = require("./db");

function formatDate(date) {
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function formatDay(date) {
  return date.toLocaleDateString("en-GB", { weekday: "long" });
}

function nextWeekday(dayOfWeek, fromDate) {
  const d = new Date(fromDate || new Date());
  d.setHours(0, 0, 0, 0);
  const diff = (dayOfWeek - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return d;
}

const CLEANING_DAYS = [1, 4, 6]; // Mon, Thu, Sat

function generateSchedule() {
  const users = db.getUsers();
  if (users.length === 0) return;

  const sorted = [...users].sort(
    (a, b) => (a.cleaningCount + a.shoppingCount) - (b.cleaningCount + b.shoppingCount)
  );

  const today = new Date();
  const schedule = sorted.map((user, i) => {
    const cleanDayOfWeek = CLEANING_DAYS[i % CLEANING_DAYS.length];
    const cleanDay = nextWeekday(cleanDayOfWeek, today);
    cleanDay.setDate(cleanDay.getDate() + Math.floor(i / CLEANING_DAYS.length) * 7);

    // Shopping = next Saturday after clean day
    const shopDay = nextWeekday(6, cleanDay);

    return {
      name:         user.name,
      telegramId:   user.telegramId,
      username:     user.username,
      cleaningDate: formatDate(cleanDay),
      cleaningDay:  formatDay(cleanDay),
      shoppingDate: formatDate(shopDay),
      shoppingDay:  formatDay(shopDay),
      cleaningRaw:  cleanDay.toISOString(),
      shoppingRaw:  shopDay.toISOString(),
    };
  });

  db.setSchedule(schedule);
  return schedule;
}

function mentionText(user) {
  return user && user.username
    ? `@${user.username}`
    : `<a href="tg://user?id=${user ? user.telegramId : 0}">${user ? user.name : "Unknown"}</a>`;
}

async function notifyGroup(bot, groupId, message) {
  try { await bot.sendMessage(groupId, message, { parse_mode: "HTML" }); }
  catch (e) { console.error("Group notify error:", e.message); }
}

async function notifyUser(bot, telegramId, message) {
  try { await bot.sendMessage(telegramId, message, { parse_mode: "HTML" }); }
  catch (e) { console.error("User notify error:", e.message); }
}

async function notifySpinResult(bot, groupId, type, selected) {
  const users = db.getUsers();

  if (type === "cleaning") {
    const user = users.find(u => u.name === selected[0]);
    if (!user) { console.log("User not found:", selected[0]); }
    else if(user) await notifyUser(bot, user.telegramId,
      `🧹 <b>You were picked to clean the house this week!</b>\n\n` +
      `📅 Cleaning days: Monday, Thursday, or Saturday\n` +
      `🗑️ Please also take out the trash!`
    );
    await notifyGroup(bot, groupId,
      `🎰 The wheel picked ${mentionText(user)} for <b>cleaning</b> this week! 🧹🗑️\n` +
      `📅 Cleaning days: Mon / Thu / Sat`
    );

  } else if (type === "shopping") {
    const shopUsers = selected.map(n => users.find(u => u.name === n)).filter(Boolean);
    for (const u of shopUsers) {
      await notifyUser(bot, u.telegramId,
        `🛒 <b>You were picked for grocery shopping this week!</b>\n\n` +
        `📅 Shopping day: Saturday\n` +
        `🥦🥚🍞 Don't forget the essentials!`
      );
    }
    const mentions = shopUsers.map(mentionText).join(" & ");
    await notifyGroup(bot, groupId,
      `🎰 The wheel picked ${mentions} for <b>grocery shopping</b> this week! 🛒\n` +
      `📅 Shopping day: Saturday`
    );
  }
}

async function sendWeeklyCleaningReminder(bot, groupId) {
  const schedule = db.getSchedule();
  if (!schedule || schedule.length === 0) return;
  const next = schedule[0];
  await notifyGroup(bot, groupId,
    `🧹 <b>Cleaning Reminder!</b>\n${mentionText(next)} — your turn this week!\n📅 ${next.cleaningDate} (${next.cleaningDay})\n🗑️ Don't forget the trash!`
  );
  await notifyUser(bot, next.telegramId,
    `🧹 <b>Cleaning reminder!</b>\nYour turn: ${next.cleaningDate} (${next.cleaningDay})\n🗑️ Don't forget the trash!`
  );
}

async function sendWeeklyShoppingReminder(bot, groupId) {
  const schedule = db.getSchedule();
  if (!schedule || schedule.length < 2) return;
  const shoppers = schedule.slice(0, 2);
  const mentions = shoppers.map(mentionText).join(" & ");
  await notifyGroup(bot, groupId,
    `🛒 <b>Shopping Reminder!</b>\n${mentions} — your turn this week!\n📅 ${shoppers[0].shoppingDate} (${shoppers[0].shoppingDay})\n🥦🥚🍞 Essentials!`
  );
  for (const s of shoppers) {
    await notifyUser(bot, s.telegramId,
      `🛒 <b>Shopping reminder!</b>\nYour turn: ${s.shoppingDate} (${s.shoppingDay})\n🥦🥚🍞 Don't forget essentials!`
    );
  }
}

module.exports = {
  generateSchedule, notifyGroup, notifyUser,
  notifySpinResult, sendWeeklyCleaningReminder, sendWeeklyShoppingReminder,
};
