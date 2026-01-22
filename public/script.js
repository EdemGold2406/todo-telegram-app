require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const cors = require('cors');
const bodyParser = require('body-parser');
const moment = require('moment-timezone'); 

// --- INTEGATED CREDENTIALS ---
// We have added quotes '' around them to fix the syntax error
const SUPABASE_URL = 'https://kjeggesbrutxgxwdrguz.supabase.co';
const SUPABASE_KEY = 'sb_secret_4V2Cs3uMDJBdd_dMlCp7Sw_i5pJ3HRw';
const TG_TOKEN = '8259244248:AAETfA7KtG13m-K0bKEcSdFn2XTXCA-AyBc';
const TIMEZONE = 'Africa/Lagos'; // WAT

// --- INIT ---
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new TelegramBot(TG_TOKEN, { polling: false });
const app = express();

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// --- API ENDPOINTS ---

// 1. Get Tasks (Sorted by Date and Time)
app.get('/api/tasks/:chatId', async (req, res) => {
    // Get Today's date in WAT
    const today = moment().tz(TIMEZONE).format('YYYY-MM-DD');
    
    // We fetch ALL pending tasks, or completed/missed tasks from TODAY only
    const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('chat_id', req.params.chatId)
        .or(`status.eq.pending,and(status.eq.completed,due_date.eq.${today}),and(status.eq.missed,due_date.eq.${today})`)
        .order('due_date', { ascending: true })
        .order('due_time', { ascending: true });
    
    if (error) return res.status(500).json(error);
    res.json(data);
});

// 2. Add Task (Handles Series Logic)
app.post('/api/tasks', async (req, res) => {
    const { task_name, start_date, due_time, chat_id, type, duration } = req.body;
    
    let tasksToInsert = [];

    if (type === 'series') {
        const days = parseInt(duration) || 1;
        // Generate a task for each day
        for (let i = 0; i < days; i++) {
            const date = moment(start_date).add(i, 'days').format('YYYY-MM-DD');
            tasksToInsert.push({
                task_name: `${task_name} (Day ${i + 1}/${days})`,
                due_date: date,
                due_time: due_time,
                chat_id: chat_id,
                status: 'pending',
                type: 'series'
            });
        }
    } else {
        // Single Task
        tasksToInsert.push({
            task_name,
            due_date: start_date,
            due_time,
            chat_id,
            status: 'pending',
            type: 'single'
        });
    }

    const { error } = await supabase.from('tasks').insert(tasksToInsert);
    
    if (error) return res.status(500).json(error);
    res.json({ success: true, count: tasksToInsert.length });
});

// 3. Update Status
app.put('/api/tasks/:id', async (req, res) => {
    const { status } = req.body;
    const { error } = await supabase.from('tasks').update({ status }).eq('id', req.params.id);
    if (error) return res.status(500).json(error);
    res.json({ success: true });
});

// 4. Delete Task
app.delete('/api/tasks/:id', async (req, res) => {
    const { error } = await supabase.from('tasks').delete().eq('id', req.params.id);
    if (error) return res.status(500).json(error);
    res.json({ success: true });
});

// --- AUTOMATION (CRON JOBS) ---

// JOB 1: Reminders (Every Minute)
cron.schedule('* * * * *', async () => {
    // Get Current Time in WAT
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
            bot.sendMessage(task.chat_id, `🔔 <b>Reminder!</b>\n\nTask: ${task.task_name}\nTime: ${task.due_time}\n\nTap "My Tasks" to mark it done!`, { parse_mode: 'HTML' });
        });
    }
});

// JOB 2: End of Day Review (1 AM WAT)
cron.schedule('0 1 * * *', async () => {
    // Check "Yesterday" in WAT
    const yesterday = moment().tz(TIMEZONE).subtract(1, 'days').format('YYYY-MM-DD');
    const today = moment().tz(TIMEZONE).format('YYYY-MM-DD');

    // Find pending tasks from yesterday
    const { data: missedTasks } = await supabase
        .from('tasks')
        .select('*')
        .eq('due_date', yesterday)
        .eq('status', 'pending');

    if (missedTasks && missedTasks.length > 0) {
        const userGroups = {};
        missedTasks.forEach(t => {
            if (!userGroups[t.chat_id]) userGroups[t.chat_id] = [];
            userGroups[t.chat_id].push(t);
        });

        for (const [chatId, tasks] of Object.entries(userGroups)) {
            // Move to Today
            const ids = tasks.map(t => t.id);
            await supabase.from('tasks').update({ due_date: today }).in('id', ids);

            // Notify
            const names = tasks.map(t => `- ${t.task_name}`).join('\n');
            bot.sendMessage(chatId, `🌙 <b>Review: Missed Tasks</b>\n\nYou didn't finish these yesterday:\n${names}\n\nI have moved them to today. Do not give up! 💪`, { parse_mode: 'HTML' });
        }
    }
}, {
    timezone: "Africa/Lagos"
});

// JOB 3: Good Morning (7 AM WAT)
cron.schedule('0 7 * * *', async () => {
    const today = moment().tz(TIMEZONE).format('YYYY-MM-DD');
    
    const { data: tasks } = await supabase
        .from('tasks')
        .select('chat_id')
        .eq('due_date', today)
        .eq('status', 'pending');

    if(tasks && tasks.length > 0) {
        // Unique users
        const users = [...new Set(tasks.map(t => t.chat_id))];
        users.forEach(chatId => {
            bot.sendMessage(chatId, "☀️ <b>Good Morning!</b>\nCheck your app to see your tasks for the day.", { parse_mode: 'HTML' });
        });
    }
}, {
    timezone: "Africa/Lagos"
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
