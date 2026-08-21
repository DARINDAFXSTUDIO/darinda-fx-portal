require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const FormData = require("form-data");

const app = express();
const PORT = process.env.PORT || 3000;

// ⚙️ CONFIGURATION
const TG_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8802791427:AAFHENzggB_bswvFwbcgaOomrMgMZEScl5E";
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "-1004309840011";
const TG_LOCAL_API = process.env.TELEGRAM_API_BASE || "http://localhost:8081";

const DB_FILE = path.join(__dirname, "database.json");
const UPLOADS_DIR = path.join(__dirname, "uploads");

fs.ensureDirSync(UPLOADS_DIR);

app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));
app.use(express.static(path.join(__dirname, "public")));

// Byte-range streaming for video players
app.use("/uploads", express.static(UPLOADS_DIR, {
  setHeaders: (res) => {
    res.set("Accept-Ranges", "bytes");
  }
}));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}_${cleanName}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2000 * 1024 * 1024 } // 2GB
});

function getDb() {
  if (!fs.existsSync(DB_FILE)) {
    const initial = {
      clients: [
        { id: "CLI-01", name: "Rahul Sharma", instagram: "@rahulfitness", secretKey: "DARINDA2026", access: "Active" },
        { id: "CLI-02", name: "DAVE", instagram: "@darinda.fx", secretKey: "DAVE", access: "Active" }
      ],
      invoices: [{ number: "DFX-2026-001", client: "DAVE", date: "2026-08-21", total: 1600, paid: 800, balance: 800, status: "SENT" }],
      deliverables: [{ 
        id: "DEL-01", 
        client: "DAVE", 
        title: "TEST 1", 
        price: 800, 
        locked: true, 
        watermark: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4", 
        master: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4" 
      }],
      utr: [],
      raw: [],
      feedback: [{ client: "DAVE", rating: 5, text: "Insane video editing quality!" }],
      kry: [
        { id: "KRY-01", client: "DAVE", token: "KRY-2026-57JUBT", tier: "VIP Preset Access", status: "Active" }
      ],
      chats: { "DAVE": [{ sender: "client", text: "Hey bro! Just uploaded raw footage." }, { sender: "Studio", text: "Received! Render started." }] }
    };
    fs.writeJsonSync(DB_FILE, initial, { spaces: 2 });
    return initial;
  }
  return fs.readJsonSync(DB_FILE);
}

function saveDb(data) {
  fs.writeJsonSync(DB_FILE, data, { spaces: 2 });
}

// Telegram Forwarder with Dual-API Fast Failover (Non-Blocking)
async function forwardToTelegram(filePath, originalname, caption) {
  if (!TG_BOT_TOKEN) return null;
  const endpoints = [
    `${TG_LOCAL_API}/bot${TG_BOT_TOKEN}/sendDocument`,
    `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendDocument`
  ];

  for (const endpoint of endpoints) {
    try {
      const form = new FormData();
      form.append("chat_id", TG_CHAT_ID);
      form.append("caption", caption);
      form.append("document", fs.createReadStream(filePath), originalname);

      const res = await axios.post(endpoint, form, {
        headers: form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 15000
      });
      return res.data?.result?.document?.file_id || null;
    } catch (err) {}
  }
  return null;
}

function authGuard(req, res, next) {
  const cid = req.cookies.dfx_client_id;
  const db = getDb();
  const client = (db.clients || []).find(c => c.id === cid);
  if (!client || client.access === "Revoked") return res.status(401).json({ error: "UNAUTHORIZED" });
  req.client = client;
  next();
}

app.get("/api/health", (req, res) => res.json({ ok: true, service: "darinda-fx" }));

// 🔐 SMART CLIENT AUTH
app.post("/api/auth/login", (req, res) => {
  const inputKey = (req.body.accessKey || "").trim().toUpperCase();
  if (!inputKey) return res.status(400).json({ error: "KEY_REQUIRED" });

  const db = getDb();
  const matchedKry = (db.kry || []).find(k => (k.token || "").toUpperCase() === inputKey && k.status === "Active");

  let client = null;
  if (matchedKry) {
    client = (db.clients || []).find(c => c.name.toLowerCase() === matchedKry.client.toLowerCase());
  }
  if (!client) {
    client = (db.clients || []).find(c => (c.secretKey || "").toUpperCase() === inputKey || c.name.toUpperCase() === inputKey);
  }

  if (!client) return res.status(401).json({ error: "INVALID_KEY" });
  if (client.access === "Revoked") return res.status(403).json({ error: "ACCESS_REVOKED" });

  res.cookie("dfx_client_id", client.id, { httpOnly: true, sameSite: "lax" });
  res.json({ client: { id: client.id, name: client.name, instagram: client.instagram } });
});

app.get("/api/me", authGuard, (req, res) => {
  res.json({ client: { id: req.client.id, name: req.client.name, instagram: req.client.instagram } });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("dfx_client_id");
  res.json({ success: true });
});

// 🎯 PORTAL SYNC WITH RAW FOOTAGE COUNT
app.get("/api/portal", authGuard, (req, res) => {
  const db = getDb();
  const cName = req.client.name;

  res.json({
    invoices: (db.invoices || []).filter(i => i.client === cName),
    deliverables: (db.deliverables || []).filter(d => d.client === cName).map(d => ({
      id: d.id,
      title: d.title,
      price: d.price,
      locked: d.locked,
      watermark: d.watermark || d.watermarkPreviewUrl,
      master: d.locked ? null : (d.master || d.originalLink)
    })),
    raw: (db.raw || []).filter(r => r.client === cName),
    reviews: db.feedback || [],
    kry: (db.kry || []).filter(k => k.client === cName)
  });
});

// FAST BATCH UPLOAD (NON-BLOCKING TELEGRAM)
app.post("/api/raw-upload-batch", authGuard, upload.array("files"), async (req, res) => {
  try {
    const { note, reference, drive } = req.body;
    const files = req.files || [];
    const db = getDb();

    if (files.length) {
      const backgroundQueue = [];

      for (const file of files) {
        const rawEntry = {
          id: "RAW-" + Date.now() + Math.floor(Math.random() * 1000),
          client: req.client.name,
          filename: file.originalname,
          storedName: file.filename,
          fileUrl: `/uploads/${file.filename}`,
          size: file.size,
          note: note || "",
          reference: reference || "",
          drive: drive || "",
          tgFileId: null,
          timestamp: new Date().toISOString()
        };

        db.raw = db.raw || [];
        db.raw.unshift(rawEntry);
        backgroundQueue.push({ entryId: rawEntry.id, filePath: file.path, originalname: file.originalname });
      }

      saveDb(db);
      res.json({ success: true, message: "Footage saved in studio registry" });

      (async () => {
        for (const item of backgroundQueue) {
          try {
            const tgId = await forwardToTelegram(
              item.filePath, 
              item.originalname, 
              `🎬 Raw: ${req.client.name}\n📝 Note: ${note || "-"}\n🔗 Ref: ${reference || "-"}`
            );
            if (tgId) {
              const liveDb = getDb();
              const rec = (liveDb.raw || []).find(r => r.id === item.entryId);
              if (rec) {
                rec.tgFileId = tgId;
                saveDb(liveDb);
              }
            }
          } catch (e) {}
        }
      })();
      return;
    } else if (drive || reference) {
      db.raw = db.raw || [];
      db.raw.unshift({
        id: "RAW-" + Date.now(),
        client: req.client.name,
        filename: "",
        storedName: "",
        fileUrl: "",
        size: 0,
        drive: drive || "",
        reference: reference || "",
        note: note || "",
        timestamp: new Date().toISOString()
      });
      saveDb(db);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: "NO_ASSETS" });
    }
  } catch (err) {
    res.status(500).json({ error: "UPLOAD_FAILED" });
  }
});

app.post("/api/raw-link", authGuard, (req, res) => {
  const { drive, reference, note } = req.body;
  const db = getDb();
  db.raw = db.raw || [];
  db.raw.unshift({
    id: "RAW-" + Date.now(),
    client: req.client.name,
    filename: "",
    storedName: "",
    fileUrl: "",
    size: 0,
    drive: drive || "",
    reference: reference || "",
    note: note || "",
    timestamp: new Date().toISOString()
  });

  saveDb(db);
  res.json({ success: true });
});

app.get("/api/chat", authGuard, (req, res) => {
  const db = getDb();
  res.json({ messages: (db.chats && db.chats[req.client.name]) || [] });
});

app.post("/api/chat", authGuard, (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "Empty message" });

  const db = getDb();
  db.chats = db.chats || {};
  if (!db.chats[req.client.name]) db.chats[req.client.name] = [];

  const newMsg = {
    sender: "client",
    text,
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  };

  db.chats[req.client.name].push(newMsg);
  saveDb(db);
  res.json({ success: true, message: newMsg });
});

// TARGETED UTR REGISTRATION
app.post("/api/utr", authGuard, (req, res) => {
  const { utr, amount, deliverableId } = req.body;
  const db = getDb();
  db.utr = db.utr || [];
  
  const targetDeliv = (db.deliverables || []).find(d => String(d.id) === String(deliverableId));

  db.utr.unshift({
    id: "UTR-" + Date.now(),
    client: req.client.name,
    deliverableId: deliverableId || null,
    deliverableTitle: targetDeliv ? targetDeliv.title : "Target Video Render",
    utr: utr || "",
    amount: Number(amount || (targetDeliv ? targetDeliv.price : 800)),
    date: new Date().toISOString().slice(0, 10)
  });

  saveDb(db);
  res.json({ success: true });
});

app.post("/api/reviews", authGuard, (req, res) => {
  const { text, rating } = req.body;
  const db = getDb();
  db.feedback = db.feedback || [];
  db.feedback.unshift({
    client: req.client.name,
    text: text || "",
    rating: Number(rating || 5),
    timestamp: new Date().toISOString().slice(0, 10)
  });

  saveDb(db);
  res.json({ success: true });
});

// ADMIN DELIVERABLE PUBLISH (DIRECT FILE + LINK)
const adminDelivUpload = upload.fields([
  { name: "draftFile", maxCount: 1 },
  { name: "masterFile", maxCount: 1 }
]);

app.post("/api/admin/publish-deliverable-upload", adminDelivUpload, async (req, res) => {
  try {
    const { client, title, price, watermarkLink, masterLink } = req.body;
    if (!client || !title) return res.status(400).json({ error: "CLIENT_AND_TITLE_REQUIRED" });

    const draftFile = req.files?.["draftFile"]?.[0];
    const masterFile = req.files?.["masterFile"]?.[0];

    const finalWatermark = draftFile ? `/uploads/${draftFile.filename}` : (watermarkLink || "#");
    const finalMaster = masterFile ? `/uploads/${masterFile.filename}` : (masterLink || "#");

    const db = getDb();
    db.deliverables = db.deliverables || [];
    db.deliverables.unshift({
      id: "DEL-" + Date.now(),
      client,
      title,
      price: Number(price || 800),
      locked: true,
      watermark: finalWatermark,
      master: finalMaster,
      timestamp: new Date().toISOString()
    });

    saveDb(db);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "PUBLISH_FAILED" });
  }
});

app.get("/api/admin/sync", (req, res) => res.json(getDb()));

app.post("/api/admin/action", (req, res) => {
  try {
    const { type, payload } = req.body;
    const db = getDb();

    if (type === "SAVE_CLIENT") {
      db.clients = db.clients || [];
      db.clients.push({ id: "CLI-" + Date.now(), ...payload });
    } else if (type === "DELETE_CLIENT") {
      db.clients = (db.clients || []).filter(c => c.id !== payload.id);
    } else if (type === "TOGGLE_DELIV_LOCK") {
      const d = (db.deliverables || []).find(x => String(x.id) === String(payload.id));
      if (d) d.locked = payload.locked;
    } else if (type === "DELETE_DELIV") {
      db.deliverables = (db.deliverables || []).filter(d => String(d.id) !== String(payload.id));
    } 
    // 🎯 STRICT SINGLE VIDEO APPROVAL
    else if (type === "APPROVE_UTR") {
      const { utrId, utrIndex, deliverableId, clientName } = payload;
      
      if (utrId) {
        db.utr = (db.utr || []).filter(u => u.id !== utrId);
      } else if (typeof utrIndex === "number") {
        db.utr.splice(utrIndex, 1);
      }

      if (deliverableId) {
        const target = (db.deliverables || []).find(d => String(d.id) === String(deliverableId));
        if (target) target.locked = false;
      } else {
        const target = (db.deliverables || []).find(d => d.client === clientName && d.locked);
        if (target) target.locked = false;
      }
    } else if (type === "SAVE_INVOICE") {
      db.invoices = db.invoices || [];
      db.invoices.unshift(payload);
    } else if (type === "DELETE_INVOICE") {
      db.invoices = (db.invoices || []).filter(i => i.number !== payload.number);
    } else if (type === "MARK_PAID_INVOICE") {
      const inv = (db.invoices || []).find(i => i.number === payload.number);
      if (inv) { inv.paid = inv.total; inv.balance = 0; inv.status = "PAID"; }
    } else if (type === "GENERATE_KRY") {
      db.kry = db.kry || [];
      db.kry.unshift(payload);
    } else if (type === "TOGGLE_KRY") {
      const k = (db.kry || []).find(x => x.id === payload.id);
      if (k) k.status = k.status === "Active" ? "Revoked" : "Active";
    } else if (type === "DELETE_RAW") {
      const item = (db.raw || []).find(r => String(r.id) === String(payload.id));
      if (item && item.storedName) {
        fs.remove(path.join(UPLOADS_DIR, item.storedName)).catch(() => {});
      }
      db.raw = (db.raw || []).filter(r => String(r.id) !== String(payload.id));
    } else if (type === "SEND_CHAT" || type === "ADMIN_CHAT_MSG") {
      const client = payload.client || payload.clientName;
      const msg = payload.message || { sender: "Studio", text: payload.text, time: new Date().toLocaleTimeString() };
      db.chats = db.chats || {};
      if (!db.chats[client]) db.chats[client] = [];
      db.chats[client].push(msg);
    }

    saveDb(db);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "ACTION_FAILED" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 DARINDA.FX Studio Engine running at http://localhost:${PORT}`);
});