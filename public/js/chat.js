// public/js/chat.js
class ChatManager {
  constructor(socket, roomId) {
    this.socket = socket;
    this.roomId = roomId;
    this.messages = [];
    this.onNewMessageCallback = null;
  }

  initialize() {
    this.socket.on('new-message', (message) => {
      this.messages.push(message);
      
      if (this.onNewMessageCallback) {
        this.onNewMessageCallback(message);
      }
    });
  }

  sendMessage(text) {
    if (!text.trim()) return;
    
    this.socket.emit('send-message', {
      roomId: this.roomId,
      message: text
    });
  }

  setOnNewMessage(callback) {
    this.onNewMessageCallback = callback;
  }
}

