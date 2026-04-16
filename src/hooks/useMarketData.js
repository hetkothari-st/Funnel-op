import { useState, useEffect, useCallback, useRef } from 'react';

const resolveWsUrl = () => {
    const envUrl = import.meta.env?.VITE_WS_URL;
    if (envUrl) {
        if (/^https?:\/\//i.test(envUrl)) {
            const u = new URL(envUrl);
            const scheme = u.protocol === 'https:' ? 'wss:' : 'ws:';
            const path = u.pathname && u.pathname !== '/' ? u.pathname : '/ws';
            return `${scheme}//${u.host}${path}`;
        }
        return envUrl;
    }
    if (typeof window !== 'undefined' && window.location) {
        const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${scheme}//${window.location.host}/ws`;
    }
    return 'ws://115.242.15.134:19101';
};

const WS_URL = resolveWsUrl();

export const useMarketData = (enabled = true, onMessage = null, onDepthPacket = null, wsCredential = null) => {
    const [status, setStatus] = useState('disconnected');
    const [depthData, setDepthData] = useState({});

    const ws = useRef(null);
    const hbInterval = useRef(null);
    const reconnectTimeout = useRef(null);
    const syncInterval = useRef(null);
    const handshakeTimeout = useRef(null);
    const onMessageRef = useRef(onMessage);
    const onDepthPacketRef = useRef(onDepthPacket);
    const enabledRef = useRef(enabled);
    const wsCredentialRef = useRef(wsCredential);
    const isLoggedIn = useRef(false);
    const isReady = useRef(false);
    const pendingSubs = useRef([]);

    // Data Buffers to prevent "React Storms"
    const depthBuffer = useRef({});
    const lastUpdate = useRef(0);
    const packetRates = useRef({});
    const lastTelemetry = useRef(Date.now());

    // Track message stats for diagnostics
    const msgCountRef = useRef(0);
    const msgTypesRef = useRef({});

    // Keep refs updated
    useEffect(() => {
        onMessageRef.current = onMessage;
        onDepthPacketRef.current = onDepthPacket;
        enabledRef.current = enabled;
        wsCredentialRef.current = wsCredential;
    }, [onMessage, onDepthPacket, enabled, wsCredential]);

    const connect = useCallback(() => {
        // Always reset session flags so the NEW socket is guaranteed to go
        // through activation (send TokenRequest on first msg). Without this,
        // if the old socket's onclose never fires (we just nulled it below),
        // isReady stays true and the new connection silently skips
        // resubscribing — only broadcast IndexData flows and stock MarketData
        // never arrives.
        isReady.current = false;
        isLoggedIn.current = false;

        if (ws.current) {
            ws.current.onclose = null;
            ws.current.close();
        }

        console.log('[WS] Connecting to:', WS_URL);
        setStatus('connecting');
        ws.current = new WebSocket(WS_URL);

        ws.current.onopen = () => {
            console.log('[WS] WebSocket OPEN — sending Login...');
            setStatus('connected');
            msgCountRef.current = 0;
            msgTypesRef.current = {};
            const cred = wsCredentialRef.current || `anon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
            const loginPayload = { Type: "Login", Data: { LoginId: cred, Password: cred } };
            console.log('[WS] Login payload:', JSON.stringify(loginPayload));
            ws.current.send(JSON.stringify(loginPayload));
        };

        ws.current.onmessage = (event) => {
            try {
                // Log raw event.data type for first message (binary vs string diagnostic)
                msgCountRef.current++;
                if (msgCountRef.current === 1) {
                    console.log('[WS] First message received — data type:', typeof event.data,
                        event.data instanceof Blob ? '(Blob)' : '(string)',
                        'length:', event.data.length || event.data.size);
                }

                const msg = JSON.parse(event.data);
                const { Type, Data } = msg;

                // Track message type counts
                msgTypesRef.current[Type] = (msgTypesRef.current[Type] || 0) + 1;

                // Log first 5 messages in detail, then summary every 100
                if (msgCountRef.current <= 5) {
                    console.log(`[WS] msg #${msgCountRef.current} type=${Type}`, Type === 'Login' ? JSON.stringify(Data) : '');
                } else if (msgCountRef.current % 100 === 0) {
                    console.log(`[WS] msg #${msgCountRef.current} — totals:`, JSON.stringify(msgTypesRef.current));
                }

                // ---------- Activate session on first usable message ----------
                if (!isReady.current) {
                    if (Type === 'Login' && Data?.Error) {
                        console.error('[WS] LOGIN FAILED:', Data.Error);
                        return;
                    }
                    console.log('[WS] Session ACTIVE (triggered by msg type:', Type + ')');
                    isLoggedIn.current = true;
                    isReady.current = true;

                    const activeQuotes = Array.from(activeSubscriptions.current.values());
                    const freshQuotes = pendingSubs.current.flat().filter(q =>
                        !activeSubscriptions.current.has(String(q.Tkn))
                    );
                    console.log('[WS] Pending subscriptions:', freshQuotes.length, '| Active (restore):', activeQuotes.length);

                    const allTokens = [...activeQuotes, ...freshQuotes];
                    const depthTokens = allTokens.filter(
                        q => q.Xchg === 'NSEFO' || q.Xchg === 'BSEFO'
                    );

                    const indexTokens = [
                        { Tkn: '26000', Xchg: 'NSE' },
                        { Tkn: '26009', Xchg: 'NSE' },
                        { Tkn: '1', Xchg: 'BSE' },
                        ...allTokens.filter(q => ['NSE', 'BSE', 'NSECM', 'BSECM'].includes(q.Xchg))
                    ].filter((v, i, a) => a.findIndex(t => t.Tkn === v.Tkn && t.Xchg === v.Xchg) === i);

                    if (depthTokens.length > 0) {
                        const payload = { Type: "TokenRequest", Data: { SubType: true, FeedType: 2, quotes: depthTokens } };
                        ws.current.send(JSON.stringify(payload));
                        console.log('[WS] Sent Depth sub (FT2):', depthTokens.length, 'tokens');
                        depthTokens.forEach(q => activeSubscriptions.current.set(String(q.Tkn), q));
                    }

                    if (indexTokens.length > 0) {
                        const payload = { Type: "TokenRequest", Data: { SubType: true, FeedType: 1, quotes: indexTokens } };
                        ws.current.send(JSON.stringify(payload));
                        console.log('[WS] Sent Index/Touchline sub (FT1):', indexTokens.length, 'tokens:', indexTokens.map(t => t.Tkn));
                        indexTokens.forEach(q => activeSubscriptions.current.set(String(q.Tkn), q));
                    }

                    console.log('[WS] Total active subscriptions:', activeSubscriptions.current.size);
                    pendingSubs.current = [];

                    if (hbInterval.current) clearInterval(hbInterval.current);
                    hbInterval.current = setInterval(() => {
                        if (ws.current?.readyState === WebSocket.OPEN) {
                            ws.current.send(JSON.stringify({
                                Type: "Info",
                                Data: { InfoType: "HB", InfoMsg: "Heartbeat" }
                            }));
                        }
                    }, 3000);

                    if (Type === 'Login') return;
                }

                // 2. Buffer Depth & Index Data
                if ((Type === 'Depth' || Type === 'DepthData' || Type === 'IndexData') && Data) {

                    // Normalize Data to Array for uniform processing
                    const packets = Array.isArray(Data) ? Data : [Data];

                    packets.forEach(packet => {
                        let token = packet.Tkn || packet.Token;

                        // IndexData usually has Symbol but no Token. Map them back.
                        if (!token && Type === 'IndexData' && packet.Symbol) {
                            const sym = packet.Symbol.toUpperCase();
                            if (sym === 'NIFTY50' || sym === 'NIFTY 50') token = '26000';
                            if (sym === 'NIFTYBANK' || sym === 'BANKNIFTY') token = '26009';
                            if (sym === 'SENSEX') token = '1';
                        }

                        if (token) {
                            const tknStr = String(token);
                            lastPacketTimes.current.set(tknStr, Date.now());
                            depthBuffer.current[tknStr] = {
                                ...packet,
                                _type: Type, // Help UI distinguish
                                _receivedAt: Date.now()
                            };

                            // Direct Audio Link (only for Depth)
                            if ((Type === 'Depth' || Type === 'DepthData') && onDepthPacketRef.current) {
                                onDepthPacketRef.current(packet);
                            }

                            // Telemetry tracking
                            packetRates.current[tknStr] = (packetRates.current[tknStr] || 0) + 1;
                        }
                    });
                    return;
                }

                // 3. Telemetry Log every 5 seconds
                if (Date.now() - lastTelemetry.current > 5000) {
                    const stats = packetRates.current;
                    const total = Object.values(stats).reduce((a, b) => a + b, 0);
                    if (total > 0) {
                        console.log('[WS] 5s Traffic Report:', JSON.stringify(stats));
                    }
                    packetRates.current = {};
                    lastTelemetry.current = Date.now();
                }

                // 3. Early ignore for high-volume packets
                const ignoredTypes = ['Touchline', 'Quote'];
                if (ignoredTypes.includes(Type)) return;

                // 4. User callback for management pulses
                if (onMessageRef.current) onMessageRef.current(Type, Data);

            } catch (err) {
                console.error('WS Message Error:', err);
            }
        };

        ws.current.onclose = (event) => {
            console.warn(`[WS] Closed: ${event.code} - ${event.reason || 'Abnormal Closure'}`);
            setStatus('disconnected');
            isLoggedIn.current = false;
            isReady.current = false;

            if (hbInterval.current) clearInterval(hbInterval.current);
            if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
            if (handshakeTimeout.current) clearTimeout(handshakeTimeout.current);

            if (enabledRef.current) {
                // Modifying aggressive reconnect to prevent 1006 loops/bans
                console.warn('[WS] Reconnecting (2000ms)...');
                reconnectTimeout.current = setTimeout(connect, 2000);
            }
        };

        ws.current.onerror = () => setStatus('error');

    }, []); // Only create connect once

    // Watchdog State
    const activeSubscriptions = useRef(new Map()); // Map<TokenID, QuoteObject>
    const lastPacketTimes = useRef(new Map());     // Map<TokenID, Timestamp>
    const watchdogInterval = useRef(null);

    // Watchdog Interval
    useEffect(() => {
        if (!enabled) return;

        watchdogInterval.current = setInterval(() => {
            if (ws.current?.readyState !== WebSocket.OPEN) return;
            if (activeSubscriptions.current.size === 0) return;

            const now = Date.now();
            const staleQuotes = [];

            activeSubscriptions.current.forEach((quote, tkn) => {
                const lastTime = lastPacketTimes.current.get(String(tkn)) || 0;
                if (now - lastTime > 30000) { // Relax watchdog to 30s
                    staleQuotes.push(quote);
                    lastPacketTimes.current.set(String(tkn), now);
                }
            });

            if (staleQuotes.length > 0 && isReady.current) {
                // Split stale quotes by their ORIGINAL FeedType. NSEFO/BSEFO
                // were subscribed as FT2 (Depth); everything else (NSE/BSE
                // cash + indices) was subscribed as FT1 (Touchline/Index).
                // Sending all of them on FT2 was overwriting the FT1 stream
                // and silently killing MarketData for the stock list.
                const depthStale = staleQuotes.filter(q => q.Xchg === 'NSEFO' || q.Xchg === 'BSEFO');
                const indexStale = staleQuotes.filter(q => q.Xchg !== 'NSEFO' && q.Xchg !== 'BSEFO');
                console.warn('[WS] Watchdog resubscribing to stale tokens:', staleQuotes.length,
                    `(FT1: ${indexStale.length}, FT2: ${depthStale.length})`);
                if (indexStale.length > 0) {
                    ws.current.send(JSON.stringify({
                        Type: "TokenRequest",
                        Data: { SubType: true, FeedType: 1, quotes: indexStale }
                    }));
                }
                if (depthStale.length > 0) {
                    ws.current.send(JSON.stringify({
                        Type: "TokenRequest",
                        Data: { SubType: true, FeedType: 2, quotes: depthStale }
                    }));
                }
            }
        }, 5000);

        return () => clearInterval(watchdogInterval.current);
    }, [enabled]);

    // Subscribe Function
    const subscribe = useCallback((quotes, feedType = 2) => {
        // 1. Track locally for persistence/watchdog
        quotes.forEach(q => {
            const tknStr = String(q.Tkn);
            activeSubscriptions.current.set(tknStr, q);
            lastPacketTimes.current.set(tknStr, Date.now());
        });

        // 2. Send if ready, otherwise queue
        if (ws.current?.readyState === WebSocket.OPEN && isReady.current) {
            const payload = {
                Type: "TokenRequest",
                Data: { SubType: true, FeedType: feedType, quotes }
            };
            console.log('[WS] Outbound Direct:', JSON.stringify(payload));
            ws.current.send(JSON.stringify(payload));
        } else {
            console.log('[WS] Connection not ready, queueing subscription:', quotes.length);
            pendingSubs.current.push(quotes);
        }
    }, []);

    // Data Sync Loop (Phase 3)
    useEffect(() => {
        if (!enabled) return;

        syncInterval.current = setInterval(() => {
            const hasDepth = Object.keys(depthBuffer.current).length > 0;

            if (hasDepth) {
                // IMPORTANT: Capture buffer snapshot BEFORE clearing it
                // React's functional updates are async, so clearing it immediately
                // would result in an empty merge if we don't capture it.
                const bufferSnapshot = { ...depthBuffer.current };
                depthBuffer.current = {};

                setDepthData(prev => ({
                    ...prev,
                    ...bufferSnapshot
                }));
            }
        }, 50);

        return () => clearInterval(syncInterval.current);
    }, [enabled]);

    // Init Effect
    useEffect(() => {
        if (enabled) {
            connect();
        } else {
            if (ws.current) {
                ws.current.close();
                ws.current = null;
            }
            if (reconnectTimeout.current) {
                clearTimeout(reconnectTimeout.current);
                reconnectTimeout.current = null;
            }
            setStatus('disconnected');
        }
        return () => {
            if (ws.current) ws.current.close();
            if (hbInterval.current) clearInterval(hbInterval.current);
            if (watchdogInterval.current) clearInterval(watchdogInterval.current);
            if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
            if (syncInterval.current) clearInterval(syncInterval.current);
            if (handshakeTimeout.current) clearTimeout(handshakeTimeout.current);
        };
    }, [enabled, connect]);

    return { status, depthData, subscribe };
};
