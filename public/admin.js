const loginView = document.getElementById('login-view');
const dashView = document.getElementById('dashboard-view');
const passInput = document.getElementById('admin-pass');
const errDisplay = document.getElementById('login-error');

// Check session
if (localStorage.getItem('admin_token')) {
    showDashboard();
}

async function attemptLogin() {
    const password = passInput.value;
    try {
        const res = await fetch('/api/admin/login', {
            method: 'POST',
            body: JSON.stringify({ password })
        });
        const data = await res.json();

        if (data.success) {
            localStorage.setItem('admin_token', data.token);
            showDashboard();
        } else {
            errDisplay.innerText = data.error || 'Access Denied';
            errDisplay.style.display = 'block';
        }
    } catch (e) {
        errDisplay.innerText = 'Connection Error';
        errDisplay.style.display = 'block';
    }
}

function showDashboard() {
    loginView.style.display = 'none';
    dashView.style.display = 'grid'; // Grid layout
    pollStatus();
    setInterval(pollStatus, 2000); // Live updates
}

async function triggerUpdate() {
    const msg = document.getElementById('update-msg');
    msg.innerText = "INITIATING UPDATE SEQUENCE...";
    msg.style.color = "#00ff88";

    try {
        const res = await fetch('/api/admin/update', { method: 'POST' });
        const data = await res.json();
        msg.innerText = (data.message || "UPDATE SEQUENCE STARTED").toUpperCase();
    } catch (e) {
        msg.innerText = "COMMAND FAILED";
        msg.style.color = "#ff4444";
    }
}

async function pollStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();

        // Active
        const activeContainer = document.getElementById('active-job-container');
        if (data.active && data.active.length > 0) {
            const job = data.active[0];
            activeContainer.innerHTML = `
                <div class="dash-stat" style="font-size: 1.5rem; color: #fff;">${job.city.toUpperCase()}</div>
                <div style="color: var(--accent); font-size: 0.9rem; letter-spacing: 0.1em; margin-top:5px;">
                    STATUS: ${job.status.toUpperCase()} <br>
                    INDEXED: ${job.pages_crawled} PAGES
                </div>
            `;
        } else {
            activeContainer.innerHTML = '<div class="dash-stat" style="font-size: 1.2rem; color: #666;">SYSTEM IDLE</div>';
        }

        // Queue
        const list = document.getElementById('queue-list');
        const qCount = document.getElementById('queue-count');

        if (data.queue && data.queue.length > 0) {
            qCount.innerText = `${data.queue.length} PENDING`;
            list.innerHTML = data.queue.map((q, i) => `
                <li class="queue-item ${i === 0 ? 'active' : ''}">
                    <span>
                        <span style="color: #666; margin-right: 10px;">#${q.ticketId}</span>
                        <strong>${q.city}</strong>
                    </span> 
                    <span class="status-badge" style="background: rgba(255,255,255,0.1); color: #888;">WAITING</span>
                </li>
            `).join('');
        } else {
            qCount.innerText = "0 PENDING";
            list.innerHTML = '<div style="text-align: center; padding: 40px 0; color: #444;">No Pending Operations</div>';
        }

    } catch (e) {
        console.warn("Poll failed", e);
    }
}
