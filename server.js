const express = require('express');
const Airtable = require('airtable');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(bodyParser.json());
app.use(cors());
app.use(express.static('public')); // Serves the HTML file

// CONFIGURE AIRTABLE HERE
// (In production, use Environment Variables, but for now paste here)
const base = new Airtable({apiKey: 'patD2Ikeh73fCcDn3.3fd3f3cbfa2b5c912f59b988612e814931125012452f908e6fec03e8ddb7eea0'}).base('appsx3vKrvNFXmLoq');

// API: Get Tasks for a User
app.get('/api/tasks/:chatId', (req, res) => {
    const chatId = req.params.chatId;
    // Look for tasks where Chat ID matches and Status is Pending
    base('Daily_Tasks').select({
        filterByFormula: `AND({chat_ID} = '${chatId}', {Status} = 'Pending')`
    }).firstPage((err, records) => {
        if (err) { console.error(err); return res.status(500).send(err); }
        
        const tasks = records.map(record => ({
            id: record.id,
            name: record.get('Task Name'),
            time: record.get('Due Time'),
            date: record.get('Due Date')
        }));
        res.json(tasks);
    });
});

// API: Add Task
app.post('/api/tasks', (req, res) => {
    const { taskName, date, time, chatId, type, duration } = req.body;

    if (type === 'series') {
        // Add to Series Table
        base('Series_Rules').create([{
            "fields": {
                "Series Name": taskName,
                "Start Date": date,
                "Duration": parseInt(duration),
                "Daily Time": time,
                "Status": "Active",
                "chat_ID": chatId
            }
        }], (err) => {
            if (err) return res.status(500).send(err);
            res.json({ success: true, message: "Series Started" });
        });
    } else {
        // Add to Daily Tasks
        base('Daily_Tasks').create([{
            "fields": {
                "Task Name": taskName,
                "Due Date": date,
                "Due Time": time,
                "Status": "Pending",
                "Source": "Manual",
                "chat_ID": chatId
            }
        }], (err) => {
            if (err) return res.status(500).send(err);
            res.json({ success: true, message: "Task Added" });
        });
    }
});

// API: Delete Task
app.delete('/api/tasks/:id', (req, res) => {
    base('Daily_Tasks').destroy([req.params.id], (err) => {
        if (err) return res.status(500).send(err);
        res.json({ success: true });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));