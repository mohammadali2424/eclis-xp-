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
      // ایجاد جدول اگر وجود ندارد
      await createTablesIfNotExist();
      return true;
    }
    
    console.log('✅ اتصال به دیتابیس موفق');
    return true;
  } catch (error) {
    console.log('❌ خطا در بررسی دیتابیس:', error.message);
    return false;
  }
};

// ایجاد جدول‌ها اگر وجود ندارند
const createTablesIfNotExist = async () => {
  try {
    console.log('🔧 ایجاد جدول‌های مورد نیاز...');
    
    // ایجاد جدول active_groups
    const { error: groupsError } = await supabase
      .from('active_groups')
      .insert({
        group_id: 'temp',
        group_title: 'temp',
        activated_by: 0,
        activated_at: new Date().toISOString(),
        is_active: false
      });
    
    if (groupsError && groupsError.code === '42P01') {
      console.log('📋 جدول active_groups وجود ندارد - باید دستی ایجاد شود');
    }
    
    // ایجاد جدول user_xp
    const { error: xpError } = await supabase
      .from('user_xp')
      .insert({
        user_id: 0,
        username: 'temp',
        first_name: 'temp',
        total_xp: 0,
        current_xp: 0,
        message_count: 0,
        last_active: new Date().toISOString()
      });
    
    if (xpError && xpError.code === '42P01') {
      console.log('📋 جدول user_xp وجود ندارد - باید دستی ایجاد شود');
    }
    
    console.log('✅ بررسی جدول‌ها انجام شد');
    return true;
  } catch (error) {
    console.log('❌ خطا در ایجاد جدول‌ها:', error.message);
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
          last_active: new Date().toISOString(),
          created_at: new Date().toISOString()
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

// کسر XP از کاربر (برای دستور warn)
const deductUserXP = async (userId, xpToDeduct, warnedBy) => {
  try {
    console.log(`⚠️ کسر XP از کاربر ${userId}: ${xpToDeduct} XP`);
    
    const { data: existingUser, error: fetchError } = await supabase
      .from('user_xp')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (fetchError && fetchError.code === 'PGRST116') {
      // کاربر جدید - ایجاد کاربر با XP منفی
      const { error: insertError } = await supabase
        .from('user_xp')
        .insert({
          user_id: userId,
          username: '',
          first_name: 'کاربر اخطاری',
          total_xp: -xpToDeduct,
          current_xp: -xpToDeduct,
          message_count: 0,
          last_active: new Date().toISOString(),
          created_at: new Date().toISOString()
        });

      if (!insertError) {
        console.log(`✅ کاربر جدید ${userId} با ${-xpToDeduct} XP ایجاد شد`);
        
        // ذخیره تاریخچه اخطار
        await saveWarnHistory(userId, warnedBy, xpToDeduct, -xpToDeduct);
        
        return -xpToDeduct;
      } else {
        console.log('❌ خطا در insert کاربر جدید:', insertError);
      }
    } else if (!fetchError && existingUser) {
      // کاربر موجود - کسر XP
      const newCurrentXP = existingUser.current_xp - xpToDeduct;

      const { error: updateError } = await supabase
        .from('user_xp')
        .update({
          current_xp: newCurrentXP,
          last_active: new Date().toISOString()
        })
        .eq('user_id', userId);

      if (!updateError) {
        console.log(`📉 کاربر ${userId} -${xpToDeduct} XP (مجموع: ${newCurrentXP})`);
        
        // ذخیره تاریخچه اخطار
        await saveWarnHistory(userId, warnedBy, xpToDeduct, newCurrentXP);
        
        return newCurrentXP;
      } else {
        console.log('❌ خطا در update کاربر:', updateError);
      }
    } else {
      console.log('❌ خطای fetch کاربر:', fetchError);
    }
  } catch (error) {
    console.log('❌ خطا در کسر XP:', error.message);
  }
  return 0;
};

// ذخیره تاریخچه اخطارها
const saveWarnHistory = async (userId, warnedBy, xpDeducted, newXP) => {
  try {
    const { error } = await supabase
      .from('warn_history')
      .insert({
        user_id: userId,
        warned_by: warnedBy,
        xp_deducted: xpDeducted,
        new_xp: newXP,
        warned_at: new Date().toISOString()
      });

    if (error) {
      console.log('❌ خطا در ذخیره تاریخچه اخطار:', error);
    } else {
      console.log('✅ تاریخچه اخطار ذخیره شد');
    }
  } catch (error) {
    console.log('❌ خطا در ذخیره تاریخچه:', error.message);
  }
};

// بررسی فعال بودن گروه
const isGroupActive = async (chatId) => {
  try {
    console.log(`🔍 بررسی فعال بودن گروه ${chatId}...`);
    
    const { data, error } = await supabase
      .from('active_groups')
      .select('group_id')
      .eq('group_id', chatId.toString())
      .eq('is_active', true)
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
        activated_at: new Date().toISOString(),
        is_active: true
      }, { 
        onConflict: 'group_id',
        ignoreDuplicates: false
      });

    if (error) {
      console.log('❌ خطا در فعال‌سازی گروه:', error);
      // تلاش با insert در صورت شکست upsert
      const { error: insertError } = await supabase
        .from('active_groups')
        .insert({
          group_id: chatId.toString(),
          group_title: chatTitle,
          activated_by: activatedBy,
          activated_at: new Date().toISOString(),
          is_active: true
        });
      
      if (insertError) {
        console.log('❌ خطا در insert گروه:', insertError);
        return false;
      }
    }
    
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

// پاک‌سازی داده‌های قدیمی
const cleanupOldData = async () => {
  try {
    console.log('🧹 شروع پاک‌سازی داده‌های قدیمی...');
    
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    // پاک‌سازی کاربرانی که بیش از یک هفته غیرفعال بوده‌اند و XP جاری صفر دارند
    const { error: userError } = await supabase
      .from('user_xp')
      .delete()
      .lt('last_active', oneWeekAgo.toISOString())
      .eq('current_xp', 0);

    if (userError) {
      console.log('❌ خطا در پاک‌سازی کاربران قدیمی:', userError);
    } else {
      console.log('✅ کاربران قدیمی پاک‌سازی شدند');
    }

    // پاک‌سازی گروه‌های غیرفعال قدیمی
    const { error: groupError } = await supabase
      .from('active_groups')
      .delete()
      .eq('is_active', false)
      .lt('deactivated_at', oneWeekAgo.toISOString());

    if (groupError) {
      console.log('❌ خطا در پاک‌سازی گروه‌های قدیمی:', groupError);
    } else {
      console.log('✅ گروه‌های قدیمی پاک‌سازی شدند');
    }

    return true;
  } catch (error) {
    console.log('❌ خطا در پاک‌سازی داده‌های قدیمی:', error.message);
    return false;
  }
};

// ==================[ محاسبه XP - هر نیم خط 2.5 XP ]==================
const calculateXPFromMessage = (text) => {
  if (!text || typeof text !== 'string') return 0;
  
  // محاسبه تعداد خطوط کامل و نیم خطوط
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  
  let totalHalfLines = 0;
  
  lines.forEach(line => {
    const words = line.trim().split(/\s+/);
    const wordCount = words.length;
    
    // اگر خط کمتر از 3 کلمه داشته باشد، نیم خط محسوب می‌شود
    if (wordCount <= 3) {
      totalHalfLines += 1; // نیم خط
    } else {
      totalHalfLines += 2; // خط کامل
    }
  });
  
  // هر نیم خط = 2.5 XP
  const xpEarned = totalHalfLines * 2.5;
  
  console.log(`📊 محاسبه XP: ${lines.length} خط -> ${totalHalfLines} نیم خط = ${xpEarned} XP`);
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
        console.log(`🥷🏻 ربات توسط کاربر ${addedBy.id} (${addedBy.first_name}) اضافه شد`);
        
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
        await ctx.reply('🥷🏻 نینجای اکلیس بیداره! از /on1 برای فعال‌سازی استفاده کنید.');
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
  
  const replyText = `🥷🏻 نینجای اکلیس بیداره\n\n` +
    `🔹 /on1 - فعال‌سازی ربات در گروه\n` +
    `🔹 /off1 - غیرفعال‌سازی و خروج از گروه\n` +
    `🔹 /list_xp - مشاهده لیست XP کاربران\n` +
    `🔹 /status - وضعیت ربات\n` +
    `🔹 /warn [مقدار] - کسر XP از کاربر (با ریپلای)\n` +
    `🔹 /cleanup - پاک‌سازی داده‌های قدیمی`;
  
  console.log('📤 ارسال پیام استارت به مالک');
  
  if (ctx.chat.type === 'private') {
    return ctx.reply(replyText, Markup.keyboard([
      ['/on1', '/off1', '/list_xp'],
      ['/status', '/warn', '/cleanup']
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
      console.log(`🥷🏻 وضعیت ادمین ربات: ${isAdmin}`);
    } catch (error) {
      console.log('❌ خطا در بررسی ادمین:', error.message);
      return ctx.reply('❌ خطا در بررسی وضعیت ادمین. لطفاً مطمئن شوید ربات در گروه است.');
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

    const successMessage = `🥷🏻 نینجای شماره 3 در خدمت شماست\n\n` +
      `📊 سیستم محاسبه XP:\n` +
      `• هر نیم خط = 2.5 XP\n` +
      `• هر خط کامل = 5 XP\n` +
      `• هر 4 خط = 20 XP\n\n` +
      `⚠️ دستورات مدیریت:\n` +
      `• /warn [مقدار] - کسر XP از کاربر (با ریپلای)\n\n` +
      `💡 برای مشاهده امتیازات از دستور /list_xp در پیوی ربات استفاده کنید.`;

    console.log(`✅ ربات XP در گروه ${chatTitle} فعال شد`);
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
      console.log('🚫 دسترسی غیرمجاز برای غیرفعال‌سازی');
      return ctx.reply(access.message);
    }

    if (ctx.chat.type === 'private') {
      console.log('❌ دستور off1 در پیوی فراخوانی شد');
      return ctx.reply('❌ این دستور فقط در گروه قابل استفاده است');
    }

    const chatId = ctx.chat.id;
    const chatTitle = ctx.chat.title || 'بدون عنوان';

    console.log(`🔧 غیرفعال‌سازی گروه: ${chatTitle} (${chatId})`);

    // غیرفعال کردن گروه در دیتابیس
    const deactivationResult = await deactivateGroup(chatId);

    if (!deactivationResult) {
      console.log('❌ خطا در غیرفعال‌سازی گروه در دیتابیس');
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
      console.log('🚫 دسترسی غیرمجاز برای لیست XP');
      return ctx.reply(access.message);
    }

    console.log('✅ دسترسی مالک برای لیست XP تأیید شد');

    // فقط در پیوی اجازه داده شود
    if (ctx.chat.type !== 'private') {
      console.log('❌ دستور list_xp در گروه فراخوانی شد');
      return ctx.reply('❌ این دستور فقط در پیوی ربات قابل استفاده است.');
    }

    await ctx.reply('📊 در حال دریافت لیست کاربران از تمام گروه‌ها...');
    console.log('🔍 دریافت لیست کاربران از دیتابیس...');

    const users = await getAllUsersXP();

    if (!users || users.length === 0) {
      console.log('📭 هیچ کاربری در دیتابیس یافت نشد');
      return ctx.reply('📭 هیچ کاربری با XP ثبت نشده است.');
    }

    console.log(`📋 ${users.length} کاربر دریافت شد`);

    // ایجاد پیام لیست
    let message = `🏆 لیست امتیازات کاربران از تمام گروه‌ها\n\n`;
    let totalXP = 0;
    let userCount = 0;
    let totalMessages = 0;

    users.forEach((user, index) => {
      if (user.current_xp !== 0) { // نمایش کاربران با XP صفر و منفی
        const name = user.first_name || user.username || `User${user.user_id}`;
        const xpDisplay = user.current_xp < 0 ? `-${Math.abs(user.current_xp)}` : user.current_xp;
        message += `${index + 1}. ${name}: ${xpDisplay} XP (${user.message_count} پیام)\n`;
        totalXP += user.current_xp;
        totalMessages += user.message_count;
        userCount++;
      }
    });

    if (userCount === 0) {
      console.log('📭 هیچ کاربری با XP یافت نشد');
      return ctx.reply('📭 هیچ کاربری با XP ثبت نشده است.');
    }

    const totalXPDisplay = totalXP < 0 ? `-${Math.abs(totalXP)}` : totalXP;
    message += `\n📊 آمار کلی:\n`;
    message += `📈 مجموع XP: ${totalXPDisplay}\n`;
    message += `👥 تعداد کاربران: ${userCount}\n`;
    message += `💬 مجموع پیام‌ها: ${totalMessages}\n\n`;
    message += `🔄 پس از تأیید، تمام XP ها ریست خواهند شد.`;

    console.log(`📤 ارسال لیست ${userCount} کاربر با ${totalXP} XP`);

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

    console.log('🔍 دریافت آمار از دیتابیس...');

    // دریافت آمار
    const { data: groups, error: groupsError } = await supabase
      .from('active_groups')
      .select('group_id, group_title')
      .eq('is_active', true);

    const { data: users, error: usersError } = await supabase
      .from('user_xp')
      .select('current_xp, message_count')
      .neq('current_xp', 0);

    const { data: allUsers, error: allUsersError } = await supabase
      .from('user_xp')
      .select('user_id');

    const activeGroups = groups && !groupsError ? groups.length : 0;
    const activeUsers = users && !usersError ? users.length : 0;
    const totalUsers = allUsers && !allUsersError ? allUsers.length : 0;
    const totalXP = users && !usersError ? users.reduce((sum, user) => sum + user.current_xp, 0) : 0;
    const totalMessages = users && !usersError ? users.reduce((sum, user) => sum + user.message_count, 0) : 0;

    const totalXPDisplay = totalXP < 0 ? `-${Math.abs(totalXP)}` : totalXP;

    let statusMessage = `🥷🏻 وضعیت ربات XP\n\n`;
    statusMessage += `🔹 گروه‌های فعال: ${activeGroups}\n`;
    statusMessage += `🔹 کاربران دارای XP: ${activeUsers}\n`;
    statusMessage += `🔹 کل کاربران ثبت‌شده: ${totalUsers}\n`;
    statusMessage += `🔹 مجموع XP: ${totalXPDisplay}\n`;
    statusMessage += `🔹 مجموع پیام‌ها: ${totalMessages}\n`;
    statusMessage += `🔹 وضعیت: فعال ✅\n\n`;
    statusMessage += `📊 سیستم: هر نیم خط = 2.5 XP\n`;
    statusMessage += `⚠️ مدیریت: /warn [مقدار] (با ریپلای)`;

    console.log(`📊 آمار: ${activeGroups} گروه فعال, ${activeUsers} کاربر, ${totalXP} XP`);

    await ctx.reply(statusMessage);

  } catch (error) {
    console.log('❌ خطا در دریافت وضعیت:', error.message);
    await ctx.reply('❌ خطا در دریافت وضعیت ربات.');
  }
});

// دستور warn برای کسر XP از کاربر
bot.command('warn', async (ctx) => {
  try {
    console.log('⚠️ درخواست warn از:', ctx.from.first_name, 'آیدی:', ctx.from.id);
    
    const access = checkOwnerAccess(ctx);
    if (!access.hasAccess) {
      console.log('🚫 دسترسی غیرمجاز برای warn');
      return ctx.reply(access.message);
    }

    // بررسی اینکه آیا در گروه است
    if (ctx.chat.type === 'private') {
      console.log('❌ دستور warn در پیوی فراخوانی شد');
      return ctx.reply('❌ این دستور فقط در گروه قابل استفاده است');
    }

    // بررسی ریپلای بودن
    if (!ctx.message.reply_to_message) {
      console.log('❌ دستور warn بدون ریپلای استفاده شده');
      return ctx.reply('❌ لطفاً با ریپلای روی پیام کاربر از این دستور استفاده کنید.\n\nمثال:\n<code>/warn 350</code>', { 
        parse_mode: 'HTML' 
      });
    }

    // بررسی آرگومان
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      console.log('❌ دستور warn بدون مقدار استفاده شده');
      return ctx.reply('❌ لطفاً مقدار XP برای کسر را وارد کنید.\n\nمثال:\n<code>/warn 350</code>', { 
        parse_mode: 'HTML' 
      });
    }

    const xpToDeduct = parseFloat(args[1]);
    if (isNaN(xpToDeduct) || xpToDeduct <= 0) {
      console.log('❌ مقدار نامعتبر برای warn');
      return ctx.reply('❌ مقدار XP باید یک عدد مثبت باشد.\n\nمثال:\n<code>/warn 350</code>', { 
        parse_mode: 'HTML' 
      });
    }

    // بررسی فعال بودن گروه
    const chatId = ctx.chat.id;
    const groupActive = await isGroupActive(chatId);
    if (!groupActive) {
      console.log('❌ گروه غیرفعال است - warn انجام نمی‌شود');
      return ctx.reply('❌ گروه غیرفعال است. ابتدا ربات را با /on1 فعال کنید.');
    }

    // دریافت اطلاعات کاربر مورد نظر
    const targetUser = ctx.message.reply_to_message.from;
    const targetUserId = targetUser.id;
    const targetUserName = targetUser.first_name || targetUser.username || 'ناشناس';

    console.log(`⚠️ کسر ${xpToDeduct} XP از کاربر ${targetUserName} (${targetUserId})`);

    // کسر XP از کاربر
    const newXP = await deductUserXP(targetUserId, xpToDeduct, ctx.from.id);

    const newXPDisplay = newXP < 0 ? `-${Math.abs(newXP)}` : newXP;

    const warnMessage = `⚠️ اخطار به کاربر\n\n` +
      `👤 کاربر: ${targetUserName}\n` +
      `📉 ${xpToDeduct} XP کسر شد\n` +
      `💠 XP جدید: ${newXPDisplay}\n` +
      `🕒 زمان: ${new Date().toLocaleTimeString('fa-IR')}`;

    await ctx.reply(warnMessage);

    console.log(`✅ warn با موفقیت انجام شد - XP جدید: ${newXP}`);

  } catch (error) {
    console.log('❌ خطا در اجرای دستور warn:', error.message);
    await ctx.reply('❌ خطا در اجرای دستور warn. لطفاً دوباره تلاش کنید.');
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

    // محاسبه XP - هر نیم خط 2.5 XP
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

    // پاک‌سازی دوره‌ای داده‌های قدیمی
    await cleanupOldData();

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
    <h1>🥷🏻 ربات XP مجموعه اکلیس</h1>
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
