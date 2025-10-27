const { Telegraf, session } = require('telegraf');
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

// ==================[ سشن ]==================
bot.use(session({
  defaultSession: () => ({
    active: false,
    userMessageCounts: {}
  })
}));

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

// ==================[ ذخیره XP در دیتابیس ]==================
const saveXPToDatabase = async (userId, username, firstName, xpToAdd) => {
  try {
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

// ==================[ دریافت لیست XP ها ]==================
const getXPList = async () => {
  try {
    const { data, error } = await supabase
      .from('user_xp')
      .select('user_id, username, first_name, xp')
      .order('xp', { ascending: false });

    if (error) {
      console.log('❌ خطا در دریافت لیست XP:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.log('❌ خطا در دریافت لیست:', error);
    return null;
  }
};

// ==================[ ریست XP ها ]==================
const resetAllXP = async () => {
  try {
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

// ==================[ مدیریت پیام‌ها و محاسبه XP ]==================
bot.on('text', async (ctx) => {
  try {
    // فقط در گروه‌های فعال پردازش کن
    if (ctx.chat.type === 'private') return;

    const chatId = ctx.chat.id.toString();
    
    // بررسی فعال بودن ربات در این گروه
    const cacheKey = `active_${chatId}`;
    let isActive = cache.get(cacheKey);
    
    if (isActive === undefined) {
      const { data } = await supabase
        .from('xp_bot_chats')
        .select('active')
        .eq('chat_id', chatId)
        .single();
      
      isActive = data ? data.active : false;
      cache.set(cacheKey, isActive, 3600);
    }

    if (!isActive) return;

    const userId = ctx.from.id;
    const username = ctx.from.username;
    const firstName = ctx.from.first_name;
    const messageText = ctx.message.text;

    // شمارش خطوط پیام
    const lineCount = messageText.split('\n').length;
    
    if (lineCount < 4) return; // کمتر از 4 خط XP ندارد

    // محاسبه XP (هر 4 خط = 20 XP)
    const xpEarned = Math.floor(lineCount / 4) * 20;

    // ذخیره در کش موقت
    const userCacheKey = `user_${userId}_xp`;
    const currentXP = cache.get(userCacheKey) || 0;
    cache.set(userCacheKey, currentXP + xpEarned, 3600);

    // ذخیره در دیتابیس (با تاخیر برای کاهش درخواست‌ها)
    setTimeout(async () => {
      await saveXPToDatabase(userId, username, firstName, xpEarned);
    }, 1000);

    console.log(`📊 کاربر ${firstName} (${userId}) - ${lineCount} خط = ${xpEarned} XP`);

  } catch (error) {
    console.log('❌ خطا در پردازش پیام:', error.message);
  }
});

// ==================[ دستور فعال‌سازی ربات ]==================
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
    let isAdmin;
    try {
      const chatMember = await ctx.getChatMember(ctx.botInfo.id);
      isAdmin = ['administrator', 'creator'].includes(chatMember.status);
    } catch (error) {
      isAdmin = false;
    }

    if (!isAdmin) {
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
      return ctx.reply('❌ خطا در فعال‌سازی ربات');
    }

    // آپدیت کش
    cache.set(`active_${chatId}`, true, 3600);

    ctx.reply('✅ ربات XP با موفقیت فعال شد! از این پس به ازای هر 4 خط پیام، 20 XP به کاربران تعلق می‌گیرد.');
    console.log(`✅ ربات XP در گروه ${chatTitle} فعال شد`);

  } catch (error) {
    console.log('❌ خطا در فعال‌سازی:', error);
    ctx.reply('❌ خطا در فعال‌سازی ربات');
  }
});

// ==================[ دستور غیرفعال‌سازی ]==================
bot.command('off1', async (ctx) => {
  try {
    const access = checkOwnerAccess(ctx);
    if (!access.hasAccess) {
      return ctx.reply(access.message);
    }

    const chatId = ctx.chat.id.toString();

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

    ctx.reply('✅ ربات XP غیرفعال شد.');
    
    try {
      await ctx.leaveChat();
    } catch (error) {
      // ignore leave errors
    }

  } catch (error) {
    console.log('❌ خطا در غیرفعال‌سازی:', error);
    ctx.reply('❌ خطا در غیرفعال‌سازی');
  }
});

// ==================[ دستور لیست XP - فقط در پیوی ]==================
bot.command('list_xp', async (ctx) => {
  try {
    const access = checkOwnerAccess(ctx);
    if (!access.hasAccess) {
      return ctx.reply(access.message);
    }

    // فقط در پیوی اجازه دسترسی
    if (ctx.chat.type !== 'private') {
      return ctx.reply('❌ این دستور فقط در پیوی ربات قابل استفاده است');
    }

    ctx.reply('🔄 در حال دریافت لیست XP کاربران...');

    const xpList = await getXPList();
    
    if (!xpList || xpList.length === 0) {
      return ctx.reply('📊 هیچ XP ای ثبت نشده است.');
    }

    // ایجاد لیست فرمت‌شده
    let message = '🏆 لیست XP کاربران:\n\n';
    
    xpList.forEach((user, index) => {
      if (user.xp > 0) {
        const name = user.first_name || user.username || 'ناشناس';
        message += `${index + 1}. ${name}: ${user.xp} XP\n`;
      }
    });

    message += `\n📈 مجموع کاربران: ${xpList.filter(u => u.xp > 0).length} نفر`;

    // ارسال لیست
    await ctx.reply(message);

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

  } catch (error) {
    console.log('❌ خطا در دریافت لیست XP:', error);
    ctx.reply('❌ خطا در دریافت لیست');
  }
});

// ==================[ مدیریت دکمه‌های تایید ریست ]==================
bot.action('reset_xp_confirm', async (ctx) => {
  try {
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
    const access = checkOwnerAccess(ctx);
    if (!access.hasAccess) {
      return ctx.reply(access.message);
    }

    const chatId = ctx.chat.type !== 'private' ? ctx.chat.id.toString() : null;
    
    if (chatId) {
      // در گروه - وضعیت این گروه
      const cacheKey = `active_${chatId}`;
      let isActive = cache.get(cacheKey);
      
      if (isActive === undefined) {
        const { data } = await supabase
          .from('xp_bot_chats')
          .select('active')
          .eq('chat_id', chatId)
          .single();
        
        isActive = data ? data.active : false;
      }

      ctx.reply(isActive ? 
        '✅ ربات XP در این گروه فعال است' : 
        '❌ ربات XP در این گروه غیرفعال است'
      );
    } else {
      // در پیوی - وضعیت کلی
      const { data: activeChats } = await supabase
        .from('xp_bot_chats')
        .select('chat_title')
        .eq('active', true);

      const { data: totalUsers } = await supabase
        .from('user_xp')
        .select('user_id', { count: 'exact' });

      const { data: totalXP } = await supabase
        .from('user_xp')
        .select('xp');

      const totalXPSum = totalXP ? totalXP.reduce((sum, user) => sum + user.xp, 0) : 0;

      ctx.reply(
        `📊 وضعیت ربات XP:\n\n` +
        `👥 گروه‌های فعال: ${activeChats ? activeChats.length : 0}\n` +
        `👤 کاربران ثبت‌شده: ${totalUsers ? totalUsers.length : 0}\n` +
        `⭐ مجموع XP: ${totalXPSum}\n\n` +
        `از /list_xp برای مشاهده جزئیات استفاده کنید.`
      );
    }

  } catch (error) {
    console.log('❌ خطا در دریافت وضعیت:', error);
    ctx.reply('❌ خطا در دریافت وضعیت');
  }
});

// ==================[ API برای بررسی وضعیت ]==================
app.post('/api/xp-stats', async (req, res) => {
  try {
    const { secretKey } = req.body;
    
    if (!secretKey || secretKey !== process.env.API_SECRET_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { data: activeChats } = await supabase
      .from('xp_bot_chats')
      .select('chat_id, chat_title')
      .eq('active', true);

    const { data: topUsers } = await supabase
      .from('user_xp')
      .select('user_id, first_name, username, xp')
      .order('xp', { ascending: false })
      .limit(10);

    res.status(200).json({
      botId: SELF_BOT_ID,
      activeChats: activeChats ? activeChats.length : 0,
      topUsers: topUsers || []
    });

  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================[ تابع ذخیره دوره‌ای ]==================
const startPeriodicSave = () => {
  // هر 1 ساعت کش‌ها را به دیتابیس منتقل کن
  setInterval(async () => {
    try {
      console.log('🔄 شروع ذخیره‌سازی دوره‌ی XP ها...');
      
      const keys = cache.keys();
      let savedCount = 0;

      for (const key of keys) {
        if (key.startsWith('user_') && key.endsWith('_xp')) {
          const userId = parseInt(key.replace('user_', '').replace('_xp', ''));
          const xpToAdd = cache.get(key);
          
          if (xpToAdd > 0) {
            // دریافت اطلاعات کاربر از کش یا دیتابیس
            const userInfo = cache.get(`user_info_${userId}`) || {};
            
            await saveXPToDatabase(
              userId, 
              userInfo.username, 
              userInfo.first_name, 
              xpToAdd
            );
            
            // پاک کردن کش این کاربر
            cache.del(key);
            savedCount++;
          }
        }
      }

      console.log(`✅ ${savedCount} کاربر در ذخیره‌سازی دوره‌ی ذخیره شدند`);
    } catch (error) {
      console.log('❌ خطا در ذخیره‌سازی دوره‌ای:', error);
    }
  }, 60 * 60 * 1000); // هر 1 ساعت
};

// ==================[ راه‌اندازی ]==================
app.use(bot.webhookCallback('/webhook'));
app.get('/', (req, res) => {
  res.send(`🤖 ربات XP ${SELF_BOT_ID} فعال - مالک: ${OWNER_ID}`);
});

app.listen(PORT, () => {
  console.log(`🚀 ربات XP ${SELF_BOT_ID} راه‌اندازی شد`);
  startAutoPing();
  startPeriodicSave();
});

if (process.env.RENDER_EXTERNAL_URL) {
  const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/webhook`;
  bot.telegram.setWebhook(webhookUrl)
    .then(() => console.log('✅ Webhook تنظیم شد'))
    .catch(() => bot.launch());
} else {
  bot.launch();
}

process.on('unhandledRejection', (error) => {
  console.log('❌ خطای catch نشده:', error.message);
});
