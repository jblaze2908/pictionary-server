const players = require("./database").players;
const rooms = require("./database").rooms;
const { v4: uuidv4 } = require("uuid");
const helperFunctions = {
  alreadyInRoom: (socket, callback) => {
    if (socket.rooms.size > 1) {
      let roomId = Array.from(socket.rooms)[1];
      callback({
        status: 220, //Already in a room
        roomId: roomId,
      });
      return true;
    } else return false;
  },
  roomNotFound: (io, roomId, callback) => {
    let socket_rooms = io.sockets.adapter.rooms;
    if (!rooms.get(roomId) || !socket_rooms.get(roomId)) {
      console.log(roomId + " not found");
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
  joinGame: (sessionId, roomId) => {
    return new Promise(async (resolve, reject) => {
      let playerDetails = { ...players.get(sessionId) };
      playerDetails.currentRoom = roomId;
      players.set(sessionId, playerDetails);
      resolve;
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
  redactChosenWord: (dataToSend) => {
    return new Promise(async (resolve, reject) => {
      if (dataToSend.roundDetails.length > 0) {
        let roundDetails = [...dataToSend.roundDetails];
        let currentRoundNumber = roundDetails.length - 1;
        let currentRound = { ...roundDetails[currentRoundNumber] };
        if (currentRound.chosenWord) {
          currentRound.chosenWord = helperFunctions.redact(
            currentRound.chosenWord
          );
          roundDetails[currentRoundNumber] = currentRound;
          dataToSend.roundDetails = roundDetails;
          resolve(dataToSend);
        }
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
    return chosenWord.toLowerCase() === text.toLowerCase();
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
    return room;
  },
  nextTurnDecider: (room) => {
    let roomPlayers = [...room.players];
    let nextPlayer;
    if (room.roundDetails.length === 0) {
      let index = 0;
      while (!nextPlayer) {
        nextPlayer = roomPlayers[index].sessionId;
        if (!players.get(nextPlayer).inGame) {
          index++;
          nextPlayer = undefined;
        }
      }
    } else {
      let currentTurn =
        room.roundDetails[room.roundDetails.length - 1].chosenBy;
      let index = helperFunctions.findWithAttr(
        roomPlayers,
        "sessionId",
        currentTurn
      );
      while (!nextPlayer) {
        if (index === roomPlayers.length - 1)
          nextPlayer = roomPlayers[0].sessionId;
        else nextPlayer = roomPlayers[index + 1].sessionId;
        if (!players.get(nextPlayer).inGame) {
          index++;
          nextPlayer = undefined;
        }
      }
    }
    return nextPlayer;
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
