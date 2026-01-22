const tg = window.Telegram.WebApp;
tg.expand();
const chatId = tg.initDataUnsafe?.user?.id || 'TEST_USER'; 

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('currentDate').innerText = new Date().toDateString();
    document.getElementById('startDate').valueAsDate = new Date();
    loadTasks();
});

async function loadTasks() {
    const res = await fetch(`/api/tasks/${chatId}`);
    const tasks = await res.json();
    const list = document.getElementById('taskList');
    list.innerHTML = '';

    tasks.forEach(task => {
        const div = document.createElement('div');
        div.className = `task-card ${task.status}`;
        
        div.innerHTML = `
            <div class="task-info">
                <span class="task-name">${task.task_name}</span>
                <span class="task-meta">
                    📅 ${task.due_date} &nbsp;|&nbsp; ⏰ ${task.due_time}
                </span>
            </div>
            <div class="actions">
                ${task.status === 'pending' ? `
                <button class="btn-icon done" onclick="updateStatus(${task.id}, 'completed')">✔</button>
                <button class="btn-icon miss" onclick="updateStatus(${task.id}, 'missed')">✖</button>
                ` : ''}
                <button class="btn-icon del" onclick="deleteTask(${task.id})">🗑</button>
            </div>
        `;
        list.appendChild(div);
    });
}

function toggleSeries() {
    const isSeries = document.getElementById('isSeries').checked;
    const div = document.getElementById('seriesInput');
    if(isSeries) div.classList.remove('hidden');
    else div.classList.add('hidden');
}

async function saveTask() {
    const task_name = document.getElementById('taskName').value;
    const start_date = document.getElementById('startDate').value;
    const due_time = document.getElementById('taskTime').value;
    const isSeries = document.getElementById('isSeries').checked;
    const duration = document.getElementById('duration').value;

    if(!task_name || !due_time) return tg.showAlert("Please fill in name and time");

    await fetch('/api/tasks', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            task_name, start_date, due_time, chat_id: chatId,
            type: isSeries ? 'series' : 'single',
            duration
        })
    });

    closeModal();
    loadTasks();
}

async function updateStatus(id, status) {
    await fetch(`/api/tasks/${id}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ status })
    });
    loadTasks();
}

async function deleteTask(id) {
    if(confirm("Delete this task?")) {
        await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
        loadTasks();
    }
}

function openModal() { document.getElementById('modal').style.display = 'flex'; }
function closeModal() { document.getElementById('modal').style.display = 'none'; }
