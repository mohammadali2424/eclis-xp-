const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================[ تنظیمات ]==================
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SELF_BOT_ID = process.env.SELF_BOT_ID || 'xp_bot_1';
const OWNER_ID = parseInt(process.env.OWNER_ID) || 0;

// بررسی وجود متغیرهای محیطی
if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_KEY) {
  console.log('❌ خطا: متغیرهای محیطی تنظیم نشده‌اند!');
  process.exit(1);
}

console.log('✅ متغیرها�� محیطی بررسی شدند');
console.log('🔑 مالک:', OWNER_ID);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);

app.use(express.json());

// ==================[ پینگ ]==================
const startAutoPing = () => {
  if (!process.env.RENDER_EXTERNAL_URL) {
    console.log('⚠️ RENDER_EXTERNAL_URL تنظیم نشده - پینگ غیرفعال');
    return;
  }
  
  const PING_INTERVAL = 13 * 60 * 1000 + 59 * 1000;
  const selfUrl = process.env.RENDER_EXTERNAL_URL;

  const performPing = async () => {
    try {
      await axios.get(`${selfUrl}/`, { timeout: 10000 });
      console.log('✅ پینگ موفق');
    } catch (error) {
      console.log('❌ پینگ ناموفق:', error.message);
    }
  };

  console.log('🔄 شروع پینگ خودکار...');
  setTimeout(performPing, 10000);
  setInterval(performPing, PING_INTERVAL);
};

// ==================[ بررسی مالکیت ]==================
const checkOwnerAccess = (ctx) => {
  const userId = ctx.from.id;
  if (userId !== OWNER_ID) {
    return {
      hasAccess: false,
      message: '🚫 این ربات متعلق به مجموعه اکلیس است ، فقط مالک اکلیس میتواند از ما استفاده کند'
    };
  }
  return { hasAccess: true };
};

// ==================[ مدیریت دیتابیس XP ]==================
const initializeDatabase = async () => {
  try {
    console.log('🔧 برر��ی ساختار دیتابیس...');
    
    // ایجاد جدول active_groups اگر وجود ندارد
    const { error: groupsError } = await supabase
      .from('active_groups')
      .select('*')
      .limit(1);
    
    if (groupsError && groupsError.code === '42P01') {
      console.log('📦 ایجاد جدول active_groups...');
      // در Supabase باید از SQL استفاده کنیم یا از رابط کاربری جدول را ایجاد کنیم
    }

    // ایجاد جدول user_xp اگر وجود ندارد
    const { error: xpError } = await supabase
      .from('user_xp')
      .select('*')
      .limit(1);
    
    if (xpError && xpError.code === '42P01') {
      console.log('📦 ایجاد جدول user_xp...');
    }

    console.log('✅ دیتابیس آماده است');
  } catch (error) {
    console.log('⚠️ خطا در بررسی دیتابیس:', error.message);
  }
};

// ذخیره XP کاربر
const saveUserXP = async (userId, username, firstName, xpToAdd) => {
  try {
    const { data: existingUser, error: fetchError } = await supabase
      .from('user_xp')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (fetchError && fetchError.code === 'PGRST116') {
      // کاربر جدید
      const { error: insertError } = await supabase
        .from('user_xp')
        .insert({
          user_id: userId,
          username: username,
          first_name: firstName,
          total_xp: xpToAdd,
          current_xp: xpToAdd,
          message_count: 1,
          last_active: new Date().toISOString()
        });

      if (!insertError) {
        console.log(`✅ کاربر جدید ${userId} با ${xpToAdd} XP ذخیره شد`);
        return xpToAdd;
      }
    } else if (!fetchError && existingUser) {
      // کاربر موجود
      const newTotalXP = existingUser.total_xp + xpToAdd;
      const newCurrentXP = existingUser.current_xp + xpToAdd;
      const newMessageCount = existingUser.message_count + 1;

      const { error: updateError } = await supabase
        .from('user_xp')
        .update({
          total_xp: newTotalXP,
          current_xp: newCurrentXP,
          message_count: newMessageCount,
          last_active: new Date().toISOString(),
          username: username,
          first_name: firstName
        })
        .eq('user_id', userId);

      if (!updateError) {
        console.log(`📈 کاربر ${userId} +${xpToAdd} XP (مجموع: ${newCurrentXP})`);
        return newCurrentXP;
      }
    }
  } catch (error) {
    console.log('❌ خطا در ذخیره XP:', error.message);
  }
  return 0;
};

// بررسی فعال بودن گروه
const isGroupActive = async (chatId) => {
  try {
    const { data, error } = await supabase
      .from('active_groups')
      .select('group_id')
      .eq('group_id', chatId.toString())
      .single();

    return !error && data;
  } catch (error) {
    console.log('❌ خطا در بررسی گروه فعال:', error.message);
    return false;
  }
};

// دریافت لیست تمام کاربران با XP
const getAllUsersXP = async () => {
  try {
    const { data, error } = await supabase
      .from('user_xp')
      .select('user_id, username, first_name, current_xp, message_count')
      .order('current_xp', { ascending: false });

    if (!error && data) {
      return data;
    }
  } catch (error) {
    console.log('❌ خطا در دریافت لیست XP:', error.message);
  }
  return [];
};

// ریست XP همه کاربران
const resetAllXP = async () => {
  try {
    const { error } = await supabase
      .from('user_xp')
      .update({ 
        current_xp: 0,
        reset_at: new Date().toISOString()
      })
      .neq('user_id', 0);

    if (!error) {
      console.log('✅ تمام XP ها ریست شدند');
      return true;
    }
  } catch (error) {
    console.log('❌ خطا در ریست XP:', error.message);
  }
  return false;
};

// ==================[ محاسبه XP ]==================
const calculateXPFromMessage = (text) => {
  if (!text || typeof text !== 'string') return 0;
  
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  const lineCount = lines.length;
  
  // هر 4 خط = 20 XP
  const xpEarned = Math.floor(lineCount / 4) * 20;
  
  return xpEarned;
};

// ==================[ پردازش پیام‌ها ]==================
bot.on('text', async (ctx) => {
  try {
    console.log('📨 دریافت پیام از:', ctx.from.first_name, 'در گروه:', ctx.chat.title);
    
    // فقط پیام‌های گروهی پردازش شوند
    if (ctx.chat.type === 'private') {
      console.log('ℹ️ پیام خصوصی - نادیده گرفته شد');
      return;
    }

    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const username = ctx.from.username;
    const firstName = ctx.from.first_name;
    const messageText = ctx.message.text;

    console.log(`🔍 بررسی گروه ${chatId}...`);

    // بررسی فعال بودن گروه
    const groupActive = await isGroupActive(chatId);
    if (!groupActive) {
      console.log('❌ گروه غیرفعال است');
      return;
    }

    console.log('✅ گروه فعال است');

    // محاسبه XP
    const xpToAdd = calculateXPFromMessage(messageText);
    console.log(`📊 خطوط پیام: ${messageText.split('\n').length} - XP قابل دریافت: ${xpToAdd}`);
    
    if (xpToAdd > 0) {
      await saveUserXP(userId, username, firstName, xpToAdd);
    } else {
      console.log('ℹ️ XP کافی برای افزودن نیست');
    }

  } catch (error) {
    console.log('❌ خطا در پردازش پیام:', error.message);
  }
});

// ==================[ دستورات ]==================

// دکمه استارت
bot.start((ctx) => {
  console.log('🎯 دستور استارت از:', ctx.from.first_name, 'آیدی:', ctx.from.id);
  
  const access = checkOwnerAccess(ctx);
  if (!access.hasAccess) {
    console.log('🚫 دسترسی غیرمجاز از کاربر:', ctx.from.id);
    return ctx.reply(access.message);
  }
  
  console.log('✅ دسترسی مالک تأیید شد');
  
  ctx.reply(
    `🤖 ربات XP مجموعه اکلیس\n\n` +
    `🔹 /on1 - فعال‌سازی ربات در گروه\n` +
    `🔹 /list_xp - مشاهده لیست XP کاربران\n` +
    `🔹 /status - وضعیت ربات\n\n` +
    `📊 سیستم امتیازدهی:\n` +
    `• هر 4 خط = 20 XP\n` +
    `• پیام‌های تمام گروه‌های فعال محاسبه می‌شوند`,
    Markup.keyboard([
      ['/on1', '/list_xp'],
      ['/status']
    ]).resize()
  );
});

// فعال‌سازی ربات در گروه
bot.command('on1', async (ctx) => {
  try {
    console.log('🔧 درخواست فعال‌سازی از:', ctx.from.first_name);
    
    const access = checkOwnerAccess(ctx);
    if (!access.hasAccess) {
      return ctx.reply(access.message);
    }

    if (ctx.chat.type === 'private') {
      return ctx.reply('❌ این دستور فقط در گروه قابل استفاده است');
    }

    const chatId = ctx.chat.id.toString();
    const chatTitle = ctx.chat.title || 'بدون عنوان';

    console.log(`🔍 بررسی ادمین بودن در گروه: ${chatTitle}`);

    // بررسی ادمین بودن ربات
    let isAdmin = false;
    try {
      const chatMember = await ctx.telegram.getChatMember(chatId, ctx.botInfo.id);
      isAdmin = ['administrator', 'creator'].includes(chatMember.status);
      console.log(`🤖 وضعیت ادمین: ${isAdmin}`);
    } catch (error) {
      console.log('❌ خطا در بررسی ادمین:', error.message);
    }

    if (!isAdmin) {
      return ctx.reply('❌ لطفاً ابتدا ربات را ادمین گروه کنید و سپس مجدداً /on1 را ارسال کنید.');
    }

    console.log(`✅ ر��ات ادمین است - ذخیره گروه: ${chatId}`);

    // ذخیره گروه فعال
    const { error } = await supabase
      .from('active_groups')
      .upsert({
        group_id: chatId,
        group_title: chatTitle,
        activated_by: ctx.from.id,
        activated_at: new Date().toISOString()
      }, { onConflict: 'group_id' });

    if (error) {
      console.log('❌ خطا در ذخیره گروه:', error);
      throw error;
    }

    ctx.reply(
      `✅ ربات XP با موفقیت فعال شد!\n\n` +
      `📊 از این پس پیام‌های کاربران محاسبه شده و به ازای هر 4 خط، 20 XP دریافت می‌کنند.\n\n` +
      `💡 برای مشاهده امتیازات از دستور /list_xp در پیوی ربات استفاده کنید.`
    );

    console.log(`✅ ربات XP در گروه ${chatTitle} فعال شد`);

  } catch (error) {
    console.log('❌ خطا در فعال‌سازی ربات:', error.message);
    ctx.reply('❌ خطا در فعال‌سازی ربات. لطفاً دوباره تلاش کنید.');
  }
});

// مشاهده لیست XP کاربران
bot.command('list_xp', async (ctx) => {
  try {
    console.log('📊 درخواست لیست XP از:', ctx.from.first_name);
    
    const access = checkOwnerAccess(ctx);
    if (!access.hasAccess) {
      return ctx.reply(access.message);
    }

    // فقط در پیوی قابل استفاده باشد
    if (ctx.chat.type !== 'private') {
      return ctx.reply('❌ این دستور فقط در پیوی ربات قابل استفاده است');
    }

    await ctx.reply('📊 در حال دریافت لیست کاربران...');

    const users = await getAllUsersXP();

    if (!users || users.length === 0) {
      return ctx.reply('📭 هیچ کاربری با XP ثبت نشده است.');
    }

    // ایجاد پیام لیست
    let message = `🏆 لیست امتیازات کاربران\n\n`;
    let totalXP = 0;
    let userCount = 0;

    users.forEach((user, index) => {
      if (user.current_xp > 0) {
        const name = user.first_name || user.username || `User${user.user_id}`;
        message += `${index + 1}. ${name}: ${user.current_xp} XP\n`;
        totalXP += user.current_xp;
        userCount++;
      }
    });

    if (userCount === 0) {
      return ctx.reply('📭 هیچ کاربری با XP ثبت نشده است.');
    }

    message += `\n📈 جمع کل: ${totalXP} XP\n👥 تعداد کاربران: ${userCount}`;

    // ارسال لیست
    await ctx.reply(message);

    // ریست XP کاربران
    await ctx.reply('🔄 در حال ریست کردن امتیازات...');
    const resetResult = await resetAllXP();
    
    if (resetResult) {
      await ctx.reply('✅ امتیازات تمام کاربران با موفقیت ریست شدند.');
      console.log(`✅ لیست XP توسط مالک مشاهده و ریست شد - ${userCount} کاربر`);
    } else {
      await ctx.reply('❌ خطا در ریست کردن امتیازات.');
    }

  } catch (error) {
    console.log('❌ خطا در دریافت لیست XP:', error.message);
    ctx.reply('❌ خطا در دریافت لیست کاربران.');
  }
});

// وضعیت ربات
bot.command('status', async (ctx) => {
  try {
    console.log('📈 درخواست وضعیت از:', ctx.from.first_name);
    
    const access = checkOwnerAccess(ctx);
    if (!access.hasAccess) {
      return ctx.reply(access.message);
    }

    // دریافت آمار
    const { data: groups, error: groupsError } = await supabase
      .from('active_groups')
      .select('group_id, group_title');

    const { data: users, error: usersError } = await supabase
      .from('user_xp')
      .select('current_xp')
      .gt('current_xp', 0);

    const activeGroups = groups && !groupsError ? groups.length : 0;
    const activeUsers = users && !usersError ? users.length : 0;
    const totalXP = users && !usersError ? users.reduce((sum, user) => sum + user.current_xp, 0) : 0;

    let statusMessage = `🤖 وضعیت ربات XP\n\n`;
    statusMessage += `🔹 گروه‌های فعال: ${activeGroups}\n`;
    statusMessage += `🔹 کاربران دارای XP: ${activeUsers}\n`;
    statusMessage += `🔹 مجموع XP: ${totalXP}\n`;
    statusMessage += `🔹 وضعیت: فعال ✅\n\n`;
    statusMessage += `📊 سیستم: هر 4 خط = 20 XP`;

    ctx.reply(statusMessage);

  } catch (error) {
    console.log('❌ خطا در دریافت وضعیت:', error.message);
    ctx.reply('❌ خطا در دریافت وضعیت ربات.');
  }
});

// ==================[ تست سلامت ]==================
app.get('/health', async (req, res) => {
  try {
    // تست اتصال به دیتابیس
    const { data, error } = await supabase
      .from('active_groups')
      .select('count')
      .limit(1);

    res.json({
      status: 'healthy',
      bot: SELF_BOT_ID,
      database: error ? 'disconnected' : 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

app.get('/', (req, res) => {
  res.send(`
    <h1>🤖 ربات XP مجموعه اکلیس</h1>
    <p>ربات فعال است - فقط مالک می‌تواند استفاده کند</p>
    <p>مالک: ${OWNER_ID}</p>
    <p>Bot ID: ${SELF_BOT_ID}</p>
    <p><a href="/health">بررسی سلامت</a></p>
  `);
});

// ==================[ راه‌اندازی سرور ]==================
const startServer = async () => {
  try {
    console.log('🚀 شروع راه‌اندازی سرور...');
    
    // مقداردهی اولیه دیتابیس
    await initializeDatabase();
    
    // استفاده از webhook در رندر
    if (process.env.RENDER_EXTERNAL_URL) {
      const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/webhook`;
      console.log(`🔗 تنظیم webhook: ${webhookUrl}`);
      
      await bot.telegram.setWebhook(webhookUrl);
      app.use(bot.webhookCallback('/webhook'));
      
      console.log('✅ Webhook تنظیم شد');
    } else {
      console.log('🔧 استفاده از polling...');
      bot.launch();
    }
    
    // شروع سرور
    app.listen(PORT, () => {
      console.log(`✅ سرور روی پورت ${PORT} راه‌اندازی شد`);
      console.log(`🤖 ربات ${SELF_BOT_ID} آماده است`);
      
      // شروع پینگ
      startAutoPing();
    });

    // مدیریت graceful shutdown
    process.once('SIGINT', () => {
      console.log('🛑 توقف ربات...');
      bot.stop('SIGINT');
    });
    process.once('SIGTERM', () => {
      console.log('🛑 توقف ربات...');
      bot.stop('SIGTERM');
    });

  } catch (error) {
    console.log('❌ خطا در راه‌اندازی سرور:', error.message);
    process.exit(1);
  }
};

// شروع برنامه
startServer();

// مدیریت خطاهای catch نشده
process.on('unhandledRejection', (error) => {
  console.log('❌ خطای catch نشده:', error.message);
});

process.on('uncaughtException', (error) => {
  console.log('❌ خطای مدیریت نشده:', error);
  process.exit(1);
});
