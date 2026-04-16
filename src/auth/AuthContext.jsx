import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { setUserNamespace } from './userStorage';

const STORAGE_KEY = 'funnel_op_auth_user';
const SESSION_KEY = 'funnel_op_session_token';

try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
        const u = JSON.parse(raw);
        if (u?.email) setUserNamespace(u.email);
    }
} catch {}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(() => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    });

    const [sessionToken, setSessionToken] = useState(() => {
        try {
            return localStorage.getItem(SESSION_KEY) || null;
        } catch {
            return null;
        }
    });

    useEffect(() => {
        try {
            if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
            else localStorage.removeItem(STORAGE_KEY);
        } catch {}
    }, [user]);

    useEffect(() => {
        try {
            if (sessionToken) localStorage.setItem(SESSION_KEY, sessionToken);
            else localStorage.removeItem(SESSION_KEY);
        } catch {}
    }, [sessionToken]);

    // On page load, validate stored session with server
    // If server lost the session (redeploy), clear stale client state
    useEffect(() => {
        if (!sessionToken || !user) return;
        fetch('/api/validate-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken }),
        })
            .then(r => r.json())
            .then(data => {
                if (!data.ok) {
                    console.log('[auth] Stored session no longer valid on server, clearing');
                    setUserNamespace(null);
                    setUser(null);
                    setSessionToken(null);
                }
            })
            .catch(() => {}); // server unreachable, keep local state
    }, []); // run once on mount

    const login = useCallback((u, token) => {
        if (u?.email) setUserNamespace(u.email);
        setUser(u);
        setSessionToken(token || null);
    }, []);

    const logout = useCallback(async () => {
        const token = sessionToken || localStorage.getItem(SESSION_KEY);
        if (token) {
            try {
                await fetch('/api/logout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionToken: token }),
                });
            } catch (e) {
                console.warn('[auth] logout request failed:', e.message);
            }
        }
        setUserNamespace(null);
        setUser(null);
        setSessionToken(null);
    }, [sessionToken]);

    return (
        <AuthContext.Provider value={{ user, sessionToken, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
    return ctx;
}

// WS credential — Supabase username + a RANDOM 4-char suffix persisted in
// sessionStorage. The broker enforces "one active session per LoginId", so
// sharing the same username across apps (Funnel EQ / OP / ROC) must NOT yield
// the same LoginId or the broker kicks sessions in a ping-pong. sessionStorage
// is per-tab: a refresh keeps the suffix (so reconnects don't fight each
// other), but a new tab / different app gets a fresh suffix.
export function buildWsCredential(user) {
    if (!user) return null;
    const name = user.name || (user.email && user.email.split('@')[0]) || 'user';
    const KEY = 'ws_cred_suffix_v1';
    let suffix = null;
    try { suffix = sessionStorage.getItem(KEY); } catch {}
    if (!suffix || suffix.length !== 4) {
        const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
        const rand = new Array(4);
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            const buf = new Uint32Array(4);
            crypto.getRandomValues(buf);
            for (let i = 0; i < 4; i++) rand[i] = alphabet[buf[i] % alphabet.length];
        } else {
            for (let i = 0; i < 4; i++) rand[i] = alphabet[Math.floor(Math.random() * alphabet.length)];
        }
        suffix = rand.join('');
        try { sessionStorage.setItem(KEY, suffix); } catch {}
    }
    return `${name}_${suffix}`;
}
