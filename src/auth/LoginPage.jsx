import React, { useState } from 'react';
import { Lock, User, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from './AuthContext';

export default function LoginPage() {
    const { login } = useAuth();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        if (!username.trim() || !password.trim()) {
            setError('Please enter both username and password.');
            return;
        }

        setLoading(true);
        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: username.trim(), password: password.trim() }),
            });
            const data = await res.json();

            if (data.ok) {
                login(
                    {
                        email: data.user.username + '@funnel-op.app',
                        name: data.user.username,
                        picture: null,
                        provider: 'credentials',
                    },
                    data.sessionToken
                );
            } else {
                setError(data.error || 'Login failed.');
            }
        } catch (err) {
            console.error('[login] request failed:', err);
            setError('Could not reach the server. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen w-full bg-[#0a0a0e] text-white flex items-center justify-center p-4">
            <div
                className="absolute inset-0 opacity-[0.03] pointer-events-none"
                style={{
                    backgroundImage:
                        'linear-gradient(rgba(255,255,255,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.5) 1px, transparent 1px)',
                    backgroundSize: '24px 24px',
                }}
            />

            <div className="relative w-full max-w-sm">
                <div className="text-center mb-8">
                    <div className="inline-flex items-center gap-2 mb-4">
                        <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                        <span className="text-[10px] font-black text-blue-400 uppercase tracking-[0.25em]">
                            Live Market Monitor
                        </span>
                    </div>
                    <h1 className="text-6xl md:text-7xl font-black text-white tracking-tight leading-none">
                        FUNNEL
                        <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent"> OP</span>
                    </h1>
                    <p className="text-[13px] text-white/40 mt-4">
                        Sign in to continue
                    </p>
                </div>

                <div className="bg-white/[0.03] border border-white/10 rounded-xl p-6 shadow-2xl">
                    <form onSubmit={handleSubmit} className="space-y-3">
                        <div className="flex items-center gap-2 bg-white/[0.04] border border-white/10 rounded px-3 h-10 focus-within:border-blue-500/40 transition-colors">
                            <User size={14} className="text-white/30 flex-shrink-0" />
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder="Username"
                                autoComplete="username"
                                disabled={loading}
                                className="bg-transparent border-none flex-1 text-[13px] text-white placeholder-white/20 focus:outline-none disabled:opacity-50"
                            />
                        </div>
                        <div className="flex items-center gap-2 bg-white/[0.04] border border-white/10 rounded px-3 h-10 focus-within:border-blue-500/40 transition-colors">
                            <Lock size={14} className="text-white/30 flex-shrink-0" />
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Password"
                                autoComplete="current-password"
                                disabled={loading}
                                className="bg-transparent border-none flex-1 text-[13px] text-white placeholder-white/20 focus:outline-none disabled:opacity-50"
                            />
                        </div>

                        {error && (
                            <div className="flex items-center gap-2 text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
                                <AlertCircle size={12} />
                                <span>{error}</span>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/40 text-blue-300 font-bold py-2.5 rounded text-[12px] uppercase tracking-wider transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <Loader2 size={14} className="animate-spin" />
                                    Signing in...
                                </>
                            ) : (
                                'Sign in'
                            )}
                        </button>
                    </form>
                </div>

                <p className="text-center text-[10px] text-white/25 mt-4">
                    Contact your administrator for access credentials.
                </p>
            </div>
        </div>
    );
}
