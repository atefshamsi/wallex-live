const https = require("https");
const WebSocket = require("ws");
const { MACD } = require("technicalindicators");
const SYMBOL = "DOGE-SWAP-USDT";
const LIMIT = 200;
function getFuturesSymbols() {
    return new Promise((resolve, reject) => {
        const url =
            "https://api.toobit.com/api/v1/exchangeInfo";
        https.get(url, (res) => {
            let data = "";
            res.on("data", chunk => {
                data += chunk;
            });
            res.on("end", () => {
                try {
                    const result =
                        JSON.parse(data);
                    if (
                        !result ||
                        !Array.isArray(result.contracts)
                    ) {
                        reject(
                            new Error(
                                "Invalid Futures contracts response"
                            )
                        );
                        return;
                    }
                    const symbols =
                    result.contracts
                        .filter(contract =>
                            contract.symbol &&
                            contract.symbol.endsWith("-SWAP-USDT") &&
                            contract.isRwa !== true &&
                            contract.rwaType !== "STOCK" &&
                            !(Array.isArray(contract.categories) && contract.categories.includes("TradFi"))
                        )
                        .map(contract =>
                            contract.symbol
                        );
                    resolve(symbols);
                } catch (error) {
                    reject(error);
                }
            });
        }).on("error", reject);
    });
}
function getFuturesTickers() {
    return new Promise((resolve, reject) => {
        const url =
            "https://api.toobit.com/quote/v1/contract/ticker/24hr";
        https.get(url, (res) => {
            let data = "";
            res.on("data", chunk => {
                data += chunk;
            });
            res.on("end", () => {
                try {
                    const result =
                        JSON.parse(data);
                    if (!Array.isArray(result)) {
                        reject(
                            new Error(
                                "Invalid Futures ticker response"
                            )
                        );
                        return;
                    }
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            });
        }).on("error", reject);
    });
}
const MARGIN_USDT = 5;
const LEVERAGE = 10;
const TIMEFRAMES = ["1m", "5m", "15m"];
const DASHBOARD_WS_URL = "ws://localhost:3000";
const dashboard = new WebSocket(DASHBOARD_WS_URL);
dashboard.on("open", () => {
    console.log("🖥️ Chrome Dashboard connected");
    dashboard.send(JSON.stringify({
        type: "TEST",
        message: "Engine connected successfully"
    }));
});
dashboard.on("error", error => {
    console.log(`❌ Chrome Dashboard error: ${error.message}`);
});
dashboard.on("message", async message => {
    try {
        const data = JSON.parse(message.toString());
        if (data.type === "NEW_SEARCH") {
            console.log("🔎 NEW SEARCH received from Chrome");
            await runFullScan();
        }
    } catch (error) {
        console.log(`❌ Invalid Dashboard message: ${error.message}`);
    }
});
const LOW_RISK_SL_PERCENT = 0.75;
const MAX_SL_PERCENT = 1.0;
let lastAnalysisState = null;
const candles = {
    "1m": [],
    "5m": [],
    "15m": []
};
// ================================
// دریافت تاریخچه
// ================================
function getHistory(interval) {
    return new Promise((resolve, reject) => {
        const url =
            `https://api.toobit.com/quote/v1/klines` +
            `?symbol=${SYMBOL}` +
            `&interval=${interval}` +
            `&limit=${LIMIT}`;
        https.get(url, (res) => {
            let data = "";
            res.on("data", chunk => {
                data += chunk;
            });
            res.on("end", () => {
                try {
                    const result = JSON.parse(data);
                    if (!Array.isArray(result)) {
                        reject(
                            new Error("Invalid Toobit response")
                        );
                        return;
                    }
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            });
        }).on("error", reject);
    });
}
function getSymbolHistory(symbol, interval, limit = 100) {
    return new Promise((resolve, reject) => {
        const url = `https://api.toobit.com/quote/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        https.get(url, (res) => {
            let data = "";
            res.on("data", chunk => {
                data += chunk;
            });
            res.on("end", () => {
                try {
                    const result = JSON.parse(data);
                    if (!Array.isArray(result)) {
                        reject(new Error(`Invalid history response: ${symbol}`));
                        return;
                    }
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            });
        }).on("error", reject);
    });
}
function analyze15mTrend(history) {
    const data = history.map(normalizeCandle).slice(0, -1);
    if (data.length < 50) return "NEUTRAL";
    const closes = data.map(candle => candle.close);
    const macdInput = {
        values: closes,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false
    };
    const macd = MACD.calculate(macdInput);
    if (macd.length === 0) return "NEUTRAL";
    const lastMACD = macd[macd.length - 1];
    const priceAction = data.slice(-30);
    const highs = priceAction.map(candle => candle.high);
    const lows = priceAction.map(candle => candle.low);
    const currentPrice = closes[closes.length - 1];
    const recentHigh = Math.max(...highs.slice(-10));
    const recentLow = Math.min(...lows.slice(-10));
    const previousHigh = Math.max(...highs.slice(0, -10));
    const previousLow = Math.min(...lows.slice(0, -10));
    let bullishScore = 0;
    let bearishScore = 0;
    if (lastMACD.MACD > lastMACD.signal) bullishScore++;
    if (lastMACD.MACD < lastMACD.signal) bearishScore++;
    if (recentHigh > previousHigh) bullishScore++;
    if (recentLow > previousLow) bullishScore++;
    if (recentHigh < previousHigh) bearishScore++;
    if (recentLow < previousLow) bearishScore++;
    if (currentPrice > recentHigh) bullishScore++;
    if (currentPrice < recentLow) bearishScore++;
    if (bullishScore >= 3 && bullishScore > bearishScore) return "BULLISH";
    if (bearishScore >= 3 && bearishScore > bullishScore) return "BEARISH";
    return "NEUTRAL";
}
function analyze5mTrend(history, trend15m) {
    const data = history.map(normalizeCandle).slice(0, -1);
    if (data.length < 50) return "NEUTRAL";
    const closes = data.map(candle => candle.close);
    const macd = MACD.calculate({
        values: closes,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false
    });
    if (macd.length === 0) return "NEUTRAL";
    const lastMACD = macd[macd.length - 1];
    const priceAction = data.slice(-30);
    const highs = priceAction.map(candle => candle.high);
    const lows = priceAction.map(candle => candle.low);
    const recentHigh = Math.max(...highs.slice(-10));
    const recentLow = Math.min(...lows.slice(-10));
    const previousHigh = Math.max(...highs.slice(0, -10));
    const previousLow = Math.min(...lows.slice(0, -10));
    let bullishScore = 0;
    let bearishScore = 0;
    if (lastMACD.MACD > lastMACD.signal) bullishScore++;
    if (lastMACD.MACD < lastMACD.signal) bearishScore++;
    if (recentHigh > previousHigh) bullishScore++;
    if (recentLow > previousLow) bullishScore++;
    if (recentHigh < previousHigh) bearishScore++;
    if (recentLow < previousLow) bearishScore++;
    if (trend15m === "BULLISH" && bullishScore > bearishScore) return "BULLISH";
    if (trend15m === "BEARISH" && bearishScore > bullishScore) return "BEARISH";
    return "NEUTRAL";
}
function analyze5mIchimoku(history, trend5m) {
    const data = history.map(normalizeCandle).slice(0, -1);
    if (data.length < 60) return false;
    const highs = data.map(candle => candle.high);
    const lows = data.map(candle => candle.low);
    const closes = data.map(candle => candle.close);
    const tenkanHigh = Math.max(...highs.slice(-9));
    const tenkanLow = Math.min(...lows.slice(-9));
    const tenkan = (tenkanHigh + tenkanLow) / 2;
    const kijunHigh = Math.max(...highs.slice(-26));
    const kijunLow = Math.min(...lows.slice(-26));
    const kijun = (kijunHigh + kijunLow) / 2;
    const spanA = (tenkan + kijun) / 2;
    const spanBHigh = Math.max(...highs.slice(-52));
    const spanBLow = Math.min(...lows.slice(-52));
    const spanB = (spanBHigh + spanBLow) / 2;
    const price = closes[closes.length - 1];
    const cloudTop = Math.max(spanA, spanB);
    const cloudBottom = Math.min(spanA, spanB);
    const tkBullish = tenkan > kijun;
    const tkBearish = tenkan < kijun;
    const cloudBullish = spanA > spanB;
    const cloudBearish = spanA < spanB;
    const priceAboveCloud = price > cloudTop;
    const priceBelowCloud = price < cloudBottom;
    if (trend5m === "BULLISH") {
        return tkBullish && cloudBullish && priceAboveCloud;
    }
    if (trend5m === "BEARISH") {
        return tkBearish && cloudBearish && priceBelowCloud;
    }
    return false;
}
function analyze5mPriceAction(history, trend5m) {
    const data = history.map(normalizeCandle).slice(0, -1);
    if (data.length < 30) return null;
    const candles = data.slice(-30);
    const lookback = 2;
    const swingHighs = [];
    const swingLows = [];
    for (let i = lookback; i < candles.length - lookback; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const leftHighs = candles.slice(i - lookback, i).map(candle => candle.high);
        const rightHighs = candles.slice(i + 1, i + 1 + lookback).map(candle => candle.high);
        const leftLows = candles.slice(i - lookback, i).map(candle => candle.low);
        const rightLows = candles.slice(i + 1, i + 1 + lookback).map(candle => candle.low);
        if (high > Math.max(...leftHighs) && high > Math.max(...rightHighs)) {
            swingHighs.push(high);
        }
        if (low < Math.min(...leftLows) && low < Math.min(...rightLows)) {
            swingLows.push(low);
        }
    }
    if (swingHighs.length < 2 || swingLows.length < 2) return null;
    const lastHigh = swingHighs[swingHighs.length - 1];
    const previousHigh = swingHighs[swingHighs.length - 2];
    const lastLow = swingLows[swingLows.length - 1];
    const previousLow = swingLows[swingLows.length - 2];
    const lastCandle = candles[candles.length - 1];
    const bullishStructure = lastHigh > previousHigh && lastLow > previousLow;
    const bearishStructure = lastHigh < previousHigh && lastLow < previousLow;
    const breakout = lastCandle.close > lastHigh;
    const breakdown = lastCandle.close < lastLow;
    let structure = "RANGE";
    if (bullishStructure) structure = "BULLISH";
    if (bearishStructure) structure = "BEARISH";
    if (trend5m === "BULLISH" && (bullishStructure || breakout || lastCandle.close > previousHigh)) {
        return {
            direction: "BULLISH",
            structure,
            breakout,
            breakdown,
            lastHigh,
            previousHigh,
            lastLow,
            previousLow,
            candleDirection: lastCandle.close >= lastCandle.open ? "BULLISH" : "BEARISH"
        };
    }
    if (trend5m === "BEARISH" && (bearishStructure || breakdown || lastCandle.close < previousLow)) {
        return {
            direction: "BEARISH",
            structure,
            breakout,
            breakdown,
            lastHigh,
            previousHigh,
            lastLow,
            previousLow,
            candleDirection: lastCandle.close <= lastCandle.open ? "BEARISH" : "BULLISH"
        };
    }
    return null;
}
function analyze1mTrigger(history, direction) {
    const data = history.map(normalizeCandle).slice(0, -1);
    if (data.length < 20) return null;
    const candles = data.slice(-20);
    const closes = candles.map(candle => candle.close);
    const macd = MACD.calculate({
        values: closes,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false
    });
    if (macd.length === 0) return null;
    const lastMACD = macd[macd.length - 1];
    const lastCandle = candles[candles.length - 1];
    const previousCandles = candles.slice(-6, -1);
    const resistance = Math.max(...previousCandles.map(candle => candle.high));
    const support = Math.min(...previousCandles.map(candle => candle.low));
    const bullishCandle = lastCandle.close > lastCandle.open;
    const bearishCandle = lastCandle.close < lastCandle.open;
    const bullishMACD = lastMACD.MACD > lastMACD.signal;
    const bearishMACD = lastMACD.MACD < lastMACD.signal;
    const bullishBreakout = lastCandle.close > resistance;
    const bearishBreakdown = lastCandle.close < support;
    if (direction === "LONG" && bullishBreakout && bullishMACD) {
        return {
            trigger: "LONG TRIGGER",
            price: lastCandle.close,
            support,
            resistance,
            candleDirection: bullishCandle ? "BULLISH" : "BEARISH",
            macdDirection: "BULLISH"
        };
    }
    if (direction === "SHORT" && bearishBreakdown && bearishMACD) {
        return {
            trigger: "SHORT TRIGGER",
            price: lastCandle.close,
            support,
            resistance,
            candleDirection: bearishCandle ? "BEARISH" : "BULLISH",
            macdDirection: "BEARISH"
        };
    }
    return {
        trigger: "WAIT",
        price: lastCandle.close,
        support,
        resistance,
        candleDirection: bullishCandle ? "BULLISH" : bearishCandle ? "BEARISH" : "NEUTRAL",
        macdDirection: bullishMACD ? "BULLISH" : bearishMACD ? "BEARISH" : "NEUTRAL"
    };
}
function analyzeScannerEntry(history, direction, history5m, priceAction5m) {
    const data = history.map(normalizeCandle).slice(0, -1);
    if (data.length < 40) {
        return {
            entryType: "REJECTED",
            reason: `NOT ENOUGH 1m DATA | Candles=${data.length}`
        };
    }
    const candles = data.slice(-40);
    const closes = candles.map(candle => candle.close);
    const macd = MACD.calculate({
        values: closes,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false
    });
    if (macd.length === 0) {
        return {
            entryType: "REJECTED",
            reason: "MACD DATA NOT AVAILABLE"
        };
    }
    const lastMACD = macd[macd.length - 1];
    const lastCandle = candles[candles.length - 1];
    const previousCandles = candles.slice(-6, -1);
    const currentPrice = lastCandle.close;
    const resistance = Math.max(...previousCandles.map(candle => candle.high));
    const support = Math.min(...previousCandles.map(candle => candle.low));
    const support5m = priceAction5m ? priceAction5m.lastLow : null;
    const resistance5m = priceAction5m ? priceAction5m.lastHigh : null;
    const bullishCandle = lastCandle.close > lastCandle.open;
    const bearishCandle = lastCandle.close < lastCandle.open;
    const bullishMACD = lastMACD.MACD > lastMACD.signal;
    const bearishMACD = lastMACD.MACD < lastMACD.signal;
    const bullishBreakout = currentPrice > resistance;
    const bearishBreakdown = currentPrice < support;
    const maxLimitDistance = 1.5;
    const longLimitDistance = support5m < currentPrice
    ? (currentPrice - support5m) / currentPrice * 100
    : null;
    const shortLimitDistance = resistance5m > currentPrice
    ? (resistance5m - currentPrice) / currentPrice * 100
    : null;
    if (direction === "LONG" && bullishBreakout && bullishMACD && bullishCandle) {
        return {
            entryType: "TRIGGER → MARKET",
            entryPrice: currentPrice,
            currentPrice,
            support,
            resistance,
            macdDirection: "BULLISH",
            candleDirection: "BULLISH",
            reason: "BREAKOUT + MACD + BULLISH CANDLE"
        };
    }
    if (direction === "SHORT" && bearishBreakdown && bearishMACD && bearishCandle) {
        return {
            entryType: "TRIGGER → MARKET",
            entryPrice: currentPrice,
            currentPrice,
            support,
            resistance,
            macdDirection: "BEARISH",
            candleDirection: "BEARISH",
            reason: "BREAKDOWN + MACD + BEARISH CANDLE"
        };
    }
    if (direction === "LONG" && support < currentPrice && longLimitDistance <= maxLimitDistance) {
        return {
            entryType: "LIMIT",
            entryPrice: support5m,
            currentPrice,
            support,
            resistance,
            macdDirection: "BULLISH",
            candleDirection: bullishCandle ? "BULLISH" : "BEARISH",
            limitDistance: longLimitDistance,
            reason: "PULLBACK TO SUPPORT"
        };
    }
    if (direction === "SHORT" && resistance > currentPrice && shortLimitDistance <= maxLimitDistance) {
        return {
            entryType: "LIMIT",
            entryPrice: resistance5m,
            currentPrice,
            support,
            resistance,
            macdDirection: "BEARISH",
            candleDirection: bearishCandle ? "BEARISH" : "BULLISH",
            limitDistance: shortLimitDistance,
            reason: "PULLBACK TO RESISTANCE"
        };
    }
    return {
        entryType: "REJECTED",
        entryPrice: null,
        currentPrice,
        support,
        resistance,
        macdDirection: bullishMACD ? "BULLISH" : bearishMACD ? "BEARISH" : "NEUTRAL",
        candleDirection: bullishCandle ? "BULLISH" : bearishCandle ? "BEARISH" : "NEUTRAL",
        limitDistance: direction === "LONG" ? longLimitDistance : shortLimitDistance,
        reason: direction === "LONG"
            ? `LONG CONDITIONS NOT MET | MACD=${bullishMACD ? "BULLISH" : "NOT BULLISH"} | Breakout=${bullishBreakout} | Candle=${bullishCandle ? "BULLISH" : "NOT BULLISH"} | LimitDistance=${longLimitDistance !== null ? longLimitDistance.toFixed(3) + "%" : "N/A"}`
            : `SHORT CONDITIONS NOT MET | MACD=${bearishMACD ? "BEARISH" : "NOT BEARISH"} | Breakdown=${bearishBreakdown} | Candle=${bearishCandle ? "BEARISH" : "NOT BEARISH"} | LimitDistance=${shortLimitDistance !== null ? shortLimitDistance.toFixed(3) + "%" : "N/A"}`
    };
}
async function scan15mCandidates(candidates) {
    console.log("\n🔍 15m + 5m + ICHIMOKU + PRICE ACTION + ENTRY + SL SCAN");
    const scanStats = {
        initial: candidates.length,
        trend15m: 0,
        trend5m: 0,
        ichimoku: 0,
        priceAction: 0,
        entry: 0,
        sl: 0
    };
    const trendCandidates = []; 
    for (const ticker of candidates) { 
        try { 
            const history15m = await getSymbolHistory(ticker.s, "15m", 100); 
            const trend15m = analyze15mTrend(history15m); 
            console.log(`${ticker.s} | 15m: ${trend15m}`); 
            if (trend15m !== "BULLISH" && trend15m !== "BEARISH") continue;
            scanStats.trend15m++; 
            const history5m = await getSymbolHistory(ticker.s, "5m", 100); 
            const trend5m = analyze5mTrend(history5m, trend15m); 
            console.log(`${ticker.s} | 5m: ${trend5m}`); 
            if (trend5m !== trend15m) continue;
            scanStats.trend5m++; 
            const ichimoku5m = analyze5mIchimoku(history5m, trend5m); 
            console.log(`${ticker.s} | 5m Ichimoku: ${ichimoku5m ? "CONFIRMED" : "REJECTED"}`); 
            if (!ichimoku5m) continue;
            scanStats.ichimoku++; 
            const priceAction5m = analyze5mPriceAction(history5m, trend5m); 
            console.log(`${ticker.s} | 5m Price Action: ${priceAction5m ? priceAction5m.direction : "REJECTED"}`); 
            if (!priceAction5m) continue;
            scanStats.priceAction++; 
            const history1m = await getSymbolHistory(ticker.s, "1m", 100); 
            const priceReceivedAt = new Date(); 
            const direction = trend5m === "BULLISH" ? "LONG" : "SHORT"; 
            const entry = analyzeScannerEntry(history1m, direction, history5m, priceAction5m);
            console.log(`${ticker.s} | 1m Entry: ${entry ? entry.entryType : "REJECTED"} | Entry: ${entry ? entry.entryPrice : "-"}`);
            if (!entry) {
                console.log(`${ticker.s} | Entry Debug: direction=${direction}`);
            } 
            if (!entry || entry.entryType === "REJECTED") {
                console.log(`${ticker.s} | Entry Debug: ${entry ? entry.reason : "NO DATA"}`);
                continue;
            }
            scanStats.entry++; 
            const sl = entry.entryType === "LIMIT"
                ? direction === "LONG" ? priceAction5m.previousLow : priceAction5m.previousHigh
                : direction === "LONG" ? priceAction5m.lastLow : priceAction5m.lastHigh; 
            if (!Number.isFinite(sl) || sl <= 0) continue; 
            const riskPercent = Math.abs(entry.entryPrice - sl) / entry.entryPrice * 100;
            if (entry.entryType === "LIMIT") {
                const validLimitStructure = direction === "LONG"
                    ? sl < entry.entryPrice && entry.entryPrice < entry.currentPrice
                    : entry.currentPrice < entry.entryPrice && entry.entryPrice < sl;
                if (!validLimitStructure) {
                    console.log(`${ticker.s} | LIMIT Structure Invalid | Current: ${entry.currentPrice} | Entry: ${entry.entryPrice} | SL: ${sl} | NO TRADE`);
                    continue;
                }
            } 
            if (riskPercent <= 0 || riskPercent > MAX_SL_PERCENT) {
                console.log(`${ticker.s} | SL REJECTED | Direction: ${direction} | Entry: ${entry.entryPrice} | Current: ${entry.currentPrice} | SL: ${sl} | Risk: ${riskPercent.toFixed(2)}% | Max: ${MAX_SL_PERCENT}%`);
                continue;
            }
            scanStats.sl++;
            console.log(`${ticker.s} | SL: ${sl} | Risk: ${riskPercent.toFixed(2)}%`);
            const takeProfits = calculateScannerTakeProfits(direction, entry.entryPrice, sl);
            if (!takeProfits) continue;
            console.log(`${ticker.s} | TP1: ${takeProfits.tp1} | TP2: ${takeProfits.tp2}`);
            const score = calculateScannerScore({
                ...ticker,
                trend15m,
                trend5m,
                ichimoku5m,
                priceAction5m,
                direction,
                entryType: entry.entryType,
                entryPrice: entry.entryPrice,
                riskPercent
            }); 
            trendCandidates.push({ 
                    ...ticker, 
                    trend15m,
                    trend5m, 
                    ichimoku5m, 
                    priceAction5m, 
                    direction, 
                    entryType: entry.entryType, 
                    entryPrice: entry.entryPrice, 
                    currentPrice: entry.currentPrice, 
                    sl,
                    riskPercent,
                    score,
                    riskAmount: takeProfits.risk,
                    tp1: takeProfits.tp1,
                    tp2: takeProfits.tp2, 
                    priceReceivedAt, 
                    history15m, 
                    history5m, 
                    history1m 
                }); 
            } 
            catch (error) { 
                console.log(`❌ ${ticker.s} | ${error.message}`); 
            } 
        } 
        trendCandidates.sort((a, b) => {
        if (b.score !== a.score) {
            return b.score - a.score;
        }
        return a.riskPercent - b.riskPercent;
        });
        console.log(`\n✅ Final Qualified After Entry + SL: ${trendCandidates.length} symbols`);
        if (dashboard.readyState === WebSocket.OPEN) {
            console.log("📤 Sending SCAN_STATUS to Chrome");
            dashboard.send(JSON.stringify({
                type: "SCAN_STATUS",
                status: trendCandidates.length > 0 ? "SIGNALS_FOUND" : "NO_SIGNAL",
                stats: scanStats,
                finalTrades: trendCandidates.length,
                trades: trendCandidates.slice(0, 5),
                receivedAt: new Date().toLocaleString("en-US", { timeZone: "Asia/Tehran" })
            }));
        }
        trendCandidates.slice(0, 9).forEach((candidate, index) => {
            console.log(`${index + 1}. ${candidate.s} | ${candidate.direction} | Score: ${candidate.score} | Risk: ${candidate.riskPercent.toFixed(2)}%`);
        });
        console.log("\n📊 SCAN STATISTICS");
        console.log(`Initial Candidates : ${scanStats.initial}`);
        console.log(`15m Passed         : ${scanStats.trend15m}`);
        console.log(`5m Passed          : ${scanStats.trend5m}`);
        console.log(`Ichimoku Passed    : ${scanStats.ichimoku}`);
        console.log(`Price Action Passed: ${scanStats.priceAction}`);
        console.log(`Entry Passed       : ${scanStats.entry}`);
        console.log(`SL Passed          : ${scanStats.sl}`);
        console.log(`Final Trades       : ${trendCandidates.length}`);
    return trendCandidates;
}
function displayFinalTrades(candidates) {
    const finalTrades = candidates.slice(0, 5);
    console.log("\n════════════════════════════════════════");
    console.log("🎯 FINAL 5 FUTURES SCALP TRADES");
    console.log("════════════════════════════════════════");
    if (finalTrades.length === 0) {
        console.log("❌ No suitable trades found");
        return;
    }
    finalTrades.forEach((candidate, index) => {
        const receivedTime = candidate.priceReceivedAt.toLocaleTimeString("en-GB");
        console.log(`\n#${index + 1} ${candidate.s}`);
        console.log(`Direction          : ${candidate.direction}`);
        console.log(`Entry Type         : ${candidate.entryType}`);
        console.log(`Current Price      : ${candidate.currentPrice}`);
        console.log(`Entry              : ${candidate.entryPrice}`);
        console.log(`SL                 : ${candidate.sl}`);
        console.log(`SL Risk            : ${candidate.riskPercent.toFixed(2)}%`);
        console.log(`TP1                : ${candidate.tp1}`);
        console.log(`TP2                : ${candidate.tp2}`);
        console.log(`R/R TP1            : 1:1.5`);
        console.log(`R/R TP2            : 1:2.5`);
        console.log(`Score              : ${candidate.score}`);
        console.log(`Engine Receive Time: ${receivedTime}`);
        console.log("----------------------------------------");
    });
}
function calculateScannerTakeProfits(direction, entry, sl) {
    if (!Number.isFinite(entry) || !Number.isFinite(sl) || entry <= 0 || sl <= 0) {
        return null;
    }
    const risk = Math.abs(entry - sl);
    if (risk <= 0) {
        return null;
    }
    const tp1 = direction === "LONG"
        ? entry + risk * 1.5
        : entry - risk * 1.5;
    const tp2 = direction === "LONG"
        ? entry + risk * 2.5
        : entry - risk * 2.5;
    return {
        risk,
        tp1,
        tp2,
        rr1: 1.5,
        rr2: 2.5
    };
}
function calculateScannerScore(candidate) {
    let score = 0;
    if (candidate.trend15m === candidate.trend5m) {
        score += 2;
    }
    if (candidate.ichimoku5m) {
        score += 2;
    }
    if (candidate.priceAction5m && candidate.priceAction5m.direction === (candidate.direction === "LONG" ? "BULLISH" : "BEARISH")) {
        score += 2;
    }
    if (candidate.entryType === "TRIGGER → MARKET") {
        score += 2;
    }
    if (candidate.entryType === "LIMIT") {
        score += 1;
    }
    if (candidate.riskPercent <= LOW_RISK_SL_PERCENT) {
        score += 2;
    } else if (candidate.riskPercent <= MAX_SL_PERCENT) {
        score += 1;
    }
    if (candidate.entryType === "LIMIT" && Number.isFinite(candidate.currentPrice) && Number.isFinite(candidate.entryPrice)) {
        const limitDistance = Math.abs(candidate.currentPrice - candidate.entryPrice) / candidate.currentPrice * 100;
        if (limitDistance <= 0.25) {
            score += 1;
        }
    }
    return score;
}
// ================================
// تبدیل کندل
// ================================
function normalizeCandle(candle) {
    // REST API
    if (Array.isArray(candle)) {
        return {
            time: Number(candle[0]),
            open: Number(candle[1]),
            high: Number(candle[2]),
            low: Number(candle[3]),
            close: Number(candle[4]),
            volume: Number(candle[5])
        };
    }
    // WebSocket
    return {
        time: Number(candle.t),
        open: Number(candle.o),
        high: Number(candle.h),
        low: Number(candle.l),
        close: Number(candle.c),
        volume: Number(candle.v)
    };
}
// ================================
// بارگذاری تاریخچه
// ================================
async function loadHistory() {
    console.log("📥 Loading Toobit history...");
    for (const timeframe of TIMEFRAMES) {
        const data = await getHistory(timeframe);
        candles[timeframe] =
            data.map(normalizeCandle);
        console.log(
            `✅ ${timeframe}: ${candles[timeframe].length} candles`
        );
    }
}
function calculateMACD(timeframe) {
    const list = candles[timeframe];
    if (list.length < 50) {
        return;
    }
    // فقط کندل‌های بسته‌شده
    const closes = list
        .slice(0, -1)
        .map(candle => candle.close);
    const result = MACD.calculate({
        values: closes,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false
    });
    if (result.length < 2) {
        return;
    }
    const current = result[result.length - 1];
    const previous = result[result.length - 2];
    const macd = current.MACD;
    const signal = current.signal;
    const histogram = current.histogram;
    const previousHistogram =
        previous.histogram;
    let direction = "NEUTRAL";
    let momentum = "NEUTRAL";
    let cross = "NO CROSS";
    // =========================
    // جهت MACD
    // =========================
    if (macd > signal) {
        direction = "🟢 BULLISH";
    }
    else if (macd < signal) {
        direction = "🔴 BEARISH";
    }
    // =========================
    // کراس
    // =========================
    if (
        previous.MACD <= previous.signal &&
        macd > signal
    ) {
        cross = "🟢 BULLISH CROSS";
    }
    else if (
        previous.MACD >= previous.signal &&
        macd < signal
    ) {
        cross = "🔴 BEARISH CROSS";
    }
    // =========================
    // قدرت مومنتوم
    // =========================
    if (
        histogram > previousHistogram
    ) {
        momentum = "📈 INCREASING";
    }
    else if (
        histogram < previousHistogram
    ) {
        momentum = "📉 DECREASING";
    }
    console.log(
        `\n📈 ${timeframe} MACD`
    );
    console.log(
        `MACD      : ${macd.toFixed(6)}`
    );
    console.log(
        `Signal    : ${signal.toFixed(6)}`
    );
    console.log(
        `Histogram : ${histogram.toFixed(6)}`
    );
    console.log(
        `Direction : ${direction}`
    );
    console.log(
        `Cross     : ${cross}`
    );
    console.log(
        `Momentum  : ${momentum}`
    );
}
function getIchimokuValues(timeframe) {
    const list = candles[timeframe];
    if (list.length < 100) {
        return null;
    }
    // فقط کندل‌های بسته‌شده
    const data = list.slice(0, -1);
    const currentIndex = data.length - 1;
    function highestHigh(start, end) {
        let highest = -Infinity;
        for (let i = start; i <= end; i++) {
            highest = Math.max(highest, data[i].high);
        }
        return highest;
    }
    function lowestLow(start, end) {
        let lowest = Infinity;
        for (let i = start; i <= end; i++) {
            lowest = Math.min(lowest, data[i].low);
        }
        return lowest;
    }
    function midpoint(start, end) {
        const high = highestHigh(start, end);
        const low = lowestLow(start, end);
        return (high + low) / 2;
    }
    // =================================
    // Tenkan-sen
    // 9 periods
    // =================================
    const tenkan = midpoint(
        currentIndex - 8,
        currentIndex
    );
    // =================================
    // Kijun-sen
    // 26 periods
    // =================================
    const kijun = midpoint(
        currentIndex - 25,
        currentIndex
    );
    // =================================
    // Senkou Span A
    //
    // نکته مهم:
    // برای Cloud فعلی باید مقدار
    // 26 کندل قبل را بررسی کنیم.
    // =================================
    const cloudIndex =
        currentIndex - 26;
    const tenkan26 = midpoint(
        cloudIndex - 8,
        cloudIndex
    );
    const kijun26 = midpoint(
        cloudIndex - 25,
        cloudIndex
    );
    const senkouA =
        (tenkan26 + kijun26) / 2;
    // =================================
    // Senkou Span B
    //
    // 52 کندل،
    // محاسبه‌شده در 26 کندل قبل
    // =================================
    const senkouB =
        midpoint(
            cloudIndex - 51,
            cloudIndex
        );
    // =================================
    // قیمت فعلی
    // =================================
    const price =
        data[currentIndex].close;
    // =================================
    // وضعیت قیمت نسبت به Cloud
    // =================================
    const cloudTop =
        Math.max(senkouA, senkouB);
    const cloudBottom =
        Math.min(senkouA, senkouB);
    let cloudPosition =
        "INSIDE CLOUD";
    if (price > cloudTop) {
        cloudPosition =
            "🟢 ABOVE CLOUD";
    }
    else if (price < cloudBottom) {
        cloudPosition =
            "🔴 BELOW CLOUD";
    }
    // =================================
    // Tenkan / Kijun
    // =================================
    let tkDirection =
        "NEUTRAL";
    if (tenkan > kijun) {
        tkDirection =
            "🟢 TENKAN > KIJUN";
    }
    else if (tenkan < kijun) {
        tkDirection =
            "🔴 TENKAN < KIJUN";
    }
    // =================================
    // Cloud Direction
    // =================================
    let cloudDirection =
        "NEUTRAL";
    if (senkouA > senkouB) {
        cloudDirection =
            "🟢 BULLISH CLOUD";
    }
    else if (senkouA < senkouB) {
        cloudDirection =
            "🔴 BEARISH CLOUD";
    }
    return {
        price,
        tenkan,
        kijun,
        senkouA,
        senkouB,
        cloudTop,
        cloudBottom,
        cloudPosition,
        tkDirection,
        cloudDirection
    };
}
function calculateIchimoku(timeframe) {
    const result =
        getIchimokuValues(timeframe);
    if (!result) {
        return;
    }
    console.log(
        `\n☁️ ${timeframe} ICHIMOKU`
    );
    console.log(
        `Price       : ${result.price}`
    );
    console.log(
        `Tenkan      : ${result.tenkan}`
    );
    console.log(
        `Kijun       : ${result.kijun}`
    );
    console.log(
        `Senkou A    : ${result.senkouA}`
    );
    console.log(
        `Senkou B    : ${result.senkouB}`
    );
    console.log(
        `TK Direction: ${result.tkDirection}`
    );
    console.log(
        `Cloud       : ${result.cloudDirection}`
    );
    console.log(
        `Position    : ${result.cloudPosition}`
    );
}
function getPriceActionStructure(timeframe) {
    const list = candles[timeframe];
    if (list.length < 30) {
        return null;
    }
    // فقط کندل‌های بسته‌شده
    const data = list.slice(0, -1);
    const lookback = 2;
    const swingHighs = [];
    const swingLows = [];
    // =================================
    // پیدا کردن Swing High / Swing Low
    // =================================
    for (
        let i = lookback;
        i < data.length - lookback;
        i++
    ) {
        const current = data[i];
        let isSwingHigh = true;
        let isSwingLow = true;
        // Swing High
        for (
            let j = 1;
            j <= lookback;
            j++
        ) {
            if (
                current.high <= data[i - j].high ||
                current.high <= data[i + j].high
            ) {
                isSwingHigh = false;
                break;
            }
        }
        // Swing Low
        for (  let j = 1; j <= lookback; j++ ) {
            if (
                current.low >= data[i - j].low ||
                current.low >= data[i + j].low
            ) {
                isSwingLow = false;
                break;
            }
        }
        if (isSwingHigh) {
            swingHighs.push({
                index: i,
                price: current.high
            });
        }
        if (isSwingLow) {
            swingLows.push({
                index: i,
                price: current.low
            });
        }
    }
    // =================================
    // آخرین Swing ها
    // =================================
    const lastHigh =
        swingHighs[swingHighs.length - 1];
    const previousHigh =
        swingHighs[swingHighs.length - 2];
    const lastLow =
        swingLows[swingLows.length - 1];
    const previousLow =
        swingLows[swingLows.length - 2];
    if (
        !lastHigh ||
        !previousHigh ||
        !lastLow ||
        !previousLow
    ) {
        return null;
    }
    // =================================
    // تشخیص ساختار
    // =================================
    let structure = "RANGE";
    const higherHigh =
        lastHigh.price > previousHigh.price;
    const lowerHigh =
        lastHigh.price < previousHigh.price;
    const higherLow =
        lastLow.price > previousLow.price;
    const lowerLow =
        lastLow.price < previousLow.price;
    if (higherHigh && higherLow) {
        structure =
            "🟢 BULLISH STRUCTURE";
    }
    else if (lowerHigh && lowerLow) {
        structure =
            "🔴 BEARISH STRUCTURE";
    }
    // =================================
    // قیمت فعلی
    // =================================
    const last =
        data[data.length - 1];
    // =================================
    // Breakout / Breakdown
    // =================================
    let breakout =
        "NO BREAKOUT";
    if (last.close > lastHigh.price) {
        breakout =
            "🟢 BULLISH BREAKOUT";
    }
    else if (last.close < lastLow.price) {
        breakout =
            "🔴 BEARISH BREAKDOWN";
    }
    // =================================
    // آخرین کندل
    // =================================
    let candleDirection =
        "NEUTRAL";
    if (last.close > last.open) {
        candleDirection =
            "🟢 BULLISH CANDLE";
    }
    else if (last.close < last.open) {
        candleDirection =
            "🔴 BEARISH CANDLE";
    }
    return {
        structure,
        breakout,
        candleDirection,
        lastHigh: lastHigh.price,
        previousHigh: previousHigh.price,
        lastLow: lastLow.price,
        previousLow: previousLow.price,
        price: last.close
    };
}
function calculatePriceAction(timeframe) {
    const result =
        getPriceActionStructure(timeframe);
    if (!result) {
        return;
    }
    console.log(
        `\n📊 ${timeframe} PRICE ACTION`
    );
    console.log(
        `Price           : ${result.price}`
    );
    console.log(
        `Last Swing High : ${result.lastHigh}`
    );
    console.log(
        `Previous High   : ${result.previousHigh}`
    );
    console.log(
        `Last Swing Low  : ${result.lastLow}`
    );
    console.log(
        `Previous Low    : ${result.previousLow}`
    );
    console.log(
        `Candle          : ${result.candleDirection}`
    );
    console.log(
        `Structure       : ${result.structure}`
    );
    console.log(
        `Breakout        : ${result.breakout}`
    );
}
function calculateCombinedSignal(timeframe) {
    const list = candles[timeframe];
    if (list.length < 60) {
        return;
    }
    // =================================
    // PRICE ACTION
    // =================================
    const priceAction =
        getPriceActionStructure(timeframe);
    if (!priceAction) {
        return;
    }
    let bullishScore = 0;
    let bearishScore = 0;
    // =================================
    // PRICE ACTION SCORE
    // =================================
    if (
        priceAction.structure ===
        "🟢 BULLISH STRUCTURE"
    ) {
        bullishScore += 2;
    }
    else if (
        priceAction.structure ===
        "🔴 BEARISH STRUCTURE"
    ) {
        bearishScore += 2;
    }
    // =================================
    // BREAKOUT
    // =================================
    if (
        priceAction.breakout ===
        "🟢 BULLISH BREAKOUT"
    ) {
        bullishScore += 1;
    }
    else if (
        priceAction.breakout ===
        "🔴 BEARISH BREAKDOWN"
    ) {
        bearishScore += 1;
    }
    // =================================
    // CANDLE
    // =================================
    if (
        priceAction.candleDirection ===
        "🟢 BULLISH CANDLE"
    ) {
        bullishScore += 1;
    }
    else if (
        priceAction.candleDirection ===
        "🔴 BEARISH CANDLE"
    ) {
        bearishScore += 1;
    }
    // =================================
    // MACD
    // =================================
    const data =
        list.slice(0, -1);
    const closes =
        data.map(candle => candle.close);
    const macdResult =
        MACD.calculate({
            values: closes,
            fastPeriod: 12,
            slowPeriod: 26,
            signalPeriod: 9,
            SimpleMAOscillator: false,
            SimpleMASignal: false
        });
    if (!macdResult.length) {
        return;
    }
    const macd =
        macdResult[macdResult.length - 1];
    if (macd.MACD > macd.signal) {
        bullishScore += 1;
    }
    else if (macd.MACD < macd.signal) {
        bearishScore += 1;
    }
    // =================================
    // ICHIMOKU
    // =================================
    const ichimokuScore =
        getIchimokuScore(timeframe);
    if (ichimokuScore > 0) {
        bullishScore += ichimokuScore;
    }
    else if (ichimokuScore < 0) {
        bearishScore +=
            Math.abs(ichimokuScore);
    }
    // =================================
    // FINAL RESULT
    // =================================
    let result =
        "⚪ NEUTRAL";
    if (bullishScore > bearishScore) {
        result =
            "🟢 BULLISH";
    }
    else if (bearishScore > bullishScore) {
        result =
            "🔴 BEARISH";
    }
    // =================================
    // DISPLAY
    // =================================
    console.log( `\n🎯 ${timeframe} COMBINED` );
    console.log( `Bullish Score  : ${bullishScore}` );
    console.log(   `Bearish Score  : ${bearishScore}` );
    console.log( `Price Action   : ${priceAction.structure}` );
    console.log(  `Breakout       : ${priceAction.breakout}` );
    console.log( `Candle         : ${priceAction.candleDirection}` );
    console.log(  `Ichimoku Score : ${ichimokuScore}` );
    console.log( `Result         : ${result}` );
}
function getTimeframeDirection(timeframe) {
    const list = candles[timeframe];
    if (list.length < 60) {
        return "NEUTRAL";
    }
    const priceAction =
        getPriceActionStructure(timeframe);
    const ichimokuScore =
        getIchimokuScore(timeframe);
    if (!priceAction) {
        return "NEUTRAL";
    }
    // =================================
    // MACD
    // =================================
    const data =
        list.slice(0, -1);
    const closes =
        data.map(candle => candle.close);
    const macdResult =
        MACD.calculate({
            values: closes,
            fastPeriod: 12,
            slowPeriod: 26,
            signalPeriod: 9,
            SimpleMAOscillator: false,
            SimpleMASignal: false
        });
    if (!macdResult.length) {
        return "NEUTRAL";
    }
    const macd =
        macdResult[macdResult.length - 1];
    let bullish = 0;
    let bearish = 0;
    // =================================
    // PRICE ACTION
    // =================================
    if (  priceAction.structure ===  "🟢 BULLISH STRUCTURE" ) {
        bullish += 2;
    }
    else if ( priceAction.structure === "🔴 BEARISH STRUCTURE") {
        bearish += 2;
    }
    // =================================
    // BREAKOUT
    // =================================
    if ( priceAction.breakout ===  "🟢 BULLISH BREAKOUT" ) {
        bullish += 1;
    }
    else if ( priceAction.breakout ===  "🔴 BEARISH BREAKDOWN" ) {
        bearish += 1;
    }
    // =================================
    // ICHIMOKU
    // =================================
    if (ichimokuScore > 0) { 
        bullish += ichimokuScore;
     }
    else if (ichimokuScore < 0) { 
        bearish += Math.abs(ichimokuScore); 
    }
    // =================================
    // MACD
    // =================================
    if (macd.MACD > macd.signal) {
        bullish += 1;
    }
    else if (macd.MACD < macd.signal) {
        bearish += 1;
    }
    // =================================
    // RESULT
    // =================================
    if (bullish > bearish) {
        return "BULLISH";
    }
    if (bearish > bullish) {
        return "BEARISH";
    }
    return "NEUTRAL";
}
function getTrend15m() {
    const timeframe = "15m";
    const priceAction =
        getPriceActionStructure(timeframe);
    const ichimokuScore =
        getIchimokuScore(timeframe);
    const list = candles[timeframe];
    if (
        !priceAction ||
        list.length < 60
    ) {
        return "NEUTRAL";
    }
    // ================================
    // MACD
    // ================================
    const data =
        list.slice(0, -1);
    const closes =
        data.map(candle => candle.close);
    const macdResult =
        MACD.calculate({
            values: closes,
            fastPeriod: 12,
            slowPeriod: 26,
            signalPeriod: 9,
            SimpleMAOscillator: false,
            SimpleMASignal: false
        });
    if (!macdResult.length) {
        return "NEUTRAL";
    }
    const macd =
        macdResult[macdResult.length - 1];
    // ================================
    // SCORE
    // ================================
    let bullish = 0;
    let bearish = 0;
    // Price Action
    if (
        priceAction.structure ===
        "🟢 BULLISH STRUCTURE"
    ) {
        bullish += 2;
    }
    else if (
        priceAction.structure ===
        "🔴 BEARISH STRUCTURE"
    ) {
        bearish += 2;
    }
    // Ichimoku
    if (ichimokuScore > 0) {
        bullish += ichimokuScore;
    }
    else if (ichimokuScore < 0) {
        bearish += Math.abs(ichimokuScore);
    }
    // MACD
    if (macd.MACD > macd.signal) {
        bullish += 1;
    }
    else if (macd.MACD < macd.signal) {
        bearish += 1;
    }
    // ================================
    // RESULT
    // ================================
    if (bullish > bearish) {
        return "BULLISH";
    }
    if (bearish > bullish) {
        return "BEARISH";
    }
    return "NEUTRAL";
}
function getSetup5m() {
    const trend15m =
        getTrend15m();
    const timeframe = "5m";
    const list = candles[timeframe];
    if (
        trend15m === "NEUTRAL" ||
        list.length < 60
    ) {
        return "WAIT";
    }
    const priceAction =
        getPriceActionStructure(timeframe);
    if (!priceAction) {
        return "WAIT";
    }
    const ichimoku =
        getIchimokuValues(timeframe);
    if (!ichimoku) {
        return "WAIT";
    }
    const data =
        list.slice(0, -1);
    const closes =
        data.map(
            candle => candle.close
        );
    const macdResult =
        MACD.calculate({
            values: closes,
            fastPeriod: 12,
            slowPeriod: 26,
            signalPeriod: 9,
            SimpleMAOscillator: false,
            SimpleMASignal: false
        });
    if (!macdResult.length) {
        return "WAIT";
    }
    const macd =
        macdResult[
            macdResult.length - 1
        ];
    const bullishPriceAction =
        priceAction.structure ===
        "🟢 BULLISH STRUCTURE";
    const bearishPriceAction =
        priceAction.structure ===
        "🔴 BEARISH STRUCTURE";
    const bullishMACD =
        macd.MACD > macd.signal;
    const bearishMACD =
        macd.MACD < macd.signal;
    const bullishIchimoku =
        ichimoku.tenkan > ichimoku.kijun &&
        ichimoku.price > ichimoku.cloudTop;
    const bearishIchimoku =
        ichimoku.tenkan < ichimoku.kijun &&
        ichimoku.price < ichimoku.cloudBottom;
    if (trend15m === "BULLISH") {
        if (
            bullishPriceAction &&
            bullishMACD &&
            bullishIchimoku
        ) {
            return "LONG READY";}
        return "WAIT";
    }
    if (trend15m === "BEARISH") {
        if (
            bearishPriceAction &&
            bearishMACD &&
            bearishIchimoku
        ) {
            return "SHORT READY";
        }
        return "WAIT";
    }
    return "WAIT";
}
function calculateSetupStrength() {
    const trend15m = getTrend15m();
    const setup5m = getSetup5m();
    const list = candles["5m"];
    if (
        list.length < 60 ||
        trend15m === "NEUTRAL"
    ) {
        return {
            score: 0,
            strength: "WEAK"
        };
    }
    if (
        setup5m !== "LONG READY" &&
        setup5m !== "SHORT READY"
    ) {
        return {
            score: 0,
            strength: "WEAK"
        };
    }
    let score = 0;
    const priceAction =
        getPriceActionStructure("5m");
    const ichimoku =
        getIchimokuValues("5m");
    const data =
        list.slice(0, -1);
    const closes =
        data.map(candle => candle.close);
    const macdResult = MACD.calculate({
        values: closes,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false
    });
    if (!priceAction || !ichimoku || !macdResult.length) {
        return {
            score: 0,
            strength: "WEAK"
        };
    }
    const macd =
        macdResult[macdResult.length - 1];
    // =========================
    // 15m Trend
    // =========================
    score += 2;
    // =========================
    // 5m Price Action Structure
    // =========================
    if (
        trend15m === "BULLISH" &&
        priceAction.structure === "🟢 BULLISH STRUCTURE"
    ) {
        score += 2;
    }
    if (
        trend15m === "BEARISH" &&
        priceAction.structure === "🔴 BEARISH STRUCTURE"
    ) {
        score += 2;
    }
    // =========================
    // 5m Breakout
    // =========================
    if (
        trend15m === "BULLISH" &&
        priceAction.breakout === "🟢 BULLISH BREAKOUT"
    ) {
        score += 1;
    }
    if (
        trend15m === "BEARISH" &&
        priceAction.breakout === "🔴 BEARISH BREAKDOWN"
    ) {
        score += 1;
    }
    // =========================
    // 5m MACD
    // =========================
    if (
        trend15m === "BULLISH" &&
        macd.MACD > macd.signal
    ) {
        score += 1;
    }
    if (
        trend15m === "BEARISH" &&
        macd.MACD < macd.signal
    ) {
        score += 1;
    }
    // =========================
    // 5m Ichimoku
    // =========================
    if (
        trend15m === "BULLISH" &&
        ichimoku.tenkan > ichimoku.kijun
    ) {
        score += 1;
    }
    if (
        trend15m === "BEARISH" &&
        ichimoku.tenkan < ichimoku.kijun
    ) {
        score += 1;
    }
    // =========================
    // Price vs Cloud
    // =========================
    if (
        trend15m === "BULLISH" &&
        ichimoku.price > ichimoku.cloudTop
    ) {
        score += 1;
    }
    if (
        trend15m === "BEARISH" &&
        ichimoku.price < ichimoku.cloudBottom
    ) {
        score += 1;
    }
    // =========================
    // Strength
    // =========================
    if (score === 8) {
        return {
            score,
            strength: "STRONG"
        };
    }
    if (score === 7) {
        return {
            score,
            strength: "MEDIUM"
        };
    }
    return {
        score,
        strength: "WEAK"
    };
}
function getTrigger1m() {
    const setup5m =
        getSetup5m();
    const list =
        candles["1m"];
    // ================================
    // Setup Validation
    // ================================
    if (
        setup5m !== "LONG READY" &&
        setup5m !== "SHORT READY"
    ) {
        return "WAIT";
    }
    if (list.length < 30) {
        return "WAIT";
    }
    // ================================
    // Closed Candles Only
    // ================================
    const data =
        list.slice(0, -1);
    const last =
        data[data.length - 1];
    // ================================
    // Previous 5 Candles
    // ================================
    const previousCandles =
        data.slice(-6, -1);
    let resistance =
        -Infinity;
    let support =
        Infinity;
    for (const candle of previousCandles) {
        resistance =
            Math.max(
                resistance,
                candle.high
            );
        support =
            Math.min(
                support,
                candle.low
            );
    }
    // ================================
    // MACD
    // ================================
    const closes =
        data.map(
            candle => candle.close
        );
    const macdResult =
        MACD.calculate({
            values: closes,
            fastPeriod: 12,
            slowPeriod: 26,
            signalPeriod: 9,
            SimpleMAOscillator: false,
            SimpleMASignal: false
        });
    if (!macdResult.length) {
        return "WAIT";
    }
    const macd =
        macdResult[
            macdResult.length - 1
        ];
    if (
        macd.MACD === undefined ||
        macd.signal === undefined
    ) {
        return "WAIT";
    }
    // ================================
    // LONG TRIGGER
    // ================================
    if (setup5m === "LONG READY") {
        const bullishMACD =
            macd.MACD > macd.signal;
        const bullishBreakout =
            last.close > resistance;
        const bullishCandle =
            last.close > last.open;
        if (
            bullishBreakout &&
            bullishMACD &&
            bullishCandle
        ) {
            return "LONG TRIGGER";
        }
        return "WAIT";
    }
    // ================================
    // SHORT TRIGGER
    // ================================
    if (setup5m === "SHORT READY") {
        const bearishMACD =
            macd.MACD < macd.signal;
        const bearishBreakdown =
            last.close < support;
        const bearishCandle =
            last.close < last.open;
        if (
            bearishBreakdown &&
            bearishMACD &&
            bearishCandle
        ) {
            return "SHORT TRIGGER";
        }
        return "WAIT";
    }
    return "WAIT";
}
function getEntryType(direction) {
    const trigger =
        getTrigger1m();
    // ================================
    // LONG
    // ================================
    if (
        direction === "LONG" &&
        trigger === "LONG TRIGGER"
    ) {
        return "TRIGGER → MARKET";
    }
    // ================================
    // SHORT
    // ================================
    if (
        direction === "SHORT" &&
        trigger === "SHORT TRIGGER"
    ) {
        return "TRIGGER → MARKET";
    }
    // ================================
    // LIMIT
    // ================================
    if (
        direction === "LONG" ||
        direction === "SHORT"
    ) {
        return "LIMIT";
    }
    return "WAIT";
}
function calculateEntryPrice(direction, entryType) {
    const list =
        candles["1m"];
    if (list.length < 20) {
        return null;
    }
    // ================================
    // Closed Candles Only
    // ================================
    const data =
        list.slice(0, -1);
    const last =
        data[data.length - 1];
    const currentPrice =
        last.close;
    // ================================
    // Previous 5 Candles
    // ================================
    const previousCandles =
        data.slice(-6, -1);
    let resistance =
        -Infinity;
    let support =
        Infinity;
    for (const candle of previousCandles) {
        if (candle.high > resistance) {
            resistance =
                candle.high;
        }
        if (candle.low < support) {
            support =
                candle.low;
        }
    }
    // ================================
    // TRIGGER → MARKET
    // ================================
    if (entryType === "TRIGGER → MARKET") {
        return currentPrice;
    }
    // ================================
    // LONG LIMIT
    // ================================
    if (
        direction === "LONG" &&
        entryType === "LIMIT"
    ) {
        if (support >= currentPrice) {
            return null;
        }
        return support;
    }
    // ================================
    // SHORT LIMIT
    // ================================
    if (
        direction === "SHORT" &&
        entryType === "LIMIT"
    ) {
        if (resistance <= currentPrice) {
            return null;
        }
        return resistance;
    }
    return null;
}
function calculateSmartStopLoss(direction) {
    const priceAction =
        getPriceActionStructure("5m");
    if (!priceAction) {
        return null;
    }
    if (direction === "LONG") {
        return priceAction.lastLow;
    }
    if (direction === "SHORT") {
        return priceAction.lastHigh;
    }
    return null;
}
function calculateRiskPercent(direction, entry, stopLoss) {
    if (
        !Number.isFinite(entry) ||
        !Number.isFinite(stopLoss) ||
        entry <= 0 ||
        stopLoss <= 0
    ) {
        return null;
    }
    let risk = 0;
    // ================================
    // LONG
    // ================================
    if (direction === "LONG") {
        risk =
            entry - stopLoss;
    }
    // ================================
    // SHORT
    // ================================
    else if (direction === "SHORT") {
        risk =
            stopLoss - entry;
    }
    // ================================
    // Invalid Direction
    // ================================
    else {
        return null;
    }
    // ================================
    // Invalid Risk
    // ================================
    if (
        !Number.isFinite(risk) ||
        risk <= 0
    ) {
        return null;
    }
    // ================================
    // Risk Percent
    // ================================
    const riskPercent =
        (risk / entry) * 100;
    if (!Number.isFinite(riskPercent)) {
        return null;
    }
    return riskPercent;
}
function calculateRiskUSDT(direction, entry, stopLoss) {
    if (!Number.isFinite(entry) || !Number.isFinite(stopLoss) || entry <= 0 || stopLoss <= 0) {
        return null;
    }
    const positionSize = calculatePositionSize(entry);
    if (!positionSize || !Number.isFinite(positionSize.quantity) || positionSize.quantity <= 0) {
        return null;
    }
    let priceRisk = 0;
    if (direction === "LONG") {
        priceRisk = entry - stopLoss;
    } else if (direction === "SHORT") {
        priceRisk = stopLoss - entry;
    } else {
        return null;
    }
    if (!Number.isFinite(priceRisk) || priceRisk <= 0) {
        return null;
    }
    const riskUSDT = priceRisk * positionSize.quantity;
    if (!Number.isFinite(riskUSDT)) {
        return null;
    }
    return riskUSDT;
}
function calculatePositionSize(entry) {
    if (
        entry === null ||
        entry <= 0
    ) {
        return null;
    }
    const positionValue =
        MARGIN_USDT * LEVERAGE;
    const quantity =
        positionValue / entry;
    return {
        margin: MARGIN_USDT,
        leverage: LEVERAGE,
        positionValue,
        quantity
    };
}
function calculateTradeLevels(direction) {
    const list =
        candles["1m"];
    if (list.length < 20) {
        return null;
    }
    // ================================
    // Entry Type
    // ================================
    const entryType =
        getEntryType(direction);
    if (entryType === "WAIT") {
        return null;
    }
    // ================================
    // Entry Price
    // ================================
    const entry =
        calculateEntryPrice(
            direction,
            entryType
        );
    if (entry === null) {
        return null;
    }
    // ================================
    // Smart Stop Loss
    // ================================
    const smartStopLoss =
        calculateSmartStopLoss(direction);
    if (smartStopLoss === null) {
        return null;
    }
    const stopLoss =
        smartStopLoss;
    // ================================
    // SL Position Validation
    // ================================
    if (direction === "LONG" && stopLoss >= entry) {
        console.log(
            `🔴 NO TRADE — LONG SL is not below Entry`
        );
        return null;
    }
    if (direction === "SHORT" && stopLoss <= entry) {
        console.log(
            `🔴 NO TRADE — SHORT SL is not above Entry`
        );
        return null;
    }
    // ================================
    // SL Risk %
    // ================================
    const riskPercent =
        calculateRiskPercent(
            direction,
            entry,
            stopLoss
        );
    if (riskPercent === null) {
        return null;
    }
    // ================================
    // SL Risk Status
    // ================================
    let slRiskStatus = "LOW";
    if (riskPercent > LOW_RISK_SL_PERCENT) {
        slRiskStatus = "ACCEPTABLE";
    }
    // ================================
    // SL Distance Filter
    // ================================
    if (riskPercent > MAX_SL_PERCENT) {
        console.log(
            `🔴 NO TRADE — SL distance ${riskPercent.toFixed(2)}% > ${MAX_SL_PERCENT}%`
        );
        return null;
    }
    // ================================
    // Position Size
    // ================================
    const positionSize =
        calculatePositionSize(entry);
    // ================================
    // Risk USDT
    // ================================
    const riskUSDT =
        calculateRiskUSDT(
            direction,
            entry,
            stopLoss
        );
    // ================================
    // LONG
    // ================================
    if (direction === "LONG") {
        const risk =
            entry - stopLoss;
        if (risk <= 0) {
            return null;
        }
        const tp1 =
            entry + risk * 1.5;
        const tp2 =
            entry + risk * 2.5;
        return {
            direction: "LONG",
            entryType,
            entry,
            stopLoss,
            tp1,
            tp2,
            riskPercent,
            slRiskStatus,
            positionSize,
            riskUSDT,
            riskRewardTP1: 1.5,
            riskRewardTP2: 2.5
        };
    }
    // ================================
    // SHORT
    // ================================
    if (direction === "SHORT") {
        const risk =
            stopLoss - entry;
        if (risk <= 0) {
            return null;
        }
        const tp1 =
            entry - risk * 1.5;
        const tp2 =
            entry - risk * 2.5;
        return {
            direction: "SHORT",
            entryType,
            entry,
            stopLoss,
            tp1,
            tp2,
            riskPercent,
            slRiskStatus,
            positionSize,
            riskUSDT,
            riskRewardTP1: 1.5,
            riskRewardTP2: 2.5
        };
    }
    return null;
}
function analyzeMultiTimeframe() {
    const direction15m =
        getTimeframeDirection("15m");
    const direction5m =
        getTimeframeDirection("5m");
    const direction1m =
        getTimeframeDirection("1m");
    console.log(
        `\n===============================`
    );
    console.log(
        `🔎 MULTI-TIMEFRAME ANALYSIS`
    );
    console.log(
        `===============================`
    );
    console.log(
        `15m Direction : ${direction15m}`
    );
    console.log(
        `5m Direction  : ${direction5m}`
    );
    console.log(
        `1m Direction  : ${direction1m}`
    );
    // =================================
    // LONG
    // =================================
    if (
        direction15m === "BULLISH" &&
        direction5m === "BULLISH" &&
        direction1m === "BULLISH"
    ) {
        console.log(
            `\n🟢 LONG SETUP`
        );
        console.log(
            `15m + 5m + 1m aligned`
        );
        return "LONG";
    }
    // =================================
    // SHORT
    // =================================
    if (
        direction15m === "BEARISH" &&
        direction5m === "BEARISH" &&
        direction1m === "BEARISH"
    ) {
        console.log(
            `\n🔴 SHORT SETUP`
        );
        console.log(
            `15m + 5m + 1m aligned`
        );
        return "SHORT";
    }
    // =================================
    // NO TRADE
    // =================================
    console.log(
        `\n⚪ NO TRADE`
    );
    console.log(
        `Timeframes are not aligned`
    );
    return "NO TRADE";
}
function getIchimokuScore(timeframe) {
    const result =
        getIchimokuValues(timeframe);
    if (!result) {
        return 0;
    }
    let score = 0;
    // Tenkan / Kijun
    if (result.tenkan > result.kijun) {
        score++;
    }
    else if (result.tenkan < result.kijun) {
        score--;
    }
    // Price vs Cloud
    if (result.price > result.cloudTop) {
        score++;
    }
    else if (result.price < result.cloudBottom) {
        score--;
    }
    // Cloud direction
    if (result.senkouA > result.senkouB) {
        score++;
    }
    else if (result.senkouA < result.senkouB) {
        score--;
    }
    return score;
}
// ================================
// WebSocket
// ================================
function connectWebSocket() {
    const ws = new WebSocket(
        "wss://stream.toobit.com/quote/ws/v1"
    );
    ws.on("open", () => {
        console.log("\n🟢 WebSocket connected");
        for (const timeframe of TIMEFRAMES) {
            ws.send(
                JSON.stringify({
                    symbol: SYMBOL,
                    topic: `kline_${timeframe}`,
                    event: "sub",
                    params: {
                        binary: false
                    }
                })
            );
        }
        console.log("📡 Live candles subscribed");
    });
    ws.on("ping", () => {
    console.log("📡 WebSocket PING");
});
ws.on("pong", () => {
    console.log("📡 WebSocket PONG");
});
    ws.on("message", (message) => {
        try {
            const data =
                JSON.parse(message.toString());
            if (
                data.topic !== "kline" ||
                !data.data ||
                !data.data.length
            ) {
                return;
            }
            const timeframe =
                data.params?.klineType;
            if (!TIMEFRAMES.includes(timeframe)) {
                return;
            }
            const live =
                normalizeCandle(data.data[0]);
            updateCandle(
                timeframe,
                live
            );
        } catch (error) {
            console.log(
                "❌ Message error:",
                error.message
            );
        }
    });
    ws.on("error", error => {
        console.log(
            "❌ WebSocket error:",
            error.message
        );
    });
    ws.on("close", (code, reason) => {
        console.log(
            "🔴 WebSocket disconnected"
        );
        console.log(
            `Close Code : ${code}`
        );
        console.log(
            `Reason     : ${reason.toString()}`
        );
        console.log(
            "🔄 Reconnecting in 5 seconds..."
        );
        setTimeout(() => {
            connectWebSocket();
        }, 5000);
    });
}
// ================================
// بروزرسانی کندل
// ================================
function updateCandle(timeframe, liveCandle) {
    const list = candles[timeframe];
    if (!list.length) {
        list.push(liveCandle);
        return;
    }
    const last =
        list[list.length - 1];
    // همان کندل در حال تشکیل
    if (liveCandle.time === last.time) {
        list[list.length - 1] =
            liveCandle;
        return;
    }
    // کندل جدید شروع شده
    if (liveCandle.time > last.time) {
        // new candle is in progress
        list.push(liveCandle);
        if (list.length > LIMIT) {
            list.shift();
        }
        // previous candle is now closed
        console.log(
            `🕯️ Closed ${timeframe} candle`
        );
        printStatus(timeframe);
        runLiveAnalysis(timeframe);
    }
}
// ================================
// نمایش وضعیت
// ================================
function printStatus(timeframe) {
    const list = candles[timeframe];
    if (list.length < 2) {
        return;
    }
    // کندل قبلی = کندلی که همین الان بسته شده
    const closedCandle = list[list.length - 2];
    console.log(
        `${timeframe} | ` +
        `CLOSED | ` +
        `Time: ${new Date(closedCandle.time).toLocaleTimeString()} | ` +
        `O: ${closedCandle.open} | ` +
        `H: ${closedCandle.high} | ` +
        `L: ${closedCandle.low} | ` +
        `C: ${closedCandle.close}`
    );
}
function runLiveAnalysis(timeframe) {
    console.log("\n");
    console.log("================================");
    console.log(`🔄 LIVE ANALYSIS — ${timeframe}`);
    console.log("================================");
    // ================================
    // 15m Trend
    // ================================
    const trend15m =
        getTrend15m();
    console.log(
        `15m Trend  : ${trend15m}`
    );
    // ================================
    // 5m Setup
    // ================================
    const setup5m =
        getSetup5m();
    console.log(
        `5m Setup   : ${setup5m}`
    );
    // ================================
    // 5m Setup Strength
    // ================================
    const setupStrength =
        calculateSetupStrength();
    console.log(
        `5m Strength: ${setupStrength.strength} (${setupStrength.score}/8)`
    );
    // ================================
    // 1m Trigger
    // ================================
    const trigger1m =
        getTrigger1m();
    console.log(
        `1m Trigger : ${trigger1m}`
    );
    // ================================
    // Analysis State
    // ================================
    const analysisState =
        `${setup5m} | ${trigger1m}`;
        if (dashboard.readyState === WebSocket.OPEN) {
        dashboard.send(JSON.stringify({
            type: "LIVE_ANALYSIS",
            status: "SCANNING",
            receivedAt: new Date().toLocaleString("en-US", { timeZone: "Asia/Tehran" })
        }));
}
    if (
        analysisState === lastAnalysisState
    ) {
        return;
    }
    lastAnalysisState =
        analysisState;
    console.log(
        `📊 Analysis State: ${analysisState}`
    );
    // ================================
    // Setup Validation
    // ================================
    if (
        setup5m !== "LONG READY" &&
        setup5m !== "SHORT READY"
    ) {
        return;
    }
    // ================================
    // Direction
    // ================================
    let direction;
    if (
        setup5m === "LONG READY"
    ) {
        direction = "LONG";
    } else {
        direction = "SHORT";
    }
    // ================================
    // Trade Levels
    // ================================
    const trade =
        calculateTradeLevels(
            direction
        );
    if (!trade) {
        console.log(
            "\n🔴 NO VALID TRADE"
        );
        return;
    }
    // ================================
    // TRADE OUTPUT
    // ================================
    console.log(
        "\n🎯 TRADE LEVELS"
    );
    console.log(
        `Direction : ${trade.direction}`
    );
    console.log(
        `Entry Type: ${trade.entryType}`
    );
    console.log(
        `Entry     : ${trade.entry}`
    );
    console.log(
        `SL        : ${trade.stopLoss}`
    );
    console.log(
        `TP1       : ${trade.tp1}`
    );
    console.log(
        `TP2       : ${trade.tp2}`
    );
    console.log(
        `Risk %    : ${trade.riskPercent.toFixed(2)}%`
    );
    console.log(
        `SL Status : ${trade.slRiskStatus}`
    );
    console.log(
        `Risk USDT : ${trade.riskUSDT.toFixed(4)} USDT`
    );
    console.log(
        `R/R TP1   : 1:${trade.riskRewardTP1}`
    );
    console.log(
        `R/R TP2   : 1:${trade.riskRewardTP2}`
    );
        // ================================
    // Position Information
    // ================================
    console.log(
        `Margin    : ${trade.positionSize.margin} USDT`
    );
    console.log(
        `Leverage  : ${trade.positionSize.leverage}x`
    );
    console.log(
        `Position  : ${trade.positionSize.positionValue} USDT`
    );
    console.log(
        `Quantity  : ${trade.positionSize.quantity}`
    );
}
async function runFullScan() {
    console.log("\n================================");
    console.log("🔎 NEW FULL SEARCH");
    console.log("================================");
    try {
        const futuresSymbols = await getFuturesSymbols();
        const futuresTickers = await getFuturesTickers();
        const validTickerSymbols = new Set(futuresSymbols);
        const activeTickers = futuresTickers.filter(ticker => validTickerSymbols.has(ticker.s) && Number(ticker.qv) > 0);
        const testFilterTickers = activeTickers.filter(ticker => Number(ticker.qv) >= 10000000 && Math.abs(Number(ticker.pcp)) >= 0.01);
        const rankedCandidates = [...testFilterTickers].sort((a, b) => (Number(b.qv) * Math.abs(Number(b.pcp))) - (Number(a.qv) * Math.abs(Number(a.pcp)))).slice(0, 200);
        let trendCandidates = [];
        const batchSize = 40;
        for (let i = 0; i < rankedCandidates.length; i += batchSize) {
            const batch = rankedCandidates.slice(i, i + batchSize);
            console.log(`\n🚀 SCANNING BATCH ${Math.floor(i / batchSize) + 1} | ${batch.length} CANDIDATES`);
            const batchResults = await scan15mCandidates(batch);
            trendCandidates.push(...batchResults);
            if (trendCandidates.length >= 5) {
                break;
            }
        }
        trendCandidates.sort((a, b) => {
            if (b.score !== a.score) {
                return b.score - a.score;
            }
            return a.riskPercent - b.riskPercent;
        });
        trendCandidates = trendCandidates.slice(0, 5);
        displayFinalTrades(trendCandidates);
        console.log(`🔎 NEW SEARCH COMPLETE | Final Trades: ${trendCandidates.length}`);
    } catch (error) {
        console.log(`❌ New Search failed: ${error.message}`);
    }
}
// ================================
// شروع برنامه
// ================================
async function start() {
    console.log("================================");
    console.log("      TOOBIT LIVE ENGINE");
    console.log("================================");
    console.log(`Symbol: ${SYMBOL}`);
    console.log("\n📡 Loading Toobit Futures symbols...");
    try {
        const futuresSymbols = await getFuturesSymbols();
        console.log(`✅ Futures symbols loaded: ${futuresSymbols.length}`);
        console.log("\n📊 Loading Futures tickers...");
        const futuresTickers = await getFuturesTickers();
        console.log(`✅ Futures tickers loaded: ${futuresTickers.length}`);
        const validTickerSymbols = new Set(futuresSymbols);
        const activeTickers = futuresTickers.filter(ticker => validTickerSymbols.has(ticker.s) && Number(ticker.qv) > 0);
        console.log(`🔎 Active Futures tickers: ${activeTickers.length}`);
        const volumePassed = activeTickers.filter(ticker => Number(ticker.qv) >= 10000000);
        const changePassed = activeTickers.filter(ticker => Math.abs(Number(ticker.pcp)) >= 0.01);
        const testFilterTickers = activeTickers.filter(ticker => Number(ticker.qv) >= 10000000 && Math.abs(Number(ticker.pcp)) >= 0.01);
        console.log(`📊 Volume >= 10M: ${volumePassed.length}`);
        console.log(`📊 24h Change >= 1%: ${changePassed.length}`);
        console.log(`📊 Both Conditions: ${testFilterTickers.length}`);
        console.log(`🧪 Test Filter: ${testFilterTickers.length} symbols`);
        const rankedCandidates = [...testFilterTickers].sort((a, b) => (Number(b.qv) * Math.abs(Number(b.pcp))) - (Number(a.qv) * Math.abs(Number(a.pcp)))).slice(0, 200);
        console.log("\n🎯 TOP 20 SCALP CANDIDATES");
        rankedCandidates.slice(0, 20).forEach((ticker, index) => {
            console.log(`${index + 1}. ${ticker.s} | Volume: ${Number(ticker.qv).toFixed(0)} | Change: ${(Number(ticker.pcp) * 100).toFixed(2)}%`);
        });
       let trendCandidates = [];
        const batchSize = 40;
        for (let i = 0; i < rankedCandidates.length; i += batchSize) {
            const batch = rankedCandidates.slice(i, i + batchSize);
            console.log(`\n🚀 SCANNING BATCH ${Math.floor(i / batchSize) + 1} | ${batch.length} CANDIDATES`);
            const batchResults = await scan15mCandidates(batch);
            trendCandidates.push(...batchResults);
            if (trendCandidates.length >= 5) {
                break;
            }
        }
        trendCandidates.sort((a, b) => {
            if (b.score !== a.score) {
                return b.score - a.score;
            }
            return a.riskPercent - b.riskPercent;
        });
        trendCandidates = trendCandidates.slice(0, 5);
        displayFinalTrades(trendCandidates);
        const topVolumeTickers = [...activeTickers].sort((a, b) => Number(b.qv) - Number(a.qv)).slice(0, 20);
        console.log("\n🔥 TOP 20 BY 24H VOLUME");
        topVolumeTickers.forEach((ticker, index) => {
            console.log(`${index + 1}. ${ticker.s} | Volume: ${Number(ticker.qv).toFixed(2)} USDT | Change: ${(Number(ticker.pcp) * 100).toFixed(2)}%`);
        });
    } catch (error) {
        console.log("❌ Failed to load Futures market data:", error.message);
        return;
    }
    await loadHistory();
    for (const timeframe of TIMEFRAMES) {
        calculateMACD(timeframe);
    }
    for (const timeframe of TIMEFRAMES) {
        calculateIchimoku(timeframe);
    }
    for (const timeframe of TIMEFRAMES) {
        calculatePriceAction(timeframe);
    }
    for (const timeframe of TIMEFRAMES) {
        calculateCombinedSignal(timeframe);
    }
    analyzeMultiTimeframe();
    const trend15m = getTrend15m();
    console.log("\n===============================");
    console.log("📈 15m MAIN TREND");
    console.log("===============================");
    console.log(`15m Trend : ${trend15m}`);
    const setup5m = getSetup5m();
    console.log("\n===============================");
    console.log("🎯 5m SETUP");
    console.log("===============================");
    console.log(`5m Setup : ${setup5m}`);
    const trigger1m = getTrigger1m();
    console.log("\n===============================");
    console.log("⚡ 1m TRIGGER");
    console.log("===============================");
    console.log(`1m Trigger : ${trigger1m}`);
    if (trigger1m === "LONG TRIGGER" || trigger1m === "SHORT TRIGGER") {
        const direction = trigger1m === "LONG TRIGGER" ? "LONG" : "SHORT";
        const entryType = getEntryType(direction);
        console.log("\n===============================");
        console.log("🚪 ENTRY TYPE");
        console.log("===============================");
        console.log(`Direction : ${direction}`);
        console.log(`Entry Type : ${entryType}`);
    }
    if (trigger1m === "LONG TRIGGER") {
        const trade = calculateTradeLevels("LONG");
        if (trade) {
            console.log("\n===============================");
            console.log("🟢 LONG TRADE LEVELS");
            console.log("===============================");
            console.log(`Entry Type: ${trade.entryType}`);
            console.log(`Entry     : ${trade.entry}`);
            console.log(`SL        : ${trade.stopLoss}`);
            console.log(`Risk USDT : ${trade.riskUSDT.toFixed(4)} USDT`);
            console.log(`Risk %    : ${trade.riskPercent.toFixed(2)}%`);
            console.log(`TP1       : ${trade.tp1}`);
            console.log(`TP2       : ${trade.tp2}`);
            console.log(`Margin    : ${trade.positionSize.margin} USDT`);
            console.log(`Leverage  : ${trade.positionSize.leverage}x`);
            console.log(`Position  : ${trade.positionSize.positionValue} USDT`);
            console.log(`Quantity  : ${trade.positionSize.quantity}`);
            console.log(`R/R TP1   : 1:${trade.riskRewardTP1}`);
            console.log(`R/R TP2   : 1:${trade.riskRewardTP2}`);
        }
    }
    if (trigger1m === "SHORT TRIGGER") {
        const trade = calculateTradeLevels("SHORT");
        if (trade) {
            console.log("\n===============================");
            console.log("🔴 SHORT TRADE LEVELS");
            console.log("===============================");
            console.log(`Entry Type: ${trade.entryType}`);
            console.log(`Entry     : ${trade.entry}`);
            console.log(`SL        : ${trade.stopLoss}`);
            console.log(`Risk USDT : ${trade.riskUSDT.toFixed(4)} USDT`);
            console.log(`Risk %    : ${trade.riskPercent.toFixed(2)}%`);
            console.log(`TP1       : ${trade.tp1}`);
            console.log(`TP2       : ${trade.tp2}`);
            console.log(`Margin    : ${trade.positionSize.margin} USDT`);
            console.log(`Leverage  : ${trade.positionSize.leverage}x`);
            console.log(`Position  : ${trade.positionSize.positionValue} USDT`);
            console.log(`Quantity  : ${trade.positionSize.quantity}`);
            console.log(`R/R TP1   : 1:${trade.riskRewardTP1}`);
            console.log(`R/R TP2   : 1:${trade.riskRewardTP2}`);
        }
    }
    console.log("\n📊 History loaded successfully");
    connectWebSocket();
}
start();