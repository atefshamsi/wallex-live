const http = require("http");
const WebSocket = require("ws");
const PORT = 3000;
const html = `
<!DOCTYPE html>
<html lang="fa">
<head>
    <meta charset="UTF-8">
    <title>Toobit Futures Scanner</title>
    <style>
        body {
            margin: 0;
            padding: 30px;
            background: #111827;
            color: #ffffff;
            font-family: Arial, sans-serif;
            box-sizing: border-box;
            height: 100vh;
            overflow: hidden;
        }
        h1 {
            margin-bottom: 20px;
        }
        .status-box {
            padding: 20px;
            border: 1px solid #374151;
            border-radius: 12px;
            background: #1f2937;
        }
        .dashboard-grid {
            display: grid;
            grid-template-columns: repeat(6, calc((100vw - 160px) / 6));
            gap: 20px;
            width: max-content;
            height: calc(100vh - 60px);
            box-sizing: border-box;
        }
        .dashboard-grid > #tradesContainer {
            display: contents;
        }
        .dashboard-grid > div:first-child .status-box {
            background: #1e3a5f;
        }
        .dashboard-grid > #tradesContainer .status-box {
            background: #1f2937;
        }
        .dashboard-grid .status-box {
            height: calc(100vh - 190px);
            box-sizing: border-box;
            overflow: hidden;
        }
    </style>
</head>
<body>
    <h1>Toobit Futures Scanner</h1>
    <div class="dashboard-grid">
        <div>
            <div class="status-box" id="statusBox">🔍 Scanner آماده است</div>
            <button id="newSearchButton">🔎 New Search</button>
        </div>
        <div id="tradesContainer"></div>
    </div>
    <script>
    const ws = new WebSocket("ws://localhost:3000");
    ws.onopen = () => {
        console.log("Chrome WebSocket connected");
    };
    document.getElementById("newSearchButton").onclick = () => {
    ws.send(JSON.stringify({
        type: "NEW_SEARCH"
    }));
    document.getElementById("statusBox").innerHTML =
        "<h2>🔍 New Search</h2>" +
        "<p>در حال اسکن بازار...</p>";
    document.getElementById("tradesContainer").innerHTML = "";
    };
    ws.onmessage = async event => {
    const text = typeof event.data === "string" ? event.data : await event.data.text();
    const data = JSON.parse(text);
        if (data.type === "SCAN_STATUS") {
            const stats = data.stats;
            document.getElementById("statusBox").innerHTML =
                "<h2>🔍 Scanner Status</h2>" +
                "<p>Initial Candidates: " + stats.initial + "</p>" +
                "<p>15m Passed: " + stats.trend15m + "</p>" +
                "<p>5m Passed: " + stats.trend5m + "</p>" +
                "<p>Ichimoku Passed: " + stats.ichimoku + "</p>" +
                "<p>Price Action Passed: " + stats.priceAction + "</p>" +
                "<p>Entry Passed: " + stats.entry + "</p>" +
                "<p>SL Passed: " + stats.sl + "</p>" +
                "<p>Final Trades: " + data.finalTrades + "</p>" +
                "<p>Toobit Data Time: " + data.receivedAt + "</p>";
                const tradesContainer = document.getElementById("tradesContainer");
                tradesContainer.innerHTML = "";
                const trades = Array.isArray(data.trades) ? data.trades.slice(0, 5) : [];
                trades.forEach((trade, index) => {
                    const box = document.createElement("div");
                    box.className = "status-box";
                    box.style.marginTop = "20px";
                    box.innerHTML =
                        "<h2>Trade " + (index + 1) + " — " + trade.s + "</h2>" +
                        "<p>Direction: " + trade.direction + "</p>" +
                        "<p>Entry Type: " + trade.entryType + "</p>" +
                        "<p>Entry: " + trade.entryPrice + "</p>" +
                        "<p>Current Price: " + trade.currentPrice + "</p>" +
                        "<p>SL: " + trade.sl + "</p>" +
                        "<p>TP1: " + trade.tp1 + "</p>" +
                        "<p>TP2: " + trade.tp2 + "</p>" +
                        "<p>Risk: " + trade.riskPercent + "%</p>" +
                        "<p>Score: " + trade.score + "</p>";
                    tradesContainer.appendChild(box);
                });
                    }
                    if (data.type === "LIVE_ANALYSIS") {
                return;
}
    };
    ws.onclose = () => {
        console.log("Chrome WebSocket disconnected");
    };
    </script>
</body>
</html>
`;
const server = http.createServer((req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8"
    });
    res.end(html);
});
const wss = new WebSocket.Server({ server });
const clients = new Set();
let lastScanStatus = null;
wss.on("connection", ws => {
    console.log("🌐 Chrome connected");
    clients.add(ws);
    if (lastScanStatus) {
    ws.send(lastScanStatus);
}
    ws.on("message", message => {
    console.log(`📩 Engine message: ${message}`);
    try {
        const data = JSON.parse(message.toString());
        if (data.type === "SCAN_STATUS") {
            lastScanStatus = message.toString();
        }
        if (data.type === "NEW_SEARCH") {
            console.log("🔎 New Search requested");
}
    } catch (error) {
        console.log(`❌ Invalid Engine message: ${error.message}`);
    }
    clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    });
    ws.on("close", () => {
        clients.delete(ws);
        console.log("🌐 Client disconnected");
    });
});
server.listen(PORT, () => {
    console.log(`🌐 Server running: http://localhost:${PORT}`);
});