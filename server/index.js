import express from 'express';
import http from 'http';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3001;
const UPSTREAM_WS = process.env.UPSTREAM_WS || 'ws://115.242.15.134:19101';
const DIST_DIR = path.resolve(__dirname, '..', 'dist');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

// ===================== SESSION TRACKING =====================
const activeSessions = new Map();

function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

// ===================== SUPABASE HELPER =====================
async function validateCredentials(username, password) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        console.error('[auth] SUPABASE_URL or SUPABASE_SERVICE_KEY not configured');
        return { ok: false, error: 'Server auth not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars.' };
    }

    try {
        const url = `${SUPABASE_URL}/rest/v1/app_users?username=eq.${encodeURIComponent(username)}&is_active=eq.true&select=username,password`;
        console.log(`[auth] Querying Supabase for user: ${username}`);

        const res = await fetch(url, {
            headers: {
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
                'Content-Type': 'application/json',
            },
        });

        if (!res.ok) {
            const body = await res.text();
            console.error(`[auth] Supabase query failed: ${res.status} ${body}`);
            return { ok: false, error: 'Authentication service unavailable.' };
        }

        const rows = await res.json();
        console.log(`[auth] Supabase returned ${rows.length} row(s) for user: ${username}`);

        if (rows.length === 0) {
            return { ok: false, error: 'Invalid username or password.' };
        }

        const user = rows[0];
        if (user.password !== password) {
            console.log(`[auth] Password mismatch for user: ${username}`);
            return { ok: false, error: 'Invalid username or password.' };
        }

        return { ok: true, user: { username: user.username } };
    } catch (err) {
        console.error(`[auth] Supabase request error:`, err.message);
        return { ok: false, error: 'Authentication service error. Try again.' };
    }
}

// ===================== EXPRESS APP =====================
const app = express();
app.use(express.json());
app.use(express.static(DIST_DIR));

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body || {};
    console.log(`[auth] Login attempt: username=${username}`);

    if (!username || !password) {
        return res.json({ ok: false, error: 'Username and password are required.' });
    }

    const result = await validateCredentials(username, password);
    if (!result.ok) {
        console.log(`[auth] Login REJECTED for ${username}: ${result.error}`);
        return res.json(result);
    }

    const existing = activeSessions.get(username);
    if (existing) {
        console.log(`[auth] Replacing existing session for ${username}`);
        activeSessions.delete(username);
    }

    const sessionToken = generateSessionToken();
    activeSessions.set(username, { sessionToken, connectedAt: Date.now() });
    console.log(`[auth] Login SUCCESS for ${username} (active sessions: ${activeSessions.size})`);

    return res.json({ ok: true, user: result.user, sessionToken });
});

app.post('/api/logout', (req, res) => {
    const { sessionToken } = req.body || {};
    if (!sessionToken) return res.json({ ok: false, error: 'No session token provided.' });

    for (const [username, session] of activeSessions) {
        if (session.sessionToken === sessionToken) {
            activeSessions.delete(username);
            console.log(`[auth] Logout SUCCESS for ${username} (active sessions: ${activeSessions.size})`);
            break;
        }
    }
    return res.json({ ok: true });
});

app.get('/api/active-sessions', (req, res) => {
    const sessions = [];
    for (const [username, session] of activeSessions) {
        sessions.push({
            username,
            connectedAt: new Date(session.connectedAt).toISOString(),
            durationMin: Math.round((Date.now() - session.connectedAt) / 60000),
        });
    }
    return res.json({ count: sessions.length, sessions });
});

app.post('/api/validate-session', (req, res) => {
    const { sessionToken } = req.body || {};
    if (!sessionToken) return res.json({ ok: false });
    for (const [username, session] of activeSessions) {
        if (session.sessionToken === sessionToken) {
            return res.json({ ok: true, user: { username } });
        }
    }
    return res.json({ ok: false });
});

app.post('/api/force-logout', (req, res) => {
    const { username } = req.body || {};
    if (!username) return res.json({ ok: false, error: 'Username required.' });
    if (activeSessions.has(username)) {
        activeSessions.delete(username);
        console.log(`[auth] Force-logout SUCCESS for ${username}`);
        return res.json({ ok: true, message: `${username} has been logged out.` });
    }
    return res.json({ ok: false, error: `${username} has no active session.` });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
});

// ===================== WEBSOCKET PROXY =====================
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

let connectionId = 0;

wss.on('connection', (client, req) => {
    const id = ++connectionId;
    const remote = req.socket.remoteAddress;
    console.log(`[ws-proxy #${id}] client connected from ${remote}, opening upstream -> ${UPSTREAM_WS}`);

    const upstream = new WebSocket(UPSTREAM_WS);
    const pending = [];
    let upstreamReady = false;
    let upstreamMsgCount = 0;
    const upstreamMsgTypes = {};

    const safeClose = (code, reason) => {
        try { client.close(code, reason); } catch {}
        try { upstream.close(code, reason); } catch {}
    };

    upstream.on('open', () => {
        upstreamReady = true;
        console.log(`[ws-proxy #${id}] upstream OPEN, flushing ${pending.length} pending frame(s)`);
        for (const frame of pending) {
            try { upstream.send(frame); } catch (e) { console.warn(`[ws-proxy #${id}] flush failed`, e.message); }
        }
        pending.length = 0;
    });

    upstream.on('message', (data) => {
        upstreamMsgCount++;
        const text = typeof data === 'string' ? data : data.toString('utf8');
        if (upstreamMsgCount <= 5 || upstreamMsgCount % 100 === 0) {
            try {
                const parsed = JSON.parse(text);
                upstreamMsgTypes[parsed.Type] = (upstreamMsgTypes[parsed.Type] || 0) + 1;
                console.log(`[ws-proxy #${id}] upstream msg #${upstreamMsgCount} type=${parsed.Type}`);
            } catch {}
        } else {
            try { const p = JSON.parse(text); upstreamMsgTypes[p.Type] = (upstreamMsgTypes[p.Type] || 0) + 1; } catch {}
        }
        if (client.readyState === WebSocket.OPEN) {
            client.send(text);
        }
    });

    upstream.on('close', (code, reason) => {
        console.log(`[ws-proxy #${id}] upstream CLOSED code=${code} (${upstreamMsgCount} msgs, types: ${JSON.stringify(upstreamMsgTypes)})`);
        safeClose(code, reason);
    });

    upstream.on('error', (err) => {
        console.warn(`[ws-proxy #${id}] upstream ERROR: ${err.message}`);
        safeClose(1011, 'upstream error');
    });

    client.on('message', (data) => {
        const text = typeof data === 'string' ? data : data.toString('utf8');
        if (upstreamReady && upstream.readyState === WebSocket.OPEN) {
            try { upstream.send(text); } catch (e) { console.warn(`[ws-proxy #${id}] forward failed: ${e.message}`); }
        } else {
            pending.push(text);
        }
    });

    client.on('close', (code, reason) => {
        console.log(`[ws-proxy #${id}] client CLOSED code=${code}`);
        safeClose(code, reason);
    });

    client.on('error', (err) => {
        console.warn(`[ws-proxy #${id}] client ERROR: ${err.message}`);
        safeClose(1011, 'client error');
    });
});

server.listen(PORT, async () => {
    console.log(`[server] listening on :${PORT}`);
    console.log(`[server] static dir: ${DIST_DIR}`);
    console.log(`[server] ws proxy:   /ws -> ${UPSTREAM_WS}`);
    console.log(`[server] supabase configured: ${!!(SUPABASE_URL && SUPABASE_SERVICE_KEY)}`);

    try {
        const res = await fetch('https://api.ipify.org');
        const ip = await res.text();
        console.log(`[server] outbound IP: ${ip}  <-- WHITELIST THIS AT THE BROKER`);
    } catch (e) {
        console.warn('[server] could not resolve outbound IP:', e.message);
    }
});
