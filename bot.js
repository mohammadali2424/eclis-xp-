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
const OWNER_ID = parseInt(process.env.OWNER_ID) || 0;

console.log('🔧 شروع راه‌اندازی ربات برای رندر...');
console.log('👤 مالک:', OWNER_ID);

// بررسی تنظیمات ضروری
if (!BOT_TOKEN) {
  console.log('❌ BOT_TOKEN تنظیم نشده است');
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.log('⚠️ Supabase تنظیم نشده - حالت تست فعال می‌شود');
}

const bot = new Telegraf(BOT_TOKEN);
let supabase;

// راه‌اندازی Supabase اگر تنظیمات موجود باشد
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log('✅ Supabase متصل شد');
} else {
  console.log('ℹ️ Supabase غیرفعال - ذخیره سازی موقت در حافظه');
}

app.use(express.json());

// ==================[ ذخیره‌سازی موقت در حافظه (برای تست) ]==================
let tempData = {
  activeGroups: new Set(),
  userXP: new Map(),
  userData: new Map()
};

// ==================[ مدیریت XP - سازگار با هر دو حالت ]==================
const saveUserXP = async (userId, username, firstName, xpToAdd) => {
  try {
    console.log(`💾 ذخیره XP برای کاربر ${userId}: ${xpToAdd} XP`);
    
    if (supabase) {
      // حالت Supabase
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
          return newCurrentXP;
        }
      }
    } else {
      // حالت ذخیره‌سازی موقت
      const userKey = userId.toString();
      if (tempData.userXP.has(userKey)) {
        const currentXP = tempData.userXP.get(userKey) + xpToAdd;
        tempData.userXP.set(userKey, currentXP);
        tempData.userData.set(userKey, {
          username,
          firstName,
          messageCount: (tempData.userData.get(userKey)?.messageCount || 0) + 1
        });
        return currentXP;
      } else {
        tempData.userXP.set(userKey, xpToAdd);
        tempData.userData.set(userKey, {
          username,
          firstName,
          messageCount: 1
        });
        return xpToAdd;
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
    if (supabase) {
      const { data, error } = await supabase
        .from('active_groups')
        .select('group_id')
        .eq('group_id', chatId.toString())
        .single();
      return !error && data;
    } else {
      // حالت موقت
      return tempData.activeGroups.has(chatId.toString());
    }
  } catch (error) {
    console.log('❌ خطا در بررسی گروه فعال:', error.message);
    return false;
  }
};

// فعال کردن گروه
const activateGroup = async (chatId, chatTitle, activatedBy) => {
  try {
    if (supabase) {
      const { error } = await supabase
        .from('active_groups')
        .upsert({
          group_id: chatId.toString(),
          group_title: chatTitle,
          activated_by: activatedBy,
          activated_at: new Date().toISOString()
        }, { onConflict: 'group_id' });
      return !error;
    } else {
      // حالت موقت
      tempData.activeGroups.add(chatId.toString());
      return true;
    }
  } catch (error) {
    console.log('❌ خطا در فعال‌سازی گروه:', error.message);
    return false;
  }
};

// دریافت لیست کاربران
const getAllUsersXP = async () => {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('user_xp')
        .select('user_id, username, first_name, current_xp, message_count')
        .order('current_xp', { ascending: false });
      return !error ? data : [];
    } else {
      // حالت موقت
      const users = [];
      for (const [userId, xp] of tempData.userXP) {
        if (xp > 0) {
          const userInfo = tempData.userData.get(userId) || {};
          users.push({
            user_id: parseInt(userId),
            username: userInfo.username,
            first_name: userInfo.firstName,
            current_xp: xp,
            message_count: userInfo.messageCount || 0
          });
        }
      }
      return users.sort((a, b) => b.current_xp - a.current_xp);
    }
  } catch (error) {
    console.log('❌ خطا در دریافت لیست کاربران:', error.message);
    return [];
  }
};

// ریست XP
const resetAllXP = async () => {
  try {
    if (supabase) {
      const { error } = await supabase
        .from('user_xp')
        .update({ 
          current_xp: 0,
          reset_at: new Date().toISOString()
        })
        .neq('user_id', 0);
      return !error;
    } else {
      // حالت موقت
      tempData.userXP.clear();
      return true;
    }
  } catch (error) {
    console.log('❌ خطا در ریست XP:', error.message);
    return false;
  }
};

// محاسبه XP
const calculateXPFromMessage = (text) => {
  if (!text || typeof text !== 'string') return 0;
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  const xpEarned = Math.floor(lines.length / 4) * 20;
  return xpEarned;
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

// ==================[ پردازش پیام‌ها ]==================
bot.on('text', async (ctx) => {
  try {
    // نادیده گرفتن پیام‌های خصوصی
    if (ctx.chat.type === 'private') {
      return;
    }

    const messageText = ctx.message.text;
    
    // اگر پیام دستور است، پردازش نشود
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
      console.log(`💰 ${firstName} در ${ctx.chat.title}: +${xpToAdd} XP`);
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
      `📊 از این پس پیام‌های کاربران محاسبه شده و به ازای هر 4 خط، 20 XP دریا��ت می‌کنند.\n\n` +
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

    users.slice(0, 50).forEach((user, index) => { // فقط 50 کاربر اول
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
    
    // اگر کاربران بیشتری وجود دارد
    if (users.length > 50) {
      message += `\n\n⚠️ فقط ${50} کاربر اول نمایش داده شدند`;
    }

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

    const users = await getAllUsersXP();
    const activeUsers = users.filter(user => user.current_xp > 0).length;
    const totalXP = users.reduce((sum, user) => sum + user.current_xp, 0);

    let statusMessage = `🤖 وضعیت ربات XP\n\n`;
    statusMessage += `🔹 حالت ذخیره‌سازی: ${supabase ? 'Supabase' : 'موقت'}\n`;
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

// ==================[ وب‌سرویس برای رندر ]==================
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>ربات XP اکلیس</title>
        <meta charset="utf-8">
        <style>
            body { font-family: Tahoma, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
            .container { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 500px; margin: 0 auto; }
            h1 { color: #2c3e50; }
            .status { color: #27ae60; font-weight: bold; }
            .info { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🤖 ربات XP مجموعه اکلیس</h1>
            <div class="info">
                <p class="status">✅ ربات فعال است</p>
                <p>مالک: ${OWNER_ID}</p>
                <p>ذخیره‌سازی: ${supabase ? 'Supabase' : 'موقت'}</p>
            </div>
            <p><a href="/health">بررسی سلامت سرویس</a></p>
        </div>
    </body>
    </html>
  `);
});

app.get('/health', async (req, res) => {
  try {
    let dbStatus = 'none';
    if (supabase) {
      const { error } = await supabase.from('active_groups').select('count').limit(1);
      dbStatus = error ? 'error' : 'connected';
    }
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: dbStatus,
      owner: OWNER_ID,
      memory_users: tempData.userXP.size,
      active_groups: tempData.activeGroups.size
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

// ==================[ راه‌اندازی برای رندر ]==================
async function startServer() {
  try {
    console.log('🚀 شروع راه‌اندازی برای رندر...');
    
    // حتماً از webhook استفاده می‌کنیم
    const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/webhook`;
    console.log(`🔗 تنظیم webhook: ${webhookUrl}`);
    
    await bot.telegram.setWebhook(webhookUrl);
    app.use(bot.webhookCallback('/webhook'));
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ سرور روی پورت ${PORT} راه‌اندازی شد`);
      console.log(`🌐 آدرس: ${process.env.RENDER_EXTERNAL_URL}`);
      console.log('🎉 ربات آماده استفاده است!');
    });

  } catch (error) {
    console.log('❌ خطا در راه‌اندازی:', error.message);
    process.exit(1);
  }
}

// مدیریت خطاهای全局
process.on('unhandledRejection', (error) => {
  console.log('❌ خطای catch نشده:', error.message);
});

process.on('uncaughtException', (error) => {
  console.log('❌ خطای مدیریت نشده:', error);
});

// شروع برنامه
startServer();
