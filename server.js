require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const cors = require('cors');
const bodyParser = require('body-parser');

// --- CONFIGURATION ---
// In production, put these in Render Environment Variables
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kjeggesbrutxgxwdrguz.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_secret_4V2Cs3uMDJBdd_dMlCp7Sw_i5pJ3HRw';
const TG_TOKEN = process.env.TG_TOKEN || '8259244248:AAETfA7KtG13m-K0bKEcSdFn2XTXCA-AyBc';

// --- INITIALIZATION ---
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new TelegramBot(TG_TOKEN, { polling: false }); // Webhook not needed for push messages
const app = express();

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// --- API ENDPOINTS FOR WEB APP ---

// 1. Get Tasks for User
app.get('/api/tasks/:chatId', async (req, res) => {
    const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('chat_id', req.params.chatId)
        .order('due_time', { ascending: true });
    
    if (error) return res.status(500).json(error);
    res.json(data);
});

// 2. Add New Task
app.post('/api/tasks', async (req, res) => {
    const { task_name, due_date, due_time, chat_id } = req.body;
    const { data, error } = await supabase
        .from('tasks')
        .insert([{ task_name, due_date, due_time, chat_id, status: 'pending' }]);
    
    if (error) return res.status(500).json(error);
    res.json({ success: true });
});

// 3. Update Task Status (Green/Red Tick)
app.put('/api/tasks/:id', async (req, res) => {
    const { status } = req.body;
    const { error } = await supabase
        .from('tasks')
        .update({ status })
        .eq('id', req.params.id);
    
    if (error) return res.status(500).json(error);
    res.json({ success: true });
});

// 4. Delete Task
app.delete('/api/tasks/:id', async (req, res) => {
    const { error } = await supabase.from('tasks').delete().eq('id', req.params.id);
    if (error) return res.status(500).json(error);
    res.json({ success: true });
});


// --- CRON JOBS (THE AUTOMATION) ---

// JOB 1: Reminders (Runs every minute)
cron.schedule('* * * * *', async () => {
    const now = new Date();
    // Format current time to HH:MM:00 for comparison
    const timeString = now.toTimeString().split(' ')[0].substring(0, 5); // "14:30"
    const dateString = now.toISOString().split('T')[0]; // "2026-01-22"

    // Find pending tasks due right now
    const { data: tasks } = await supabase
        .from('tasks')
        .select('*')
        .eq('due_date', dateString)
        .eq('due_time', timeString)
        .eq('status', 'pending');

    if (tasks && tasks.length > 0) {
        tasks.forEach(task => {
            bot.sendMessage(task.chat_id, `⏰ <b>It's time!</b>\n\nTask: <b>${task.task_name}</b>\n\nOpen the app to mark it done.`, { parse_mode: 'HTML' });
        });
    }
});

// JOB 2: Good Morning (Runs at 7:00 AM)
cron.schedule('0 7 * * *', async () => {
    // Get unique users with tasks today
    const dateString = new Date().toISOString().split('T')[0];
    const { data: tasks } = await supabase
        .from('tasks')
        .select('chat_id, task_name')
        .eq('due_date', dateString);

    // Group tasks by user
    const userTasks = {};
    tasks.forEach(t => {
        if (!userTasks[t.chat_id]) userTasks[t.chat_id] = [];
        userTasks[t.chat_id].push(t.task_name);
    });

    // Send messages
    for (const [chatId, taskList] of Object.entries(userTasks)) {
        bot.sendMessage(chatId, `☀️ <b>Good Morning!</b>\n\nYou have ${taskList.length} tasks scheduled for today.\nLet's get them done! 💪`, { parse_mode: 'HTML' });
    }
});

// JOB 3: 1 AM Review & Rollover (Runs at 01:00 AM)
cron.schedule('0 1 * * *', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    const todayStr = new Date().toISOString().split('T')[0];

    // Find tasks from "Yesterday" that are NOT completed
    const { data: missedTasks } = await supabase
        .from('tasks')
        .select('*')
        .eq('due_date', yesterdayStr)
        .neq('status', 'completed');

    if (missedTasks && missedTasks.length > 0) {
        // Group by user
        const userMissed = {};
        missedTasks.forEach(t => {
            if (!userMissed[t.chat_id]) userMissed[t.chat_id] = [];
            userMissed[t.chat_id].push(t);
        });

        for (const [chatId, tasks] of Object.entries(userMissed)) {
            // 1. Move dates to Today
            const ids = tasks.map(t => t.id);
            await supabase
                .from('tasks')
                .update({ due_date: todayStr, status: 'pending' })
                .in('id', ids);

            // 2. Send Report
            const taskNames = tasks.map(t => `- ${t.task_name}`).join('\n');
            bot.sendMessage(chatId, `🌙 <b>End of Day Review</b>\n\nI noticed you didn't mark these as done:\n${taskNames}\n\nI've moved them to today for you. Try to clear them!`, { parse_mode: 'HTML' });
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`To-Do Bot Server running on port ${PORT}`));
