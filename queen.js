
const {
  BufferJSON,
  Browsers,
  WA_DEFAULT_EPHEMERAL,
  default: makeWASocket,
  generateWAMessageFromContent,
  proto,
  getBinaryNodeChildren,
  generateWAMessageContent,
  generateWAMessage,
  prepareWAMessageMedia,
  areJidsSameUser,
  jidNormalizedUser,
  getContentType,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadContentFromMessage,
} = require("anju-xpro-baileys");

const path = require("path");
const P = require("pino");
const express = require("express");
const cors = require("cors");

// ================= SESSION ======================
const sess = require("./session");
const SESSION_DIR = path.join(__dirname, sess.SESSION_DIR || "session");

// ================= GLOBALS ======================
let sockInstance = null; // Baileys socket instance
const PORT = process.env.PORT || 5000; // Render uses PORT env variable

// ================= ERROR LOGGER =================
function logError(context, err) {
  const time = new Date().toISOString();
  console.error(`[${time}] [${context}]`, err?.stack || err);
}

// ================= CREATE EXPRESS APP =================
const app = express();
app.use(express.json());
app.use(cors());

// ================= HEALTH CHECK =================
app.get("/", (req, res) => {
  res.json({ 
    status: "online", 
    service: "XPROVerce WhatsApp OTP Server",
    whatsapp: sockInstance ? "connected" : "connecting",
    timestamp: new Date().toISOString()
  });
});

// ================= SEND OTP ENDPOINT =================
app.post("/send-otp", async (req, res) => {
  try {
    const { number, message } = req.body;
    
    console.log("📱 OTP Request received:", { 
      number, 
      messageLength: message?.length,
      timestamp: new Date().toISOString() 
    });
    
    if (!number || !message) {
      return res.status(400).json({ 
        error: "number & message required",
        received: { number, messageLength: message?.length }
      });
    }

    // Check if WhatsApp is connected
    if (!sockInstance) {
      return res.status(503).json({ 
        error: "WhatsApp not connected yet",
        message: "Please wait for WhatsApp connection to establish" 
      });
    }

    // Format number to WhatsApp JID
    const cleanNumber = number.replace(/[^0-9]/g, "");
    const jid = cleanNumber + "@s.whatsapp.net";
    
    console.log('📤 Attempting to send to:', cleanNumber);
    
    // Send message
    await sockInstance.sendMessage(jid, { text: message });
    
    console.log('✅ Message sent successfully to:', cleanNumber);
    
    res.json({ 
      ok: true,
      message: "OTP sent successfully",
      to: cleanNumber,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Send OTP error:', error.message);
    
    let statusCode = 500;
    let errorMessage = error.message;
    
    if (error.message.includes("Not authorized")) {
      statusCode = 401;
      errorMessage = "WhatsApp not authenticated. Please scan QR code.";
    } else if (error.message.includes("not registered") || error.message.includes("invalid")) {
      statusCode = 400;
      errorMessage = "Invalid phone number or number not registered on WhatsApp";
    }
    
    res.status(statusCode).json({ 
      error: "Failed to send message",
      details: errorMessage,
      timestamp: new Date().toISOString()
    });
  }
});

// ================= CONNECT TO WA =================
async function connectToWA() {
  try {
    console.log("🔥 XPROVerce WhatsApp Bot is starting...");

    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Using WA v${version.join(".")}, isLatest: ${isLatest}`);

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR + "/");

    const conn = makeWASocket({
      logger: P({ level: "silent" }),
      printQRInTerminal: true, // Changed to true to see QR in Render logs
      generateHighQualityLinkPreview: true,
      auth: state,
      defaultQueryTimeoutMs: undefined,
      browser: Browsers.macOS("Firefox"),
      syncFullHistory: false,
      version,
    });

    // Reconnect logic
    conn.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        console.log("⚠️ Connection closed, reconnecting...", statusCode || "");
        setTimeout(connectToWA, 5000);
      } else if (connection === "open") {
        console.log("✅ XPROVerce WhatsApp connected successfully!");
        
        sockInstance = conn; // Set the global socket instance
        
        // Send startup message (optional)
        const up = `OTP-BOT ✅
        `;
        try {
          await conn.sendMessage(conn.user.id, { text: up });
        } catch (err) {
          console.log("Startup message failed:", err.message);
        }
      }
      
      // QR code event
      if (update.qr) {
        console.log("📱 QR Code generated - Scan with WhatsApp");
      }
    });

    conn.ev.on("creds.update", saveCreds);
    
  } catch (err) {
    logError("connectToWA", err);
    console.log("Reconnecting in 10 seconds...");
    setTimeout(connectToWA, 10000);
  }
}

// ================= START SERVER =================
app.listen(PORT, () => {
  console.log(`✨ XPROVerce OTP Server listening on port ${PORT}`);
  console.log(`🌐 Health check: https://your-render-url.onrender.com/`);
  console.log(`📱 OTP endpoint: POST https://your-render-url.onrender.com/send-otp`);
  
  // Start WhatsApp connection
  setTimeout(() => {
    console.log("\n📱 Starting WhatsApp connection...");
    connectToWA();
  }, 1000);
});
