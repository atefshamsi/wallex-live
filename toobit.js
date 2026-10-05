```js
const WebSocket = require("ws");

// تنظیمات اتصال
const SYMBOL = "DOGE-SWAP-USDT";
const ws = new WebSocket("wss://stream.toobit.com/quote/ws/v1");

// اتصال موفق به WebSocket
ws.on("open", () => {
    console.log("✅ Connected to Toobit");
    console.log(`📡 Symbol: ${SYMBOL}`);
    console.log("--------------------------------");
    // دریافت قیمت لحظه‌ای
    subscribe("realtimes");
    // دریافت کندل 1 دقیقه
    subscribe("kline_1m");
    // دریافت کندل 5 دقیقه
    subscribe("kline_5m");
    // دریافت کندل 15 دقیقه
    subscribe("kline_15m");
});

// ارسال درخواست Subscribe برای دریافت داده‌های بازار
function subscribe(topic) {
    const message = {
        symbol: SYMBOL,
        topic: topic,
        event: "sub",
        params: {
            binary: false
        }
    };
    ws.send(JSON.stringify(message));
}

// دریافت و پردازش داده‌های WebSocket
ws.on("message", message => {
    try {
        const data = JSON.parse(message.toString());
        if (!data.data || !data.data.length) {
            return;
        }
        const candle = data.data[0];
        // دریافت قیمت لحظه‌ای
        if (data.topic === "realtimes") {
            console.log(`💰 PRICE: ${candle.c}`);
        }
        // دریافت و نمایش کندل‌ها
        if (data.topic === "kline") {
            const type = data.params?.klineType;
            console.log(`📊 ${type} | O:${candle.o} H:${candle.h} L:${candle.l} C:${candle.c} V:${candle.v}`);
        }
    } catch (error) {
        console.log("❌ Parse error:", error.message);
    }
});

// مدیریت خطای WebSocket
ws.on("error", error => {
    console.log("❌ WebSocket Error:", error.message);
});

// مدیریت قطع اتصال
ws.on("close", () => {
    console.log("🔴 Connection closed");
});
```
