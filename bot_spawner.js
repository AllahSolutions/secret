const io = require("socket.io-client");
const axios = require("axios");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { SocksProxyAgent } = require("socks-proxy-agent");
const fakeUserAgent = require("fake-useragent");
const http = require("http");
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

// ==========================================
// HTTP SERVER (FOR RENDER KEEPALIVE)
// ==========================================
const PORT = process.env.PORT || 3000;
let startTime = Date.now();
let activeBots = 0;
let totalLaunched = 0;
let cfClearance = "";
let cfUserAgent = "";

const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`
        <html style="background:#0d1117; color:#c9d1d9; font-family:monospace;">
            <head><meta http-equiv="refresh" content="5"></head>
            <body style="display:flex; justify-content:center; align-items:center; height:100vh; flex-direction:column;">
                <h1 style="color:#58a6ff;">🤖 Tanchiki Bot Spawner v5.0 (CF Bypass)</h1>
                <div style="border:1px solid #30363d; padding:20px; border-radius:6px; background:#161b22; width:300px;">
                    <p>Status: <span style="color:#3fb950">● ONLINE</span></p>
                    <p>CF Cookie: <b>${cfClearance ? "✅ FOUND" : "❌ MISSING"}</b></p>
                    <p>Active Bots: <b>${activeBots}</b></p>
                    <p>Total Launched: <b>${totalLaunched}</b></p>
                    <p>Uptime: <b>${Math.floor((Date.now() - startTime) / 1000)}s</b></p>
                </div>
                <p style="margin-top:20px; color:#8b949e; font-size:12px;">Refreshes every 5s</p>
            </body>
        </html>
    `);
});

server.listen(PORT, () => {
    console.log(`🌐 Landing page running on port ${PORT}`);
});

// ==========================================
// BOT CONFIG
// ==========================================
const TARGET_URL = "https://neurochel.tech";
const PROXY_LIST_URL = "https://advanced.name/freeproxy/6991d73bd4112";

const HEADERS = {
    "Origin": "https://neurochel.tech",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "ru,uk;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache"
};

const BOTS_PER_PROXY = 1;
const CONNECT_TIMEOUT = 30000;
const SPAWN_INTERVAL = 100;

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
        return null;
    }
}

// ==========================================
// CLOUDFLARE SOLVER
// ==========================================
async function solveCloudflare() {
    console.log("🔍 Solving Cloudflare Challenge...");

    // Launch browser
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    });

    try {
        const page = await browser.newPage();

        // Go to site
        await page.goto(TARGET_URL, { waitUntil: 'networkidle0', timeout: 60000 });

        // Wait for challenge to solve
        console.log("⏳ Waiting for Turnstile...");
        try {
            await page.waitForFunction(() => {
                // Check if challenge is solved or main content loaded
                // Usually indicated by disappearance of challenge iframe or appearance of game content
                // Or existence of cf_clearance cookie
                return document.title.includes("Tanchiki") || !document.querySelector('#cf-turnstile');
            }, { timeout: 30000 });
        } catch (e) {
            console.log("⚠️ Turnstile wait timeout, checking cookies anyway...");
        }

        // Get cookies
        const cookies = await page.cookies();
        const clearanceCookie = cookies.find(c => c.name === 'cf_clearance');
        const userAgent = await page.evaluate(() => navigator.userAgent);

        if (clearanceCookie) {
            cfClearance = `${clearanceCookie.name}=${clearanceCookie.value}`;
            cfUserAgent = userAgent;
            console.log(`✅ Cloudflare Solved! Token: ${cfClearance.substring(0, 20)}...`);
            console.log(`👤 User-Agent: ${cfUserAgent}`);

            await browser.close();
            return true;
        } else {
            console.error("❌ Failed to get cf_clearance cookie.");
            await browser.close();
            return false;
        }

    } catch (error) {
        console.error("❌ Solver Error:", error.message);
        await browser.close();
        return false;
    }
}

// ==========================================
// BOT LOGIC
// ==========================================
class Bot {
    constructor(id, proxy) {
        this.id = id;
        this.proxy = proxy;
        this.socket = null;
        this.nickname = `w2mpu_${Math.floor(Math.random() * 99999)}`;
        this.userAgent = cfUserAgent || fakeUserAgent(); // Use solved UA
        this.moveInterval = null;
        this.gameState = null;
        this.myPosition = { x: 0, z: 0 };
        this.lastShotTime = 0;
    }

    connect() {
        const agent = createAgent(this.proxy);
        if (!agent) return;

        // Add CF cookies to headers
        const connectionHeaders = {
            ...HEADERS,
            "User-Agent": this.userAgent,
            "Cookie": cfClearance // Vital for bypass
        };

        const options = {
            transports: ["websocket"],
            agent: agent,
            rejectUnauthorized: false,
            extraHeaders: connectionHeaders,
            reconnection: false,
            timeout: CONNECT_TIMEOUT,
            forceNew: true
        };

        try {
            this.socket = io(TARGET_URL, options);
        } catch (e) {
            return;
        }

        this.socket.on("connect", () => {
            console.log(`✅ [Bot ${this.id}] CONNECTED! Socket ID: ${this.socket.id}`);
            activeBots++;
            this.joinGame();
        });

        this.socket.on("connect_error", (err) => {
            // console.log(`❌ [Bot ${this.id}] Connect Failed: ${err.message}`);
            this.disconnect();
        });

        this.socket.on("disconnect", (reason) => {
            if (activeBots > 0) activeBots--;
            this.disconnect();
        });

        this.socket.on("serverFull", () => {
            this.disconnect();
        });

        this.socket.on("gameState", (state) => {
            this.gameState = state;

            let players = [];
            if (state.players && Array.isArray(state.players)) {
                players = state.players;
            } else if (state.players) {
                players = Object.values(state.players);
            }

            const me = players.find(p => p.id === this.socket.id);
            if (me) {
                this.myPosition = { x: me.x, z: me.z };
            }
        });
    }

    joinGame() {
        this.socket.emit("join", { nickname: this.nickname });
        this.startBehavior();
    }

    startBehavior() {
        if (this.moveInterval) clearInterval(this.moveInterval);

        this.moveInterval = setInterval(() => {
            if (!this.socket || !this.socket.connected) return;

            let angle = Math.random() * 6.28;
            let shouldShoot = false;

            if (this.gameState && this.gameState.players) {
                let players = Array.isArray(this.gameState.players) ? this.gameState.players : Object.values(this.gameState.players);

                let nearest = null;
                let minDst = Infinity;

                for (const player of players) {
                    if (player.id === this.socket.id) continue;
                    if (player.a === false || player.hp <= 0) continue;
                    if (player.n && player.n.startsWith("w2mpu_")) continue;

                    const dx = player.x - this.myPosition.x;
                    const dz = player.z - this.myPosition.z;
                    const dst = dx * dx + dz * dz;

                    if (dst < minDst) {
                        minDst = dst;
                        nearest = { dx, dz };
                    }
                }

                if (nearest) {
                    angle = Math.atan2(nearest.dx, -nearest.dz);
                    shouldShoot = true;
                }
            }

            this.socket.emit("input", {
                up: Math.random() > 0.5,
                down: Math.random() > 0.5,
                left: Math.random() > 0.5,
                right: Math.random() > 0.5,
                angle: angle,
                shooting: shouldShoot
            });

            if (shouldShoot) {
                const now = Date.now();
                if (now - this.lastShotTime >= 1000) {
                    this.socket.emit("shoot");
                    this.lastShotTime = now;
                }
            }
        }, 200);
    }

    disconnect() {
        if (this.moveInterval) clearInterval(this.moveInterval);
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.close();
            this.socket = null;
        }
    }
}

async function startSpam() {
    console.log("🚀 STARTING BOT SPAWNER v5.0 (CF Bypass)");

    process.on('uncaughtException', (err) => { });

    // First, solve Cloudflare to get tokens
    const success = await solveCloudflare();
    if (!success) {
        console.log("⚠️ Could not solve CF challenge. Retrying in 10s...");
        setTimeout(startSpam, 10000); // Retry logic
        return;
    }

    const proxies = await getProxies();
    if (proxies.length === 0) return;

    let botId = 1;

    for (const proxy of proxies) {
        for (let i = 0; i < BOTS_PER_PROXY; i++) {
            const bot = new Bot(botId++, proxy);
            bot.connect();
            totalLaunched++;
            await new Promise(r => setTimeout(r, SPAWN_INTERVAL));
        }
    }

    console.log("All proxies processed.");

    setInterval(() => {
        console.log(`[STATS] Active Bots: ${activeBots} | Total Launched: ${totalLaunched}`);
    }, 5000);

    // Refresh CF token every 10 minutes (cookies expire)
    setInterval(async () => {
        console.log("🔄 Refreshing Cloudflare Token...");
        await solveCloudflare();
    }, 600000);
}

startSpam();
