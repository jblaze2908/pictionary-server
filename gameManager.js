const players = require("./database").players;
const rooms = require("./database").rooms;
const pictionaryWords = require("./wordsDB");
const {
  alreadyInRoom,
  generateRoomId,
  generateSessionId,
  scoreCalculator,
  roomNotFound,
  redactChosenWord,
  wordAlreadyChosen,
  populatePlayers,
  populatePlayerDetails,
  correctWordValidator,
  updateScore,
  nextTurnDecider,
  joinGame,
  findWithAttr,
} = require("./helperFunctions");
let timeout;
const gameManager = {
  configSession: async (socket, sessionId, callback) => {
    let newSessionId = await generateSessionId(sessionId);
    let player = players.get(newSessionId);
    players.set(newSessionId, {
      username: player ? player.username : "",
      socket_id: socket.id,
      sessionId: newSessionId,
      currentRoom: player ? player.currentRoom : "",
      inGame: true,
      ...player,
    });
    socket.sessionId = newSessionId;
    if (players.get(newSessionId).currentRoom) {
      socket.join(players.get(newSessionId).currentRoom);
      clearTimeout(players.get(newSessionId).deleteTimeout);
      let dataToSend = { ...rooms.get(players.get(newSessionId).currentRoom) };
      dataToSend = await redactChosenWord(dataToSend, sessionId);
      dataToSend = await populatePlayers(dataToSend);
      callback({
        status: 200,
        sessionId: newSessionId,
        roomDetails: dataToSend,
      });
    } else callback({ status: 200, sessionId: newSessionId });
  },
  setUsername: (socket, sessionId, username, callback) => {
    players.set(sessionId, {
      ...players.get(sessionId),
      username: username,
    });
    socket.username = username;
    callback({ status: 200 });
  },
  createRoom: async (io, socket, callback) => {
    let roomID = await alreadyInRoom(io, socket, callback);

    if (roomID) {
      gameManager.endRound(io, roomID);
    }
    let roomId = generateRoomId();
    let room = {
      roomId,
      players: [
        {
          sessionId: socket.sessionId,
          score: 0,
        },
      ],
      chats: [],
      currentBoard: [],
      roundDetails: [],
      timer: 60,
      gameOver: false,
    };
    rooms.set(roomId, room);
    await joinGame(socket.sessionId, roomId);
    socket.join(roomId);
    let dataToSend = { ...room };
    dataToSend = await populatePlayers(dataToSend);
    callback({
      status: 200,
      roomId: roomId,
      roomDetails: dataToSend,
    });
  },
  joinGame: async (io, socket, roomId, callback) => {
    let roomID = await alreadyInRoom(io, socket, callback);
    if (roomID) {
      gameManager.endRound(io, roomID);
    }
    if (roomNotFound(io, roomId, callback)) return;
    let startGame;
    let room = { ...rooms.get(roomId) };
    let roomPlayers = [...room.players];
    if (roomPlayers.length === 1) startGame = true;
    roomPlayers.push({
      sessionId: socket.sessionId,
      score: 0,
    });
    let chats = [...room.chats];
    let msg = {
      text: players.get(socket.sessionId).username + " joined",
      sender: undefined,
    };
    chats.push(msg);
    room.chats = chats;
    room.players = roomPlayers;
    rooms.set(roomId, room);
    joinGame(socket.sessionId, roomId);
    socket.join(roomId);
    let dataToSend = { ...room };

    // socket
    //   .to(roomId)
    //   .emit("playerJoined", populatePlayerDetails(socket.sessionId), 0);
    dataToSend = await redactChosenWord(dataToSend, socket.sessionId);
    dataToSend = await populatePlayers(dataToSend);
    io.to(roomId).emit("updateRound", {
      chats: room.chats,
      players: dataToSend.players,
    });
    callback({
      status: 200,
      roomId: roomId,
      roomDetails: dataToSend,
    });
    if (startGame) gameManager.endRound(io, roomId, true);
  },
  fetchRoomDetails: async (socket, roomID, callback) => {
    let roomId = Array.from(socket.rooms)[1];
    if (roomID !== roomId) {
      callback({ status: 404 });
      return;
    }
    let room = { ...rooms.get(roomId) };
    let currentRound = room.roundDetails[room.roundDetails.length - 1];
    let dataToSend = { ...room };
    dataToSend = await populatePlayers(dataToSend);
    dataToSend = await redactChosenWord(dataToSend, socket.sessionId);
    let callBackData = {
      status: 200,
      roomId: roomId,
      roomDetails: dataToSend,
    };
    callback(callBackData);
  },
  pauseGame: (room) => {},
  randomWordsGenerator: (roomId) => {
    let room = { ...rooms.get(roomId) };
    let length = pictionaryWords.length;
    let words = [];
    while (words.length < 3) {
      let word = pictionaryWords[Math.floor(Math.random() * length)];
      if (!wordAlreadyChosen(word, room.roundDetails)) words.push(word);
    }
    return words;
  },
  chooseWord: async (io, socket, chosenWord, callback) => {
    let roomId = Array.from(socket.rooms)[1];
    let room = { ...rooms.get(roomId) };
    room.roundDetails[room.roundDetails.length - 1].chosenWord = chosenWord;
    rooms.set(roomId, room);
    callback({
      status: 200,
    });
    let dataToSend = { ...room };
    dataToSend = await populatePlayers(dataToSend);
    let unredactedData = { ...dataToSend };
    socket.emit("updateRound", unredactedData);
    dataToSend = await redactChosenWord(dataToSend, "");
    socket.to(roomId).emit("updateRound", dataToSend);
    gameManager.timerUpdate(io, roomId, 60);
  },
  timerUpdate: (io, roomId, time) => {
    let room = { ...rooms.get(roomId) };
    room.timer = time;
    rooms.set(roomId, room);
    io.to(roomId).emit("timerUpdate", time);
    if (time >= 1) {
      timeout = setTimeout(() => {
        room = { ...rooms.get(roomId) };
        if (room.players.length === 1) {
          io.to(roomId).emit("timerUpdate", 60);
          io.to(roomId).emit("drawDataServer", { clear: true });
          return;
        }
        gameManager.timerUpdate(io, roomId, time - 1);
      }, 1000);
    } else {
      gameManager.endRound(io, roomId);
    }
  },
  updateCanvas: (socket, data) => {
    if (socket.rooms.size === 1) {
    } else {
      let roomId = Array.from(socket.rooms)[1];
      let room = { ...rooms.get(roomId) };
      let currentRound = room.roundDetails[room.roundDetails.length - 1];
      if (!currentRound || currentRound.chosenBy !== socket.sessionId) return;
      if (data.clear) room.currentBoard = [];
      else room.currentBoard = room.currentBoard.concat(data);
      rooms.set(roomId, room);
      socket.to(roomId).emit("drawDataServer", data);
    }
  },
  chatHandler: async (io, socket, text) => {
    let roomId = Array.from(socket.rooms)[1];
    let room = { ...rooms.get(roomId) };
    let sender = socket.sessionId;
    let currentRound = room.roundDetails[room.roundDetails.length - 1];
    if (correctWordValidator(room, text)) {
      if (currentRound.chosenBy === sender) {
        return;
      }
      let score = scoreCalculator(room.timer);
      room = updateScore({ ...room }, sender, score);
      let msg = {
        text:
          players.get(sender).username +
          " guessed the word correctly. +" +
          score +
          ".",
        sender: undefined,
      };
      let chats = [...room.chats];
      chats.push(msg);
      room.chats = chats;
      rooms.set(roomId, room);
      socket.emit("correctAnswer", score);
      io.in(roomId).emit("newChatMessage", undefined, msg.text);
      // socket
      //   .to(roomId)
      //   .emit("someoneGuessedCorrect", players.get(sender).username, score);
      let dataToSend = { ...room };
      dataToSend = await populatePlayers(dataToSend);
      io.in(roomId).emit("updateRound", dataToSend);
      if (currentRound.guessedBy.length === room.players.length - 2) {
        gameManager.endRound(io, roomId);
      }
    } else {
      let chats = [...room.chats];
      chats.push({
        text: text,
        sender: socket.username,
      });
      room.chats = chats;
      rooms.set(roomId, room);
      io.in(roomId).emit("newChatMessage", players.get(sender).username, text);
    }
  },
  endRound: async (io, roomId, firstTime) => {
    clearTimeout(timeout);
    let room = { ...rooms.get(roomId) };
    let nextTurn = nextTurnDecider(room);
    room.roundDetails.push({
      roundNum: room.roundDetails.length + 1,
      chosenWord: "",
      chosenBy: nextTurn,
      guessedBy: [],
    });
    room.currentBoard = [];
    rooms.set(roomId, room);
    let words = gameManager.randomWordsGenerator(roomId);
    let nextTurnPlayer = players.get(nextTurn);
    let playerSocketId = nextTurnPlayer.socket_id;
    if (firstTime) {
      io.to(roomId).emit("startingIn", 3);
      setTimeout(() => {
        io.to(roomId).emit("startingIn", 2);
        setTimeout(() => {
          io.to(roomId).emit("startingIn", 1);
          setTimeout(async () => {
            io.to(roomId).emit("startingIn", 0);
            io.to(playerSocketId).emit("chooseWord", words);
            let dataToSend = { ...room };
            dataToSend = await populatePlayers(dataToSend);
            io.in(roomId).emit("updateRound", dataToSend);
          }, 1000);
        }, 1000);
      }, 1000);
    } else {
      io.to(playerSocketId).emit("chooseWord", words);
      let dataToSend = { ...room };
      dataToSend = await populatePlayers(dataToSend);
      io.in(roomId).emit("updateRound", dataToSend);
    }
  },
  removeAfkPlayers: async (io, playerSessionId) => {
    let player = players.get(playerSessionId);
    if (!player || !player.currentRoom) return;
    let room = rooms.get(player.currentRoom);
    if (room) {
      let roomPlayers = [...room.players];
      let index = findWithAttr(roomPlayers, "SessionId", playerSessionId);
      roomPlayers.splice(index, 1);
      let msg = {
        text: player.username + " left.",
        sender: undefined,
      };
      let chats = [...room.chats];
      chats.push(msg);
      room.chats = chats;
      room.timer = 60;
      room.players = roomPlayers;
      rooms.set(player.currentRoom, room);
      if (
        room.roundDetails.length !== 0 &&
        room.roundDetails[room.roundDetails.length - 1].chosenBy ===
          player.sessionId &&
        room.players.length !== 1
      ) {
        gameManager.endRound(io, player.currentRoom);
      } else {
        let dataToSend = { ...room };
        dataToSend = await populatePlayers(dataToSend);
        let unredactedData = { ...dataToSend };
        io.in(player.currentRoom).emit("updateRound", unredactedData);
      }
    }
    players.delete(playerSessionId);
  },
  leaveRoom: (io, socket, callback) => {
    alreadyInRoom(io, socket);
    callback({ status: 200 });
  },
  endGame: (io, roomId) => {
    let room = { ...rooms.get(roomId) };
    let playerInRoom = room.players;
    io.to(roomId).emit("matchOver");
    playerInRoom.forEach((player) => {
      let socketId = players.get(player.sessionId).socket_id;
      io.sockets.sockets[socketId].leave(roomId);
    });
    room.gameOver = true;
    rooms.set(roomId, room);
  },
  setPlayerAsAfk: (io, socket) => {
    for (let [key, value] of players) {
      if (value.socket_id === socket.id) {
        let player = players.get(key);
        players.set(key, {
          ...player,
          inGame: false,
          deleteTimeout: setTimeout(() => {
            gameManager.removeAfkPlayers(io, player.sessionId);
          }, 5000),
        });
      }
    }
  },
};
module.exports = gameManager;
