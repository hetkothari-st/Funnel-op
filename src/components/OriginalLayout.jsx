import React, { useState, useMemo, useEffect } from 'react';
import { Settings, Bell, Layers, Database, Activity, RefreshCw, ChevronDown, Check, Trash2, X, ArrowUp, ArrowDown, PanelLeftClose, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import contractsData from '../contracts_nsefo.json';

function cn(...inputs) {
    return twMerge(clsx(inputs));
}

// Helper to generate range of strikes
const getStrikeRange = (center, step, count = 10) => {
    const start = center - (step * (count / 2));
    return Array.from({ length: count + 1 }, (_, i) => start + (i * step));
};

const OriginalLayout = ({
    visibleElements,
    monitoredTokens,
    depthData,
    logs,
    onAddTokens,
    onRemoveToken,
    onClearTokens,
    onUpdateTokenQty,
    onUpdateTokenStrike,
    showAllPrices,      // Lifted State
    setShowAllPrices,   // Lifted State Setter
    isSidebarVisible,
    onToggleSidebar
}) => {
    // Local State
    const [config, setConfig] = useState(() => {
        const saved = localStorage.getItem('mt_original_layout_config');
        return saved ? JSON.parse(saved) : {
            index: 'NIFTY',
            centerStrike: '25800',
            selectedStrikes: [],
            type: 'CE',
            expiry: '',
            side: 'buy',
            quantity: 5000
        };
    });

    useEffect(() => {
        localStorage.setItem('mt_original_layout_config', JSON.stringify(config));
    }, [config]);

    // Dropdown State
    const [isStrikeDropdownOpen, setIsStrikeDropdownOpen] = useState(false);
    const [activeStrikeEditor, setActiveStrikeEditor] = useState(null);

    // UI Persistence (Relative Timer stays local as it's purely UI)
    const [showRelativeTimer, setShowRelativeTimer] = useState(() => {
        const saved = localStorage.getItem('mt_show_relative_timer_original');
        return saved ? JSON.parse(saved) : false;
    });
    const [timeTick, setTimeTick] = useState(0);
    const [logsHeight, setLogsHeight] = useState(350); // Default height in pixels

    // Reset height when log visibility toggles
    useEffect(() => {
        setLogsHeight(350);
    }, [visibleElements.logs]);

    // Resizing Logic for Alerts
    const handleResizeStart = (e) => {
        e.preventDefault();
        const startY = e.pageY;
        const startHeight = logsHeight;

        const onPointerMove = (moveEvent) => {
            const delta = startY - moveEvent.pageY;
            // Min height ~230px (allows ~2 alerts), max height 80% of viewport
            const newHeight = Math.min(window.innerHeight * 0.8, Math.max(255, startHeight + delta));
            setLogsHeight(newHeight);
        };

        const onPointerUp = () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            document.body.style.cursor = 'default';
        };

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        document.body.style.cursor = 'ns-resize';
    };

    useEffect(() => {
        localStorage.setItem('mt_show_relative_timer_original', JSON.stringify(showRelativeTimer));
    }, [showRelativeTimer]);

    useEffect(() => {
        if (!showRelativeTimer) return;
        const interval = setInterval(() => setTimeTick(t => t + 1), 1000);
        return () => clearInterval(interval);
    }, [showRelativeTimer]);

    // Derived: Available Strikes based on Center
    const availableStrikesOptions = useMemo(() => {
        const center = parseInt(config.centerStrike) || 0;
        if (center === 0) return [];
        let step = 50;
        if (config.index === 'BANKNIFTY' || config.index === 'SENSEX') step = 100;
        return getStrikeRange(center, step, 10);
    }, [config.index, config.centerStrike]);

    // Derived: Available Expiries
    const availableExpiries = useMemo(() => {
        const strikeVal = Number(config.centerStrike).toFixed(5);
        let searchIndex = config.index === 'SENSEX' ? 'BSX' : config.index;
        const filtered = contractsData.filter(c =>
            c.s === searchIndex
        );
        const exactMatches = filtered.filter(c => Number(c.st).toFixed(5) === strikeVal);
        const source = exactMatches.length > 0 ? exactMatches : filtered;
        return [...new Set(source.map(c => c.e))].sort();
    }, [config.index, config.centerStrike]);

    // Auto-select expiry
    useEffect(() => {
        if (availableExpiries.length > 0 && !availableExpiries.includes(config.expiry)) {
            const today = new Date().toISOString().split('T')[0];
            setConfig(prev => ({ ...prev, expiry: availableExpiries.find(e => e >= today) || availableExpiries[0] }));
        }
    }, [availableExpiries, config.expiry]);

    // Click away for strike editor
    useEffect(() => {
        const handleClickAway = (e) => {
            if (activeStrikeEditor && !e.target.closest('.strike-editor-container')) {
                setActiveStrikeEditor(null);
            }
        };
        document.addEventListener('mousedown', handleClickAway);
        return () => document.removeEventListener('mousedown', handleClickAway);
    }, [activeStrikeEditor]);

    // Focus the strike button when editor opens
    useEffect(() => {
        if (activeStrikeEditor) {
            const btn = document.getElementById(`strike-btn-${activeStrikeEditor.id}`);
            if (btn) btn.focus();
        }
    }, [activeStrikeEditor]);

    const toggleStrike = (strike) => {
        const str = strike.toString();
        setConfig(prev => {
            const current = prev.selectedStrikes;
            if (current.includes(str)) {
                return { ...prev, selectedStrikes: current.filter(s => s !== str) };
            } else {
                return { ...prev, selectedStrikes: [...current, str].sort((a, b) => Number(a) - Number(b)) };
            }
        });
    };

    const handleAdd = () => {
        const newTokens = [];
        let searchIndex = config.index === 'SENSEX' ? 'BSX' : config.index;

        config.selectedStrikes.forEach(strike => {
            const strikeVal = Number(strike).toFixed(5);
            const findMatch = (type) => {
                return contractsData.find(c =>
                    c.s === searchIndex &&
                    Number(c.st).toFixed(5) === strikeVal &&
                    c.p === type &&
                    c.e === config.expiry
                );
            };

            const typesToFind = config.type === 'Both' ? ['CE', 'PE'] : [config.type];

            typesToFind.forEach(type => {
                const match = findMatch(type);
                if (match) {
                    const token = match.t;
                    const symbol = `${config.index} ${strike} ${type}`;
                    newTokens.push({
                        id: `${token}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        tkn: token,
                        symbol: symbol,
                        strike: strike,
                        type: type,
                        side: config.side,
                        quantity: config.quantity,
                        expiry: config.expiry,
                        index: config.index
                    });
                }
            });
        });

        if (newTokens.length > 0) {
            onAddTokens(newTokens);
            setConfig(prev => ({ ...prev, selectedStrikes: [] }));
            setIsStrikeDropdownOpen(false);
        }
    };

    // Quick Strikes: Add 1 ATM + 2 ITM + 5 OTM for both CE and PE
    const INDEX_SPOT_MAP = {
        NIFTY: { tokenId: '26000', step: 50 },
        BANKNIFTY: { tokenId: '26009', step: 100 },
        FINNIFTY: { tokenId: '26000', step: 50 },
        SENSEX: { tokenId: '1', step: 100 },
    };

    const handleQuickStrikes = () => {
        const indexInfo = INDEX_SPOT_MAP[config.index];
        if (!indexInfo) return;

        const { tokenId, step } = indexInfo;
        const spotPacket = depthData[tokenId];
        if (!spotPacket) {
            alert('Spot price not available yet. Wait for market data to load.');
            return;
        }

        const spotPrice = parseFloat(spotPacket.Price || spotPacket.iv || spotPacket.ltp || spotPacket.LastTradedPrice || 0);
        if (!spotPrice) {
            alert('Could not determine spot price.');
            return;
        }

        const atm = Math.round(spotPrice / step) * step;
        let searchIndex = config.index === 'SENSEX' ? 'BSX' : config.index;

        // CE: ITM = below ATM, OTM = above ATM
        // PE: ITM = above ATM, OTM = below ATM
        const ceStrikes = [];
        const peStrikes = [];

        // 2 ITM for CE (below ATM)
        for (let i = 2; i >= 1; i--) ceStrikes.push(atm - i * step);
        // ATM
        ceStrikes.push(atm);
        // 5 OTM for CE (above ATM)
        for (let i = 1; i <= 5; i++) ceStrikes.push(atm + i * step);

        // 2 ITM for PE (above ATM)
        for (let i = 2; i >= 1; i--) peStrikes.push(atm + i * step);
        // ATM
        peStrikes.push(atm);
        // 5 OTM for PE (below ATM)
        for (let i = 1; i <= 5; i++) peStrikes.push(atm - i * step);

        const newTokens = [];
        const addStrike = (strike, type) => {
            const strikeVal = Number(strike).toFixed(5);
            const match = contractsData.find(c =>
                c.s === searchIndex &&
                Number(c.st).toFixed(5) === strikeVal &&
                c.p === type &&
                c.e === config.expiry
            );
            if (match) {
                // Skip if already monitored
                const alreadyExists = monitoredTokens.some(m => m.tkn === match.t && m.type === type);
                if (!alreadyExists) {
                    newTokens.push({
                        id: `${match.t}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        tkn: match.t,
                        symbol: `${config.index} ${strike} ${type}`,
                        strike: strike.toString(),
                        type: type,
                        side: config.side,
                        quantity: 25000,
                        expiry: config.expiry,
                        index: config.index
                    });
                }
            }
        };

        ceStrikes.forEach(s => addStrike(s, 'CE'));
        peStrikes.forEach(s => addStrike(s, 'PE'));

        if (newTokens.length > 0) {
            onAddTokens(newTokens);
        }
    };

    const handleUpdateStrike = (id, newStrike) => {
        const item = monitoredTokens.find(m => m.id === id);
        if (!item) return;

        let searchIndex = item.index === 'SENSEX' ? 'BSX' : item.index;
        const strikeVal = Number(newStrike).toFixed(5);

        const contract = contractsData.find(c =>
            c.s === searchIndex &&
            c.p === item.type &&
            c.e === item.expiry &&
            Number(c.st).toFixed(5) === strikeVal
        );

        if (contract) {
            onUpdateTokenStrike(id, newStrike, contract.t, contract.ns);
            setActiveStrikeEditor(null);
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden space-y-3">
            {/* 1. CONFIG BAR */}
            {visibleElements.config && (
                <section className={cn(
                    "glass-card p-2 flex flex-wrap items-center gap-3 flex-shrink-0 z-20 relative transition-all duration-300",
                    !isSidebarVisible && "pl-12"
                )}>
                    <button
                        onClick={() => onToggleSidebar(true)}
                        className="p-1.5 rounded text-white/30 hover:text-white hover:bg-white/10 transition-all mr-1"
                        title="Hide Sidebar"
                    >
                        <PanelLeftClose size={14} />
                    </button>
                    {/* Index */}
                    <div className="space-y-0.5">
                        <label className="text-[9px] uppercase text-white/40 block">Index</label>
                        <select className="bg-white/5 border border-white/10 rounded px-2 py-1 text-[10px] w-20 focus:ring-1 focus:ring-blue-500 outline-none"
                            value={config.index} onChange={e => setConfig({ ...config, index: e.target.value })}>
                            <option className="bg-[#0f1115] text-white">NIFTY</option>
                            <option className="bg-[#0f1115] text-white">BANKNIFTY</option>
                            <option className="bg-[#0f1115] text-white">FINNIFTY</option>
                            <option className="bg-[#0f1115] text-white">SENSEX</option>
                        </select>
                    </div>

                    {/* Multi-Strike Selector */}
                    <div className="space-y-0.5 relative">
                        <label className="text-[9px] uppercase text-white/40 block">Strikes</label>
                        <div className="flex gap-1">
                            <input
                                type="number"
                                placeholder="Center"
                                className="bg-white/5 border border-white/10 rounded px-2 py-1 w-16 text-[10px] focus:ring-1 focus:ring-blue-500 outline-none"
                                value={config.centerStrike}
                                onChange={e => setConfig({ ...config, centerStrike: e.target.value })}
                            />
                            <button
                                onClick={() => setIsStrikeDropdownOpen(!isStrikeDropdownOpen)}
                                className={cn("px-2 py-1 border border-white/10 rounded flex items-center gap-1 text-[10px] min-w-[60px] justify-between",
                                    config.selectedStrikes.length > 0 ? "bg-blue-500/20 text-blue-400 border-blue-500/30" : "bg-white/5 text-white/60")}
                            >
                                {config.selectedStrikes.length > 0 ? `${config.selectedStrikes.length} Selected` : "Select"}
                                <ChevronDown size={10} />
                            </button>
                        </div>

                        {/* Dropdown Panel */}
                        {isStrikeDropdownOpen && (
                            <div className="absolute top-full left-0 mt-1 w-40 bg-[#0f1115] border border-white/10 rounded-lg shadow-xl p-2 z-[999] max-h-60 overflow-y-auto">
                                <div className="text-[9px] uppercase text-white/30 mb-2 font-bold tracking-wider">Select Strikes</div>
                                <div className="space-y-1">
                                    {availableStrikesOptions.map(strike => (
                                        <div
                                            key={strike}
                                            onClick={() => toggleStrike(strike)}
                                            className="flex items-center gap-2 px-2 py-1.5 hover:bg-white/5 rounded cursor-pointer text-[10px]"
                                        >
                                            <div className={cn("w-3 h-3 rounded border flex items-center justify-center",
                                                config.selectedStrikes.includes(strike.toString()) ? "bg-blue-600 border-blue-600" : "border-white/20")}>
                                                {config.selectedStrikes.includes(strike.toString()) && <Check size={8} />}
                                            </div>
                                            <span className={config.selectedStrikes.includes(strike.toString()) ? "text-white font-medium" : "text-white/60"}>
                                                {strike}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Standard Controls */}
                    <div className="space-y-0.5">
                        <label className="text-[9px] uppercase text-white/40 block">Type</label>
                        <div className="flex bg-white/5 rounded border border-white/10">
                            {['CE', 'PE', 'Both'].map(t => (
                                <button key={t} onClick={() => setConfig({ ...config, type: t })}
                                    className={cn("px-2 py-1 text-[9px]", config.type === t ? "bg-blue-500 text-white" : "text-white/60")}>
                                    {t}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-0.5">
                        <label className="text-[9px] uppercase text-white/40 block">Expiry</label>
                        <select className="bg-white/5 border border-white/10 rounded px-2 py-1 text-[10px] w-24 focus:ring-1 focus:ring-blue-500 outline-none"
                            value={config.expiry} onChange={e => setConfig({ ...config, expiry: e.target.value })}>
                            {availableExpiries.map(e => <option key={e} value={e} className="bg-[#0f1115] text-white">{e.split('T')[0]}</option>)}
                        </select>
                    </div>

                    <div className="space-y-0.5">
                        <label className="text-[9px] uppercase text-white/40 block">Qty</label>
                        <input type="number" className="bg-white/5 border border-white/10 rounded px-2 py-1 w-16 text-[10px] focus:ring-1 focus:ring-blue-500 outline-none"
                            value={config.quantity} onChange={e => setConfig({ ...config, quantity: parseInt(e.target.value) || 0 })} />
                    </div>

                    <div className="space-y-0.5">
                        <label className="text-[9px] uppercase text-white/40 block">Side</label>
                        <div className="flex bg-white/5 rounded border border-white/10">
                            {['buy', 'sell', 'both'].map(s => (
                                <button key={s} onClick={() => setConfig({ ...config, side: s })}
                                    className={cn("px-2 py-1 text-[9px] capitalize", config.side === s ? "bg-blue-500 text-white" : "text-white/60")}>
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex gap-2 ml-auto">
                        <button onClick={handleQuickStrikes} className="bg-amber-600 hover:bg-amber-500 text-white font-bold py-1 px-3 rounded text-[10px] h-7 shadow-lg shadow-amber-500/20 flex items-center gap-2" title="Add 1 ATM + 2 ITM + 5 OTM (CE & PE)">
                            <Zap size={10} /> Quick Strikes
                        </button>
                        <button onClick={handleAdd} className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-1 px-4 rounded text-[10px] h-7 shadow-lg shadow-blue-500/20 flex items-center gap-2">
                            Add to Monitor
                        </button>
                        <button onClick={onClearTokens} className="bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20 font-bold py-1 px-3 rounded text-[10px] h-7 flex items-center gap-2">
                            <Trash2 size={10} /> Clear
                        </button>
                    </div>
                </section>
            )}

            {/* 2. MULTI-STRIKE DEPTHS GRID */}
            <div className={cn(
                "overflow-y-auto px-1 transition-all duration-300 flex-1",
                visibleElements.logs ? "min-h-0" : "h-full"
            )}>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                    {monitoredTokens.map((item, idx) => {
                        const tkn = item.tkn;
                        const currentDepth = depthData[tkn] || depthData[Number(tkn)];
                        const label = item.type; // CE or PE

                        // Visibility Check
                        if (label === 'CE' && !visibleElements.ceDepth) return null;
                        if (label === 'PE' && !visibleElements.peDepth) return null;

                        return (
                            <div key={item.id} className="glass-card p-4 min-w-[280px] border-white/5 relative group">
                                <button
                                    onClick={() => onRemoveToken(item.id)}
                                    className="absolute -top-2 -right-2 w-6 h-6 bg-red-500/80 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-20 hover:bg-red-500"
                                >
                                    <X size={14} />
                                </button>

                                <div className="flex justify-between items-start mb-3">
                                    <div className="relative strike-editor-container">
                                        <button
                                            id={`strike-btn-${item.id}`}
                                            onClick={() => setActiveStrikeEditor(activeStrikeEditor?.id === item.id ? null : { id: item.id, strike: item.strike, index: item.index, focusIndex: 5 })}
                                            onKeyDown={(e) => {
                                                if (activeStrikeEditor?.id !== item.id) return;
                                                const center = parseInt(item.strike);
                                                let step = 50;
                                                if (item.index === 'BANKNIFTY' || item.index === 'SENSEX') step = 100;
                                                const range = getStrikeRange(center, step, 10);

                                                if (e.key === 'ArrowDown') {
                                                    e.preventDefault();
                                                    setActiveStrikeEditor(prev => ({ ...prev, focusIndex: Math.min(range.length - 1, prev.focusIndex + 1) }));
                                                } else if (e.key === 'ArrowUp') {
                                                    e.preventDefault();
                                                    setActiveStrikeEditor(prev => ({ ...prev, focusIndex: Math.max(0, prev.focusIndex - 1) }));
                                                } else if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    handleUpdateStrike(item.id, range[activeStrikeEditor.focusIndex].toString());
                                                } else if (e.key === 'Escape') {
                                                    setActiveStrikeEditor(null);
                                                }
                                            }}
                                            className={cn(
                                                "text-sm font-black transition-colors flex items-center gap-1 focus:outline-none focus:ring-1 focus:ring-white/20 rounded px-1 -mx-1",
                                                item.type === 'CE' ? "text-emerald-400" : "text-purple-400"
                                            )}
                                        >
                                            {item.strike} {item.type}
                                            <ChevronDown size={14} className={cn("transition-transform", activeStrikeEditor?.id === item.id && "rotate-180")} />
                                        </button>

                                        <AnimatePresence>
                                            {activeStrikeEditor?.id === item.id && (
                                                <motion.div
                                                    initial={{ opacity: 0, y: 10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0, y: 10 }}
                                                    className="absolute top-full left-0 mt-1 bg-[#1a1c21] border border-white/10 rounded shadow-2xl z-[100] min-w-[120px] max-h-[300px] overflow-auto scrollbar-thin"
                                                >
                                                    {(() => {
                                                        const center = parseInt(item.strike);
                                                        let step = 50;
                                                        if (item.index === 'BANKNIFTY' || item.index === 'SENSEX') step = 100;
                                                        const range = getStrikeRange(center, step, 10);

                                                        return range.map((s, i) => (
                                                            <button
                                                                key={s}
                                                                ref={activeStrikeEditor.focusIndex === i ? (el) => el?.scrollIntoView({ block: 'nearest' }) : null}
                                                                onClick={() => handleUpdateStrike(item.id, s.toString())}
                                                                className={cn(
                                                                    "w-full text-left px-3 py-2 text-xs transition-colors flex items-center justify-between",
                                                                    activeStrikeEditor.focusIndex === i ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5",
                                                                    s.toString() === item.strike && "text-yellow-400 font-bold"
                                                                )}
                                                            >
                                                                {s}
                                                                {s.toString() === item.strike && <Check size={10} />}
                                                            </button>
                                                        ));
                                                    })()}
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                    <span className="text-white/20 text-[8px] font-mono">{tkn}</span>
                                </div>
                                <div className="flex items-center gap-2 mb-2 text-[9px] text-white/40 font-medium">
                                    <div className="flex items-center gap-1 bg-white/5 px-1.5 py-0.5 rounded border border-white/5">
                                        <span>Qty:</span>
                                        <input
                                            type="number"
                                            value={item.quantity}
                                            onChange={(e) => onUpdateTokenQty(item.id, e.target.value)}
                                            className="bg-transparent border-none text-yellow-500 font-bold w-12 focus:outline-none focus:ring-1 focus:ring-yellow-500/50 rounded px-0.5 -my-0.5"
                                        />
                                    </div>
                                    <span className="bg-white/5 px-1.5 py-0.5 rounded border border-white/5 capitalize">{item.side}</span>
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-[10px]">
                                    {item.side !== 'sell' && (
                                        <div className="space-y-0.5">
                                            {[...Array(5)].map((_, i) => {
                                                const d = currentDepth?.depths?.[i];
                                                return (
                                                    <div key={`b-${i}`} className="flex justify-between bg-black/20 px-1.5 py-0.5 rounded">
                                                        <span className="text-success">{d?.BP || '-'}</span>
                                                        <span className={d?.BQ >= item.quantity ? "text-yellow-400 font-bold" : "text-white/60"}>{d?.BQ || '0'}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                    {item.side !== 'buy' && (
                                        <div className="space-y-0.5">
                                            {[...Array(5)].map((_, i) => {
                                                const d = currentDepth?.depths?.[i];
                                                return (
                                                    <div key={`a-${i}`} className="flex justify-between bg-black/20 px-1.5 py-0.5 rounded">
                                                        <span className={d?.SQ >= item.quantity ? "text-yellow-400 font-bold" : "text-white/60"}>{d?.SQ || '0'}</span>
                                                        <span className="text-danger">{d?.SP || '-'}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* 3. CONSOLIDATED LOGS */}
            {visibleElements.logs && (
                <div
                    className="glass-card flex-shrink-0 flex flex-col p-0 overflow-hidden relative"
                    style={{ height: logsHeight }}
                >
                    {/* Resize Handle */}
                    <div
                        className="absolute top-0 left-0 w-full h-1 cursor-ns-resize hover:bg-blue-500/30 z-50 transition-colors"
                        onPointerDown={handleResizeStart}
                    />
                    <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between bg-white/5">
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2">
                                <Bell size={12} className="text-yellow-400" />
                                <span className="text-[10px] font-bold uppercase tracking-wider text-white/60">Consolidated Alerts</span>
                            </div>
                            <span className="text-[9px] text-white/30">{logs.length} events</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-white/30 text-[8px] font-normal lowercase italic">Live Timer:</span>
                            <button
                                onClick={() => setShowRelativeTimer(!showRelativeTimer)}
                                className={cn(
                                    "w-8 h-4 rounded-full relative transition-colors duration-300",
                                    showRelativeTimer ? "bg-blue-500" : "bg-white/10"
                                )}
                            >
                                <div className={cn(
                                    "absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all duration-300 shadow-sm",
                                    showRelativeTimer ? "left-[1.125rem]" : "left-0.5"
                                )} />
                            </button>
                        </div>
                    </div>
                    <div className="overflow-auto flex-1 min-h-0 w-full relative border-t border-white/5">
                        <table className="w-max min-w-full text-left whitespace-nowrap">
                            <thead className="text-base font-bold uppercase text-white/50 sticky top-0 bg-[#0f1115] z-10">
                                <tr>
                                    <th className="py-4 px-6">Time</th>
                                    <th className="py-4 px-6">Symbol</th>
                                    <th className="py-4 px-6">Side</th>
                                    <th className="py-4 px-6 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <span className="text-white/30 text-[8px] font-normal lowercase italic">Show 0/5:</span>
                                            <button
                                                onClick={() => setShowAllPrices(!showAllPrices)}
                                                className={cn(
                                                    "w-8 h-4 rounded-full relative transition-colors duration-300",
                                                    showAllPrices ? "bg-emerald-500" : "bg-white/10"
                                                )}
                                            >
                                                <div className={cn(
                                                    "absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all duration-300 shadow-sm",
                                                    showAllPrices ? "left-[1.125rem]" : "left-0.5"
                                                )} />
                                            </button>
                                            Price
                                        </div>
                                    </th>
                                    <th className="py-4 px-8 text-right">Qty</th>
                                </tr>
                            </thead>
                            <tbody className="text-xl font-medium">
                                {logs.map((log, i) => {
                                    const elapsed = log.timestamp ? Math.floor((Date.now() - log.timestamp) / 1000) : 0;
                                    const mins = Math.floor(elapsed / 60);
                                    const secs = elapsed % 60;
                                    const timerStr = `${mins}:${secs.toString().padStart(2, '0')}`;

                                    return (
                                        <tr key={`${log.id}-${i}`} className="border-b border-white/5 hover:bg-white/5">
                                            <td className="py-3 px-6 font-mono text-sm">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-white/40">{log.time}</span>
                                                    {showRelativeTimer && (
                                                        <span className="text-blue-400/80 font-bold">({timerStr})</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="py-3 px-6">
                                                <div className={cn(
                                                    "text-4xl font-black tracking-tighter uppercase",
                                                    log.type === 'CE' ? "text-emerald-400" : "text-purple-400"
                                                )}>
                                                    {log.strike} {log.type}
                                                </div>
                                            </td>
                                            <td className="py-3 px-6">
                                                <div className={cn("text-4xl uppercase font-black tracking-tighter", log.side === 'buy' ? "text-success" : "text-danger")}>
                                                    {log.side}
                                                </div>
                                            </td>
                                            <td className="py-3 px-6 text-right font-mono text-white/80">{Number(log.price).toFixed(2)}</td>
                                            <td className="py-3 px-8 text-right font-bold text-yellow-400">{log.observedQty}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};

export default OriginalLayout;
