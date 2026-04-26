import express from "express";
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { PrismaClient } = require("@prisma/client");
const { v4: uuidv4 } = require("uuid");

const prisma = new PrismaClient();
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingTimeout: 20000,
  pingInterval: 10000,
});


const FU_REGISTRY = {}; 
const SID_TO_FU = {};   

const FU_TIMEOUT_SEC = 30;


app.get("/api/users", async (req, res) => {
  try {
    const users = await prisma.user.findMany();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: "Database error" });
  }
});

app.get("/api/users/requests", async (req, res) => {
  try {
   
    const users = await prisma.user.findMany({
      select: { satids: true } 
    });

    const requestedNorads = new Set();

    users.forEach(user => {
      if (Array.isArray(user.satids)) {
        user.satids.forEach(satStr => {
      
          const match = satStr.match(/\((\d+)\)/);
          if (match) {
            requestedNorads.add(match[1]);
          } 
     
          else if (/^\d+$/.test(satStr.trim())) {
            requestedNorads.add(satStr.trim());
          }
        });
      }
    });

    res.json(Array.from(requestedNorads));

  } catch (error) {
    console.error("Prisma Error:", error);
    res.status(500).json({ error: "Failed to fetch user data" });
  }
});

app.post("/api/schedule/publish", (req, res) => {
  const { schedule } = req.body;
  
  if (!schedule) {
    return res.status(400).json({ error: "No schedule provided" });
  }

  console.log("[SCHEDULER] New schedule received from Control Unit. Broadcasting...");
  io.emit("fu_schedule_update", schedule);
  res.json({ status: "ok", message: "Schedule published successfully" });
});

app.get("/api/fu_registry", (req, res) => {
  res.json(Object.values(FU_REGISTRY));
});


app.post("/api/fu/noradid", (req, res) => {
  const { fu_id, norad_id } = req.body;
  const fu = FU_REGISTRY[fu_id];

  if (!fu) return res.status(404).json({ error: "FU not found" });
  if (fu.state === "OFFLINE") return res.status(400).json({ error: "FU is offline" });

  const activity_id = uuidv4();
  
  
  fu.state = "BUSY";
  fu.current_pass = activity_id;


  io.to(fu_id).emit("fu_command", {
    command_id: activity_id,
    type: "track",
    args: { norad_id, mode: "MANUAL" },
    timestamp: Date.now()
  });

  console.log(`[MANUAL_TRACK] fu=${fu_id} norad=${norad_id}`);
  

  io.emit("fu_registry_update", Object.values(FU_REGISTRY));

  res.json({ status: "ok", activity_id });
});



io.on("connection", (socket) => {
  console.log(`[CONNECT] Client connected: ${socket.id}`);
  socket.on("sdr_waterfall", (data) => {
    io.emit("sdr_waterfall", data);
  });

  socket.on("fu_status", (data) => {
    const fu_id = data.fu_id;

    socket.join(fu_id);
    SID_TO_FU[socket.id] = fu_id;

    FU_REGISTRY[fu_id] = {
      fu_id: fu_id,
      state: data.state || "IDLE",
      health: data.health || "OK",
      mode: data.mode || "AUTO",
      location: data.location || null,
      az: data.az || 0,
      el: data.el || 0,
      satellite: data.satellite || "--",
      next_satellite: data.next_satellite || "--",
      current_pass: data.current_pass || null,
      last_seen: Date.now(),
    };

  
    io.emit("fu_registry_update", Object.values(FU_REGISTRY));
  });


  socket.on("disconnect", () => {
    const fu_id = SID_TO_FU[socket.id];
    if (fu_id && FU_REGISTRY[fu_id]) {
      FU_REGISTRY[fu_id].state = "OFFLINE";
      FU_REGISTRY[fu_id].health = "ERROR";
      io.emit("fu_registry_update", Object.values(FU_REGISTRY));
    }
    delete SID_TO_FU[socket.id];
    console.log(`[DISCONNECT] ${fu_id || socket.id}`);
  });
});



setInterval(() => {
  const now = Date.now();
  let changed = false;

  for (const fu_id in FU_REGISTRY) {
    const fu = FU_REGISTRY[fu_id];
    if (fu.state !== "OFFLINE" && (now - fu.last_seen) > (FU_TIMEOUT_SEC * 1000)) {
      fu.state = "OFFLINE";
      fu.health = "ERROR";
      changed = true;
      console.log(`[WATCHDOG] FU ${fu_id} marked OFFLINE`);
    }
  }

  if (changed) {
    io.emit("fu_registry_update", Object.values(FU_REGISTRY));
  }
}, 5000); 

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;