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

export function buildWsCredential(user) {
    if (!user) return null;
    const name = user.name || (user.email && user.email.split('@')[0]) || 'user';
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
    }
    const suffix = Math.abs(hash).toString(36).slice(0, 4).padEnd(4, '0');
    return `${name}_${suffix}`;
}
