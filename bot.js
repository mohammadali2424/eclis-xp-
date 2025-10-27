const { Telegraf } = require('telegraf');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// تنظیمات پایه
const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = parseInt(process.env.OWNER_ID) || 0;

console.log('🔧 شروع راه‌اندازی ربات...');
console.log('👤 مالک:', OWNER_ID);
console.log('🤖 توکن:', BOT_TOKEN ? '✅ موجود' : '❌ مفقود');

if (!BOT_TOKEN) {
  console.log('❌ خطا: BOT_TOKEN تنظیم نشده است');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// تست ساده ترین دستور
bot.start((ctx) => {
  console.log('✅ دستور استارت دریافت شد از:', ctx.from.id);
  return ctx.reply('🤖 ربات فعال است! سلام!');
});

// تست پیام ساده
bot.on('text', (ctx) => {
  console.log('📝 پیام دریافت شد:', ctx.message.text);
  return ctx.reply(`شما گفتید: ${ctx.message.text}`);
});

// راه اندازی سرور
app.get('/', (req, res) => {
  res.send('🤖 ربات فعال است');
});

// راه اندازی ربات
async function startBot() {
  try {
    console.log('🚀 راه اندازی ربات...');
    
    if (process.env.RENDER_EXTERNAL_URL) {
      // استفاده از webhook
      const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/webhook`;
      console.log(`🔗 تنظیم webhook: ${webhookUrl}`);
      
      await bot.telegram.setWebhook(webhookUrl);
      app.use(bot.webhookCallback('/webhook'));
    } else {
      // استفاده از polling
      console.log('🔧 استفاده از polling...');
      await bot.launch();
    }
    
    app.listen(PORT, () => {
      console.log(`✅ سرور روی پورت ${PORT} راه‌اندازی شد`);
    });
    
    console.log('🎉 ربات با موفقیت راه اندازی شد');
    
  } catch (error) {
    console.log('❌ خطا در راه اندازی:', error.message);
    process.exit(1);
  }
}

startBot();
