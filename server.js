require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const cors = require('cors');
const bodyParser = require('body-parser');
const moment = require('moment-timezone');

// --- CREDENTIALS ---
const SUPABASE_URL = 'https://kjeggesbrutxgxwdrguz.supabase.co';
const SUPABASE_KEY = 'sb_secret_4V2Cs3uMDJBdd_dMlCp7Sw_i5pJ3HRw'; 
const TG_TOKEN = '8259244248:AAETfA7KtG13m-K0bKEcSdFn2XTXCA-AyBc';
const TIMEZONE = 'Africa/Lagos';

// ⚠️ IMPORTANT: Replace this with your actual Web App URL (e.g., Vercel/Netlify link)
const WEB_APP_URL = 'https://YOUR-WEB-APP-URL.com'; 

// --- INIT ---
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new TelegramBot(TG_TOKEN, { polling: true });
const app = express();

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// --- 1. WEB APP API ENDPOINTS (Unchanged) ---

app.get('/api/tasks/:chatId', async (req, res) => {
    const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('chat_id', req.params.chatId)
        .neq('status', 'completed')
        .order('due_date', { ascending: true })
        .order('due_time', { ascending: true });
    
    if (error) return res.status(500).json(error);
    res.json(data);
});

app.post('/api/tasks', async (req, res) => {
    const { task_name, start_date, due_time, chat_id, type, duration } = req.body;
    let tasksToInsert = [];
    
    if (type === 'series') {
        const days = parseInt(duration) || 1;
        for (let i = 0; i < days; i++) {
            const date = moment(start_date).add(i, 'days').format('YYYY-MM-DD');
            tasksToInsert.push({
                task_name: `${task_name} (Day ${i + 1}/${days})`,
                due_date: date,
                due_time,
                chat_id: chat_id.toString(),
                status: 'pending',
                type: 'series'
            });
        }
    } else {
        tasksToInsert.push({
            task_name,
            due_date: start_date,
            due_time,
            chat_id: chat_id.toString(),
            status: 'pending',
            type: 'single'
        });
    }

    const { error } = await supabase.from('tasks').insert(tasksToInsert);
    if (error) return res.status(500).json(error);
    res.json({ success: true, count: tasksToInsert.length });
});

app.put('/api/tasks/:id', async (req, res) => {
    const { status } = req.body;
    const { error } = await supabase.from('tasks').update({ status }).eq('id', req.params.id);
    if (error) return res.status(500).json(error);
    res.json({ success: true });
});

app.delete('/api/tasks/:id', async (req, res) => {
    const { error } = await supabase.from('tasks').delete().eq('id', req.params.id);
    if (error) return res.status(500).json(error);
    res.json({ success: true });
});

// --- 2. TELEGRAM BOT HANDLERS (Simplified) ---

// A. Handle /start - Sets up the Interface Button
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    
    // Set the persistent "Menu" button
    bot.setChatMenuButton({
        chat_id: chatId,
        menu_button: {
            type: "web_app",
            text: "My Tasks",
            web_app: { url: WEB_APP_URL }
        }
    });

    const welcomeMsg = `👋 *Welcome to your To-Do App!*\n\nManage your daily tasks easily using the visual interface.\n\n👇 *Click the "My Tasks" button below to get started.*`;
    
    bot.sendMessage(chatId, welcomeMsg, { 
        parse_mode: 'Markdown',
        reply_markup: {
            // Also provide an inline button as a backup
            inline_keyboard: [[{ text: "📝 Open Task Manager", web_app: { url: WEB_APP_URL } }]]
        }
    });
});

// B. Handle /help
bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    const helpMessage = `❓ *Help Section*\n\nThis bot is a Mini App wrapper.\n\n1. Click "My Tasks" (bottom left) or the button in the chat.\n2. Add, Edit, or Delete tasks inside the web window.\n3. I will send you reminders when tasks are due!`;
    bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

// C. Handle generic text (No AI, just guidance)
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Ignore commands (starting with /) and bot messages
    if (!text || msg.from.is_bot || text.startsWith('/')) return;

    // If user types random text, guide them to the button
    bot.sendMessage(chatId, "🤖 Please use the *My Tasks* button to manage your to-dos.", { 
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: "Open App", web_app: { url: WEB_APP_URL } }]]
        }
    });
});


// --- 3. CRON JOBS (Background Automation) ---

// Check for Reminders (Every minute)
cron.schedule('* * * * *', async () => {
    const now = moment().tz(TIMEZONE);
    const currentDate = now.format('YYYY-MM-DD');
    const currentTime = now.format('HH:mm');
    
    const { data: tasks } = await supabase
        .from('tasks')
        .select('*')
        .eq('due_date', currentDate)
        .eq('due_time', currentTime)
        .eq('status', 'pending');

    if (tasks && tasks.length > 0) {
        tasks.forEach(task => {
            bot.sendMessage(task.chat_id, `🔔 <b>Reminder:</b> ${task.task_name}\n\nTap below to mark as done.`, { 
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[{ text: "✅ Open Tasks", web_app: { url: WEB_APP_URL } }]]
                }
            });
        });
    }
});

// Rollover Missed Tasks (Daily at 1 AM)
cron.schedule('0 1 * * *', async () => {
    const yesterday = moment().tz(TIMEZONE).subtract(1, 'days').format('YYYY-MM-DD');
    const today = moment().tz(TIMEZONE).format('YYYY-MM-DD');
    
    const { data: missedTasks } = await supabase
        .from('tasks')
        .select('*')
        .eq('due_date', yesterday)
        .in('status', ['pending', 'missed']);

    if (missedTasks && missedTasks.length > 0) {
        const ids = missedTasks.map(t => t.id);
        await supabase.from('tasks').update({ due_date: today }).in('id', ids);
        
        const userGroups = {};
        missedTasks.forEach(t => {
            if(!userGroups[t.chat_id]) userGroups[t.chat_id] = 0;
            userGroups[t.chat_id]++;
        });

        for (const [chatId, count] of Object.entries(userGroups)) {
            bot.sendMessage(chatId, `🔄 Moved ${count} tasks from yesterday to today.`);
        }
    }
}, { timezone: TIMEZONE });

// Morning Greeting (Daily at 7 AM)
cron.schedule('0 7 * * *', async () => {
    const today = moment().tz(TIMEZONE).format('YYYY-MM-DD');
    const { data: tasks } = await supabase.from('tasks').select('chat_id').eq('due_date', today).eq('status', 'pending');
    
    if(tasks && tasks.length > 0) {
        const distinctUsers = [...new Set(tasks.map(t => t.chat_id))];
        distinctUsers.forEach(chatId => {
            bot.sendMessage(chatId, "☀️ <b>Good Morning!</b>\nCheck your app for today's tasks.", { 
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[{ text: "Open My Tasks", web_app: { url: WEB_APP_URL } }]]
                }
            });
        });
    }
}, { timezone: TIMEZONE });


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}...`));
