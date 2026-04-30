import { useRef, useEffect, useCallback } from 'react';

const FLUSH_INTERVAL_MS = 2000;
const MAX_QUEUE_SIZE = 5000;

export function useAlertRecorder(sessionToken, monitorId) {
    const queueRef = useRef([]);
    const inFlightRef = useRef(false);
    const tokenRef = useRef(sessionToken);
    const monitorIdRef = useRef(monitorId);

    useEffect(() => { tokenRef.current = sessionToken; }, [sessionToken]);
    useEffect(() => { monitorIdRef.current = monitorId; }, [monitorId]);

    const flush = useCallback(async () => {
        const token = tokenRef.current;
        if (!token) return;
        if (inFlightRef.current) return;
        if (queueRef.current.length === 0) return;

        const batch = queueRef.current;
        queueRef.current = [];
        inFlightRef.current = true;

        try {
            const res = await fetch('/api/alerts/record', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionToken: token,
                    monitorId: monitorIdRef.current,
                    alerts: batch,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!data?.ok) {
                queueRef.current = [...batch, ...queueRef.current].slice(-MAX_QUEUE_SIZE);
            }
        } catch {
            queueRef.current = [...batch, ...queueRef.current].slice(-MAX_QUEUE_SIZE);
        } finally {
            inFlightRef.current = false;
        }
    }, []);

    useEffect(() => {
        const interval = setInterval(flush, FLUSH_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [flush]);

    useEffect(() => {
        const handleUnload = () => {
            const token = tokenRef.current;
            if (!token) return;
            if (queueRef.current.length === 0) return;
            try {
                const payload = JSON.stringify({
                    sessionToken: token,
                    monitorId: monitorIdRef.current,
                    alerts: queueRef.current,
                });
                const blob = new Blob([payload], { type: 'application/json' });
                navigator.sendBeacon('/api/alerts/record', blob);
                // Do NOT clear queueRef — sendBeacon is fire-and-forget,
                // delivery is not guaranteed. Server dedup handles retries.
            } catch {}
        };
        window.addEventListener('beforeunload', handleUnload);
        return () => window.removeEventListener('beforeunload', handleUnload);
    }, []);

    const recordAlert = useCallback((alert) => {
        if (queueRef.current.length >= MAX_QUEUE_SIZE) {
            queueRef.current.splice(0, queueRef.current.length - MAX_QUEUE_SIZE + 1);
        }
        queueRef.current.push(alert);
    }, []);

    return { recordAlert };
}
