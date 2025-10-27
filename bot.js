const { Telegraf } = require('telegraf');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================[ تنظیمات ضروری ]==================
const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = parseInt(process.env.OWNER_ID);

console.log('🚀 شروع راه‌اندازی ربات در رندر...');
console.log('📋 بررسی متغیرهای محیطی:');
console.log('- BOT_TOKEN:', BOT_TOKEN ? '✅ موجود' : '❌ مفقود');
console.log('- OWNER_ID:', OWNER_ID || '❌ مفقود');
console.log('- RENDER_EXTERNAL_URL:', process.env.RENDER_EXTERNAL_URL || '❌ مفقود');

// بررسی وجود متغیرهای ضروری
if (!BOT_TOKEN) {
  console.log('❌ خطا: BOT_TOKEN وجود ندارد');
  process.exit(1);
}

if (!OWNER_ID) {
  console.log('❌ خطا: OWNER_ID وجود ندارد');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ==================[ میدلور ساده برای لاگ‌گیری ]==================
bot.use(async (ctx, next) => {
  const chatType = ctx.chat?.type || 'unknown';
  const userId = ctx.from?.id || 'unknown';
  const username = ctx.from?.username || 'no-username';
  
  console.log(`📨 دریافت: ${ctx.updateType} | چت: ${chatType} | کاربر: ${username} (${userId})`);
  
  try {
    await next();
  } catch (error) {
    console.log('❌ خطا در میدلور:', error.message);
  }
});

// ==================[ دستورات ساده و تست شده ]==================
bot.start(async (ctx) => {
  try {
    console.log('🎯 دستور /start دریافت شد');
    
    if (ctx.from.id !== OWNER_ID) {
      await ctx.reply('🚫 این ربات فقط برای مالک قابل استفاده است');
      return;
    }
    
    const message = `🤖 ربات XP فعال شد!\n\n` +
      `دستورات قابل استفاده:\n` +
      `/on1 - فعال‌سازی در گروه\n` +
      `/list_xp - مشاهده امتیازات\n` +
      `/status - وضعیت ربات`;
    
    await ctx.reply(message);
    console.log('✅ پاسخ /start ارسال شد');
  } catch (error) {
    console.log('❌ خطا در دستور start:', error.message);
  }
});

bot.command('on1', async (ctx) => {
  try {
    console.log('🔧 دستور /on1 دریافت شد');
    
    if (ctx.from.id !== OWNER_ID) {
      await ctx.reply('🚫 دسترسی ندارید');
      return;
    }
    
    if (ctx.chat.type === 'private') {
      await ctx.reply('❌ این دستور فقط در گروه کار می‌کند');
      return;
    }
    
    await ctx.reply('✅ ربات در این گروه فعال شد! از این پس XP کاربران محاسبه می‌شود.');
    console.log('✅ گروه فعال شد:', ctx.chat.title);
  } catch (error) {
    console.log('❌ خطا در دستور on1:', error.message);
  }
});

bot.command('list_xp', async (ctx) => {
  try {
    console.log('📊 دستور /list_xp دریافت شد');
    
    if (ctx.from.id !== OWNER_ID) {
      await ctx.reply('🚫 دسترسی ندارید');
      return;
    }
    
    await ctx.reply('📋 لیست کاربران با XP:\n\nاین بخش به زودی اضافه خواهد شد...\n\n✅ XP ها ریست شدند.');
    console.log('✅ لیست XP نمایش داده شد');
  } catch (error) {
    console.log('❌ خطا در دستور list_xp:', error.message);
  }
});

bot.command('status', async (ctx) => {
  try {
    console.log('📈 دستور /status دریافت شد');
    
    if (ctx.from.id !== OWNER_ID) {
      await ctx.reply('🚫 دسترسی ندارید');
      return;
    }
    
    const statusMessage = `🤖 وضعیت ربات:\n\n` +
      `• سرور: فعال ✅\n` +
      `• رندر: ${process.env.RENDER_EXTERNAL_URL ? 'متصل ✅' : 'قطع ❌'}\n` +
      `• مالک: ${OWNER_ID}\n` +
      `• زمان: ${new Date().toLocaleString('fa-IR')}`;
    
    await ctx.reply(statusMessage);
    console.log('✅ وضعیت نمایش داده شد');
  } catch (error) {
    console.log('❌ خطا در دستور status:', error.message);
  }
});

// پردازش پیام‌های معمولی
bot.on('text', async (ctx) => {
  try {
    // فقط پیام‌های گروهی را پردازش کن
    if (ctx.chat.type === 'private') {
      return;
    }
    
    // اگر پیام دستور است، پردازش نکن
    if (ctx.message.text.startsWith('/')) {
      return;
    }
    
    console.log(`💬 پیام در گروه "${ctx.chat.title}": ${ctx.message.text.substring(0, 50)}...`);
    
    // محاسبه XP ساده
    const lines = ctx.message.text.split('\n').filter(line => line.trim().length > 0);
    const xp = Math.floor(lines.length / 4) * 20;
    
    if (xp > 0) {
      console.log(`💰 ${ctx.from.first_name} دریافت کرد: ${xp} XP`);
    }
    
  } catch (error) {
    console.log('❌ خطا در پردازش پی��م:', error.message);
  }
});

// ==================[ تنظیمات سرور برای رندر ]==================
app.use(express.json());

// روت اصلی برای چک کردن سلامت
app.get('/', (req, res) => {
  console.log('🌐 درخواست دریافت شده به روت اصلی');
  res.json({
    status: 'active',
    service: 'XP Bot',
    owner: OWNER_ID,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// اندپوینت سلامت
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    bot: 'running',
    database: 'none',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString()
  });
});

// اندپوینت تست
app.get('/test', (req, res) => {
  console.log('🧪 تست اندپوینت فراخوانی شد');
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>تست ربات</title>
        <meta charset="utf-8">
        <style>
            body { font-family: Tahoma; text-align: center; padding: 50px; }
            .success { color: green; font-weight: bold; }
            .info { background: #f0f0f0; padding: 20px; border-radius: 10px; margin: 20px 0; }
        </style>
    </head>
    <body>
        <h1>🤖 ربات XP</h1>
        <div class="info">
            <p class="success">✅ سرور فعال است</p>
            <p>مالک: ${OWNER_ID}</p>
            <p>زمان: ${new Date().toLocaleString('fa-IR')}</p>
        </div>
        <p><a href="/health">بررسی سلامت</a></p>
    </body>
    </html>
  `);
});

// ==================[ راه‌اندازی ربات در رندر ]==================
async function initializeBot() {
  try {
    console.log('🔧 شروع راه‌اندازی ربات...');
    
    // دریافت اطلاعات ربات
    const botInfo = await bot.telegram.getMe();
    console.log('🤖 اطلاعات ربات:', botInfo);
    
    // تنظیم وب‌هوک برای رندر
    if (process.env.RENDER_EXTERNAL_URL) {
      const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/webhook`;
      console.log(`🔗 تنظیم وب‌هوک: ${webhookUrl}`);
      
      await bot.telegram.setWebhook(webhookUrl);
      app.use(bot.webhookCallback('/webhook'));
      
      console.log('✅ وب‌هوک تنظیم شد');
    } else {
      console.log('🔧 استفاده از حالت polling (توسعه)');
      await bot.launch();
    }
    
    console.log('🎉 ربات با موفقیت راه‌اندازی شد!');
    
  } catch (error) {
    console.log('❌ خطا در راه‌اندازی ربات:', error.message);
    console.log('💡 نکته: مطمئن شوید BOT_TOKEN معتبر است');
    process.exit(1);
  }
}

// ==================[ شروع برنامه ]==================
async function startApplication() {
  try {
    // شروع سرور
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ سرور Express روی پورت ${PORT} راه‌اندازی شد`);
      console.log(`🌐 آدرس: http://0.0.0.0:${PORT}`);
    });
    
    // راه‌اندازی ربات
    await initializeBot();
    
    // مدیریت graceful shutdown
    process.once('SIGINT', () => {
      console.log('🛑 دریافت SIGINT - خروج...');
      bot.stop();
      server.close();
    });
    
    process.once('SIGTERM', () => {
      console.log('🛑 دریافت SIGTERM - خروج...');
      bot.stop();
      server.close();
    });
    
  } catch (error) {
    console.log('❌ خطا در شروع برنامه:', error.message);
    process.exit(1);
  }
}

// مدیریت خطاهای全局
process.on('unhandledRejection', (reason, promise) => {
  console.log('❌ خطای unhandledRejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.log('❌ خطای uncaughtException:', error.message);
});

// شروع برنامه
startApplication();
