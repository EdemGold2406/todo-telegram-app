const tg = window.Telegram.WebApp;
tg.expand();

// Simulation for local testing, otherwise use Telegram ID
const chatId = tg.initDataUnsafe?.user?.id || 'TEST_USER'; 

const API_URL = ''; // Leave empty if hosted on same server

// Initial Load
document.addEventListener('DOMContentLoaded', () => {
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    document.getElementById('dateHeader').innerText = today;
    loadTasks();
});

async function loadTasks() {
    const res = await fetch(`${API_URL}/api/tasks/${chatId}`);
    const tasks = await res.json();
    const list = document.getElementById('taskList');
    list.innerHTML = '';

    // Filter to show only pending/completed for TODAY or previous missed
    // For this simple version, we show all returned by API
    
    tasks.forEach(task => {
        const div = document.createElement('div');
        div.className = `task-card ${task.status}`;
        
        // Time Formatting
        const timeParts = task.due_time.split(':');
        const formattedTime = `${timeParts[0]}:${timeParts[1]}`;

        div.innerHTML = `
            <div class="task-info">
                <span class="task-title">${task.task_name}</span>
                <span class="task-time">⏰ ${formattedTime}</span>
            </div>
            <div class="task-actions">
                ${task.status === 'pending' ? `
                <button class="btn-icon btn-done" onclick="updateStatus(${task.id}, 'completed')">✔</button>
                <button class="btn-icon btn-miss" onclick="updateStatus(${task.id}, 'missed')">✖</button>
                ` : ''}
                <button class="btn-icon btn-del" onclick="deleteTask(${task.id})">🗑</button>
            </div>
        `;
        list.appendChild(div);
    });
}

async function saveTask() {
    const name = document.getElementById('taskName').value;
    const time = document.getElementById('taskTime').value;
    
    if(!name || !time) return tg.showAlert("Please fill details");

    const today = new Date().toISOString().split('T')[0];

    await fetch(`${API_URL}/api/tasks`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            task_name: name,
            due_date: today,
            due_time: time,
            chat_id: chatId
        })
    });

    closeModal();
    loadTasks();
}

async function updateStatus(id, status) {
    await fetch(`${API_URL}/api/tasks/${id}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ status })
    });
    loadTasks();
}

async function deleteTask(id) {
    if(confirm('Delete this task?')) {
        await fetch(`${API_URL}/api/tasks/${id}`, { method: 'DELETE' });
        loadTasks();
    }
}

function openModal() { document.getElementById('modal').style.display = 'flex'; }
function closeModal() { document.getElementById('modal').style.display = 'none'; }
