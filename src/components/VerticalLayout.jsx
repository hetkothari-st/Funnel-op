import React, { useState, useMemo, useEffect, useRef, memo, useCallback } from 'react';
import { Plus, Trash2, X, ChevronDown, Check, GripVertical, Eraser } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence, Reorder, useDragControls } from 'framer-motion';
import contractsData from '../contracts_nsefo.json';

function cn(...inputs) {
    return twMerge(clsx(inputs));
}

const LogRow = memo(React.forwardRef(({ log, token, side, timeTick }, ref) => {
    const isBuy = side === 'buy';

    // Calculate relative timer
    const elapsed = log.timestamp ? Math.floor((Date.now() - log.timestamp) / 1000) : 0;
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const timerStr = `(${mins}:${secs.toString().padStart(2, '0')})`;

    const isHighQty = log.observedQty >= 100000;

    return (
        <motion.div
            ref={ref}
            layout
            initial={{ opacity: 0, x: isBuy ? -10 : 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex items-center justify-between gap-1 text-[13px] leading-tight px-1 py-0.5 rounded hover:bg-white/5 transition-colors border-b border-white/5 last:border-0 overflow-hidden"
        >
            {isBuy ? (
                <>
                    <span className="text-[10px] text-blue-400 font-bold font-mono whitespace-nowrap shrink-0">{timerStr}</span>
                    <span className={cn(
                        "font-mono flex-1 text-center whitespace-nowrap min-w-0 truncate transition-all duration-300",
                        isHighQty ? "text-amber-400 font-black text-[14.5px] drop-shadow-[0_0_8px_rgba(251,191,36,0.4)] tracking-tighter" : "text-emerald-400 font-bold text-[12px]"
                    )}>{log.observedQty}</span>
                    <span className={cn(
                        "font-mono whitespace-nowrap shrink-0 text-right transition-all duration-300",
                        isHighQty
                            ? "text-violet-400 font-black text-[12.5px] drop-shadow-[0_0_10px_rgba(167,139,250,0.6)]"
                            : "text-slate-300 font-bold text-[10.5px] drop-shadow-[0_0_4px_rgba(255,255,255,0.1)]"
                    )}>{Number(log.price).toFixed(2)}</span>
                </>
            ) : (
                <>
                    <span className={cn(
                        "font-mono whitespace-nowrap shrink-0 text-left transition-all duration-300",
                        isHighQty
                            ? "text-violet-400 font-black text-[12.5px] drop-shadow-[0_0_10px_rgba(167,139,250,0.6)]"
                            : "text-slate-300 font-bold text-[10.5px] drop-shadow-[0_0_4px_rgba(255,255,255,0.1)]"
                    )}>{Number(log.price).toFixed(2)}</span>
                    <span className={cn(
                        "font-mono flex-1 text-center whitespace-nowrap min-w-0 truncate transition-all duration-300",
                        isHighQty ? "text-amber-400 font-black text-[14.5px] drop-shadow-[0_0_8px_rgba(251,191,36,0.4)] tracking-tighter" : "text-red-400 font-bold text-[12px]"
                    )}>{log.observedQty}</span>
                    <span className="text-[10px] text-blue-400 font-bold font-mono whitespace-nowrap shrink-0 text-right">{timerStr}</span>
                </>
            )}
        </motion.div>
    );
}), (prev, next) => {
    // Re-render if log changes OR if the timer needs to update (every second)
    return prev.log.id === next.log.id && prev.timeTick === next.timeTick;
});

const DraggableColumn = ({ token, isAtm, onDragStateChange, logs, onRemove, onUpdateQty, onUpdateStrike, onUpdateType, onUpdateWidth, onClearLogs, timeTick, showNetQtyBreakdown }) => {
    const controls = useDragControls();
    const columnWidth = token.width || 300;

    // Net Quantity Calculation Logic
    const calculateNetQty = useCallback((side) => {
        const sideLogs = logs.filter(l => l.side === side && l.observedQty >= 100000);
        const maxQtyPerPrice = {};
        sideLogs.forEach(log => {
            const price = Number(log.price).toFixed(2);
            if (!maxQtyPerPrice[price] || log.observedQty > maxQtyPerPrice[price]) {
                maxQtyPerPrice[price] = log.observedQty;
            }
        });

        const breakdown = Object.entries(maxQtyPerPrice)
            .map(([price, qty]) => ({ price, qty }))
            .sort((a, b) => parseFloat(b.price) - parseFloat(a.price));

        const total = Object.values(maxQtyPerPrice).reduce((sum, qty) => sum + qty, 0);
        return { total, breakdown };
    }, [logs]);

    const netBuyData = useMemo(() => calculateNetQty('buy'), [calculateNetQty]);
    const netSellData = useMemo(() => calculateNetQty('sell'), [calculateNetQty]);

    // Resizing Logic
    const handleResizeStart = (e) => {
        e.stopPropagation();
        e.preventDefault();

        const startX = e.pageX;
        const startWidth = columnWidth;

        onDragStateChange(true); // Lock ATM logic/reordering

        const handlePointerMove = (moveEvent) => {
            const delta = moveEvent.pageX - startX;
            const newWidth = Math.min(320, Math.max(240, startWidth + delta));
            onUpdateWidth(newWidth);
        };

        const handlePointerUp = () => {
            onDragStateChange(false);
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
            document.body.style.cursor = 'default';
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        document.body.style.cursor = 'col-resize';
    };

    // Derived All Strikes
    const allStrikes = useMemo(() => {
        let searchIndex = token.index === 'SENSEX' ? 'BSX' : token.index;
        const filtered = contractsData.filter(c =>
            c.s === searchIndex &&
            c.e === token.expiry
        );
        const strikes = [...new Set(filtered.map(c => Number(c.st)))];
        return strikes.sort((a, b) => a - b);
    }, [token.index, token.expiry, token.strike]); // Added token.strike to dependecy if needed, though mostly index/expiry matters

    const [isEditingStrike, setIsEditingStrike] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const dropdownRef = useRef(null);
    const inputRef = useRef(null);
    const containerRef = useRef(null); // Ref for click-outside detection

    // Handle Click Outside & Escape
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setIsEditingStrike(false);
            }
        };

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                setIsEditingStrike(false);
            }
        };

        if (isEditingStrike) {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('keydown', handleKeyDown);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isEditingStrike]);

    useEffect(() => {
        if (isEditingStrike) {
            setSearchTerm(""); // Reset search
            // Tiny delay ensures DOM elements are rendered before we scroll/focus
            setTimeout(() => {
                if (inputRef.current) inputRef.current.focus();

                if (dropdownRef.current) {
                    const activeBtn = dropdownRef.current.querySelector('[data-active="true"]');
                    if (activeBtn) {
                        activeBtn.scrollIntoView({ block: 'center', behavior: 'instant' });
                    }
                }
            }, 50);
        }
    }, [isEditingStrike]);

    return (
        <Reorder.Item
            value={token}
            dragListener={false}
            dragControls={controls}
            onDragStart={() => onDragStateChange(true)}
            onDragEnd={() => onDragStateChange(false)}
            whileDrag={{ scale: 1.02, zIndex: 50 }}
            style={{
                flex: `0 0 ${columnWidth}px`, // Strictly respect the width to prevent overlap
                maxWidth: 320,
                minWidth: 240
            }}
            className={cn(
                "h-full flex flex-col bg-[#0f1115] border rounded-lg shadow-xl transition-[border-color,box-shadow,flex-basis] duration-500 relative",
                isAtm ? "border-yellow-400/50 shadow-[0_0_15px_rgba(250,204,21,0.15)] z-10" : "border-white/10"
            )}
        >
            {/* Resize Handle */}
            <div
                className="absolute right-0 top-0 w-1.5 h-full cursor-col-resize hover:bg-blue-500/20 z-50 transition-colors"
                onPointerDown={handleResizeStart}
            />
            {/* Column Header */}
            <div className="p-2 border-b border-white/10 space-y-2 bg-[#15171c]">
                <div className="flex items-center justify-between">
                    <div
                        className="flex items-center gap-2 cursor-grab active:cursor-grabbing hover:text-white/80 transition-colors"
                        onPointerDown={(e) => controls.start(e)}
                    >
                        <GripVertical size={14} className="text-white/20" />
                        <span className="text-[10px] font-bold text-white/50 select-none">{token.index} {token.expiry.split('T')[0]}</span>
                    </div>
                    <button onClick={onRemove} className="text-white/20 hover:text-red-400 transition-colors">
                        <X size={12} />
                    </button>
                </div>

                {/* Controls Row */}
                <div className="flex items-center justify-between h-7 px-1">
                    {/* Strike */}
                    <div className="relative flex items-center h-full" ref={containerRef}>
                        {/* Ghost/Shadow Strike Text */}
                        <div className={cn(
                            "absolute left-0 top-1/2 -translate-y-1/2 text-5xl font-black tracking-tighter opacity-[0.05] select-none pointer-events-none transition-colors",
                            token.type === 'CE' ? "text-cyan-500" : "text-purple-500"
                        )}>
                            {token.strike}
                        </div>

                        <button
                            onClick={() => setIsEditingStrike(!isEditingStrike)}
                            className={cn(
                                "relative z-10 bg-transparent border-none p-0 flex items-center gap-0.5 transition-colors",
                                token.type === 'CE' ? "text-cyan-400 hover:text-cyan-300" : "text-purple-400 hover:text-purple-300"
                            )}
                        >
                            <span className="text-xl font-black tracking-tight leading-none">{token.strike}</span>
                            <ChevronDown size={14} className="opacity-40 flex-shrink-0" />
                        </button>

                        {isEditingStrike && (
                            <div
                                ref={dropdownRef}
                                className="absolute top-full left-0 mt-1 bg-[#1a1c21] border border-white/10 rounded shadow-xl z-50 max-h-64 overflow-y-auto min-w-[140px]"
                            >
                                <div className="sticky top-0 bg-[#1a1c21] p-1.5 border-b border-white/10 z-10">
                                    <input
                                        ref={inputRef}
                                        type="text"
                                        placeholder="Search..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:border-blue-500 placeholder-white/20"
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                </div>
                                {allStrikes.filter(s => s.toString().includes(searchTerm)).map(s => (
                                    <button
                                        key={s}
                                        data-active={s.toString() === token.strike}
                                        onClick={() => {
                                            onUpdateStrike(s.toString());
                                            setIsEditingStrike(false);
                                        }}
                                        className={cn(
                                            "w-full text-left px-2 py-1.5 text-xs hover:bg-white/5 flex items-center justify-between",
                                            s.toString() === token.strike ? "text-yellow-400 font-bold bg-white/5" : "text-white/60"
                                        )}
                                    >
                                        {s}
                                        {s.toString() === token.strike && <Check size={10} />}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Controls Group */}
                    <div className="flex items-center gap-1 h-full">
                        <button
                            onClick={() => onUpdateType(token.type === 'CE' ? 'PE' : 'CE')}
                            className={cn("px-1.5 py-0.5 rounded text-[11px] font-bold border transition-colors hover:brightness-110 flex-shrink-0 h-full flex items-center",
                                token.type === 'CE' ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" : "bg-purple-500/10 text-purple-400 border-purple-500/20")}
                        >
                            {token.type}
                        </button>

                        <div className="flex items-center gap-1 bg-white/5 px-1.5 py-0.5 rounded border border-white/5 flex-shrink-0 h-full">
                            <span className="text-[10px] text-white/30 uppercase font-bold">Q</span>
                            <input
                                type="number"
                                value={token.quantity}
                                onChange={(e) => onUpdateQty(e.target.value)}
                                style={{ width: `${Math.max(1, token.quantity.toString().length) + 2}ch` }}
                                className="bg-transparent border-none text-[11px] font-bold text-yellow-500 min-w-[20px] max-w-[48px] focus:outline-none text-right [&::-webkit-inner-spin-button]:appearance-none"
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Split Columns (Buy | Sell) */}
            <div className="flex-1 min-h-0 flex divide-x divide-white/10">
                {/* Buy Column */}
                <div className="flex-1 flex flex-col min-w-0 group/buy">
                    <div className="p-1 border-b border-white/5 flex items-center justify-center gap-2 relative">
                        <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-wider opacity-80">Buy</span>
                        <button
                            onClick={() => onClearLogs(token.id, 'buy')}
                            className="opacity-30 hover:opacity-100 transition-opacity absolute right-1 p-0.5 hover:text-emerald-400 text-white/50"
                            title="Clear Buy Logs"
                        >
                            <Eraser size={10} />
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-1 scrollbar-thin [&::-webkit-scrollbar]:w-1">
                        <AnimatePresence initial={false} mode='popLayout'>
                            {logs.filter(l => l.side === 'buy').slice(0, 250).map((log) => (
                                <LogRow key={log.id} log={log} token={token} side="buy" timeTick={timeTick} />
                            ))}
                        </AnimatePresence>
                    </div>
                    {/* Net Qty Footer */}
                    <div className={cn(
                        "p-1 px-2 border-t border-white/10 bg-white/[0.02] transition-all",
                        showNetQtyBreakdown ? "min-h-[60px] max-h-[120px] overflow-y-auto scrollbar-none" : "h-[28px]"
                    )}>
                        {!showNetQtyBreakdown ? (
                            <div className="flex items-center justify-between h-full">
                                <span className="text-[9px] font-bold text-white/30 uppercase">Net Qty</span>
                                <span className={cn(
                                    "font-mono text-[13px] font-black tracking-tight",
                                    netBuyData.total > 0 ? "text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.3)]" : "text-white/20"
                                )}>
                                    {netBuyData.total.toLocaleString()}
                                </span>
                            </div>
                        ) : (
                            <div className="space-y-0.5">
                                <div className="flex items-center justify-between border-b border-white/5 pb-0.5 mb-1">
                                    <span className="text-[8px] font-black text-white/20 uppercase tracking-tighter">Net Breakdown (Buy)</span>
                                    <span className="text-[10px] font-black text-emerald-400/80">{netBuyData.total.toLocaleString()}</span>
                                </div>
                                {netBuyData.breakdown.length === 0 ? (
                                    <div className="text-[10px] text-white/10 text-center py-2 italic font-medium">No 1L+ Pulses</div>
                                ) : (
                                    netBuyData.breakdown.map((item, idx) => (
                                        <div key={idx} className="flex items-center justify-between text-[11px] font-mono group/item">
                                            <span className="text-white/40 group-hover/item:text-white/60 transition-colors">{item.price}</span>
                                            <span className="text-emerald-400/90 font-bold">{item.qty.toLocaleString()}</span>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Sell Column */}
                <div className="flex-1 flex flex-col min-w-0 group/sell">
                    <div className="p-1 border-b border-white/5 flex items-center justify-center gap-2 relative">
                        <span className="text-[9px] font-bold text-red-500 uppercase tracking-wider opacity-80">Sell</span>
                        <button
                            onClick={() => onClearLogs(token.id, 'sell')}
                            className="opacity-30 hover:opacity-100 transition-opacity absolute right-1 p-0.5 hover:text-red-400 text-white/50"
                            title="Clear Sell Logs"
                        >
                            <Eraser size={10} />
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-1 scrollbar-thin [&::-webkit-scrollbar]:w-1">
                        <AnimatePresence initial={false} mode='popLayout'>
                            {logs.filter(l => l.side === 'sell').slice(0, 250).map((log) => (
                                <LogRow key={log.id} log={log} token={token} side="sell" timeTick={timeTick} />
                            ))}
                        </AnimatePresence>
                    </div>
                    {/* Net Qty Footer */}
                    <div className={cn(
                        "p-1 px-2 border-t border-white/10 bg-white/[0.02] transition-all",
                        showNetQtyBreakdown ? "min-h-[60px] max-h-[120px] overflow-y-auto scrollbar-none" : "h-[28px]"
                    )}>
                        {!showNetQtyBreakdown ? (
                            <div className="flex items-center justify-between h-full">
                                <span className="text-[9px] font-bold text-white/30 uppercase">Net Qty</span>
                                <span className={cn(
                                    "font-mono text-[13px] font-black tracking-tight",
                                    netSellData.total > 0 ? "text-red-400 drop-shadow-[0_0_8px_rgba(248,113,113,0.3)]" : "text-white/20"
                                )}>
                                    {netSellData.total.toLocaleString()}
                                </span>
                            </div>
                        ) : (
                            <div className="space-y-0.5">
                                <div className="flex items-center justify-between border-b border-white/5 pb-0.5 mb-1">
                                    <span className="text-[8px] font-black text-white/20 uppercase tracking-tighter">Net Breakdown (Sell)</span>
                                    <span className="text-[10px] font-black text-red-400/80">{netSellData.total.toLocaleString()}</span>
                                </div>
                                {netSellData.breakdown.length === 0 ? (
                                    <div className="text-[10px] text-white/10 text-center py-2 italic font-medium">No 1L+ Pulses</div>
                                ) : (
                                    netSellData.breakdown.map((item, idx) => (
                                        <div key={idx} className="flex items-center justify-between text-[11px] font-mono group/item">
                                            <span className="text-white/40 group-hover/item:text-white/60 transition-colors">{item.price}</span>
                                            <span className="text-red-400/90 font-bold">{item.qty.toLocaleString()}</span>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </Reorder.Item>

    );
};

const VerticalLayout = ({
    monitoredTokens,
    logs,
    onAddTokens,
    onRemoveToken,
    onUpdateTokenQty,
    onUpdateTokenStrike,
    onUpdateTokenType,
    onUpdateTokenWidth,
    onClearTokens,
    visibleElements,

    onReorderTokens, // Destructure new prop
    isSidebarVisible, // New prop
    depthData, // Need depthData to get Spot Prices
    onClearLogs // New prop
}) => {
    // --- Top Bar State (Unchanged) ---
    const [globalIndex, setGlobalIndex] = useState('NIFTY');
    const [globalExpiry, setGlobalExpiry] = useState('');
    const [atmStrike, setAtmStrike] = useState(null);
    const [timeTick, setTimeTick] = useState(0);
    const [showNetQtyBreakdown, setShowNetQtyBreakdown] = useState(false);
    const isDraggingRef = useRef(false);

    // Live Timer Tick
    useEffect(() => {
        const interval = setInterval(() => setTimeTick(t => t + 1), 1000);
        return () => clearInterval(interval);
    }, []);

    // --- Spot Price & ATM Logic ---
    useEffect(() => {
        // Prevent auto-reorder while user is manually dragging
        // Using ref check to avoid the "lock re-render" fighting the drag start
        if (isDraggingRef.current) return;

        // 1. Get Spot Token ID based on Global Index
        let spotTokenId = null;
        let step = 50; // Default NIFTY Step

        if (globalIndex === 'NIFTY') { spotTokenId = '26000'; step = 50; }
        else if (globalIndex === 'BANKNIFTY') { spotTokenId = '26009'; step = 100; }
        // Add others if known, else skip

        if (!spotTokenId || !depthData || !depthData[spotTokenId]) return;

        // 2. Get Spot Price
        // IndexData packet structure usually has 'iv' (Index Value) or similar. 
        // Based on typical NSE updates, it might be in `Touchline` format or specific `IndexData`.
        // Let's assume standard `ltp` or `LastTradedPrice` or `iv` is available in the object.
        // We enabled 'IndexData' flow, so let's inspect what we get. usually it's `LastTradedPrice` or `Close`.
        // Ideally we check `rt` (Real Time) or `iv`. Let's fallback to `ltp`.
        const spotPacket = depthData[spotTokenId];
        // IndexData uses 'Price'. Depth uses 'ltp' or 'iv'.
        const spotPrice = parseFloat(spotPacket.Price || spotPacket.iv || spotPacket.ltp || spotPacket.LastTradedPrice || 0);

        if (!spotPrice) {
            console.log(`[ATM] Spot Price missing for ${globalIndex} (${spotTokenId}):`, spotPacket);
            return;
        }

        // 3. Calculate ATM Strike
        const calculatedAtm = Math.round(spotPrice / step) * step;

        // 4. Update interactions ONLY if ATM changes
        if (atmStrike !== calculatedAtm) {
            setAtmStrike(calculatedAtm);
        }

        // 5. Auto-Reorder: Ensure ATM columns (CE & PE) are at front whenever tokens or ATM changes
        const currentTokens = [...monitoredTokens];
        const atmTokens = currentTokens.filter(t =>
            t.index === globalIndex &&
            parseFloat(t.strike) === calculatedAtm
        );

        if (atmTokens.length > 0) {
            // Check if all ATM tokens are already grouped at the very front
            const firstNIds = monitoredTokens.slice(0, atmTokens.length).map(t => t.id);
            const allAtFront = atmTokens.every(t => firstNIds.includes(t.id));

            if (!allAtFront) {
                const nonAtmTokens = currentTokens.filter(t =>
                    !(t.index === globalIndex && parseFloat(t.strike) === calculatedAtm)
                );
                // Maintain relative order of ATM tokens (CE/PE) as they were added
                const newOrder = [...atmTokens, ...nonAtmTokens];
                onReorderTokens(newOrder); // This updates the parent state
            }
        }
    }, [depthData, globalIndex, monitoredTokens, onReorderTokens, atmStrike]);


    const availableExpiries = useMemo(() => {
        let searchIndex = globalIndex === 'SENSEX' ? 'BSX' : globalIndex;
        const filtered = contractsData.filter(c => c.s === searchIndex);
        const expiries = [...new Set(filtered.map(c => c.e))].sort();
        return expiries;
    }, [globalIndex]);

    useEffect(() => {
        if (availableExpiries.length > 0 && !availableExpiries.includes(globalExpiry)) {
            const today = new Date().toISOString().split('T')[0];
            setGlobalExpiry(availableExpiries.find(e => e >= today) || availableExpiries[0]);
        }
    }, [availableExpiries, globalExpiry]);


    const handleAddColumn = () => {
        let defaultStrike = '24000';
        if (globalIndex === 'BANKNIFTY') defaultStrike = '50000';
        if (globalIndex === 'SENSEX') defaultStrike = '80000';

        let searchIndex = globalIndex === 'SENSEX' ? 'BSX' : globalIndex;
        const validContract = contractsData.find(c =>
            c.s === searchIndex &&
            c.e === globalExpiry &&
            c.p === 'CE'
        );

        if (validContract) {
            const strike = typeof validContract.st === 'string' ? validContract.st : validContract.st.toString();
            const tokenObj = {
                id: `${validContract.t}_${Date.now()}`,
                tkn: validContract.t,
                symbol: validContract.ns,
                strike: parseFloat(strike).toString(),
                type: 'CE',
                side: 'both',
                quantity: 5000,
                expiry: globalExpiry,
                index: globalIndex
            };
            onAddTokens([tokenObj]);
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden bg-[#050505]">
            {/* Top Bar */}
            {visibleElements?.config && (
                <div className={cn("flex items-center gap-4 p-2 border-b border-white/10 bg-[#0a0a0e] transition-all",
                    !isSidebarVisible && "pl-12" // Add padding when sidebar is closed to avoid overlap with toggle button
                )}>
                    <div className="flex items-center gap-2">
                        <label className="text-[10px] text-white/40 uppercase font-bold">Index</label>
                        <select
                            value={globalIndex}
                            onChange={(e) => setGlobalIndex(e.target.value)}
                            className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
                        >
                            <option className="bg-[#0a0a0e] text-white" value="NIFTY">NIFTY</option>
                            <option className="bg-[#0a0a0e] text-white" value="BANKNIFTY">BANKNIFTY</option>
                            <option className="bg-[#0a0a0e] text-white" value="FINNIFTY">FINNIFTY</option>
                            <option className="bg-[#0a0a0e] text-white" value="SENSEX">SENSEX</option>
                        </select>
                    </div>

                    <div className="flex items-center gap-2">
                        <label className="text-[10px] text-white/40 uppercase font-bold">Expiry</label>
                        <select
                            value={globalExpiry}
                            onChange={(e) => setGlobalExpiry(e.target.value)}
                            className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
                        >
                            {availableExpiries.map(e => <option className="bg-[#0a0a0e] text-white" key={e} value={e}>{e.split('T')[0]}</option>)}
                        </select>
                    </div>

                    <button
                        onClick={handleAddColumn}
                        className="ml-auto bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-xs font-bold flex items-center gap-1 transition-colors"
                    >
                        <Plus size={14} /> Add Column
                    </button>

                    <div className="flex items-center gap-2 bg-white/5 px-2 py-1 rounded border border-white/10 h-7">
                        <label className="text-[10px] text-white/40 uppercase font-black tracking-tight">Breakdown</label>
                        <button
                            onClick={() => setShowNetQtyBreakdown(!showNetQtyBreakdown)}
                            className={cn(
                                "w-7 h-4 rounded-full relative transition-colors duration-300",
                                showNetQtyBreakdown ? "bg-emerald-500/80" : "bg-white/10"
                            )}
                        >
                            <div className={cn(
                                "absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform duration-300 shadow-sm",
                                showNetQtyBreakdown ? "translate-x-3" : "translate-x-0"
                            )} />
                        </button>
                    </div>

                    <button onClick={onClearTokens} className="bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20 font-bold py-1 px-3 rounded text-[10px] h-7 flex items-center gap-2">
                        <Trash2 size={10} /> Clear
                    </button>
                </div>
            )}

            {/* Main Content with Reorder.Group */}
            <div className="flex-1 overflow-x-auto overflow-y-hidden p-2 relative">
                <Reorder.Group
                    axis="x"
                    values={monitoredTokens}
                    onReorder={onReorderTokens}
                    className="flex h-full gap-4 pb-4 w-fit min-w-full" // Use w-fit to ensure scrollbar triggers correctly
                >
                    {monitoredTokens.map(token => {
                        const isAtm = token.index === globalIndex && parseFloat(token.strike) === atmStrike;
                        return (
                            <DraggableColumn
                                key={token.id}
                                token={token}
                                isAtm={isAtm}
                                timeTick={timeTick}
                                onDragStateChange={(val) => (isDraggingRef.current = val)}
                                logs={logs.filter(l => l.tokenId === token.id || l.tokenId === token.tkn)}
                                onRemove={() => onRemoveToken(token.id)}
                                onUpdateQty={(q) => onUpdateTokenQty(token.id, q)}
                                onUpdateStrike={(s) => {
                                    let searchIndex = token.index === 'SENSEX' ? 'BSX' : token.index;
                                    const strikeVal = Number(s).toFixed(5);
                                    const contract = contractsData.find(c =>
                                        c.s === searchIndex &&
                                        c.p === token.type &&
                                        c.e === token.expiry &&
                                        Number(c.st).toFixed(5) === strikeVal
                                    );
                                    if (contract) {
                                        onUpdateTokenStrike(token.id, s, contract.t, contract.ns);
                                    }
                                }}
                                onUpdateType={(newType) => {
                                    let searchIndex = token.index === 'SENSEX' ? 'BSX' : token.index;
                                    const strikeVal = Number(token.strike).toFixed(5);
                                    const contract = contractsData.find(c =>
                                        c.s === searchIndex &&
                                        c.p === newType &&
                                        c.e === token.expiry &&
                                        Number(c.st).toFixed(5) === strikeVal
                                    );
                                    if (contract) {
                                        onUpdateTokenType(token.id, newType, contract.t, contract.ns);
                                    }
                                }}
                                onUpdateWidth={(w) => onUpdateTokenWidth(token.id, w)}
                                onClearLogs={onClearLogs}
                                showNetQtyBreakdown={showNetQtyBreakdown}
                            />
                        );
                    })}

                    {monitoredTokens.length === 0 && (
                        <div className="flex items-center justify-center w-64 h-full border border-dashed border-white/10 rounded text-white/20 text-sm">
                            Add a column to start
                        </div>
                    )}
                </Reorder.Group>
            </div>
        </div>
    );
};

export default VerticalLayout;
