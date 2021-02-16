const express = require("express");
const app = express();
const server = require("http").createServer(app);
const PORT = process.env.PORT || 4000;
const bodyParser = require("body-parser");
const cors = require("cors");
const gameManager = require("./gameManager");
app.use(bodyParser.json({ limit: "50mb" }));
app.use(cors());
const players = require("./database").players;
const rooms = require("./database").rooms;
const options = {
  cors: {
    origin: "*",
  },
};

app.set("port", PORT);
app.get("/", async (req, res) => {
  return res.status(200).json({
    players: Object.fromEntries(players),
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
    gameManager.setPlayerAsAfk(socket);
  });
  //Create Room
  socket.on("createRoom", (callback) => {
    gameManager.createRoom(socket, callback);
  });
  //Join Room
  socket.on("joinRoom", (roomId, callback) => {
    gameManager.joinGame(io, socket, roomId, callback);
  });
  //Fetch Room Details
  socket.on("getRoomDetails", (callback) => {
    gameManager.fetchRoomDetails(socket, callback);
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
