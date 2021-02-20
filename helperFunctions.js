const players = require("./database").players;
const rooms = require("./database").rooms;
const { v4: uuidv4 } = require("uuid");
const helperFunctions = {
  alreadyInRoom: (socket) => {
    if (socket.rooms.size > 1) {
      let roomId = Array.from(socket.rooms)[1];
      return roomId;
    } else return null;
  },
  whoseTurnIsIt: (roomId) => {
    let room = rooms.get(roomId);
    if (room.roundDetails.length !== 0) {
      return room.roundDetails[room.roundDetails.length - 1].chosenBy;
    } else return null;
  },
  removeFromRoom: (socket, roomId) => {
    return new Promise(async (resolve, reject) => {
      let room = { ...rooms.get(roomId) };
      let roomPlayers = [...room.players];
      let index = helperFunctions.findWithAttr(
        roomPlayers,
        "sessionId",
        socket.sessionId
      );
      roomPlayers.splice(index, 1);
      room.players = roomPlayers;
      let msg = {
        text: socket.username + " left.",
        sender: undefined,
      };
      let chats = [...room.chats];
      chats.push(msg);
      room.chats = chats;
      rooms.set(roomId, room);
      let player = players.get(socket.sessionId);
      player.currentRoom = "";
      players.set(socket.sessionId, player);
      socket.leave(roomId);
      resolve(null);
    });
  },
  setGameAsPaused: (roomId) => {
    return new Promise(async (resolve, reject) => {
      let room = { ...rooms.get(roomId) };
      room.gameState = "PAUSED";
      rooms.set(roomId, room);
      resolve(null);
    });
  },
  notifyPlayersInRoom: async (io, roomId, wordChosenBy) => {
    let room = { ...rooms.get(roomId) };
    room = await helperFunctions.populatePlayers(room);
    let unredactedData = { ...room };
    let redactedData = await helperFunctions.redactChosenWord(room);
    room.players.forEach((player) => {
      socketId = helperFunctions.populatePlayerDetails(player.sessionId)
        .socket_id;
      if (player.sessionId === wordChosenBy)
        io.to(socketId).emit("updateRound", unredactedData);
      else io.to(socketId).emit("updateRound", redactedData);
    });
  },

  roomNotFound: (io, roomId, callback) => {
    let socket_rooms = io.sockets.adapter.rooms;
    if (!rooms.get(roomId) || !socket_rooms.get(roomId)) {
      callback({
        status: 404, //Room not found
      });
      return true;
    } else return false;
  },
  findWithAttr: (array, attr, value) => {
    for (var i = 0; i < array.length; i += 1) {
      if (array[i][attr] === value) {
        return i;
      }
    }
    return -1;
  },
  joinRoom: (sessionId, roomId) => {
    return new Promise(async (resolve, reject) => {
      let playerDetails = { ...players.get(sessionId) };
      playerDetails.currentRoom = roomId;
      players.set(sessionId, playerDetails);
      resolve(null);
    });
  },
  populatePlayerDetails: (sessionId) => {
    let playerDetails = players.get(sessionId);
    return {
      username: playerDetails.username,
      socket_id: playerDetails.socket_id,
      sessionId: playerDetails.sessionId,
      inGame: playerDetails.inGame,
    };
  },
  populatePlayers: (dataToSend) => {
    return new Promise(async (resolve, reject) => {
      let playerData = [];
      for (let player of dataToSend.players) {
        let playerDetails = players.get(player.sessionId);
        if (playerDetails)
          playerData.push({
            username: playerDetails.username,
            socket_id: playerDetails.socket_id,
            sessionId: playerDetails.sessionId,
            inGame: playerDetails.inGame,
            score: player.score,
          });
      }
      dataToSend.players = playerData;
      resolve(dataToSend);
    });
  },
  wordAlreadyChosen: (word, roundDetails) => {
    for (let roundDetail of roundDetails) {
      if (roundDetail.chosenWord === word) {
        return true;
      }
    }
    return false;
  },
  redactChosenWord: (dataToSend, sessionId) => {
    return new Promise(async (resolve, reject) => {
      if (dataToSend.roundDetails.length > 0) {
        let roundDetails = [...dataToSend.roundDetails];
        let currentRoundNumber = roundDetails.length - 1;
        let currentRound = { ...roundDetails[currentRoundNumber] };
        if (
          currentRound.wordsSent.length !== 0 &&
          currentRound.chosenBy !== sessionId
        ) {
          currentRound.wordsSent = [];
        }
        if (currentRound.chosenWord && currentRound.chosenBy !== sessionId) {
          currentRound.chosenWord = helperFunctions.redact(
            currentRound.chosenWord
          );
        }
        roundDetails[currentRoundNumber] = currentRound;
        dataToSend.roundDetails = roundDetails;
        resolve(dataToSend);
      } else resolve(dataToSend);
    });
  },
  redact: (word) => {
    let redacted_word = "";
    for (let i = 1; i <= word.length; i++) redacted_word += "_";
    return redacted_word;
  },
  correctWordValidator: (room, text) => {
    let currentRoundNumber = room.roundDetails.length - 1;
    let currentRound = room.roundDetails[currentRoundNumber];
    if (!currentRound) return false;
    let chosenWord = currentRound.chosenWord;
    return text.toLowerCase() === chosenWord.toLowerCase();
  },
  scoreCalculator: (time) => {
    if (time > 40) return 50;
    if (time > 30) return 45;
    if (time > 20) return 40;
    if (time > 15) return 30;
    if (time > 10) return 20;
    if (time > 5) return 15;
    if (time > 0) return 10;
  },
  updateScore: (room, sessionId, score) => {
    return new Promise(async (resolve, reject) => {
      let players = [...room.players];
      let index = helperFunctions.findWithAttr(players, "sessionId", sessionId);
      let currentRoundNumber = room.roundDetails.length - 1;
      let currentRound = { ...room.roundDetails[currentRoundNumber] };
      let guessedBy = [...currentRound.guessedBy] || [];
      guessedBy.push(sessionId);
      currentRound.guessedBy = guessedBy;
      let updatedRound = currentRound;
      players[index].score += score;
      room.roundDetails[currentRoundNumber] = updatedRound;
      room.players = players;
      resolve(room);
    });
  },
  nextTurnDecider: (room) => {
    return new Promise(async (resolve, reject) => {
      let roomPlayers = [...room.players];
      let roundDetails = [...room.roundDetails];
      let nextPlayer;
      let prevPlayer = helperFunctions.whoseTurnIsIt(room.roomId);
      if (roundDetails.length === 0) {
        nextPlayer = roomPlayers[0].sessionId;
      } else {
        let index = helperFunctions.findWithAttr(
          roomPlayers,
          "sessionId",
          prevPlayer
        );
        if (index === -1) {
          let reversedRoundDetails = [...roundDetails].reverse();
          for (const round of reversedRoundDetails) {
            index = helperFunctions.findWithAttr(
              roomPlayers,
              "sessionId",
              round.chosenBy
            );
            if (index !== -1) break;
          }
          if (index === -1) nextPlayer = roomPlayers[0].sessionId;
          else {
            if (index === roomPlayers.length - 1)
              nextPlayer = roomPlayers[0].sessionId;
            else nextPlayer = roomPlayers[index + 1].sessionId;
          }
        } else {
          if (index === roomPlayers.length - 1)
            nextPlayer = roomPlayers[0].sessionId;
          else nextPlayer = roomPlayers[index + 1].sessionId;
        }
      }
      resolve(nextPlayer);
    });
  },
  generateRoomId: () => {
    return "RoomNo" + (rooms.size + 1);
  },
  generateSessionId: (sessionId) => {
    return new Promise(async (resolve, reject) => {
      if (sessionId) {
        resolve(sessionId);
      } else {
        let uuid = uuidv4();
        if (players.get(uuid)) {
          helperFunctions.generateSessionId(sessionId);
        } else {
          resolve(uuid);
        }
      }
    });
  },
};
module.exports = helperFunctions;
