const express = require("express");
const app = express();
const fs = require("fs");
const config = require("./config");
const PORT = process.env.PORT || 4000;
const bodyParser = require("body-parser");
const cors = require("cors");
const gameManager = require("./gameManager");
const players = require("./database").players;
const rooms = require("./database").rooms;
let server;
if (config.devMode) {
  server = require("http").createServer(app);
} else {
  const serverOptions = {
    key: fs.readFileSync(
      "/etc/letsencrypt/live/" + config.domain + "/privkey.pem"
    ),
    cert: fs.readFileSync(
      "/etc/letsencrypt/live/" + config.domain + "/cert.pem"
    ),
  };
  server = require("https").createServer(serverOptions, app);
}
app.use(bodyParser.json({ limit: "50mb" }));
app.use(cors());
const options = {
  cors: {
    origin: "*",
  },
};

app.set("port", PORT);
app.get("/", async (req, res) => {
  return res.status(200).json({
    // players: Object.fromEntries(players),
    rooms: Object.fromEntries(rooms),
  });
});
const io = require("socket.io")(server, options);
io.on("connection", async (socket) => {
  console.log("New Connection - " + socket.id);
  //User Init - sessionId
  socket.on("configSession", (sessionId, callback) => {
    gameManager.configSession(socket, sessionId, callback);
  });
  //User Init - username
  socket.on("setUsername", (sessionId, username, callback) => {
    gameManager.setUsername(socket, sessionId, username, callback);
  });
  //User Leave
  socket.on("disconnecting", () => {
    gameManager.setPlayerAsAfk(io, socket);
  });
  //Create Room
  socket.on("createRoom", (callback) => {
    gameManager.createRoom(io, socket, callback);
  });
  //Join Room
  socket.on("joinRoom", (roomId, callback) => {
    gameManager.joinGame(io, socket, roomId, callback);
  });
  //Leave Room
  socket.on("leaveRoom", (callback) => {
    gameManager.leaveRoom(io, socket, callback);
  });
  //Fetch Room Details
  socket.on("getRoomDetails", (roomId, callback) => {
    gameManager.fetchRoomDetails(roomId, socket, callback);
  });
  //Player chooses word
  socket.on("chooseWord", (chosenWord, callback) => {
    gameManager.chooseWord(io, socket, chosenWord, callback);
  });
  //Draw Data
  socket.on("drawData", (data) => {
    gameManager.updateCanvas(socket, data);
  });
  //New Chat message
  socket.on("newMessage", (text) => {
    gameManager.chatHandler(io, socket, text);
  });
});
server.listen(PORT, () => {
  console.log("Server Started...");
});
