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
  setGameAsPaused,
  correctWordValidator,
  updateScore,
  nextTurnDecider,
  joinRoom,
  whoseTurnIsIt,
  removeFromRoom,
  notifyPlayersInRoom,
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
  removeFromExistingRoom: async (io, socket, roomId) => {
    return new Promise(async (resolve, reject) => {
      await removeFromRoom(socket, roomId);
      let numPlayersLeft = rooms.get(roomId).players.length;
      if (numPlayersLeft < 2) {
        await setGameAsPaused(roomId);
      }
      let wordChosenBy = whoseTurnIsIt(roomId);
      if (wordChosenBy === socket.sessionId) {
        await gameManager.endRound(io, roomId);
      } else {
        await notifyPlayersInRoom(io, roomId, wordChosenBy);
      }
      resolve(null);
    });
  },
  createRoom: async (io, socket, callback) => {
    let previousRoomId = alreadyInRoom(socket);
    if (previousRoomId) {
      await gameManager.removeFromExistingRoom(io, socket, previousRoomId);
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
      chats: [{ text: socket.username + " joined.", sender: undefined }],
      currentBoard: [],
      roundDetails: [],
      timer: 60,
      gameState: "PAUSED",
    };
    rooms.set(roomId, room);
    await joinRoom(socket.sessionId, roomId);
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
    let previousRoomId = alreadyInRoom(socket);
    if (previousRoomId) {
      await gameManager.removeFromExistingRoom(io, socket, previousRoomId);
    }
    if (roomNotFound(io, roomId, callback)) return;
    let room = { ...rooms.get(roomId) };
    let roomPlayers = [...room.players];
    let stateChange = false;
    if (room.gameState === "PAUSED") {
      room.gameState = "ACTIVE";
      stateChange = true;
    }
    roomPlayers.push({
      sessionId: socket.sessionId,
      score: 0,
    });
    let chats = [...room.chats];
    chats.push({
      text: socket.username + " joined.",
      sender: undefined,
    });
    room.chats = chats;
    room.players = roomPlayers;
    rooms.set(roomId, room);
    await notifyPlayersInRoom(io, roomId, whoseTurnIsIt(roomId));
    await joinRoom(socket.sessionId, roomId);
    socket.join(roomId);
    let dataToSend = { ...room };
    dataToSend = await populatePlayers(dataToSend);
    dataToSend = await redactChosenWord(dataToSend, socket.sessionId);
    callback({
      status: 200,
      roomId: roomId,
      roomDetails: dataToSend,
    });
    if (stateChange)
      setTimeout(() => {
        gameManager.endRound(io, roomId, true);
      }, 1000);
  },
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
    await notifyPlayersInRoom(io, roomId, socket.sessionId);
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
        if (room.gameState === "PAUSED") {
          io.to(roomId).emit("timerUpdate", 60);
          io.to(roomId).emit("drawDataServer", { clear: true });
          return;
        }
        if (room.players.length === 0) {
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
      room = await updateScore({ ...room }, sender, score);
      currentRound = room.roundDetails[room.roundDetails.length - 1];
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
      await notifyPlayersInRoom(io, roomId, currentRound.chosenBy);
      if (currentRound.guessedBy.length === room.players.length - 1) {
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
  endRound: async (io, roomId, stateChange) => {
    clearTimeout(timeout);
    let room = { ...rooms.get(roomId) };
    if (room.gameState === "ACTIVE") {
      let nextTurn = await nextTurnDecider(room);
      let roundDetails = [...room.roundDetails];
      let words = gameManager.randomWordsGenerator(roomId);
      roundDetails.push({
        chosenWord: "",
        chosenBy: nextTurn,
        guessedBy: [],
        wordsSent: words,
      });
      room.timer = 60;
      room.currentBoard = [];
      room.roundDetails = roundDetails;
      rooms.set(roomId, room);
      if (stateChange) {
        io.to(roomId).emit("startingIn", 3);
        setTimeout(() => {
          io.to(roomId).emit("startingIn", 2);
          setTimeout(() => {
            io.to(roomId).emit("startingIn", 1);
            setTimeout(async () => {
              io.to(roomId).emit("startingIn", 0);
              io.to(roomId).emit("drawDataServer", { clear: true });
              await notifyPlayersInRoom(io, roomId, nextTurn);
            }, 1000);
          }, 1000);
        }, 1000);
      } else {
        io.to(roomId).emit("drawDataServer", { clear: true });
        await notifyPlayersInRoom(io, roomId, nextTurn);
      }
    } else {
      room.timer = 60;
      room.currentBoard = [];
      rooms.set(roomId, room);
      io.to(roomId).emit("drawDataServer", { clear: true });
      await notifyPlayersInRoom(io, roomId, "");
    }
  },
  leaveRoom: async (io, socket, callback) => {
    let roomId = alreadyInRoom(socket);
    if (roomId) await gameManager.removeFromExistingRoom(io, socket, roomId);
    callback({
      status: 200,
    });
  },
  removeAfkPlayer: async (io, socket) => {
    let player = { ...players.get(socket.sessionId) };
    if (player.currentRoom) {
      await gameManager.removeFromExistingRoom(io, socket, player.currentRoom);
    }
    players.delete(socket.sessionId);
  },
  setPlayerAsAfk: (io, socket) => {
    for (let [key, value] of players) {
      if (value.socket_id === socket.id) {
        let player = players.get(key);
        players.set(key, {
          ...player,
          inGame: false,
          deleteTimeout: setTimeout(() => {
            gameManager.removeAfkPlayer(io, socket);
          }, 1000),
        });
      }
    }
  },
};
module.exports = gameManager;
