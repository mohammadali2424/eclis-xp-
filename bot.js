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
  performPing(); // اولین پینگ
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

// ==================[ مدیریت دیتابیس XP ]==================
const initializeDatabase = async () => {
  try {
    console.log('🔧 بررسی ساختار دیتابیس...');
    
    // تست اتصال به دیتابیس
    const { data, error } = await supabase
      .from('active_groups')
      .select('*')
      .limit(1);
    
    if (error) {
      console.log('❌ خطا در اتصال به دیتابیس:', error.message);
      return false;
    }
    
    console.log('✅ اتصال به دیتابیس موفق');
    return true;
  } catch (error) {
    console.log('❌ خطا در بررسی دیتابیس:', error.message);
    return false;
  }
};

// ذخیره XP کاربر
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
          username: username || '',
          first_name: firstName || 'ناشناس',
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
          username: username || existingUser.username,
          first_name: firstName || existingUser.first_name
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
    console.log(`🔍 بررسی فعال بودن گروه ${chatId}...`);
    
    const { data, error } = await supabase
      .from('active_groups')
      .select('group_id')
      .eq('group_id', chatId.toString())
      .single();

    const isActive = !error && data;
    console.log(`📊 گروه ${chatId} فعال: ${isActive}`);
    return isActive;
  } catch (error) {
    console.log('❌ خطا در بررسی گروه فعال:', error.message);
    return false;
  }
};

// فعال کردن گروه
const activateGroup = async (chatId, chatTitle, activatedBy) => {
  try {
    console.log(`🔧 فعال‌سازی گروه ${chatId} - ${chatTitle}...`);
    
    const { error } = await supabase
      .from('active_groups')
      .upsert({
        group_id: chatId.toString(),
        group_title: chatTitle,
        activated_by: activatedBy,
        activated_at: new Date().toISOString()
      }, { onConflict: 'group_id' });

    if (error) {
      console.log('❌ خطا در فعال‌سازی گروه:', error);
      return false;
    }
    
    console.log(`✅ گروه ${chatId} با موفقیت فعال شد`);
    return true;
  } catch (error) {
    console.log('❌ خطا در activateGroup:', error.message);
    return false;
  }
};

// دریافت لیست تمام کاربران با XP
const getAllUsersXP = async () => {
  try {
    console.log('📋 دریافت لیست کاربران از دیتابیس...');
    
    const { data, error } = await supabase
      .from('user_xp')
      .select('user_id, username, first_name, current_xp, message_count')
      .order('current_xp', { ascending: false });

    if (!error && data) {
      console.log(`✅ ${data.length} کاربر دریافت شد`);
      return data;
    } else {
      console.log('❌ خطا در دریافت لیست کاربران:', error);
    }
  } catch (error) {
    console.log('❌ خطا در دریافت لیست XP:', error.message);
  }
  return [];
};

// ریست XP همه کاربران
const resetAllXP = async () => {
  try {
    console.log('🔄 ریست XP همه کاربران...');
    
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
    } else {
      console.log('❌ خطا در ریست XP:', error);
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
  
  console.log(`📊 محاسبه XP: ${lineCount} خط = ${xpEarned} XP`);
  return xpEarned;
};

// ==================[ پردازش اعضای جدید - برای لفت دادن ]==================
bot.on('new_chat_members', async (ctx) => {
  try {
    console.log('👥 دریافت عضو جدید در گروه');
    
    // بررسی اگر ربات اضافه شده باشد
    for (const member of ctx.message.new_chat_members) {
      if (member.is_bot && member.id === ctx.botInfo.id) {
        const addedBy = ctx.message.from;
        console.log(`🤖 ربات توسط کاربر ${addedBy.id} (${addedBy.first_name}) اضافه شد`);
        
        // بررسی مالکیت
        if (addedBy.id !== OWNER_ID) {
          console.log(`🚫 کاربر ${addedBy.id} مالک نیست - لفت دادن از گروه`);
          await ctx.reply('🚫 این ربات متعلق به مجموعه اکلیس است ، فقط مالک اکلیس میتواند از ما استفاده کند');
          
          try {
            await ctx.leaveChat();
            console.log('✅ ربات با موفقیت از گروه خارج شد');
          } catch (leaveError) {
            console.log('❌ خطا در خروج از گروه:', leaveError.message);
          }
          return;
        }
        
        console.log(`✅ ربات توسط مالک ${addedBy.id} اضافه شد`);
        await ctx.reply('✅ ربات با موفقیت اضافه شد! از /on1 برای فعال‌سازی استفاده کنید.');
        return;
      }
    }
  } catch (error) {
    console.log('❌ خطا در پردازش عضو جدید:', error.message);
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
  
  const replyText = `🤖 ربات XP مجموعه اکلیس\n\n` +
    `🔹 /on1 - فعال‌سازی ربات در گروه\n` +
    `🔹 /list_xp - مشاهده لیست XP کاربران\n` +
    `🔹 /status - وضعیت ربات\n\n` +
    `📊 سیستم امتیازدهی:\n` +
    `• هر 4 خط = 20 XP\n` +
    `• پیام‌های تمام گروه‌های فعال محاسبه می‌شوند`;
  
  console.log('📤 ارسال پیام استارت به مالک');
  
  if (ctx.chat.type === 'private') {
    return ctx.reply(replyText, Markup.keyboard([
      ['/on1', '/list_xp'],
      ['/status']
    ]).resize());
  } else {
    return ctx.reply(replyText);
  }
});

// فعال‌سازی ربات در گروه
bot.command('on1', async (ctx) => {
  try {
    console.log('🔧 درخواست فعال‌سازی از:', ctx.from.first_name, 'آیدی:', ctx.from.id);
    
    const access = checkOwnerAccess(ctx);
    if (!access.hasAccess) {
      console.log('🚫 دسترسی غیرمجاز برای فعال‌سازی');
      return ctx.reply(access.message);
    }

    if (ctx.chat.type === 'private') {
      console.log('❌ دستور on1 در پیوی فراخوانی شد');
      return ctx.reply('❌ این دستور فقط در گروه قابل استفاده است');
    }

    const chatId = ctx.chat.id;
    const chatTitle = ctx.chat.title || 'بدون عنوان';

    console.log(`🔍 بررسی ادمین بودن در گروه: ${chatTitle} (${chatId})`);

    // بررسی ادمین بودن ربات
    let isAdmin = false;
    try {
      const chatMember = await ctx.telegram.getChatMember(chatId, ctx.botInfo.id);
      isAdmin = ['administrator', 'creator'].includes(chatMember.status);
      console.log(`🤖 وضعیت ادمین ربات: ${isAdmin}`);
    } catch (error) {
      console.log('❌ خطا در بررسی ادمین:', error.message);
    }

    if (!isAdmin) {
      console.log('❌ ربات ادمین نیست');
      return ctx.reply('❌ لطفاً ابتدا ربات را ادمین گروه کنید و سپس مجدداً /on1 را ارسال کنید.');
    }

    console.log(`✅ ربات ادمین است - فعال‌سازی گروه: ${chatId}`);

    // فعال کردن گروه
    const activationResult = await activateGroup(chatId, chatTitle, ctx.from.id);

    if (!activationResult) {
      console.log('❌ خطا در فعال‌سازی گروه در دیتابیس');
      return ctx.reply('❌ خطا در فعال‌سازی ربات. لطفاً دوباره تلاش کنید.');
    }

    const successMessage = `✅ ربات XP با موفقیت فعال شد!\n\n` +
      `📊 از این پس پیام‌های کاربران محاسبه شده و به ازای هر 4 خط، 20 XP دریافت می‌کنند.\n\n` +
      `💡 برای مشاهده امتیازات از دستور /list_xp در پیوی ربات استفاده کنید.`;

    console.log(`✅ ربات XP در گروه ${chatTitle} فعال شد`);
    await ctx.reply(successMessage);

  } catch (error) {
    console.log('❌ خطا در فعال‌سازی ربات:', error.message);
    await ctx.reply('❌ خطا در فعال‌سازی ربات. لطفاً دوباره تلاش کنید.');
  }
});

// مشاهده لیست XP کاربران
bot.command('list_xp', async (ctx) => {
  try {
    console.log('📊 درخواست لیست XP از:', ctx.from.first_name, 'آیدی:', ctx.from.id);
    
    const access = checkOwnerAccess(ctx);
    if (!access.hasAccess) {
      console.log('🚫 دسترسی غیرمجاز برای لیست XP');
      return ctx.reply(access.message);
    }

    console.log('✅ دسترسی مالک برای لیست XP تأیید شد');

    await ctx.reply('📊 در حال دریافت لیست کاربران...');
    console.log('🔍 دریافت لیست کاربران از دیتابیس...');

    const users = await getAllUsersXP();

    if (!users || users.length === 0) {
      console.log('📭 هیچ کاربری در دیتابیس یافت نشد');
      return ctx.reply('📭 هیچ کاربری با XP ثبت نشده است.');
    }

    console.log(`📋 ${users.length} کاربر دریافت شد`);

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
      console.log('📭 هیچ کاربری با XP مثبت یافت نشد');
      return ctx.reply('📭 هیچ کاربری با XP ثبت نشده است.');
    }

    message += `\n📈 جمع کل: ${totalXP} XP\n👥 تعداد کاربران: ${userCount}`;

    console.log(`📤 ارسال لیست ${userCount} کاربر با ${totalXP} XP`);
    
    // ارسال لیست
    await ctx.reply(message);

    // ریست XP کاربران
    await ctx.reply('🔄 در حال ریست کردن امتیازات...');
    console.log('🔄 شروع ریست XP...');
    
    const resetResult = await resetAllXP();
    
    if (resetResult) {
      await ctx.reply('✅ امتیازات تمام کاربران با موفقیت ریست شدند.');
      console.log(`✅ لیست XP توسط مالک مشاهده و ریست شد - ${userCount} کاربر`);
    } else {
      await ctx.reply('❌ خطا در ریست کردن امتیازات.');
      console.log('❌ خطا در ریست XP');
    }

  } catch (error) {
    console.log('❌ خطا در دریافت لیست XP:', error.message);
    await ctx.reply('❌ خطا در دریافت لیست کاربران.');
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

    console.log('🔍 دریافت آمار از دیتابیس...');

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

    console.log(`📊 آمار: ${activeGroups} گروه فعال, ${activeUsers} کاربر, ${totalXP} XP`);

    await ctx.reply(statusMessage);

  } catch (error) {
    console.log('❌ خطا در دریافت وضعیت:', error.message);
    await ctx.reply('❌ خطا در دریافت وضعیت ربات.');
  }
});

// ==================[ پردازش پیام‌های معمولی برای XP ]==================
bot.on('text', async (ctx) => {
  try {
    // اگر پیام دستور است، پردازش نکن
    if (ctx.message.text && ctx.message.text.startsWith('/')) {
      return;
    }

    const userName = ctx.from.first_name || 'ناشناس';
    const chatTitle = ctx.chat.title || 'بدون عنوان';
    console.log(`📨 دریافت پیام از: ${userName} در گروه: ${chatTitle} (${ctx.chat.id})`);

    // فقط پیام‌های گروهی پردازش شوند
    if (ctx.chat.type === 'private') {
      console.log('ℹ️ پیام خصوصی - نادیده گرفته شد');
      return;
    }

    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const username = ctx.from.username;
    const firstName = ctx.from.first_name;

    console.log(`🔍 بررسی گروه ${chatId}...`);

    // بررسی فعال بودن گروه
    const groupActive = await isGroupActive(chatId);
    if (!groupActive) {
      console.log('❌ گروه غیرفعال است - XP محاسبه نمی‌شود');
      return;
    }

    console.log('✅ گروه فعال است - محاسبه XP...');

    // محاسبه XP
    const xpToAdd = calculateXPFromMessage(ctx.message.text);
    
    if (xpToAdd > 0) {
      await saveUserXP(userId, username, firstName, xpToAdd);
    } else {
      console.log('ℹ️ XP کافی برای افزودن نیست');
    }

  } catch (error) {
    console.log('❌ خطا در پردازش پیام:', error.message);
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

// ==================[ راه‌اندازی سرور ]==================
const startServer = async () => {
  try {
    console.log('🚀 شروع راه‌اندازی سرور...');
    
    // مقداردهی اولیه دیتابیس
    const dbReady = await initializeDatabase();
    if (!dbReady) {
      console.log('❌ خطا در اتصال به دیتابیس');
    }
    
    // استفاده از webhook در رندر
    if (process.env.RENDER_EXTERNAL_URL) {
      const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/webhook`;
      console.log(`🔗 تنظیم webhook: ${webhookUrl}`);
      
      await bot.telegram.setWebhook(webhookUrl);
      app.use(bot.webhookCallback('/webhook'));
      
      console.log('✅ Webhook تنظیم شد');
    } else {
      console.log('🔧 استفاده از polling...');
      bot.launch().then(() => {
        console.log('✅ ربات با polling راه‌اندازی شد');
      });
    }
    
    // شروع سرور
    app.listen(PORT, () => {
      console.log(`✅ سرور روی پورت ${PORT} راه‌اندازی شد`);
      console.log(`🤖 ربات ${SELF_BOT_ID} آماده است`);
      
      // شروع پینگ
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
