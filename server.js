require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const cors = require('cors');
const bodyParser = require('body-parser');
const moment = require('moment-timezone');
const fetch = require('node-fetch');

// --- CREDENTIALS ---
const SUPABASE_URL = 'https://kjeggesbrutxgxwdrguz.supabase.co';
const SUPABASE_KEY = 'sb_secret_4V2Cs3uMDJBdd_dMlCp7Sw_i5pJ3HRw';
const TG_TOKEN = '8259244248:AAETfA7KtG13m-K0bKEcSdFn2XTXCA-AyBc';
const GROQ_API_KEY = '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'; 
const TIMEZONE = 'Africa/Lagos';

// --- INIT ---
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new TelegramBot(TG_TOKEN, { polling: true });
const app = express();

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// --- ⭐ FIX: WEB APP API ENDPOINTS (Restored) ---

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
                chat_id: chat_id.toString(), // Ensure it's a string
                status: 'pending',
                type: 'series'
            });
        }
    } else {
        tasksToInsert.push({
            task_name,
            due_date: start_date,
            due_time,
            chat_id: chat_id.toString(), // Ensure it's a string
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


// --- NATURAL LANGUAGE PROCESSOR ---

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text || msg.from.is_bot || text.startsWith('/')) {
        // We add a check for '/' to ignore commands except /help
        if (text && text.toLowerCase() === '/help') {
            const helpMessage = `👋 *Hello! I am your To-Do Bot.*\n\nYou can interact with me in two ways:\n\n1️⃣ *Natural Language:*\nJust type a reminder in the chat.\ne.g., \`Remind me to call John at 5:30pm\`\n\n2️⃣ *Full Interface:*\nTap the "My Tasks" button below to open the full web app.`;
            bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
        }
        return;
    }
    
    bot.sendChatAction(chatId, 'typing');

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messages: [
                    {
                        role: 'system',
                        content: `You are an AI assistant that extracts tasks from text. Current date is ${moment().tz(TIMEZONE).format('YYYY-MM-DD')}. Timezone is WAT. Analyze the user's message and respond ONLY with a valid JSON object.
                        - If it's a task, set intent to "create_task" and extract task_name (string), due_date (string, YYYY-MM-DD), and due_time (string, HH:mm). Assume today's date unless another day like "tomorrow" is mentioned.
                        - If it's a greeting or casual chat, set intent to "chat".
                        - If you can't determine the intent, set it to "unknown".
                        Your entire response must be ONLY the JSON.`
                    },
                    {
                        role: 'user',
                        content: text
                    }
                ],
                model: 'llama3-8b-8192',
                temperature: 0.1,
                max_tokens: 200,
                response_format: { type: "json_object" }
            })
        });

        const data = await response.json();

        // ⭐ FIX: Add robust error checking
        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            console.error("Groq returned an invalid response:", data);
            bot.sendMessage(chatId, "Sorry, I had a little trouble understanding that. Please try rephrasing.");
            return;
        }

        const result = JSON.parse(data.choices[0].message.content);

        switch (result.intent) {
            case 'create_task':
                if (!result.task_name || !result.due_time) {
                     bot.sendMessage(chatId, "I understood it was a task, but couldn't get the details. Please be more specific with the task name and time.");
                     return;
                }
                const dueDate = result.due_date || moment().tz(TIMEZONE).format('YYYY-MM-DD');
                await supabase.from('tasks').insert({
                    task_name: result.task_name,
                    due_date: dueDate,
                    due_time: result.due_time,
                    chat_id: chatId.toString(),
                    status: 'pending',
                    type: 'single'
                });
                bot.sendMessage(chatId, `✅ Got it! Task added: "${result.task_name}" for ${result.due_time}.`);
                break;

            case 'chat':
                bot.sendMessage(chatId, "Hello! You can tell me a task or open the 'My Tasks' app below.");
                break;
                
            case 'unknown':
            default:
                // Do nothing to avoid spamming the user
                break;
        }

    } catch (error) {
        console.error("Groq or parsing error:", error);
        bot.sendMessage(chatId, "I'm having trouble thinking right now. Please try again in a moment.");
    }
});


// --- AUTOMATION / CRON JOBS ---

cron.schedule('* * * * *', async () => { /* Reminder Logic */ });
cron.schedule('0 1 * * *', async () => { /* Rollover Logic */ }, { timezone: TIMEZONE });
cron.schedule('0 2 * * *', async () => { /* Cleanup Logic */ }, { timezone: TIMEZONE });
cron.schedule('0 7 * * *', async () => { /* Morning Logic */ }, { timezone: TIMEZONE });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT} and listening for messages...`));

// --- Helper Functions for Cron Jobs ---
// (The full functions need to be here)

cron.schedule('* * * * *', async () => {
    const now = moment().tz(TIMEZONE);
    const currentDate = now.format('YYYY-MM-DD');
    const currentTime = now.format('HH:mm');
    const { data: tasks } = await supabase.from('tasks').select('*').eq('due_date', currentDate).eq('due_time', currentTime).eq('status', 'pending');
    if (tasks && tasks.length > 0) {
        tasks.forEach(task => {
            bot.sendMessage(task.chat_id, `🔔 <b>Reminder!</b>\n\nTask: ${task.task_name}\nTime: ${task.due_time}\n\nTap "My Tasks" to mark it done!`, { parse_mode: 'HTML' });
        });
    }
});

cron.schedule('0 1 * * *', async () => {
    const yesterday = moment().tz(TIMEZONE).subtract(1, 'days').format('YYYY-MM-DD');
    const today = moment().tz(TIMEZONE).format('YYYY-MM-DD');
    const { data: missedTasks } = await supabase.from('tasks').select('*').eq('due_date', yesterday).in('status', ['pending', 'missed']);
    if (missedTasks && missedTasks.length > 0) {
        const userGroups = {};
        missedTasks.forEach(t => {
            if (!userGroups[t.chat_id]) userGroups[t.chat_id] = [];
            userGroups[t.chat_id].push(t);
        });
        for (const [chatId, tasks] of Object.entries(userGroups)) {
            const ids = tasks.map(t => t.id);
            await supabase.from('tasks').update({ due_date: today, status: 'pending' }).in('id', ids);
            const names = tasks.map(t => `- ${t.task_name}`).join('\n');
            bot.sendMessage(chatId, `🌙 <b>Review: Missed Tasks</b>\n\nYou didn't finish these yesterday:\n${names}\n\nI have moved them to today. Keep going! 💪`, { parse_mode: 'HTML' });
        }
    }
}, { timezone: "Africa/Lagos" });

cron.schedule('0 2 * * *', async () => {
    const yesterday = moment().tz(TIMEZONE).subtract(1, 'days').format('YYYY-MM-DD');
    const { error } = await supabase.from('tasks').delete().eq('due_date', yesterday).eq('status', 'completed');
    if (error) { console.error('Cleanup Error:', error); }
    else { console.log(`🧹 Cleaned up completed tasks from ${yesterday}.`); }
}, { timezone: "Africa/Lagos" });

cron.schedule('0 7 * * *', async () => {
    const today = moment().tz(TIMEZONE).format('YYYY-MM-DD');
    const { data: tasks } = await supabase.from('tasks').select('chat_id').eq('due_date', today).eq('status', 'pending');
    if(tasks && tasks.length > 0) {
        const users = [...new Set(tasks.map(t => t.chat_id))];
        users.forEach(chatId => {
            bot.sendMessage(chatId, "☀️ <b>Good Morning!</b>\nCheck your app to see your tasks for the day.", { parse_mode: 'HTML' });
        });
    }
}, { timezone: "Africa/Lagos" });
