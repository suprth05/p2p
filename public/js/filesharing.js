class FileSharing {
  constructor(socket, roomId) {
    this.socket = socket;
    this.roomId = roomId;
    this.peerConnections = {};
    this.fileChunks = {};
    this.onFileReceiveStartCallback = null;
    this.onFileReceiveProgressCallback = null;
    this.onFileReceiveCompleteCallback = null;
    this.onFileSendProgressCallback = null;
    
    // File sending parameters
    this.chunkSize = 16384; // 16KB chunks
    this.maxFileSize = 100 * 1024 * 1024; // 100MB max file size
  }

  initialize(peerConnections) {
    this.peerConnections = peerConnections;
    this.setupSocketEvents();
    console.log("FileSharing initialized with peer connections:", Object.keys(peerConnections));
  }

  setupSocketEvents() {
    // File transfer signaling
    this.socket.on('file-start', (data) => {
      console.log('Received file-start:', data);
      const { sender, fileInfo } = data;
      this.prepareFileReceive(sender, fileInfo);
    });
    
    this.socket.on('file-chunk', (data) => {
      const { sender, fileId, chunk, chunkIndex, totalChunks } = data;
      this.receiveFileChunk(sender, fileId, chunk, chunkIndex, totalChunks);
    });
    
    this.socket.on('file-complete', (data) => {
      console.log('Received file-complete:', data);
      const { sender, fileId } = data;
      this.completeFileReceive(sender, fileId);
    });
    
    this.socket.on('file-reject', (data) => {
      const { sender, fileId, reason } = data;
      // Handle rejection (e.g., file too large, receiver out of space)
      console.warn(`File ${fileId} rejected by ${sender}: ${reason}`);
      if (this.onFileReceiveCompleteCallback) {
        this.onFileReceiveCompleteCallback({
          success: false,
          fileId: fileId,
          error: reason
        });
      }
    });
  }

  // Prepare to receive a file
  prepareFileReceive(senderId, fileInfo) {
    const { fileId, fileName, fileSize, fileType } = fileInfo;
    
    // Check if file size is acceptable
    if (fileSize > this.maxFileSize) {
      this.socket.emit('file-reject', {
        target: senderId,
        fileId: fileId,
        reason: 'File too large'
      });
      return;
    }
    
    // Initialize file chunks storage
    this.fileChunks[fileId] = {
      info: fileInfo,
      chunks: [],
      receivedChunks: 0,
      totalChunks: Math.ceil(fileSize / this.chunkSize),
      completed: false
    };
    
    // Notify UI that file transfer has started
    if (this.onFileReceiveStartCallback) {
      this.onFileReceiveStartCallback({
        fileId,
        fileName,
        fileSize,
        fileType,
        senderId
      });
    }
  }

  // Receive a file chunk
  receiveFileChunk(senderId, fileId, chunk, chunkIndex, totalChunks) {
    if (!this.fileChunks[fileId]) {
      console.error(`Received chunk for unknown file: ${fileId}`);
      return;
    }
    
    // Store the chunk
    this.fileChunks[fileId].chunks[chunkIndex] = chunk;
    this.fileChunks[fileId].receivedChunks++;
    this.fileChunks[fileId].totalChunks = totalChunks;
    
    // Calculate progress
    const progress = Math.floor((this.fileChunks[fileId].receivedChunks / totalChunks) * 100);
    
    // Update progress
    if (this.onFileReceiveProgressCallback) {
      this.onFileReceiveProgressCallback({
        fileId,
        fileName: this.fileChunks[fileId].info.fileName,
        progress,
        senderId
      });
    }
  }

  // Complete file receive when all chunks arrived
  completeFileReceive(senderId, fileId) {
    if (!this.fileChunks[fileId]) {
      console.error(`Completion signal for unknown file: ${fileId}`);
      return;
    }
    
    const fileData = this.fileChunks[fileId];
    
    // Check if all chunks have been received
    if (fileData.receivedChunks < fileData.totalChunks) {
      console.warn(`File completion signal received but only ${fileData.receivedChunks}/${fileData.totalChunks} chunks received`);
      return;
    }

    try {
      // Convert base64 chunks to binary
      const binaryChunks = fileData.chunks.map(chunk => {
        try {
          return this._base64ToArrayBuffer(chunk);
        } catch (e) {
          console.error("Error converting chunk to binary:", e);
          return new ArrayBuffer(0);
        }
      });
      
      // Combine all chunks to create file
      const fileBlob = new Blob(binaryChunks, { type: fileData.info.fileType });
      
      // Create download URL
      const downloadUrl = URL.createObjectURL(fileBlob);
      
      // Notify UI that file is ready
      if (this.onFileReceiveCompleteCallback) {
        this.onFileReceiveCompleteCallback({
          success: true,
          fileId,
          fileName: fileData.info.fileName,
          fileSize: fileData.info.fileSize,
          fileType: fileData.info.fileType,
          downloadUrl,
          senderId
        });
      }
      
      // Clean up
      fileData.completed = true;
    } catch (error) {
      console.error("Error completing file receive:", error);
      
      if (this.onFileReceiveCompleteCallback) {
        this.onFileReceiveCompleteCallback({
          success: false,
          fileId,
          error: "Failed to process received file"
        });
      }
    }
  }

  // Convert base64 to ArrayBuffer
  _base64ToArrayBuffer(base64) {
    const binaryString = window.atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // Send a file to all participants in the room
  async sendFile(file) {
    // Validate file
    if (file.size > this.maxFileSize) {
      throw new Error(`File too large. Maximum size is ${this.maxFileSize / (1024 * 1024)}MB`);
    }
    
    const fileId = Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
    
    // File info to send to receivers
    const fileInfo = {
      fileId,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type
    };
    
    console.log("Sending file-start signal for file:", fileInfo);
    
    // Notify all participants about the incoming file
    this.socket.emit('file-start', {
      roomId: this.roomId,
      fileInfo
    });
    
    // Read and send file in chunks
    const totalChunks = Math.ceil(file.size / this.chunkSize);
    
    try {
      for (let i = 0; i < totalChunks; i++) {
        const start = i * this.chunkSize;
        const end = Math.min(start + this.chunkSize, file.size);
        const chunk = file.slice(start, end);
        
        // Convert chunk to base64 for transmission
        const base64Chunk = await this._readChunkAsBase64(chunk);
        
        // Send chunk to all participants
        this.socket.emit('file-chunk', {
          roomId: this.roomId,
          fileId,
          chunk: base64Chunk,
          chunkIndex: i,
          totalChunks
        });
        
        // Update progress
        const progress = Math.floor(((i + 1) / totalChunks) * 100);
        if (this.onFileSendProgressCallback) {
          this.onFileSendProgressCallback({
            fileId,
            fileName: file.name,
            progress
          });
        }
        
        // Small delay to prevent overwhelming the connection
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      console.log("Sending file-complete signal for file:", fileId);
      
      // Signal completion
      this.socket.emit('file-complete', {
        roomId: this.roomId,
        fileId
      });
      
      return fileId;
    } catch (error) {
      console.error("Error sending file:", error);
      throw error;
    }
  }
  
  // Read a chunk as base64
  _readChunkAsBase64(chunk) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        // Extract base64 data from data URL
        const base64 = e.target.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = (e) => {
        reject(e);
      };
      reader.readAsDataURL(chunk);
    });
  }

  // Set callbacks
  setOnFileReceiveStart(callback) {
    this.onFileReceiveStartCallback = callback;
  }
  
  setOnFileReceiveProgress(callback) {
    this.onFileReceiveProgressCallback = callback;
  }
  
  setOnFileReceiveComplete(callback) {
    this.onFileReceiveCompleteCallback = callback;
  }
  
  setOnFileSendProgress(callback) {
    this.onFileSendProgressCallback = callback;
  }
}
