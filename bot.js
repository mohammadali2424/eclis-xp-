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

console.log('🔧 شروع راه‌اندازی ربات...');
console.log('👤 مالک:', OWNER_ID);
console.log('🤖 شناسه ربات:', SELF_BOT_ID);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);

app.use(express.json());

// ==================[ ایجاد جداول دیتابیس ]==================
const initializeDatabase = async () => {
  try {
    console.log('🔧 ایجاد جداول دیتابیس...');
    
    // ایجاد جدول گروه‌های فعال
    const { error: groupsError } = await supabase
      .from('active_groups')
      .select('*')
      .limit(1);

    if (groupsError && groupsError.code === '42P01') {
      console.log('📊 ایجاد جدول active_groups...');
      // در صورت عدم وجود جدول، باید از طریق Supabase UI آن را ایجاد کنید
      console.log('⚠️ لطفاً جدول active_groups را در Supabase ایجاد کنید');
    }

    // ایجاد جدول XP کاربران
    const { error: xpError } = await supabase
      .from('user_xp')
      .select('*')
      .limit(1);

    if (xpError && xpError.code === '42P01') {
      console.log('📊 ایجاد جدول user_xp...');
      console.log('⚠️ لطفاً جدول user_xp را در Supabase ایجاد کنید');
    }

    console.log('✅ بررسی دیتابیس کامل شد');
    return true;
  } catch (error) {
    console.log('❌ خطا در بررسی دیتابیس:', error.message);
    return false;
  }
};

// ==================[ پینگ ]==================
const startAutoPing = () => {
  if (!process.env.RENDER_EXTERNAL_URL) {
    console.log('⚠️ RENDER_EXTERNAL_URL تنظیم نشده');
    return;
  }
  
  const PING_INTERVAL = 5 * 60 * 1000; // هر 5 دقیقه
  const selfUrl = process.env.RENDER_EXTERNAL_URL;

  const performPing = async () => {
    try {
      await axios.get(`${selfUrl}/health`, { timeout: 10000 });
      console.log('✅ پینگ موفق');
    } catch (error) {
      console.log('❌ پینگ ناموفق:', error.message);
    }
  };

  console.log('🔄 شروع پینگ خودکار...');
  setInterval(performPing, PING_INTERVAL);
  performPing(); // پینگ اولیه
};

// ==================[ بررسی مالکیت ]==================
const checkOwnerAccess = (ctx) => {
  const userId = ctx.from.id;
  console.log(`🔐 بررسی دسترسی کاربر ${userId} - مالک: ${OWNER_ID}`);
  
  if (userId !== OWNER_ID) {
    return {
      hasAccess: false,
      message: '🚫 این ربات متعلق به مجموعه اکلیس است ، فقط مالک اکلیس میتواند از ما استفاده کند'
    };
  }
  return { hasAccess: true };
};

// ==================[ مدیریت XP ]==================
const saveUserXP = async (userId, username, firstName, xpToAdd) => {
  try {
    console.log(`💾 ذخیره XP برای کاربر ${userId}: ${xpToAdd} XP`);
    
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
      } else {
        console.log('❌ خطا در insert کاربر جدید:', insertError);
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
      } else {
        console.log('❌ خطا در update کاربر:', updateError);
      }
    } else {
      console.log('❌ خطای fetch کاربر:', fetchError);
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

// فعال کردن گروه
const activateGroup = async (chatId, chatTitle, activatedBy) => {
  try {
    const { error } = await supabase
      .from('active_groups')
      .upsert({
        group_id: chatId.toString(),
        group_title: chatTitle,
        activated_by: activatedBy,
        activated_at: new Date().toISOString()
      }, { onConflict: 'group_id' });

    return !error;
  } catch (error) {
    console.log('❌ خطا در activateGroup:', error.message);
    return false;
  }
};

// دریافت لیست کاربران
const getAllUsersXP = async () => {
  try {
    const { data, error } = await supabase
      .from('user_xp')
      .select('user_id, username, first_name, current_xp, message_count')
      .order('current_xp', { ascending: false });

    if (!error) return data;
    console.log('❌ خطا در دریافت لیست کاربران:', error);
  } catch (error) {
    console.log('❌ خطا در دریافت لیست XP:', error.message);
  }
  return [];
};

// ریست XP
const resetAllXP = async () => {
  try {
    const { error } = await supabase
      .from('user_xp')
      .update({ 
        current_xp: 0,
        reset_at: new Date().toISOString()
      })
      .neq('user_id', 0);

    return !error;
  } catch (error) {
    console.log('❌ خطا در ریست XP:', error.message);
    return false;
  }
};

// محاسبه XP
const calculateXPFromMessage = (text) => {
  if (!text || typeof text !== 'string') return 0;
  
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  const lineCount = lines.length;
  const xpEarned = Math.floor(lineCount / 4) * 20;
  
  return xpEarned;
};

// ==================[ پردازش اعضای جدید ]==================
bot.on('new_chat_members', async (ctx) => {
  try {
    for (const member of ctx.message.new_chat_members) {
      if (member.is_bot && member.id === ctx.botInfo.id) {
        const addedBy = ctx.message.from;
        
        if (addedBy.id !== OWNER_ID) {
          await ctx.reply('🚫 این ربات متعلق به مجموعه اکلیس است ، فقط مالک اکلیس میتواند از ما استفاده کند');
          await ctx.leaveChat();
          return;
        }
        
        await ctx.reply('✅ ربات با موفقیت اضافه شد! از /on1 برای فعال‌سازی استفاده کنید.');
        return;
      }
    }
  } catch (error) {
    console.log('❌ خطا در پردازش عضو جدید:', error.message);
  }
});

// ==================[ پردازش پیام‌ها - تصحیح شده ]==================
bot.on('text', async (ctx) => {
  try {
    // نادیده گرفتن پیام‌های خصوصی
    if (ctx.chat.type === 'private') {
      return;
    }

    const messageText = ctx.message.text;
    
    // اگر پیام با اسلش شروع شد، به هندلرهای دستور اجازه پردازش بده
    if (messageText.startsWith('/')) {
      return;
    }

    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const username = ctx.from.username;
    const firstName = ctx.from.first_name;

    // بررسی فعال بودن گروه
    const groupActive = await isGroupActive(chatId);
    if (!groupActive) {
      return;
    }

    // محاسبه و ذخیره XP
    const xpToAdd = calculateXPFromMessage(messageText);
    if (xpToAdd > 0) {
      await saveUserXP(userId, username, firstName, xpToAdd);
    }

  } catch (error) {
    console.log('❌ خطا در پردازش پیام:', error.message);
  }
});

// ==================[ دستورات ]==================
bot.start((ctx) => {
  const access = checkOwnerAccess(ctx);
  if (!access.hasAccess) {
    return ctx.reply(access.message);
  }
  
  const replyText = `🤖 ربات XP مجموعه اکلیس\n\n` +
    `🔹 /on1 - فعال‌سازی ربات در گروه\n` +
    `🔹 /list_xp - مشاهده لیست XP کاربران\n` +
    `🔹 /status - وضعیت ربات\n\n` +
    `📊 سیستم امتیازدهی:\n` +
    `• هر 4 خط = 20 XP\n` +
    `• پیام‌های تمام گروه‌های فعال محاسبه می‌شوند`;
  
  if (ctx.chat.type === 'private') {
    return ctx.reply(replyText, Markup.keyboard([
      ['/on1', '/list_xp'],
      ['/status']
    ]).resize());
  } else {
    return ctx.reply(replyText);
  }
});

bot.command('on1', async (ctx) => {
  try {
    const access = checkOwnerAccess(ctx);
    if (!access.hasAccess) {
      return ctx.reply(access.message);
    }

    if (ctx.chat.type === 'private') {
      return ctx.reply('❌ این دستور فقط در گروه قابل استفاده است');
    }

    const chatId = ctx.chat.id;
    const chatTitle = ctx.chat.title || 'بدون عنوان';

    // بررسی ادمین بودن ربات
    let isAdmin = false;
    try {
      const chatMember = await ctx.telegram.getChatMember(chatId, ctx.botInfo.id);
      isAdmin = ['administrator', 'creator'].includes(chatMember.status);
    } catch (error) {
      console.log('❌ خطا در بررسی ادمین:', error.message);
    }

    if (!isAdmin) {
      return ctx.reply('❌ لطفاً ابتدا ربات را ادمین گروه کنید و سپس مجدداً /on1 را ارسال کنید.');
    }

    // فعال کردن گروه
    const activationResult = await activateGroup(chatId, chatTitle, ctx.from.id);

    if (!activationResult) {
      return ctx.reply('❌ خطا در فعال‌سازی ربات. لطفاً دوباره تلاش کنید.');
    }

    const successMessage = `✅ ربات XP با موفقیت فعال شد!\n\n` +
      `📊 از این پس پیام‌های کاربران محاسبه شده و به ازای هر 4 خط، 20 XP دریافت می‌کنند.\n\n` +
      `💡 برای مشاهده امتیازات از دستور /list_xp در پیوی ربات استفاده کنید.`;

    await ctx.reply(successMessage);

  } catch (error) {
    console.log('❌ خطا در فعال‌سازی ربات:', error.message);
    await ctx.reply('❌ خطا در فعال‌سازی ربات. لطفاً دوباره تلاش کنید.');
  }
});

bot.command('list_xp', async (ctx) => {
  try {
    const access = checkOwnerAccess(ctx);
    if (!access.hasAccess) {
      return ctx.reply(access.message);
    }

    await ctx.reply('📊 در حال دریافت لیست کاربران...');

    const users = await getAllUsersXP();

    if (!users || users.length === 0) {
      return ctx.reply('📭 هیچ کاربری با XP ثبت نشده است.');
    }

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
    
    await ctx.reply(message);

    // ریست XP کاربران
    await ctx.reply('🔄 در حال ریست کردن امتیازات...');
    const resetResult = await resetAllXP();
    
    if (resetResult) {
      await ctx.reply('✅ امتیازات تمام کاربران با موفقیت ریست شدند.');
    } else {
      await ctx.reply('❌ خطا در ریست کردن امتیازات.');
    }

  } catch (error) {
    console.log('❌ خطا در دریافت لیست XP:', error.message);
    await ctx.reply('❌ خطا در دریافت لیست کاربران.');
  }
});

bot.command('status', async (ctx) => {
  try {
    const access = checkOwnerAccess(ctx);
    if (!access.hasAccess) {
      return ctx.reply(access.message);
    }

    // دریافت آمار
    const { data: groups } = await supabase
      .from('active_groups')
      .select('group_id, group_title');

    const { data: users } = await supabase
      .from('user_xp')
      .select('current_xp')
      .gt('current_xp', 0);

    const activeGroups = groups ? groups.length : 0;
    const activeUsers = users ? users.length : 0;
    const totalXP = users ? users.reduce((sum, user) => sum + user.current_xp, 0) : 0;

    let statusMessage = `🤖 وضعیت ربات XP\n\n`;
    statusMessage += `🔹 گروه‌های فعال: ${activeGroups}\n`;
    statusMessage += `🔹 کاربران دارای XP: ${activeUsers}\n`;
    statusMessage += `🔹 مجموع XP: ${totalXP}\n`;
    statusMessage += `🔹 وضعیت: فعال ✅\n\n`;
    statusMessage += `📊 سیستم: هر 4 خط = 20 XP`;

    await ctx.reply(statusMessage);

  } catch (error) {
    console.log('❌ خطا در دریافت وضعیت:', error.message);
    await ctx.reply('❌ خطا در دریافت وضعیت ربات.');
  }
});

// ==================[ روت‌های سرور ]==================
app.get('/health', async (req, res) => {
  try {
    // تست اتصال به دیتابیس
    const { error } = await supabase
      .from('active_groups')
      .select('count')
      .limit(1);

    res.json({
      status: 'healthy',
      bot: SELF_BOT_ID,
      database: error ? 'disconnected' : 'connected',
      owner: OWNER_ID,
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

// ==================[ راه‌اندازی ]==================
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
    } else {
      console.log('🔧 استفاده از polling...');
      bot.launch();
    }
    
    // شروع سرور
    app.listen(PORT, () => {
      console.log(`✅ سرور روی پورت ${PORT} راه‌اندازی شد`);
      startAutoPing();
    });

  } catch (error) {
    console.log('❌ خطا در راه‌اندازی سرور:', error.message);
    process.exit(1);
  }
};

// شروع برنامه
startServer();

// مدیریت خطاها
process.on('unhandledRejection', (error) => {
  console.log('❌ خطای catch نشده:', error.message);
});

process.on('uncaughtException', (error) => {
  console.log('❌ خطای مدیریت نشده:', error);
});
