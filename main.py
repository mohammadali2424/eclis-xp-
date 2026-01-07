import os
import logging
import asyncio
from dataclasses import dataclass
from typing import Dict, List, Optional

import httpx
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application,
    CommandHandler,
    CallbackQueryHandler,
    ContextTypes,
)

# ============================================================
# ENV / CONFIG
# ============================================================
PUBLIC_URL = os.getenv("PUBLIC_URL")  # https://your-service.onrender.com
PORT = int(os.getenv("PORT", "10000"))

BOT_TOKEN_1 = os.getenv("BOT_TOKEN_1")  # controller bot (receives commands)
BOT_TOKEN_2 = os.getenv("BOT_TOKEN_2")  # sender bot 2
BOT_TOKEN_3 = os.getenv("BOT_TOKEN_3")  # sender bot 3

DEFAULT_INTERVAL_SECONDS = float(os.getenv("DEFAULT_INTERVAL_SECONDS", "1"))
MAX_COUNT = int(os.getenv("MAX_COUNT", "1000"))

MIN_INTERVAL = float(os.getenv("MIN_INTERVAL", "0.2"))
MAX_INTERVAL = float(os.getenv("MAX_INTERVAL", "3600"))

if not BOT_TOKEN_1 or not BOT_TOKEN_2 or not BOT_TOKEN_3:
    raise RuntimeError("You must set BOT_TOKEN_1, BOT_TOKEN_2, BOT_TOKEN_3 env vars.")

SENDER_TOKENS: List[str] = [BOT_TOKEN_1, BOT_TOKEN_2, BOT_TOKEN_3]

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s", level=logging.INFO
)
logger = logging.getLogger("rr-bot")

# ============================================================
# Persian number-to-words (0..1000)
# ============================================================
ONES = {0: "صفر", 1: "یک", 2: "دو", 3: "سه", 4: "چهار", 5: "پنج", 6: "شش", 7: "هفت", 8: "هشت", 9: "نه"}
TEENS = {10: "ده", 11: "یازده", 12: "دوازده", 13: "سیزده", 14: "چهارده", 15: "پانزده",
         16: "شانزده", 17: "هفده", 18: "هجده", 19: "نوزده"}
TENS = {2: "بیست", 3: "سی", 4: "چهل", 5: "پنجاه", 6: "شصت", 7: "هفتاد", 8: "هشتاد", 9: "نود"}
HUNDREDS = {1: "صد", 2: "دویست", 3: "سیصد", 4: "چهارصد", 5: "پانصد", 6: "ششصد",
            7: "هفتصد", 8: "هشتصد", 9: "نهصد"}

def number_to_words_fa(n: int) -> str:
    if n < 0 or n > 1000:
        raise ValueError("Supported range: 0..1000")
    if n == 1000:
        return "هزار"
    if n < 10:
        return ONES[n]
    if 10 <= n < 20:
        return TEENS[n]
    if 20 <= n < 100:
        t = n // 10
        o = n % 10
        return TENS[t] if o == 0 else f"{TENS[t]} و {ONES[o]}"
    if 100 <= n < 1000:
        h = n // 100
        rest = n % 100
        return HUNDREDS[h] if rest == 0 else f"{HUNDREDS[h]} و {number_to_words_fa(rest)}"
    return ONES[0]

# ============================================================
# State (in-memory per chat)
# ============================================================
@dataclass
class ChatState:
    running: bool = False
    current: int = 1
    interval: float = DEFAULT_INTERVAL_SECONDS
    rr_index: int = 0  # next bot token index
    lock: asyncio.Lock = asyncio.Lock()

CHAT: Dict[int, ChatState] = {}
JOB_PREFIX = "rr_counter_job:"

def get_state(chat_id: int) -> ChatState:
    if chat_id not in CHAT:
        CHAT[chat_id] = ChatState()
    return CHAT[chat_id]

def keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("▶️ استارت", callback_data="start"),
         InlineKeyboardButton("⏹ پایان", callback_data="stop")],
        [InlineKeyboardButton("⏱ تنظیم فاصله", callback_data="help_interval")],
    ])

async def send_controls(update: Update) -> None:
    txt = (
        "کنترل شمارنده (سه بات نوبتی):\n"
        "• ▶️ استارت: شروع شمارش از 1 تا 1000\n"
        "• ⏹ پایان: توقف\n\n"
        "تنظیم فاصله زمانی:\n"
        "• /interval 2  (هر 2 ثانیه)\n"
        "• /interval 0.5 (هر نیم ثانیه)\n"
        f"پیش‌فرض: {DEFAULT_INTERVAL_SECONDS} ثانیه"
    )
    if update.message:
        await update.message.reply_text(txt, reply_markup=keyboard())
    elif update.callback_query:
        await update.callback_query.message.reply_text(txt, reply_markup=keyboard())

# ============================================================
# Low-level sender: send via Bot API directly, choosing token
# ============================================================
async def api_send_message(token: str, chat_id: int, text: str) -> None:
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(url, json={"chat_id": chat_id, "text": text})
        r.raise_for_status()

async def send_round_robin(chat_id: int, text: str) -> None:
    state = get_state(chat_id)
    token = SENDER_TOKENS[state.rr_index]
    state.rr_index = (state.rr_index + 1) % len(SENDER_TOKENS)
    await api_send_message(token, chat_id, text)

def job_name(chat_id: int) -> str:
    return f"{JOB_PREFIX}{chat_id}"

# ============================================================
# Counter job tick
# ============================================================
async def counter_tick(context: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = context.job.chat_id
    state = get_state(chat_id)

    async with state.lock:
        if not state.running:
            return

        if state.current > MAX_COUNT:
            state.running = False
            # Use controller bot to announce finish (or use RR)
            await context.bot.send_message(chat_id, f"✅ تمام شد. تا {MAX_COUNT} شمردم.")
            return

        n = state.current
        txt = f"{n} - {number_to_words_fa(n)}"
        state.current += 1

    # Send outside lock to reduce contention
    try:
        await send_round_robin(chat_id, txt)
    except Exception as e:
        logger.exception("Send failed: %s", e)

# ============================================================
# Start / Stop / Reschedule
# ============================================================
async def start_counter(chat_id: int, context: ContextTypes.DEFAULT_TYPE) -> str:
    state = get_state(chat_id)
    async with state.lock:
        if state.running:
            return "⏳ شمارنده در حال اجراست."
        state.running = True
        state.current = 1
        state.rr_index = 0  # always start from bot1; change if you prefer
        interval = state.interval

    # remove old jobs
    for j in context.job_queue.get_jobs_by_name(job_name(chat_id)):
        j.schedule_removal()

    context.job_queue.run_repeating(
        counter_tick,
        interval=interval,
        first=0.0,
        chat_id=chat_id,
        name=job_name(chat_id),
    )
    return f"✅ شروع شد. فاصله: {interval} ثانیه\n(ارسال نوبتی بین 3 بات)"

async def stop_counter(chat_id: int, context: ContextTypes.DEFAULT_TYPE) -> str:
    state = get_state(chat_id)
    async with state.lock:
        state.running = False
    for j in context.job_queue.get_jobs_by_name(job_name(chat_id)):
        j.schedule_removal()
    return "🛑 متوقف شد."

async def reschedule(chat_id: int, context: ContextTypes.DEFAULT_TYPE) -> None:
    state = get_state(chat_id)
    jobs = context.job_queue.get_jobs_by_name(job_name(chat_id))
    if not jobs:
        return
    for j in jobs:
        j.schedule_removal()
    context.job_queue.run_repeating(
        counter_tick,
        interval=state.interval,
        first=0.0,
        chat_id=chat_id,
        name=job_name(chat_id),
    )

# ============================================================
# Handlers
# ============================================================
async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await send_controls(update)

async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await send_controls(update)

async def cmd_interval(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = update.effective_chat.id
    state = get_state(chat_id)

    if not context.args:
        await update.message.reply_text(
            f"فاصله فعلی: {state.interval} ثانیه\n"
            "برای تغییر: /interval 2 یا /interval 0.5"
        )
        return

    try:
        val = float(context.args[0])
        if val < MIN_INTERVAL or val > MAX_INTERVAL:
            raise ValueError
    except Exception:
        await update.message.reply_text(
            f"فرمت یا بازه نادرست.\n"
            f"مثال: /interval 2\n"
            f"حداقل: {MIN_INTERVAL} ثانیه | حداکثر: {MAX_INTERVAL} ثانیه"
        )
        return

    async with state.lock:
        state.interval = val

    await reschedule(chat_id, context)
    await update.message.reply_text(f"✅ فاصله تنظیم شد روی: {state.interval} ثانیه")

async def on_button(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    q = update.callback_query
    await q.answer()
    chat_id = q.message.chat_id

    if q.data == "start":
        msg = await start_counter(chat_id, context)
        await q.message.reply_text(msg)
    elif q.data == "stop":
        msg = await stop_counter(chat_id, context)
        await q.message.reply_text(msg)
    elif q.data == "help_interval":
        await q.message.reply_text(
            "برای تنظیم فاصله زمانی:\n"
            "• /interval 2  (هر 2 ثانیه)\n"
            "• /interval 0.5 (هر نیم ثانیه)\n"
            f"حداقل: {MIN_INTERVAL} ثانیه"
        )

# ============================================================
# Webhook startup
# ============================================================

def main() -> None:
    app = Application.builder().token(BOT_TOKEN_1).build()

    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(CommandHandler("interval", cmd_interval))
    app.add_handler(CallbackQueryHandler(on_button))

  app.run_webhook(
    listen="0.0.0.0",
    port=PORT,
    url_path="telegram/webhook",
    webhook_url=f"{PUBLIC_URL}/telegram/webhook",
    allowed_updates=Update.ALL_TYPES,
)

if __name__ == "__main__":
    main()
