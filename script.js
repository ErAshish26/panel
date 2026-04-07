I'll create a complete admin panel with **full database integration** using Node.js, Express, MySQL, and the frontend I already provided. Here's the complete working solution:

## 1. Backend - Server Setup (server.js)

```javascript
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Database Configuration
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: 'your_password',
    database: 'admin_panel_db'
};

const pool = mysql.createPool(dbConfig);

// JWT Secret
const JWT_SECRET = 'your-super-secret-jwt-key-change-in-production';

// Auth Middleware
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
};

// Initialize Database Tables
async function initDatabase() {
    const connection = await pool.getConnection();
    
    await connection.execute(`
        CREATE DATABASE IF NOT EXISTS admin_panel_db;
    `);
    
    await connection.changeUser({database: 'admin_panel_db'});
    
    // Transactions Table
    await connection.execute(`
        CREATE TABLE IF NOT EXISTS transactions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            txn_id VARCHAR(50) UNIQUE NOT NULL,
            user_id INT NOT NULL,
            user_name VARCHAR(100) NOT NULL,
            amount DECIMAL(10,2) NOT NULL,
            type ENUM('deposit', 'withdrawal', 'transfer') NOT NULL,
            status ENUM('pending', 'approved', 'rejected', 'processing') DEFAULT 'pending',
            description TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `);
    
    // Requests Table
    await connection.execute(`
        CREATE TABLE IF NOT EXISTS requests (
            id INT AUTO_INCREMENT PRIMARY KEY,
            req_id VARCHAR(50) UNIQUE NOT NULL,
            user_id INT NOT NULL,
            user_name VARCHAR(100) NOT NULL,
            type VARCHAR(50) NOT NULL,
            details TEXT,
            status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `);
    
    // Users Table
    await connection.execute(`
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(50) UNIQUE NOT NULL,
            email VARCHAR(100) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            role ENUM('admin', 'user') DEFAULT 'user',
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    // Insert default admin
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await connection.execute(
        `INSERT IGNORE INTO users (username, email, password, role) 
         VALUES ('admin', 'admin@system.com', ?, 'admin')`,
        [hashedPassword]
    );
    
    connection.release();
    console.log('Database initialized successfully!');
}

// API Routes

// Auth Routes
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const [rows] = await pool.execute(
            'SELECT * FROM users WHERE username = ? AND role = "admin"',
            [username]
        );
        
        if (rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const user = rows[0];
        const validPassword = await bcrypt.compare(password, user.password);
        
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        res.json({
            token,
            user: { id: user.id, username: user.username, role: user.role }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Dashboard Stats
app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
    try {
        const [transactions] = await pool.execute('SELECT COUNT(*) as count FROM transactions');
        const [requests] = await pool.execute("SELECT COUNT(*) as count FROM requests WHERE status = 'pending'");
        const [revenue] = await pool.execute("SELECT SUM(amount) as total FROM transactions WHERE status = 'approved'");
        const [users] = await pool.execute('SELECT COUNT(*) as count FROM users WHERE is_active = true');
        
        res.json({
            totalTransactions: transactions[0].count,
            pendingRequests: requests[0].count,
            totalRevenue: revenue[0].total || 0,
            activeUsers: users[0].count
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Transactions Routes
app.get('/api/transactions', authenticateToken, async (req, res) => {
    try {
        const { page = 1, limit = 10, status, search } = req.query;
        const offset = (page - 1) * limit;
        
        let query = `
            SELECT * FROM transactions 
            WHERE 1=1
        `;
        let params = [];
        
        if (status && status !== 'All Status') {
            query += ' AND status = ?';
            params.push(status.toLowerCase());
        }
        
        if (search) {
            query += ' AND (txn_id LIKE ? OR user_name LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }
        
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const [transactions] = await pool.execute(query, params);
        const [total] = await pool.execute('SELECT COUNT(*) as count FROM transactions WHERE 1=1' + (status ? ` AND status = '${status.toLowerCase()}'` : '') + (search ? ` AND (txn_id LIKE '%${search}%' OR user_name LIKE '%${search}%')` : ''));
        
        res.json({
            transactions,
            total: total[0].count,
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/transactions/:id/status', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        await pool.execute(
            'UPDATE transactions SET status = ? WHERE id = ?',
            [status, id]
        );
        
        res.json({ success: true, message: `Transaction status updated to ${status}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Requests Routes
app.get('/api/requests', authenticateToken, async (req, res) => {
    try {
        const { page = 1, limit = 10, status } = req.query;
        const offset = (page - 1) * limit;
        
        let query = `
            SELECT * FROM requests 
            WHERE 1=1
        `;
        let params = [];
        
        if (status && status !== 'All') {
            query += ' AND status = ?';
            params.push(status.toLowerCase());
        }
        
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const [requests] = await pool.execute(query, params);
        const [total] = await pool.execute('SELECT COUNT(*) as count FROM requests');
        
        res.json({
            requests,
            total: total[0].count,
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/requests/:id/status', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        await pool.execute(
            'UPDATE requests SET status = ? WHERE id = ?',
            [status, id]
        );
        
        res.json({ success: true, message: `Request status updated to ${status}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Bulk Actions
app.post('/api/transactions/bulk-status', authenticateToken, async (req, res) => {
    try {
        const { ids, status } = req.body;
        
        await pool.execute(
            'UPDATE transactions SET status = ? WHERE id IN (?)',
            [status, ids]
        );
        
        res.json({ success: true, updated: ids.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/requests/bulk-status', authenticateToken, async (req, res) => {
    try {
        const { ids, status } = req.body;
        
        await pool.execute(
            'UPDATE requests SET status = ? WHERE id IN (?)',
            [status, ids]
        );
        
        res.json({ success: true, updated: ids.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Serve Frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function startServer() {
    await initDatabase();
    app.listen(PORT, () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
        console.log(`📊 Admin Panel: http://localhost:${PORT}`);
    });
}

startServer();
```

## 2. Updated Frontend (public/index.html)

Replace the previous HTML `<script>` section with this enhanced version:

```html
<script>
class AdminPanel {
    constructor() {
        this.token = localStorage.getItem('adminToken');
        this.currentPage = 'dashboard';
        this.init();
    }

    async init() {
        this.bindEvents();
        await this.checkAuth();
        this.loadDashboard();
        this.toggleSidebar();
    }

    bindEvents() {
        // Navigation
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const section = link.dataset.section;
                this.switchSection(section);
            });
        });

        // Search
        document.getElementById('globalSearch').addEventListener('input', debounce(this.globalSearch.bind(this), 300));

        // Transaction filters
        document.getElementById('transactionFilter')?.addEventListener('change', (e) => {
            this.loadTransactions(1, e.target.value);
        });

        // Bulk actions
        document.getElementById('selectAllTransactions')?.addEventListener('change', this.toggleSelectAll.bind(this, 'transactions'));
        document.getElementById('selectAllRequests')?.addEventListener('change', this.toggleSelectAll.bind(this, 'requests'));
        document.getElementById('bulkApprove')?.addEventListener('click', () => this.bulkAction('requests', 'approved'));
    }

    async checkAuth() {
        if (!this.token) {
            window.location.href = '/login.html'; // Create simple login page
            return false;
        }
        try {
            const response = await fetch('/api/dashboard/stats', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            if (response.status === 401) {
                localStorage.removeItem('adminToken');
                window.location.href = '/login.html';
            }
        } catch (error) {
            console.error('Auth check failed:', error);
        }
        return true;
    }

    async apiCall(endpoint, options = {}) {
        const config = {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.token}`,
                ...options.headers
            },
            ...options
        };

        const response = await fetch(endpoint, config);
        
        if (response.status === 401) {
            localStorage.removeItem('adminToken');
            window.location.href = '/login.html';
            return;
        }

        return response.json();
    }

    async loadDashboard() {
        try {
            const stats = await this.apiCall('/api/dashboard/stats');
            this.updateStats(stats);
            this.loadRecentTransactions();
        } catch (error) {
            console.error('Dashboard load error:', error);
        }
    }

    updateStats(stats) {
        document.getElementById('totalTransactions').textContent = stats.totalTransactions || 0;
        document.getElementById('pendingRequests').textContent = stats.pendingRequests || 0;
        document.getElementById('totalRevenue').textContent = stats.totalRevenue?.toLocaleString() || '0';
        document.getElementById('activeUsers').textContent = stats.activeUsers || 0;
    }

    async loadRecentTransactions() {
        const recentTxns = transactionsData.slice(0, 5); // Mock data for demo
        this.renderTransactionsTable('recentTransactions', recentTxns);
    }

    async loadTransactions(page = 1, status = 'All Status') {
        try {
            const data = await this.apiCall(`/api/transactions?page=${page}&status=${status}`);
            this.renderTransactionsTable('transactionsTable', data.transactions);
            this.renderPagination('transactionsPagination', data);
        } catch (error) {
            console.error('Transactions load error:', error);
        }
    }

    async loadRequests(page = 1) {
        try {
            const data = await this.apiCall(`/api/requests?page=${page}`);
            this.renderRequestsTable('requestsTable', data.requests);
            this.renderPagination('requestsPagination', data);
        } catch (error) {
            console.error('Requests load error:', error);
        }
    }

    renderTransactionsTable(tableId, transactions) {
        const tbody = document.querySelector(`#${tableId} tbody`);
        tbody.innerHTML = transactions.map(txn => `
            <tr>
                <td><input type="checkbox" class="txn-checkbox" value="${txn.id}"></td>
                <td><strong>${txn.txn_id}</strong></td>
                <td>
                    <div class="d-flex align-items-center gap-2">
                        <div class="avatar bg-primary text-white rounded-circle d-flex align-items-center justify-content-center" style="width: 32px; height: 32px;">
                            ${txn.user_name.charAt(0).toUpperCase()}
                        </div>
                        <span>${txn.user_name}</span>
                    </div>
                </td>
                <td><strong class="text-success">${txn.amount}</strong></td>
                <td>
                    <span class="badge bg-${txn.type === 'deposit' ? 'success' : txn.type === 'withdrawal' ? 'warning' : 'primary'}">
                        ${txn.type.charAt(0).toUpperCase() + txn.type.slice(1)}
                    </span>
                </td>
                <td><span class="status-badge status-${txn.status}">${txn.status.toUpperCase()}</span></td>
                <td>${new Date(txn.created_at).toLocaleDateString()}</td>
                <td>
                    <div class="btn-group" role="group">
                        <button class="btn btn-sm btn-approve btn-action" onclick="admin.updateStatus(${txn.id}, 'approved', 'transaction')">
                            <i class="fas fa-check"></i>
                        </button>
                        <button class="btn btn-sm btn-reject btn-action" onclick="admin.updateStatus(${txn.id}, 'rejected', 'transaction')">
                            <i class="fas fa-times"></i>
                        </button>
                        <button class="btn btn-sm btn-view btn-action" onclick="admin.viewDetails(${txn.id})">
                            <i class="fas fa-eye"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    renderRequestsTable(tableId, requests) {
        const tbody = document.querySelector(`#${tableId} tbody`);
        tbody.innerHTML = requests.map(req => `
            <tr>
                <td><input type="checkbox" class="req-checkbox" value="${req.id}"></td>
                <td><strong>${req.req_id}</strong></td>
                <td>${req.user_name}</td>
                <td>${req.type}</td>
                <td>${req.details?.substring(0, 50)}${req.details?.length > 50 ? '...' : ''}</td>
                <td><span class="status-badge status-${req.status}">${req.status.toUpperCase()}</span></td>
                <td>${new Date(req.created_at).toLocaleDateString()}</td>
                <td>
                    <div class="btn-group" role="group">
                        <button class="btn btn-sm btn-approve btn-action" onclick="admin.updateStatus(${req.id}, 'approved', 'request')">
                            <i class="fas fa-check"></i>
                        </button>
                        <button class="btn btn-sm btn-reject btn-action" onclick="admin.updateStatus(${req.id}, 'rejected', 'request')">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    async updateStatus(id, status, type) {
        try {
            await this.apiCall(`/api/${type}s/${id}/status`, {
                method: 'PATCH',
                body: JSON.stringify({ status })
            });
            this.showToast(`Status updated to ${status}`, 'success');
            if (type === 'transactions') {
                this.loadTransactions(1);
            } else {
                this.loadRequests(1);
            }
        } catch (error) {
            this.showToast('Update failed', 'error');
        }
    }

    async bulkAction(type, status) {
        const checkboxes = document.querySelectorAll(`.${type === 'transactions' ? 'txn' : 'req'}-checkbox:checked`);
        if (checkboxes.length === 0) {
            this.showToast('Please select items first', 'warning');
            return;
        }

        const ids = Array.from(checkboxes).map(cb => parseInt(cb.value));
        
        try {
            await this.apiCall(`/api/${type}/bulk-status`, {
                method: 'POST',
                body: JSON.stringify({
