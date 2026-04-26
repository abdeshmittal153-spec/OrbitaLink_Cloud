// mock_fu.js
const io = require("socket.io-client"); // <-- This is the fix!

// Connect to the cloud server
const socket = io("http://localhost:5050");

socket.on("connect", () => {
  console.log("Mock Field Unit Connected!");
  
  // Send telemetry status to the server
  socket.emit("fu_status", {
    fu_id: "FU-TEST-01",
    state: "IDLE",
    health: "OK",
    location: { latitude: 27.897, longitude: 78.088 }, // e.g., Aligarh coordinates
    satellite: "--"
  });
});

// Listen for track commands from the GUI
socket.on("fu_command", (cmd) => {
  console.log("RECEIVED COMMAND FROM GUI:", cmd);
  
  // Acknowledge we are tracking
  socket.emit("fu_status", {
    fu_id: "FU-TEST-01",
    state: "BUSY",
    health: "OK",
    location: { latitude: 27.897, longitude: 78.088 },
    satellite: `CAT-${cmd.args.norad_id}` 
  });
});