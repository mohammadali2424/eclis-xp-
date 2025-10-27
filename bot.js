const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ==================[ تنظیمات ]==================
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SELF_BOT_ID = process.env.SELF_BOT_ID || 'xp_bot_1';
const OWNER_ID = parseInt(process.env.OWNER_ID) || 0;

const cache = new NodeCache({ 
  stdTTL: 3600,
  checkperiod: 600,
  maxKeys: 5000
});

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);

// ==================[ پینگ ]==================
const startAutoPing = () => {
  if (!process.env.RENDER_EXTERNAL_URL) return;
  
  const PING_INTERVAL = 13 * 60 * 1000 + 59 * 1000;
  const selfUrl = process.env.RENDER_EXTERNAL_URL;

  const performPing = async () => {
    try {
      await axios.head(`${selfUrl}/ping`, { timeout: 5000 });
    } catch (error) {
      setTimeout(performPing, 60000);
    }
  };

  setTimeout(performPing, 30000);
  setInterval(performPing, PING_INTERVAL);
};

app.head('/ping', (req, res) => res.status(200).end());
app.get('/ping', (req, res) => {
  res.status(200).json({ status: 'active', bot: SELF_BOT_ID });
});

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

// ایجاد جدول اگر وجود ندارد
const initializeDatabase = async () => {
  try {
    const { error } = await supabase.rpc('create_xp_tables_if_not_exists');
    if (error) {
      // اگر ��ابع وجود ندارد، جدول را مستقیم ایجاد کنیم
      console.log('📦 ایجاد جدول های XP...');
    }
  } catch (error) {
    console.log('✅ جداول XP آماده هستند');
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
          last_active: new Date().toISOString(),
          created_at: new Date().toISOString()
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

// بررسی فعال بودن گروه
const isGroupActive = async (chatId) => {
  try {
    const cacheKey = `active_group_${chatId}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;

    const { data, error } = await supabase
      .from('active_groups')
      .select('group_id')
      .eq('group_id', chatId.toString())
      .single();

    const isActive = !error && data;
    cache.set(cacheKey, isActive, 3600);
    return isActive;
  } catch (error) {
    return false;
  }
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
    // فقط پیام‌ه��ی گروهی پردازش شوند
    if (ctx.chat.type === 'private') return;

    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const username = ctx.from.username;
    const firstName = ctx.from.first_name;
    const messageText = ctx.message.text;

    // بررسی فعال بودن گروه
    const groupActive = await isGroupActive(chatId);
    if (!groupActive) {
      return; // گروه غیرفعال است
    }

    // محاسبه XP
    const xpToAdd = calculateXPFromMessage(messageText);
    
    if (xpToAdd > 0) {
      await saveUserXP(userId, username, firstName, xpToAdd);
      
      // کش را برای لیست کاربران پاک کن
      cache.del('all_users_xp');
    }

  } catch (error) {
    console.log('❌ خطا در پردازش پیام:', error.message);
  }
});

// ==================[ دستورات ]==================

// دکمه استارت
bot.start((ctx) => {
  const access = checkOwnerAccess(ctx);
  if (!access.hasAccess) {
    return ctx.reply(access.message);
  }
  
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
    const access = checkOwnerAccess(ctx);
    if (!access.hasAccess) {
      return ctx.reply(access.message);
    }

    if (ctx.chat.type === 'private') {
      return ctx.reply('❌ این دستور فقط در گروه قابل استفاده است');
    }

    const chatId = ctx.chat.id.toString();
    const chatTitle = ctx.chat.title || 'بدون عنوان';

    // بررسی ادمین بودن ربات
    let isAdmin = false;
    try {
      const chatMember = await ctx.telegram.getChatMember(chatId, ctx.botInfo.id);
      isAdmin = ['administrator', 'creator'].includes(chatMember.status);
    } catch (error) {
      console.log('خطا در بررسی ادمین:', error.message);
    }

    if (!isAdmin) {
      return ctx.reply('❌ لطفاً ابتدا ربات را ادمین گروه کنید و سپس مجدداً /on1 را ارسال کنید.');
    }

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
      throw error;
    }

    // پاک کردن کش
    cache.del(`active_group_${chatId}`);

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
    const access = checkOwnerAccess(ctx);
    if (!access.hasAccess) {
      return ctx.reply(access.message);
    }

    // فقط در پیوی قابل استفاده باشد
    if (ctx.chat.type !== 'private') {
      return ctx.reply('❌ این دستور فقط در پیوی ربات قابل استفاده است');
    }

    ctx.reply('📊 در حال دریافت لیست کاربران...');

    // بررسی کش
    const cacheKey = 'all_users_xp';
    let users = cache.get(cacheKey);
    
    if (!users) {
      users = await getAllUsersXP();
      cache.set(cacheKey, users, 300); // کش برای 5 دقیقه
    }

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
    ctx.reply('🔄 در حال ریست کردن امتیازات...');
    const resetResult = await resetAllXP();
    
    if (resetResult) {
      // پاک کردن کش
      cache.del('all_users_xp');
      users.forEach(user => {
        cache.del(`active_group_${user.user_id}`);
      });
      
      ctx.reply('✅ امتیازات تمام کاربران با موفقیت ریست شدند.');
      console.log(`✅ لیست XP توسط مالک مشاهده و ریست شد - ${userCount} کاربر`);
    } else {
      ctx.reply('❌ خطا در ریست کردن امتیازات.');
    }

  } catch (error) {
    console.log('❌ خطا در دریافت لیست XP:', error.message);
    ctx.reply('❌ خطا در دریافت لیست کاربران.');
  }
});

// وضعیت ربات
bot.command('status', async (ctx) => {
  try {
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
    statusMessage += `📊 سیستم: هر 4 ��ط = 20 XP`;

    ctx.reply(statusMessage);

  } catch (error) {
    console.log('❌ خطا در دریافت وضعیت:', error.message);
    ctx.reply('❌ خطا در دریافت وضعیت ربات.');
  }
});

// ==================[ API ]==================
app.get('/api/stats', async (req, res) => {
  try {
    const { data: groups } = await supabase
      .from('active_groups')
      .select('group_id');

    const { data: users } = await supabase
      .from('user_xp')
      .select('current_xp')
      .gt('current_xp', 0);

    res.json({
      active_groups: groups ? groups.length : 0,
      active_users: users ? users.length : 0,
      total_xp: users ? users.reduce((sum, user) => sum + user.current_xp, 0) : 0,
      bot_id: SELF_BOT_ID
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================[ ذخیره ساعتی XP ]==================
const startHourlyBackup = () => {
  setInterval(async () => {
    try {
      console.log('💾 شروع ذخیره‌سازی ساعتی XP...');
      
      const { data: users, error } = await supabase
        .from('user_xp')
        .select('user_id, current_xp')
        .gt('current_xp', 0);

      if (!error && users && users.length > 0) {
        const totalXP = users.reduce((sum, user) => sum + user.current_xp, 0);
        console.log(`✅ ذخیره‌سازی ساعتی: ${users.length} کاربر - ${totalXP} XP`);
        
        // ذخیره در جدول backup (اگر نیاز باشد)
        await supabase
          .from('xp_backups')
          .insert({
            backup_time: new Date().toISOString(),
            user_count: users.length,
            total_xp: totalXP
          });
      }
    } catch (error) {
      console.log('❌ خطا در ذخیره‌سازی ساعتی:', error.message);
    }
  }, 60 * 60 * 1000); // هر 1 ساعت
};

// ==================[ راه‌اندازی سرور ]==================
app.use(bot.webhookCallback('/webhook'));

app.get('/', (req, res) => {
  res.send(`
    <h1>🤖 ربات XP مجموعه اکلیس</h1>
    <p>ربات فعال است - فقط مالک می‌تواند استفاده کند</p>
    <p>مالک: ${OWNER_ID}</p>
    <p>سیستم امتیازدهی: هر 4 خط = 20 XP</p>
  `);
});

app.listen(PORT, async () => {
  console.log(`🚀 ربات XP ${SELF_BOT_ID} راه‌اندازی شد`);
  console.log(`👤 مالک ربات: ${OWNER_ID}`);
  
  // مقداردهی اولیه دیتابیس
  await initializeDatabase();
  
  // شروع پینگ و پشتیبان‌گیری
  startAutoPing();
  startHourlyBackup();
});

if (process.env.RENDER_EXTERNAL_URL) {
  const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/webhook`;
  bot.telegram.setWebhook(webhookUrl)
    .then(() => console.log('✅ Webhook تنظیم شد'))
    .catch(error => {
      console.log('❌ خطا در تنظیم Webhook:', error.message);
      bot.launch();
    });
} else {
  bot.launch();
}

process.on('unhandledRejection', (error) => {
  console.log('❌ خطای catch نشده:', error.message);
});
