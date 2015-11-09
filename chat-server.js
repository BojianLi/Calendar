// Require the packages we will use:
var http = require("http"),
	socketio = require("socket.io"),
	fs = require("fs");
 
// Listen for HTTP connections.  This is essentially a miniature static file server that only serves our one file, client.html:
var app = http.createServer(function(req, resp){
	// This callback runs when a new connection is made to our HTTP server.
 
	fs.readFile("chat.html", function(err, data){
		// This callback runs when the client.html file has been read from the filesystem.
 
		if(err) return resp.writeHead(500);
		resp.writeHead(200);
		resp.end(data);
	});
});
app.listen(3456);
var rooms = ["public"];//room name
var roomTable = {};//key:room name; value: room object
roomTable["public"] = new RoomClass("public");
var users = ["public"];//socket id
var userTable = {};//key:socket id; value: userObject
var nameToID = {};//user name to socket ID
userTable["public"] = new UserClass("public", "public", "public");
roomTable["public"].roomMember.push(userTable["public"]);
roomTable["public"].admin = userTable["public"];

// Do the Socket.IO magic:x
var io = socketio.listen(app);
io.sockets.on("connection", function(socket){
	// This callback runs when a new Socket.IO connection is established.
	
	//createUser
	socket.on("createUser", function(data) {
		var newName = data['userName'];
		for (var index = 0; index < users.length; ++index) {
			if (userTable[users[index]].userName == newName) {
				io.sockets.to(socket.id).emit("userNameExist", {userName:newName});
				return;
			}
		}
		socket.join(socket.id);
		socket.join("public");
		userTable[socket.id] = new UserClass(newName, socket.id, "public");
		roomTable["public"].roomMember.push(userTable[socket.id]);
		users.push(socket.id);
		io.sockets.to("public").emit("updateUsers", {users:roomTable["public"].roomMember, admin:roomTable["public"].admin});
		io.sockets.to(socket.id).emit("updateRooms", {rooms:rooms});
	});
	
	//create room
	socket.on("createRoom", function(data) {
		var roomName = data['roomName'];
		if (rooms.indexOf(roomName) >= 0) {
			io.sockets.to(socket.id).emit("roomNameExist", {roomName:roomName});
		} else {
			rooms.push(roomName);
			var newroom = new RoomClass(roomName);
			newroom.admin = userTable[socket.id];
			roomTable[roomName] = newroom;
			enterRoom(data, socket);
			io.sockets.emit("updateRooms", {rooms:rooms});
		}
	});
	
	//create a room with password
	socket.on("createPasswordRoom", function(data) {
		var roomName = data['roomName'];
		if (rooms.indexOf(roomName) >= 0) {
			io.sockets.to(socket.id).emit("roomNameExist", {roomName:roomName});
		} else {
			var password = data['password'];
			rooms.push(roomName);
			var newroom = new RoomClass(roomName);
			newroom.admin = userTable[socket.id];
			newroom.havePass = true;
			newroom.password = password;
			roomTable[roomName] = newroom;
			enterRoom(data, socket);
			io.sockets.emit("updateRooms", {rooms:rooms});
		}
	});
	
	//enter a room
	socket.on("enterRoom", function(data){
		var newName = data['roomName'];
		if (roomTable[newName].havePass) {
			if (data['password'] == roomTable[newName].password) {
				enterRoom(data, socket);
			} else {
				io.sockets.to(socket.id).emit("wrongPassword", {});
			}
		} else {
			enterRoom(data, socket);
		}
	});
	
	//who are typing
	socket.on('isTyping', function(data) {
		var croom = data['currentRoom'];
		var userName = data['userName'];
		var typing = data['typing'];
		var who;
		if (!roomTable[croom]) {
			who = [];
		} else {
			who = roomTable[croom].typing;
			if (typing) {
				if (who.indexOf(userName) < 0) {
					who.push(userName);
				}
			} else {
				var index = who.indexOf(userName);
				if (index >= 0) {
					who.splice(index, 1);
				}
			}
		}
		io.sockets.to(croom).emit("updateTyping", {typing:who});
	});
	
	//send image to the room
	socket.on("image_to_server", function(data){
		var src = data['src'];
		var croom = data['currentRoom'];
		io.sockets.to(croom).emit("image_to_client", {src:src});
	});
	
	//send private message
	socket.on('private_message_to_server', function(data) {
		var message = data['message'];
		var to = data['to'];
		var user = userTable[socket.id];
		var members = roomTable[user.croom].roomMember;
		var toID = "";
		for (var index = 0; index < members.length; ++index) {
			if (members[index].userName == to) {
				toID = members[index].id;
				break;
			}
		}
		if (toID == "") {
			io.sockets.emit("noUser", {});
		} else {
			io.sockets.to(toID).emit("private_message_to_client", {message:message, from:user.userName, to:to, style:data['style']});
			io.sockets.to(socket.id).emit("private_message_to_client", {message:message, from:user.userName, to:to, style:data['style']});
		}
	});
	
	//send message
	socket.on('message_to_server', function(data) {
		io.sockets.to(data["room"]).emit("message_to_client",{message:data["message"], user:userTable[socket.id].userName, style:data['style']}); // broadcast the message to other users
	});
	
	//kick a user
	socket.on('kick', function(data) {
		var room = data['roomName'];
		var userName = data['kickName'];
		var user;
		for (var index = 0; index < users.length; ++index) {
			if (userTable[users[index]].userName == userName) {
				user = userTable[users[index]];
				break;
			}
		}
		io.sockets.to(user.id).emit("beKicked", {});
	});
	
	//ban a user
	socket.on('ban', function(data) {
		var room = data['roomName'];
		var userName = data['banName'];
		var user;
		for (var index = 0; index < users.length; ++index) {
			if (userTable[users[index]].userName == userName) {
				user = userTable[users[index]];
				break;
			}
		}
		io.sockets.to(user.id).emit("bebanned", {});
		roomTable[room].banList.push(user.id);
	});
	
	//disconnect
	socket.on('disconnect', function() {
		if (!userTable[socket.id]) {
			return;
		}
		var oldName = userTable[socket.id].croom;
		socket.leave(oldName);
		socket.leave(socket.id);
		var index = roomTable[oldName].roomMember.indexOf(userTable[socket.id]);
		roomTable[oldName].roomMember.splice(index, 1);
		if (roomTable[oldName].roomMember.length == 0) {
			delete roomTable[oldName];
			rooms.splice(rooms.indexOf(oldName), 1);
			io.sockets.emit("updateRooms", {rooms:rooms});
		} else {
			if (roomTable[oldName].admin == socket.id) {
				roomTable[oldName].admin = roomTable[oldName].roomMember[0];
			}
			io.sockets.to(oldName).emit("updateUsers", {users:roomTable[oldName].roomMember, admin:roomTable[oldName].admin});
		}
    });
});


function enterRoom(data, socket) {
	var newName = data['roomName'];
	var oldName = data['oldName'];
	if (roomTable[newName].banList.indexOf(socket.id) >= 0) {
		io.sockets.to(socket.id).emit("banned", {});
		return;
	}
	socket.join(newName);
	roomTable[newName].roomMember.push(userTable[socket.id]);
	socket.leave(oldName);
	var index = roomTable[oldName].roomMember.indexOf(userTable[socket.id]);
	roomTable[oldName].roomMember.splice(index, 1);
	userTable[socket.id].croom = newName;
	if (roomTable[oldName].roomMember.length == 0) {
		delete roomTable[oldName];
		rooms.splice(rooms.indexOf(oldName), 1);
		io.sockets.emit("updateRooms", {rooms:rooms});
	} else {
		if (roomTable[oldName].admin == userTable[socket.id]) {
			roomTable[oldName].admin = roomTable[oldName].roomMember[0];
		}
		io.sockets.to(oldName).emit("updateUsers", {users:roomTable[oldName].roomMember, admin:roomTable[oldName].admin});
	}
	userTable[socket.id].croom = newName;
	io.sockets.to(socket.id).emit("updateCurrentRooms", {croom:newName});
	io.sockets.to(newName).emit("updateUsers", {users:roomTable[newName].roomMember, admin:roomTable[newName].admin});
}

function RoomClass(room) {
   this.roomName = room;//room name
   this.roomMember = [];//user objects
   this.havePass = false;
   this.password = "";
   this.admin;//socket id
   this.banList = [];//socket id
   this.typing = [];
}

function UserClass(name, sid, room) {
   this.userName = name;
   this.id = sid;
   this.croom = room;
}
