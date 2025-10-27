const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');

const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const PORT = process.env.PORT || 3000;
const OWNER_ID = parseInt(process.env.OWNER_ID) || 0;
const SELF_BOT_ID = process.env.SELF_BOT_ID || 'xp_bot_1';

const cache = new NodeCache({ 
  stdTTL: 3600,
  checkperiod: 1200,
  maxKeys: 5000
});

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(express.json());

// ==================[ لاگینگ پیشرفته ]==================
console.log('🔧 شروع راه‌اندازی ربات XP...');
console.log('🤖 مالک ربات:', OWNER_ID);
console.log('🔑 Supabase URL:', SUPABASE_URL ? 'تنظیم شده' : 'تنظیم نشده');

// ==================[ پینگ ]==================
const startAutoPing = () => {
  if (!process.env.RENDER_EXTERNAL_URL) {
    console.log('⚠️ RENDER_EXTERNAL_URL تنظیم نشده');
    return;
  }
  
  const PING_INTERVAL = 13 * 60 * 1000 + 59 * 1000;
  const selfUrl = process.env.RENDER_EXTERNAL_URL;

  const performPing = async () => {
    try {
      await axios.head(`${selfUrl}/ping`, { timeout: 5000 });
      console.log('✅ پینگ موفق');
    } catch (error) {
      console.log('❌ خطا در پینگ:', error.message);
      setTimeout(performPing, 60000);
    }
  };

  setTimeout(performPing, 30000);
  setInterval(performPing, PING_INTERVAL);
  console.log('✅ سیستم پینگ فعال شد');
};

app.head('/ping', (req, res) => res.status(200).end());
app.get('/ping', (req, res) => {
  res.status(200).json({ status: 'active', bot: SELF_BOT_ID });
});

// ==================[ بررسی مالکیت ]==================
const checkOwnerAccess = (ctx) => {
  const userId = ctx.from.id;
  console.log(`🔍 بررسی دسترسی کاربر ${userId} - مالک: ${OWNER_ID}`);
  
  if (userId !== OWNER_ID) {
    return {
      hasAccess: false,
      message: '🚫 این ربات متعلق به مجموعه اکلیس است ، فقط مالک اکلیس میتواند از ما استفاده کند'
    };
  }
  return { hasAccess: true };
};

// ==================[ ذخیره XP در دیتابیس ]==================
const saveXPToDatabase = async (userId, username, firstName, xpToAdd) => {
  try {
    console.log(`💾 ذخیره ${xpToAdd} XP برای کاربر ${userId}`);

    // ابتدا کاربر فعلی را بررسی کن
    const { data: existingUser, error: selectError } = await supabase
      .from('user_xp')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (selectError && selectError.code !== 'PGRST116') {
      console.log('❌ خطا در بررسی کاربر:', selectError);
      return false;
    }

    if (existingUser) {
      // کاربر وجود دارد - XP را آپدیت کن
      const { error: updateError } = await supabase
        .from('user_xp')
        .update({
          xp: existingUser.xp + xpToAdd,
          username: username,
          first_name: firstName,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);

      if (updateError) {
        console.log('❌ خطا در آپدیت XP:', updateError);
        return false;
      }
    } else {
      // کاربر جدید - insert کن
      const { error: insertError } = await supabase
        .from('user_xp')
        .insert({
          user_id: userId,
          username: username,
          first_name: firstName,
          xp: xpToAdd,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });

      if (insertError) {
        console.log('❌ خطا در ذخیره XP جدید:', insertError);
        return false;
      }
    }

    console.log(`✅ ${xpToAdd} XP برای کاربر ${userId} ذخیره شد`);
    return true;
  } catch (error) {
    console.log('❌ خطا در ذخیره XP:', error);
    return false;
  }
};

// ==================[ بررسی فعال بودن گروه ]==================
const isChatActive = async (chatId) => {
  try {
    const cacheKey = `active_${chatId}`;
    let isActive = cache.get(cacheKey);
    
    if (isActive === undefined) {
      console.log(`🔍 بررسی وضعیت گروه ${chatId} از دیتابیس...`);
      const { data, error } = await supabase
        .from('xp_bot_chats')
        .select('active')
        .eq('chat_id', chatId)
        .single();
      
      if (error && error.code !== 'PGRST116') {
        console.log('❌ خطا در بررسی گروه:', error);
      }
      
      isActive = data ? data.active : false;
      cache.set(cacheKey, isActive, 3600);
      console.log(`📊 وضعیت گروه ${chatId}: ${isActive ? 'فعال' : 'غیرفعال'}`);
    }
    
    return isActive;
  } catch (error) {
    console.log('❌ خطا در بررسی وضعیت گروه:', error);
    return false;
  }
};

// ==================[ مدیریت پیام‌ها و محاسبه XP ]==================
bot.on('message', async (ctx) => {
  try {
    // فقط در گروه پردازش کن
    if (ctx.chat.type === 'private') {
      console.log('📱 پیام در پیوی - نادیده گرفته شد');
      return;
    }

    const chatId = ctx.chat.id.toString();
    const chatTitle = ctx.chat.title || 'بدون عنوان';
    
    console.log(`📨 دریافت پیام در گروه ${chatTitle} (${chatId})`);

    // بررسی فعال بودن ربات در این گروه
    const isActive = await isChatActive(chatId);
    
    if (!isActive) {
      console.log('❌ ربات در این گروه غیرفعال است');
      return;
    }

    const userId = ctx.from.id;
    const username = ctx.from.username;
    const firstName = ctx.from.first_name || 'کاربر';
    
    // فقط پیام‌های متنی پردازش شوند
    if (!ctx.message.text) {
      console.log('📎 پیام غیرمتنی - نادیده گرفته شد');
      return;
    }

    const messageText = ctx.message.text;

    // شمارش خطوط پیام
    const lineCount = messageText.split('\n').length;
    console.log(`📊 پیام از ${firstName} - ${lineCount} خط`);
    
    if (lineCount < 4) {
      console.log('📝 کمتر از 4 خط - XP تعلق نمی‌گیرد');
      return;
    }

    // محاسبه XP (هر 4 خط = 20 XP)
    const xpEarned = Math.floor(lineCount / 4) * 20;
    console.log(`⭐ ${firstName} دریافت کرد: ${xpEarned} XP`);

    // ذخیره در دیتابیس
    const saveResult = await saveXPToDatabase(userId, username, firstName, xpEarned);
    
    if (saveResult) {
      console.log(`✅ XP کاربر ${firstName} ذخیره شد`);
    } else {
      console.log(`❌ خطا در ذخیره XP کاربر ${firstName}`);
    }

  } catch (error) {
    console.log('❌ خطا در پردازش پیام:', error.message);
  }
});

// ==================[ دستور فعال‌سازی ربات ]==================
bot.command('on1', async (ctx) => {
  try {
    console.log('🚀 درخواست فعال‌سازی ربات دریافت شد');
    
    const access = checkOwnerAccess(ctx);
    if (!access.hasAccess) {
      console.log('❌ دسترسی غیرمجاز');
      return ctx.reply(access.message);
    }

    if (ctx.chat.type === 'private') {
      console.log('❌ درخواست فعال‌سازی در پیوی');
      return ctx.reply('❌ این دستور فقط در گروه قابل استفاده است');
    }

    const chatId = ctx.chat.id.toString();
    const chatTitle = ctx.chat.title || 'بدون عنوان';

    console.log(`🔧 فعال‌سازی ربات در گروه ${chatTitle} (${chatId})`);

    // بررسی ادمین بودن ربات
    let isAdmin;
    try {
      const chatMember = await ctx.getChatMember(ctx.botInfo.id);
      isAdmin = ['administrator', 'creator'].includes(chatMember.status);
      console.log(`🤖 وضعیت ادمین ربات: ${isAdmin}`);
    } catch (error) {
      console.log('❌ خطا در بررسی ادمین:', error.message);
      isAdmin = false;
    }

    if (!isAdmin) {
      console.log('❌ ربات ادمین نیست');
      return ctx.reply('❌ لطفاً ابتدا ربات را ادمین گروه کنید و سپس مجدداً /on1 را ارسال کنید.');
    }

    // ذخیره گروه فعال در دیتابیس
    const { error } = await supabase
      .from('xp_bot_chats')
      .upsert({
        chat_id: chatId,
        chat_title: chatTitle,
        active: true,
        updated_at: new Date().toISOString()
      }, { onConflict: 'chat_id' });

    if (error) {
      console.log('❌ خطا در ذخیره گروه:', error);
      return ctx.reply('❌ خطا در فعال‌سازی ربات. لطفاً دوباره تلاش کنید.');
    }

    // آپدیت کش
    cache.set(`active_${chatId}`, true, 3600);

    console.log(`✅ ربات XP در گروه ${chatTitle} فعال شد`);
    ctx.reply('✅ ربات XP با موفقیت فعال شد! از این پس به ازای هر 4 خط پیام، 20 XP به کاربران تعلق می‌گیرد.');

  } catch (error) {
    console.log('❌ خطا در فعال‌سازی:', error);
    ctx.reply('❌ خطا در فعال‌سازی ربات');
  }
});

// ==================[ دستور غیرفعال‌سازی ]==================
bot.command('off1', async (ctx) => {
  try {
    console.log('🛑 درخواست غیرفعال‌سازی ربات');
    
    const access = checkOwnerAccess(ctx);
    if (!access.hasAccess) {
      return ctx.reply(access.message);
    }

    const chatId = ctx.chat.id.toString();
    const chatTitle = ctx.chat.title || 'بدون عنوان';

    console.log(`🔧 غیرفعال‌سازی ربات از گروه ${chatTitle} (${chatId})`);

    const { error } = await supabase
      .from('xp_bot_chats')
      .update({
        active: false,
        updated_at: new Date().toISOString()
      })
      .eq('chat_id', chatId);

    if (error) {
      console.log('❌ خطا در غیرفعال‌سازی:', error);
      return ctx.reply('❌ خطا در غیرفعال‌سازی');
    }

    cache.set(`active_${chatId}`, false, 3600);

    console.log(`✅ ربات XP از گروه ${chatTitle} غیرفعال شد`);
    ctx.reply('✅ ربات XP غیرفعال شد.');
    
    try {
      await ctx.leaveChat();
      console.log(`🚪 ربات از گروه ${chatTitle} خارج شد`);
    } catch (error) {
      console.log('⚠️ خطا در خروج از گروه:', error.message);
    }

  } catch (error) {
    console.log('❌ خطا در غیرفعال‌سازی:', error);
    ctx.reply('❌ خطا در غیرفعال‌سازی');
  }
});

// ==================[ دریافت لیست XP ها ]==================
const getXPList = async () => {
  try {
    console.log('📋 دریافت لیست XP ها از دیتابیس...');
    
    const { data, error } = await supabase
      .from('user_xp')
      .select('user_id, username, first_name, xp')
      .order('xp', { ascending: false });

    if (error) {
      console.log('❌ خطا در دریافت لیست XP:', error);
      return null;
    }

    console.log(`✅ ${data ? data.length : 0} کاربر دریافت شد`);
    return data;
  } catch (error) {
    console.log('❌ خطا در دریافت لیست:', error);
    return null;
  }
};

// ==================[ ریست XP ها ]==================
const resetAllXP = async () => {
  try {
    console.log('🔄 شروع ریست تمام XP ها...');
    
    const { error } = await supabase
      .from('user_xp')
      .update({ 
        xp: 0,
        updated_at: new Date().toISOString()
      })
      .gt('xp', 0);

    if (error) {
      console.log('❌ خطا در ریست XP ها:', error);
      return false;
    }

    console.log('✅ تمام XP ها ریست شدند');
    return true;
  } catch (error) {
    console.log('❌ خطا در ریست:', error);
    return false;
  }
};

// ==================[ دستور لیست XP - فقط در پیوی ]==================
bot.command('list_xp', async (ctx) => {
  try {
    console.log('📊 درخواست لیست XP ها');
    
    const access = checkOwnerAccess(ctx);
    if (!access.hasAccess) {
      return ctx.reply(access.message);
    }

    // فقط در پیوی اجازه دسترسی
    if (ctx.chat.type !== 'private') {
      return ctx.reply('❌ این دستور فقط در پیوی ربات قابل استفاده است');
    }

    await ctx.reply('🔄 در حال دریافت لیست XP کاربران...');

    const xpList = await getXPList();
    
    if (!xpList || xpList.length === 0) {
      return ctx.reply('📊 هیچ XP ای ثبت نشده است.');
    }

    // ایجاد لیست فرمت‌شده
    let message = '🏆 لیست XP کاربران:\n\n';
    let userCount = 0;
    
    xpList.forEach((user, index) => {
      if (user.xp > 0) {
        userCount++;
        const name = user.first_name || user.username || `کاربر ${user.user_id}`;
        message += `${userCount}. ${name}: ${user.xp} XP\n`;
      }
    });

    if (userCount === 0) {
      message = '📊 هیچ کاربری XP ندارد.';
    } else {
      message += `\n📈 مجموع کاربران: ${userCount} نفر`;
    }

    // ارسال لیست
    await ctx.reply(message);

    if (userCount > 0) {
      // تأیید ریست
      await ctx.reply(
        '⚠️ آیا می‌خواهید تمام XP ها ریست شوند؟\n' +
        '✅ بله - ریست کن\n' +
        '❌ خیر - نگه دار',
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ بله - ریست کن', callback_data: 'reset_xp_confirm' },
                { text: '❌ خیر - نگه دار', callback_data: 'reset_xp_cancel' }
              ]
            ]
          }
        }
      );
    }

  } catch (error) {
    console.log('❌ خطا در دریافت لیست XP:', error);
    ctx.reply('❌ خطا در دریافت لیست');
  }
});

// ==================[ مدیریت دکمه‌های تایید ریست ]==================
bot.action('reset_xp_confirm', async (ctx) => {
  try {
    console.log('✅ تایید ریست XP ها');
    
    const access = checkOwnerAccess(ctx);
    if (!access.hasAccess) {
      return ctx.answerCbQuery('دسترسی denied');
    }

    await ctx.answerCbQuery('در حال ریست XP ها...');
    
    const success = await resetAllXP();
    
    if (success) {
      await ctx.editMessageText('✅ تمام XP ها با موفقیت ریست شدند.');
    } else {
      await ctx.editMessageText('❌ خطا در ریست XP ها.');
    }

  } catch (error) {
    console.log('❌ خطا در ریست:', error);
    await ctx.answerCbQuery('خطا در ریست');
  }
});

bot.action('reset_xp_cancel', async (ctx) => {
  try {
    await ctx.answerCbQuery('ریست لغو شد');
    await ctx.editMessageText('❌ ریست XP ها لغو شد.');
  } catch (error) {
    await ctx.answerCbQuery('خطا');
  }
});

// ==================[ دستور وضعیت ]==================
bot.command('status_xp', async (ctx) => {
  try {
    console.log('📈 درخواست وضعیت ربات');
    
    const access = checkOwnerAccess(ctx);
    if (!access.hasAccess) {
      return ctx.reply(access.message);
    }

    const chatId = ctx.chat.type !== 'private' ? ctx.chat.id.toString() : null;
    
    if (chatId) {
      // در گروه - وضعیت این گروه
      const isActive = await isChatActive(chatId);
      ctx.reply(isActive ? 
        '✅ ربات XP در این گروه فعال است' : 
        '❌ ربات XP در این گروه غیرفعال است'
      );
    } else {
      // در پیوی - وضعیت کلی
      const { data: activeChats, error: chatsError } = await supabase
        .from('xp_bot_chats')
        .select('chat_title')
        .eq('active', true);

      const { data: totalUsers, error: usersError } = await supabase
        .from('user_xp')
        .select('user_id', { count: 'exact' });

      const { data: totalXP, error: xpError } = await supabase
        .from('user_xp')
        .select('xp');

      if (chatsError) console.log('❌ خطا در دریافت گروه‌ها:', chatsError);
      if (usersError) console.log('❌ خطا در دریافت کاربران:', usersError);
      if (xpError) console.log('❌ خطا در دریافت XP:', xpError);

      const activeChatsCount = activeChats ? activeChats.length : 0;
      const totalUsersCount = totalUsers ? totalUsers.length : 0;
      const totalXPSum = totalXP ? totalXP.reduce((sum, user) => sum + user.xp, 0) : 0;

      ctx.reply(
        `📊 وضعیت ربات XP:\n\n` +
        `👥 گروه‌های فعال: ${activeChatsCount}\n` +
        `👤 کاربران ثبت‌شده: ${totalUsersCount}\n` +
        `⭐ مجموع XP: ${totalXPSum}\n\n` +
        `از /list_xp برای مشاهده جزئیات استفاده کنید.`
      );
    }

  } catch (error) {
    console.log('❌ خطا در دریافت وضعیت:', error);
    ctx.reply('❌ خطا در دریافت وضعیت');
  }
});

// ==================[ دستور help ]==================
bot.command('help', (ctx) => {
  ctx.reply(`🤖 راهنما ربات XP:

/on1 - فعال‌سازی ربات در گروه (فقط مالک)
/off1 - غیرفعال‌سازی ربات از گروه (فقط مالک)  
/list_xp - مشاهده و مدیریت XP ها (فقط در پیوی)
/status_xp - وضعیت ربات

📝 نحوه کار:
• ربات به ازای هر 4 خط پیام، 20 XP میدهد
• فقط در گروه‌های فعال کار میکند
• فقط مالک میتواند ربات را مدیریت کند`);
});

// ==================[ راه‌اندازی ]==================
app.use(bot.webhookCallback('/webhook'));
app.get('/', (req, res) => {
  res.send(`🤖 ربات XP ${SELF_BOT_ID} فعال - مالک: ${OWNER_ID}`);
});

// هندل خطاهای راه‌اندازی
bot.catch((err, ctx) => {
  console.log('❌ خطای ربات:', err);
});

app.listen(PORT, () => {
  console.log(`🚀 ربات XP ${SELF_BOT_ID} روی پورت ${PORT} راه‌اندازی شد`);
  console.log(`👤 مالک: ${OWNER_ID}`);
  console.log(`🔗 Supabase: ${SUPABASE_URL ? 'متصل' : 'قطع'}`);
  startAutoPing();
});

// راه‌اندازی ربات
if (process.env.RENDER_EXTERNAL_URL) {
  const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/webhook`;
  console.log(`🌐 تنظیم Webhook روی: ${webhookUrl}`);
  
  bot.telegram.setWebhook(webhookUrl)
    .then(() => console.log('✅ Webhook تنظیم شد'))
    .catch((error) => {
      console.log('❌ خطا در Webhook:', error.message);
      console.log('🔄 راه‌اندازی با polling...');
      bot.launch();
    });
} else {
  console.log('🔄 راه‌اندازی با polling...');
  bot.launch().then(() => {
    console.log('✅ ربات با polling راه‌اندازی شد');
  }).catch(error => {
    console.log('❌ خطا در راه‌اندازی ربات:', error.message);
  });uu
}

process.on('unhandledRejection', (error) => {
  console.log('❌ خطای catch نشده:', error.message);
});
