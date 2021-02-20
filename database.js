let players = new Map();
//_____________PLAYERS_STRUCTURE______________//
//players={
//  [playerSessionId]:{
//       username: socket.username,
//       socket_id: socket.id,
//       sessionId: socket.sessionId,
//       currentRoom:
//       inGame:false/true,
//}},
//___________________________________________//

let rooms = new Map();
//_____________ROOMS_STRUCTURE______________//
// rooms={
//   [roomID]:{
//   roomId,
//   players: [
//     {
//       sessionId: socket.sessionId,
//       score: 0,
//     },
//   ],
//   currentBoard: [],
//   chats:[{
//        text:"",
//        sender:""
//   }]
//   roundDetails: [
//    {
//        chosenWord:"",
//        chosenBy:"",
//        guessedBy:[],
//        wordsSent:[]
//    }
//],
//   timer:60-0,
//   gameState:"ACTIVE",PAUSED"
// }
//};
//___________________________________________//

module.exports.rooms = rooms;
module.exports.players = players;
