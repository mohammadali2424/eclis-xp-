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

// بررسی وجود متغیرهای محیطی ضروری
if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ خطا: متغیرهای محیطی ضروری تنظیم نشده‌اند');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);

app.use(express.json());

// کش برای کاهش درخواست‌های دیتابیس
const cache = {
  activeGroups: new Map(),
  lastCleanup: Date.now()
};

// ==================[ پینگ خودکار ]==================
const startAutoPing = () => {
  if (!process.env.RENDER_EXTERNAL_URL) {
    console.log('⚠️ RENDER_EXTERNAL_URL تنظیم نشده - پینگ غیرفعال');
    return;
  }
  
  const PING_INTERVAL = 5 * 60 * 1000; // هر 5 دقیقه
  const selfUrl = process.env.RENDER_EXTERNAL_URL;

  const performPing = async () => {
    try {
      await axios.get(`${selfUrl}/health`, { timeout: 10000 });
      console.log('✅ پینگ موفق -', new Date().toLocaleString('fa-IR'));
    } catch (error) {
      console.log('❌ پینگ ناموفق:', error.message);
    }
  };

  console.log('🔄 شروع پینگ خودکار...');
  setInterval(performPing, PING_INTERVAL);
  performPing(); // اولین پینگ
};

// ==================[ مدیریت کش ]==================
const updateGroupCache = async () => {
  try {
    const { data, error } = await supabase
      .from('active_groups')
      .select('group_id')
      .eq('is_active', true);

    if (!error && data) {
      cache.activeGroups.clear();
      data.forEach(group => {
        cache.activeGroups.set(group.group_id, true);
      });
      console.log(`🔄 کش گروه‌ها به‌روز شد: ${data.length} گروه فعال`);
    }
  } catch (error) {
    console.log('❌ خطا در به‌روزرسانی کش:', error.message);
  }
};

// ==================[ بررسی مالکیت ]==================
const checkOwnerAccess = (ctx) => {
  const userId = ctx.from.id;
  
  if (userId !== OWNER_ID) {
    console.log(`🚫 دسترسی غیرمجاز - کاربر: ${userId}, مالک: ${OWNER_ID}`);
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
    console.log('🔧 بررسی اتصال به دیتابیس...');
    
    // تست اتصال به دیتابیس
    const { data, error } = await supabase
      .from('active_groups')
      .select('count')
      .limit(1);

    if (error) {
      console.log('❌ خطا در اتصال به دیتابیس:', error.message);
      return false;
    }
    
    console.log('✅ اتصال به دیتابیس موفق');
    
    // به‌روزرسانی اولیه کش
    await updateGroupCache();
    
    return true;
  } catch (error) {
    console.log('❌ خطا در بررسی دیتابیس:', error.message);
    return false;
  }
};

// ذخیره XP کاربر - بهینه‌شده
const saveUserXP = async (userId, username, firstName, xpToAdd) => {
  try {
    if (!userId || xpToAdd <= 0) {
      console.log('❌ پارامترهای نامعتبر برای ذخیره XP');
      return 0;
    }

    // استفاده از upsert برای سادگی و کارایی
    const { data, error } = await supabase
      .from('user_xp')
      .upsert({
        user_id: userId,
        username: username || '',
        first_name: firstName || 'ناشناس',
        total_xp: supabase.raw(`COALESCE(total_xp, 0) + ${xpToAdd}`),
        current_xp: supabase.raw(`COALESCE(current_xp, 0) + ${xpToAdd}`),
        message_count: supabase.raw('COALESCE(message_count, 0) + 1'),
        last_active: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      })
      .select()
      .single();

    if (error) {
      console.log('❌ خطا در ذخیره XP:', error);
      return 0;
    }

    console.log(`✅ XP کاربر ${userId} ذخیره شد: +${xpToAdd} (مجموع: ${data.current_xp})`);
    return data.current_xp;
  } catch (error) {
    console.log('❌ خطا در ذخیره XP:', error.message);
    return 0;
  }
};

// بررسی فعال بودن گروه - با کش
const isGroupActive = async (chatId) => {
  const chatIdStr = chatId.toString();
  
  // بررسی کش اول
  if (cache.activeGroups.has(chatIdStr)) {
    return cache.activeGroups.get(chatIdStr);
  }

  try {
    const { data, error } = await supabase
      .from('active_groups')
      .select('group_id')
      .eq('group_id', chatIdStr)
      .eq('is_active', true)
      .single();

    const isActive = !error && data;
    
    // به‌روزرسانی کش
    cache.activeGroups.set(chatIdStr, isActive);
    
    return isActive;
  } catch (error) {
    console.log('❌ خطا در بررسی گروه فعال:', error.message);
    return false;
  }
};

// فعال کردن گروه
const activateGroup = async (chatId, chatTitle, activatedBy) => {
  try {
    console.log(`🔧 فعال‌سازی گروه ${chatId} - "${chatTitle}" توسط ${activatedBy}`);
    
    const { error } = await supabase
      .from('active_groups')
      .upsert({
        group_id: chatId.toString(),
        group_title: chatTitle,
        activated_by: activatedBy,
        activated_at: new Date().toISOString(),
        is_active: true,
        deactivated_at: null
      }, {
        onConflict: 'group_id'
      });

    if (error) {
      console.log('❌ خطا در فعال‌سازی گروه:', error);
      return false;
    }

    // به‌روزرسانی کش
    cache.activeGroups.set(chatId.toString(), true);
    console.log(`✅ گروه ${chatId} با موفقیت فعال شد`);
    return true;
  } catch (error) {
    console.log('❌ خطا در activateGroup:', error.message);
    return false;
  }
};

// غیرفعال کردن گروه
const deactivateGroup = async (chatId) => {
  try {
    console.log(`🔧 غیرفعال‌سازی گروه ${chatId}...`);
    
    const { error } = await supabase
      .from('active_groups')
      .update({
        is_active: false,
        deactivated_at: new Date().toISOString()
      })
      .eq('group_id', chatId.toString());

    if (error) {
      console.log('❌ خطا در غیرفعال‌سازی گروه:', error);
      return false;
    }

    // به‌روزرسانی کش
    cache.activeGroups.set(chatId.toString(), false);
    console.log(`✅ گروه ${chatId} با موفقیت غیرفعال شد`);
    return true;
  } catch (error) {
    console.log('❌ خطا در deactivateGroup:', error.message);
    return false;
  }
};

// دریافت لیست تمام کاربران با XP
const getAllUsersXP = async () => {
  try {
    console.log('📋 دریافت لیست کاربران از دیتابیس...');
    
    const { data, error } = await supabase
      .from('user_xp')
      .select('user_id, username, first_name, current_xp, message_count, total_xp')
      .gt('current_xp', 0)
      .order('current_xp', { ascending: false });

    if (error) {
      console.log('❌ خطا در دریافت لیست کاربران:', error);
      return [];
    }

    console.log(`✅ ${data.length} کاربر دریافت شد`);
    return data;
  } catch (error) {
    console.log('❌ خطا در دریافت لیست XP:', error.message);
    return [];
  }
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
      .gt('current_xp', 0);

    if (error) {
      console.log('❌ خطا در ریست XP:', error);
      return false;
    }

    console.log('✅ تمام XP ها ریست شدند');
    return true;
  } catch (error) {
    console.log('❌ خطا در ریست XP:', error.message);
    return false;
  }
};

// پاک‌سازی داده‌های قدیمی
const cleanupOldData = async () => {
  try {
    console.log('🧹 شروع پاک‌سازی داده‌های قدیمی...');
    
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    let cleanedCount = 0;

    // پاک‌سازی کاربرانی که بیش از یک هفته غیرفعال بوده‌اند و XP جاری صفر دارند
    const { error: userError, count: userCount } = await supabase
      .from('user_xp')
      .delete()
      .lt('last_active', oneWeekAgo.toISOString())
      .eq('current_xp', 0);

    if (!userError) {
      cleanedCount += userCount || 0;
      console.log(`✅ ${userCount || 0} کاربر قدیمی پاک‌سازی شد`);
    }

    // پاک‌سازی گروه‌های غیرفعال قدیمی
    const { error: groupError, count: groupCount } = await supabase
      .from('active_groups')
      .delete()
      .eq('is_active', false)
      .lt('deactivated_at', oneWeekAgo.toISOString());

    if (!groupError) {
      cleanedCount += groupCount || 0;
      console.log(`✅ ${groupCount || 0} گروه قدیمی پاک‌سازی شد`);
    }

    cache.lastCleanup = Date.now();
    console.log(`🧹 پاک‌سازی کامل: ${cleanedCount} رکورد پاک شد`);
    return true;
  } catch (error) {
    console.log('❌ خطا در پاک‌سازی داده‌های قدیمی:', error.message);
    return false;
  }
};

// ==================[ محاسبه XP - بهینه‌شده ]==================
const calculateXPFromMessage = (text) => {
  if (!text || typeof text !== 'string') return 0;
  
  // حذف کامندها
  const cleanText = text.replace(/^\//, '').trim();
  if (cleanText.length === 0) return 0;
  
  // تقسیم به خطوط معنی‌دار
  const lines = cleanText.split('\n')
    .filter(line => line.trim().length >= 2) // خطوط با حداقل 2 کاراکتر
    .filter(line => !line.match(/^(http|www)/i)); // حذف لینک‌ها

  if (lines.length === 0) return 0;
  
  let totalHalfLines = 0;
  
  lines.forEach(line => {
    const words = line.trim().split(/\s+/);
    const wordCount = words.length;
    
    if (wordCount <= 2) {
      totalHalfLines += 0.5; // نیم خط برای پیام‌های کوتاه
    } else if (wordCount <= 5) {
      totalHalfLines += 1; // نیم خط کامل
    } else {
      totalHalfLines += 2; // خط کامل
    }
  });
  
  // محاسبه XP نهایی با حداقل و حداکثر
  const baseXP = totalHalfLines * 2.5;
  const finalXP = Math.max(1, Math.min(baseXP, 50)); // حداقل 1 و حداکثر 50 XP
  
  console.log(`📊 محاسبه XP: ${lines.length} خط -> ${totalHalfLines} نیم خط = ${finalXP} XP`);
  return finalXP;
};

// ==================[ پردازش اعضای جدید - برای لفت دادن ]==================
bot.on('new_chat_members', async (ctx) => {
  try {
    console.log('👥 دریافت عضو جدید در گروه');
    
    for (const member of ctx.message.new_chat_members) {
      if (member.is_bot && member.id === ctx.botInfo.id) {
        const addedBy = ctx.message.from;
        console.log(`🥷🏻 ربات توسط کاربر ${addedBy.id} (${addedBy.first_name}) اضافه شد`);
        
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
        await ctx.reply(
          '🥷🏻 نینجای اکلیس بیداره!\n\n' +
          'برای فعال‌سازی سیستم XP از دستور زیر استفاده کنید:\n' +
          '🔹 /on1'
        );
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
    return ctx.reply(access.message);
  }
  
  const replyText = `🥷🏻 نینجای اکلیس بیداره\n\n` +
    `🔹 /on1 - فعال‌سازی ربات در گروه\n` +
    `🔹 /off1 - غیرفعال‌سازی و خروج از گروه\n` +
    `🔹 /list_xp - مشاهده لیست XP کاربران\n` +
    `🔹 /status - وضعیت ربات\n` +
    `🔹 /debug - اطلاعات دیباگ\n` +
    `🔹 /cleanup - پاک‌سازی داده‌های قدیمی\n\n` +
    `📊 سیستم XP: هر نیم خط = 2.5 XP`;
  
  if (ctx.chat.type === 'private') {
    return ctx.reply(replyText, Markup.keyboard([
      ['/on1', '/off1'],
      ['/list_xp', '/status'],
      ['/debug', '/cleanup']
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
      return ctx.reply(access.message);
    }

    if (ctx.chat.type === 'private') {
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
      console.log(`🥷🏻 وضعیت ادمین ربات: ${isAdmin}`);
    } catch (error) {
      console.log('❌ خطا در بررسی ادمین:', error.message);
      return ctx.reply('❌ خطا در بررسی وضعیت ادمین. لطفاً مطمئن شوید ربات در گروه است.');
    }

    if (!isAdmin) {
      return ctx.reply('❌ لطفاً ابتدا ربات را ادمین گروه کنید و سپس مجدداً /on1 را ارسال کنید.');
    }

    // فعال کردن گروه
    const activationResult = await activateGroup(chatId, chatTitle, ctx.from.id);

    if (!activationResult) {
      return ctx.reply('❌ خطا در فعال‌سازی ربات. لطفاً دوباره تلاش کنید.');
    }

    const successMessage = `🥷🏻 نینجای شماره 3 در خدمت شماست\n\n` +
      `📊 سیستم محاسبه XP:\n` +
      `• هر نیم خط = 2.5 XP\n` +
      `• هر خط کامل = 5 XP\n` +
      `• هر 4 خط = 20 XP\n\n` +
      `💡 برای مشاهده امتیازات از دستور /list_xp در پیوی ربات استفاده کنید.`;

    await ctx.reply(successMessage);

  } catch (error) {
    console.log('❌ خطا در فعال‌سازی ربات:', error.message);
    await ctx.reply('❌ خطا در فعال‌سازی ربات. لطفاً دوباره تلاش کنید.');
  }
});

// غیرفعال‌سازی و خروج از گروه
bot.command('off1', async (ctx) => {
  try {
    console.log('🔧 درخواست غیرفعال‌سازی از:', ctx.from.first_name, 'آیدی:', ctx.from.id);
    
    const access = checkOwnerAccess(ctx);
    if (!access.hasAccess) {
      return ctx.reply(access.message);
    }

    if (ctx.chat.type === 'private') {
      return ctx.reply('❌ این دستور فقط در گروه قابل استفاده است');
    }

    const chatId = ctx.chat.id;
    const chatTitle = ctx.chat.title || 'بدون عنوان';

    // غیرفعال کردن گروه در دیتابیس
    const deactivationResult = await deactivateGroup(chatId);

    if (!deactivationResult) {
      return ctx.reply('❌ خطا در غیرفعال‌سازی ربات. لطفاً دوباره تلاش کنید.');
    }

    // خروج از گروه
    try {
      await ctx.reply('🥷🏻 نینجای اکلیس در حال خروج...');
      await ctx.leaveChat();
      console.log(`✅ ربات با موفقیت از گروه ${chatTitle} خارج شد`);
    } catch (leaveError) {
      console.log('❌ خطا در خروج از گروه:', leaveError.message);
      await ctx.reply('✅ ربات غیرفعال شد اما خطا در خروج از گروه. ممکن است نیاز باشد دستی حذف شود.');
    }

  } catch (error) {
    console.log('❌ خطا در غیرفعال‌سازی ربات:', error.message);
    await ctx.reply('❌ خطا در غیرفعال‌سازی ربات. لطفاً دوباره تلاش کنید.');
  }
});

// مشاهده لیست XP کاربران
bot.command('list_xp', async (ctx) => {
  try {
    console.log('📊 درخواست لیست XP از:', ctx.from.first_name, 'آیدی:', ctx.from.id);
    
    const access = checkOwnerAccess(ctx);
    if (!access.hasAccess) {
      return ctx.reply(access.message);
    }

    // فقط در پیوی اجازه داده شود
    if (ctx.chat.type !== 'private') {
      return ctx.reply('❌ این دستور فقط در پیوی ربات قابل استفاده است.');
    }

    await ctx.reply('📊 در حال دریافت لیست کاربران از تمام گروه‌ها...');

    const users = await getAllUsersXP();

    if (!users || users.length === 0) {
      return ctx.reply('📭 هیچ کاربری با XP ثبت نشده است.');
    }

    // ایجاد پیام لیست
    let message = `🏆 لیست امتیازات کاربران از تمام گروه‌ها\n\n`;
    let totalXP = 0;
    let userCount = 0;
    let totalMessages = 0;

    users.slice(0, 50).forEach((user, index) => { // فقط 50 کاربر اول
      if (user.current_xp > 0) {
        const name = user.first_name || user.username || `User${user.user_id}`;
        const shortName = name.length > 20 ? name.substring(0, 20) + '...' : name;
        message += `${index + 1}. ${shortName}: ${Math.round(user.current_xp)} XP (${user.message_count} پیام)\n`;
        totalXP += user.current_xp;
        totalMessages += user.message_count;
        userCount++;
      }
    });

    if (userCount === 0) {
      return ctx.reply('📭 هیچ کاربری با XP ثبت نشده است.');
    }

    message += `\n📊 آمار کلی:\n`;
    message += `📈 مجموع XP: ${Math.round(totalXP)}\n`;
    message += `👥 تعداد کاربران: ${userCount}\n`;
    message += `💬 مجموع پیام‌ها: ${totalMessages}`;

    if (users.length > 50) {
      message += `\n\n⚠️ فقط ${50} کاربر اول نمایش داده شدند`;
    }

    message += `\n\n🔄 پس از تأیید، تمام XP ها ریست خواهند شد.`;

    // دکمه تأیید ریست
    const confirmKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('✅ تأیید و ریست XP ها', 'confirm_reset')],
      [Markup.button.callback('❌ انصراف', 'cancel_reset')]
    ]);

    await ctx.reply(message, confirmKeyboard);

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

    // دریافت آمار
    const { data: groups, error: groupsError } = await supabase
      .from('active_groups')
      .select('group_id, group_title')
      .eq('is_active', true);

    const { data: users, error: usersError } = await supabase
      .from('user_xp')
      .select('current_xp, message_count')
      .gt('current_xp', 0);

    const { data: allUsers, error: allUsersError } = await supabase
      .from('user_xp')
      .select('user_id');

    const activeGroups = groups && !groupsError ? groups.length : 0;
    const activeUsers = users && !usersError ? users.length : 0;
    const totalUsers = allUsers && !allUsersError ? allUsers.length : 0;
    const totalXP = users && !usersError ? users.reduce((sum, user) => sum + user.current_xp, 0) : 0;
    const totalMessages = users && !usersError ? users.reduce((sum, user) => sum + user.message_count, 0) : 0;

    let statusMessage = `🥷🏻 وضعیت ربات XP\n\n`;
    statusMessage += `🔹 گروه‌های فعال: ${activeGroups}\n`;
    statusMessage += `🔹 کاربران دارای XP: ${activeUsers}\n`;
    statusMessage += `🔹 کل کاربران ثبت‌شده: ${totalUsers}\n`;
    statusMessage += `🔹 مجموع XP: ${Math.round(totalXP)}\n`;
    statusMessage += `🔹 مجموع پیام‌ها: ${totalMessages}\n`;
    statusMessage += `🔹 وضعیت: فعال ✅\n`;
    statusMessage += `🔹 کش گروه‌ها: ${cache.activeGroups.size}\n\n`;
    statusMessage += `📊 سیستم: هر نیم خط = 2.5 XP`;

    await ctx.reply(statusMessage);

  } catch (error) {
    console.log('❌ خطا در دریافت وضعیت:', error.message);
    await ctx.reply('❌ خطا در دریافت وضعیت ربات.');
  }
});

// پاک‌سازی داده‌های قدیمی
bot.command('cleanup', async (ctx) => {
  try {
    console.log('🧹 درخواست پاک‌سازی از:', ctx.from.first_name);
    
    const access = checkOwnerAccess(ctx);
    if (!access.hasAccess) {
      return ctx.reply(access.message);
    }

    await ctx.reply('🧹 در حال پاک‌سازی داده‌های قدیمی (بیش از 1 هفته)...');
    
    const cleanupResult = await cleanupOldData();
    
    if (cleanupResult) {
      await ctx.reply('✅ داده‌های قدیمی با موفقیت پاک‌سازی شدند.');
    } else {
      await ctx.reply('❌ خطا در پاک‌سازی داده‌های قدیمی.');
    }

  } catch (error) {
    console.log('❌ خطا در پاک‌سازی:', error.message);
    await ctx.reply('❌ خطا در پاک‌سازی داده‌های قدیمی.');
  }
});

// دستور دیباگ
bot.command('debug', async (ctx) => {
  try {
    const access = checkOwnerAccess(ctx);
    if (!access.hasAccess) return ctx.reply(access.message);

    const chatId = ctx.chat.id;
    const isPrivate = ctx.chat.type === 'private';
    
    let debugInfo = `🔧 اطلاعات دیباگ\n\n`;
    debugInfo += `👤 کاربر: ${ctx.from.id} (${ctx.from.first_name})\n`;
    debugInfo += `💬 نوع چت: ${ctx.chat.type}\n`;
    debugInfo += `🤖 شناسه ربات: ${SELF_BOT_ID}\n`;
    debugInfo += `🕒 زمان: ${new Date().toLocaleString('fa-IR')}\n`;
    
    if (!isPrivate) {
      debugInfo += `👥 گروه: ${ctx.chat.title} (${chatId})\n`;
      
      // بررسی وضعیت گروه
      const isActive = await isGroupActive(chatId);
      debugInfo += `📊 وضعیت گروه: ${isActive ? 'فعال ✅' : 'غیرفعال ❌'}\n`;
      
      // بررسی ادمین بودن ربات
      try {
        const chatMember = await ctx.telegram.getChatMember(chatId, ctx.botInfo.id);
        debugInfo += `🥷🏻 وضعیت ربات: ${chatMember.status}\n`;
      } catch (error) {
        debugInfo += `🥷🏻 وضعیت ربات: خطا - ${error.message}\n`;
      }
    }
    
    debugInfo += `\n📊 آمار کش:\n`;
    debugInfo += `🔹 گروه‌های فعال در کش: ${cache.activeGroups.size}\n`;
    debugInfo += `🔹 آخرین پاک‌سازی: ${new Date(cache.lastCleanup).toLocaleString('fa-IR')}\n`;

    // تست دیتابیس
    try {
      const { count, error } = await supabase
        .from('active_groups')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);
      
      debugInfo += `🔹 گروه‌های فعال در دیتابیس: ${error ? 'خطا' : count}\n`;
    } catch (error) {
      debugInfo += `🔹 گروه‌های فعال در دیتابیس: خطا در بررسی\n`;
    }

    await ctx.reply(debugInfo);
    
  } catch (error) {
    console.log('❌ خطا در دستور دیباگ:', error);
    await ctx.reply('❌ خطا در دریافت اطلاعات دیباگ');
  }
});

// ==================[ پردازش Callback ها ]==================
bot.action('confirm_reset', async (ctx) => {
  try {
    console.log('🔄 تأیید ریست XP توسط مالک');
    
    await ctx.editMessageText('🔄 در حال ریست کردن امتیازات...');
    
    const resetResult = await resetAllXP();
    
    if (resetResult) {
      await ctx.editMessageText('✅ امتیازات تمام کاربران با موفقیت ریست شدند.');
      console.log('✅ XP ها توسط مالک ریست شدند');
    } else {
      await ctx.editMessageText('❌ خطا در ریست کردن امتیازات.');
    }
  } catch (error) {
    console.log('❌ خطا در پردازش تأیید:', error.message);
    await ctx.editMessageText('❌ خطا در ریست کردن امتیازات.');
  }
});

bot.action('cancel_reset', async (ctx) => {
  try {
    await ctx.editMessageText('❌ ریست XP لغو شد.');
    console.log('❌ ریست XP توسط مالک لغو شد');
  } catch (error) {
    console.log('❌ خطا در لغو:', error.message);
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

    // فقط پیام‌های گروهی پردازش شوند
    if (ctx.chat.type === 'private') {
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

    // محاسبه XP
    const xpToAdd = calculateXPFromMessage(ctx.message.text);
    
    if (xpToAdd > 0) {
      await saveUserXP(userId, username, firstName, xpToAdd);
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

    // پاک‌سازی دوره‌ای داده‌های قدیمی (هر 1 ساعت)
    if (Date.now() - cache.lastCleanup > 60 * 60 * 1000) {
      await cleanupOldData();
    }

    // به‌روزرسانی کش هر 5 دقیقه
    if (Date.now() - cache.lastCleanup > 5 * 60 * 1000) {
      await updateGroupCache();
    }

    res.json({
      status: 'healthy',
      bot: SELF_BOT_ID,
      database: error ? 'disconnected' : 'connected',
      owner: OWNER_ID,
      cache: {
        activeGroups: cache.activeGroups.size,
        lastCleanup: new Date(cache.lastCleanup).toISOString()
      },
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
    <!DOCTYPE html>
    <html dir="rtl">
    <head>
      <meta charset="UTF-8">
      <title>🥷🏻 ربات XP مجموعه اکلیس</title>
      <style>
        body { font-family: Tahoma, sans-serif; background: #0d1117; color: #c9d1d9; margin: 0; padding: 20px; }
        .container { max-width: 800px; margin: 0 auto; background: #161b22; padding: 30px; border-radius: 10px; border: 1px solid #30363d; }
        h1 { color: #58a6ff; text-align: center; margin-bottom: 30px; }
        .info { background: #0c2d6b; padding: 15px; border-radius: 5px; margin: 10px 0; }
        .status { background: #238636; padding: 10px; border-radius: 5px; text-align: center; font-weight: bold; }
        a { color: #58a6ff; text-decoration: none; }
        a:hover { text-decoration: underline; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🥷🏻 ربات XP مجموعه اکلیس</h1>
        <div class="status">ربات فعال و آماده به کار</div>
        
        <div class="info">
          <strong>👤 مالک:</strong> ${OWNER_ID}<br>
          <strong>🤖 شناسه ربات:</strong> ${SELF_BOT_ID}<br>
          <strong>🕒 زمان راه‌اندازی:</strong> ${new Date().toLocaleString('fa-IR')}
        </div>
        
        <p>این ربات فقط توسط مالک قابل استفاده است و سیستم امتیازدهی XP را مدیریت می‌کند.</p>
        
        <p><a href="/health">🔍 بررسی سلامت سرویس</a></p>
      </div>
    </body>
    </html>
  `);
});

// ==================[ راه‌اندازی سرور ]==================
const startServer = async () => {
  try {
    console.log('🚀 شروع راه‌اندازی سرور...');
    
    // مقداردهی اولیه دیتابیس
    const dbReady = await initializeDatabase();
    if (!dbReady) {
      console.log('⚠️ هشدار: مشکل در اتصال به دیتابیس');
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
      console.log(`🥷🏻 ربات ${SELF_BOT_ID} آماده است`);
      
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

// مدیریت graceful shutdown
process.on('SIGINT', () => {
  console.log('🛑 دریافت SIGINT - خروج تمیز...');
  bot.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('🛑 دریافت SIGTERM - خروج تمیز...');
  bot.stop();
  process.exit(0);
});
