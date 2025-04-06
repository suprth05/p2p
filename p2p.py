import npyscreen
import sys
import lib.server as server
import lib.client as client
from lib.form import ChatForm
from lib.form import ChatInput
import time
import curses
import socket
import datetime
import pyperclip
import os
import json
from io import StringIO
import base64
import threading
import cv2
import numpy as np
import pickle
import struct
from pathlib import Path

class ChatApp(npyscreen.NPSAppManaged):
    def onStart(self):
        # Initialize settings and language
        try:
            jsonSettings = open('settings.json')
            self.settings = json.loads(jsonSettings.read())
            jsonSettings.close()
            jsonFile = open('lang/{0}.json'.format(self.settings['language']))
        except Exception:
            jsonFile = open('lang/en.json')
        self.lang = json.loads(jsonFile.read())
        jsonFile.close()

        if os.name == "nt":
            os.system("title P2P-Chat by flowei")

        self.ChatForm = self.addForm('MAIN', ChatForm, name='Peer-2-Peer Chat')

        # Get local IP
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            self.hostname = s.getsockname()[0]
            s.close()
        except socket.error as error:
            self.sysMsg(self.lang['noInternetAccess'])
            self.sysMsg(self.lang['failedFetchPublicIP'])
            self.hostname = "0.0.0.0"

        # Initialize variables
        self.port = 3333
        self.video_port = 3334
        self.file_transfer_port = 3335
        self.nickname = ""
        self.peer = ""
        self.peerIP = "0"
        self.peerPort = "0"
        self.historyLog = []
        self.messageLog = []
        self.historyPos = 0
        self.video_streaming = False
        self.receiving_video = False
        self.file_transfer_active = False
        self.download_dir = os.path.join(os.path.expanduser("~"), "Downloads", "P2P-Chat")
        
        if not os.path.exists(self.download_dir):
            os.makedirs(self.download_dir)

        # Start server and client
        self.chatServer = server.Server(self)
        self.chatServer.daemon = True
        self.chatServer.start()
        self.chatClient = client.Client(self)
        self.chatClient.start()

        # Command dictionary
        self.commandDict = {
            "connect": [self.chatClient.conn, 2],
            "disconnect": [self.restart, 0],
            "nickname": [self.setNickname, 1],
            "quit": [self.exitApp, 0],
            "port": [self.restart, 1],
            "connectback": [self.connectBack, 0],
            "clear": [self.clearChat, 0],
            "eval": [self.evalCode, -1],
            "status": [self.getStatus, 0],
            "log": [self.logChat, 0],
            "help": [self.commandHelp, 0],
            "flowei": [self.flowei, 0],
            "lang": [self.changeLang, 1],
            "sendfile": [self.initiate_file_transfer, 1],
            "video": [self.toggle_video, 0],
            "acceptfile": [self.accept_file, 0],
            "rejectfile": [self.reject_file, 0],
            "listfiles": [self.list_downloaded_files, 0]
        }

        # Command aliases
        self.commandAliasDict = {
            "nick": "nickname",
            "conn": "connect",
            "q": "quit",
            "connback": "connectback",
            "sf": "sendfile",
            "v": "video",
            "af": "acceptfile",
            "rf": "rejectfile",
            "lf": "listfiles"
        }
        
        # File transfer variables
        self.pending_file_transfer = None
        self.pending_outgoing_file = None
        self.file_socket = None
        self.video_socket = None

    def changeLang(self, args):
        self.sysMsg(self.lang['changingLang'].format(args[0]))
        try:
            jsonFile = open('lang/{0}.json'.format(args[0]))
            self.lang = json.loads(jsonFile.read())
            jsonFile.close()
        except Exception as e:
            self.sysMsg(self.lang['failedChangingLang'])
            self.sysMsg(e)
            return False
        self.settings['language'] = args[0]
        with open('settings.json', 'w') as file:
            file.write(json.dumps(self.settings))

    def restart(self, args=None):
        self.sysMsg(self.lang['restarting'])
        if not args == None and args[0] != self.port:
            self.port = int(args[0])
        if self.chatClient.isConnected:
            self.chatClient.send("\b/quit")
            time.sleep(0.2)
        self.chatClient.stop()
        self.chatServer.stop()
        self.stop_video_streaming()
        self.clean_file_transfer_resources()
        self.chatClient = client.Client(self)
        self.chatClient.start()
        self.chatServer = server.Server(self)
        self.chatServer.daemon = True
        self.chatServer.start()
    
    def stop_video_streaming(self):
        if self.video_streaming:
            self.video_streaming = False
            if hasattr(self, 'video_thread') and self.video_thread.is_alive():
                self.video_thread.join(timeout=1)
        
        if self.receiving_video:
            self.receiving_video = False
            if hasattr(self, 'receive_video_thread') and self.receive_video_thread.is_alive():
                self.receive_video_thread.join(timeout=1)
                
        if hasattr(self, 'video_socket') and self.video_socket:
            try:
                self.video_socket.close()
            except:
                pass
            self.video_socket = None
    
    def clean_file_transfer_resources(self):
        self.file_transfer_active = False
        if hasattr(self, 'file_transfer_thread') and self.file_transfer_thread.is_alive():
            self.file_transfer_thread.join(timeout=1)
            
        if hasattr(self, 'file_socket') and self.file_socket:
            try:
                self.file_socket.close()
            except:
                pass
            self.file_socket = None
        
        self.pending_file_transfer = None
        self.pending_outgoing_file = None
            
    def historyBack(self, _input):
        if not self.historyLog or self.historyPos == 0:
            return False
        self.historyPos -= 1
        self.ChatForm.chatInput.value = self.historyLog[len(self.historyLog)-1-self.historyPos]

    def historyForward(self, _input):
        if not self.historyLog:
            return False
        if self.historyPos == len(self.historyLog)-1:
            self.ChatForm.chatInput.value = ""
            return True
        self.historyPos += 1
        self.ChatForm.chatInput.value = self.historyLog[len(self.historyLog)-1-self.historyPos]

    def setNickname(self, args):
        self.nickname = args[0]
        self.sysMsg("{0}".format(self.lang['setNickname'].format(args[0])))
        if self.chatClient.isConnected:
            self.chatClient.send("\b/nick {0}".format(args[0]))

    def sysMsg(self, msg):
        self.messageLog.append("[SYSTEM] "+str(msg))
        if len(self.ChatForm.chatFeed.values) > self.ChatForm.y - 10:
                self.clearChat()
        if len(str(msg)) > self.ChatForm.x - 20:
            self.ChatForm.chatFeed.values.append('[SYSTEM] '+str(msg[:self.ChatForm.x-20]))
            self.ChatForm.chatFeed.values.append(str(msg[self.ChatForm.x-20:]))
        else:
            self.ChatForm.chatFeed.values.append('[SYSTEM] '+str(msg))
        self.ChatForm.chatFeed.display()

    def sendMessage(self, _input):
        msg = self.ChatForm.chatInput.value
        if msg == "":
            return False
        if len(self.ChatForm.chatFeed.values) > self.ChatForm.y - 11:
                self.clearChat()
        self.messageLog.append(self.lang['you']+" > "+msg)
        self.historyLog.append(msg)
        self.historyPos = len(self.historyLog)
        self.ChatForm.chatInput.value = ""
        self.ChatForm.chatInput.display()
        if msg.startswith('/'):
            self.commandHandler(msg)
        else:
            if self.chatClient.isConnected:
                if self.chatClient.send(msg):
                    self.ChatForm.chatFeed.values.append(self.lang['you']+" > "+msg)
                    self.ChatForm.chatFeed.display()
            else:
                self.sysMsg(self.lang['notConnected'])

    def connectBack(self):
        if self.chatServer.hasConnection and not self.chatClient.isConnected:
            if self.peerIP == "unknown" or self.peerPort == "unknown":
                self.sysMsg(self.lang['failedConnectPeerUnkown'])
                return False
            self.chatClient.conn([self.peerIP, int(self.peerPort)])
        else:
            self.sysMsg(self.lang['alreadyConnected'])

    def logChat(self):
        try:
            date = datetime.datetime.now().strftime("%m-%d-%Y")
            log = open("p2p-chat-log_{0}.log".format(date), "a")
            for msg in self.messageLog:
                log.write(msg+"\n")
        except Exception:
            self.sysMsg(self.lang['failedSaveLog'])
            return False
        log.close()
        self.messageLog = []
        self.sysMsg(self.lang['savedLog'].format(date))
    
    def flowei(self):
        if os.name == 'nt':
            os.system("start https://flowei.tech")
        else:
            os.system("xdg-open https://flowei.tech")

    def clearChat(self):
        self.ChatForm.chatFeed.values = []
        self.ChatForm.chatFeed.display()

    def evalCode(self, code):
        defaultSTDout = sys.stdout
        redirectedSTDout = sys.stdout = StringIO()
        try:
            exec(code)
        except Exception as e:
            self.sysMsg(e)
        finally:
            sys.stdout = defaultSTDout
        self.ChatForm.chatFeed.values.append('> '+redirectedSTDout.getvalue())
        self.ChatForm.chatFeed.display()
            
    def exitApp(self):
        self.sysMsg(self.lang['exitApp'])
        if self.chatClient.isConnected:
            self.chatClient.send("\b/quit")
        self.chatClient.stop()
        self.chatServer.stop()
        self.stop_video_streaming()
        self.clean_file_transfer_resources()
        exit(1)

    def pasteFromClipboard(self, _input):
        self.ChatForm.chatInput.value = pyperclip.paste()
        self.ChatForm.chatInput.display()
        
    def commandHandler(self, msg):
        if msg.startswith("/eval"):
            args = msg[6:]
            self.evalCode(args)
            return True

        msg = msg.split(' ')
        command = msg[0][1:]
        args = msg[1:]
        if command in self.commandAliasDict:
            command = self.commandAliasDict[command]
        if not command in self.commandDict:
            self.sysMsg(self.lang['commandNotFound'])
        else:
            if self.commandDict[command][1] == 0:
                self.commandDict[command][0]()
            elif len(args) == self.commandDict[command][1]:
                self.commandDict[command][0](args)
            else:
                self.sysMsg(self.lang['commandWrongSyntax'].format(command, self.commandDict[command][1], len(args)))

    def commandHelp(self):
        if len(self.ChatForm.chatFeed.values) + len(self.commandDict) + 1 > self.ChatForm.y - 10:
            self.clearChat()
        self.sysMsg(self.lang['commandList'])
        for command in self.commandDict:
            # Skip if command not in language file
            if command not in self.lang['commands']:
                continue
            if not self.lang['commands'][command] == "":
                self.sysMsg(self.lang['commands'][command])

    def getStatus(self):
        self.sysMsg("STATUS:")
        if self.chatServer: serverStatus = True
        else: serverStatus = False
        if self.chatClient: client = True
        else: clientStatus = False
        self.sysMsg(self.lang['serverStatusMessage'].format(serverStatus, self.port, self.chatServer.hasConnection))
        self.sysMsg(self.lang['clientStatusMessage'].format(clientStatus, self.chatClient.isConnected))
        if not self.nickname == "": self.sysMsg(self.lang['nicknameStatusMessage'].format(self.nickname))
        self.sysMsg(f"Video Streaming: {self.video_streaming}")
        self.sysMsg(f"Receiving Video: {self.receiving_video}")
        self.sysMsg(f"File Transfer Active: {self.file_transfer_active}")
        self.sysMsg(f"Pending File Transfer: {'Yes' if self.pending_file_transfer else 'No'}")
        self.sysMsg(f"Download Directory: {self.download_dir}")
    
    # FILE TRANSFER METHODS
    
    def initiate_file_transfer(self, args):
        if not self.chatClient.isConnected:
            self.sysMsg("You need to be connected to a peer to send files.")
            return
        
        file_path = args[0]
        if not os.path.exists(file_path):
            self.sysMsg(f"File not found: {file_path}")
            return
        
        file_size = os.path.getsize(file_path)
        file_name = os.path.basename(file_path)
        
        file_info = {
            "command": "file_request",
            "file_name": file_name,
            "file_size": file_size,
            "sender": self.nickname or "Anonymous"
        }
        
        self.chatClient.send(f"\b/file_request {json.dumps(file_info)}")
        self.sysMsg(f"File transfer request sent for {file_name} ({file_size} bytes)")
        self.pending_outgoing_file = file_path
        
    def handle_file_request(self, file_info):
        file_info = json.loads(file_info)
        self.pending_file_transfer = file_info
        
        self.sysMsg(f"File transfer request from {file_info['sender']}")
        self.sysMsg(f"File: {file_info['file_name']} ({file_info['file_size']} bytes)")
        self.sysMsg("Type /acceptfile to accept or /rejectfile to decline")
    
    def accept_file(self):
        if not self.pending_file_transfer:
            self.sysMsg("No pending file transfers.")
            return
        
        self.sysMsg(f"Accepted file transfer for {self.pending_file_transfer['file_name']}")
        
        response = {
            "command": "file_accepted",
            "file_name": self.pending_file_transfer['file_name']
        }
        
        self.chatClient.send(f"\b/file_accepted {json.dumps(response)}")
        
        self.file_transfer_thread = threading.Thread(target=self.receive_file)
        self.file_transfer_thread.daemon = True
        self.file_transfer_thread.start()
    
    def reject_file(self):
        if not self.pending_file_transfer:
            self.sysMsg("No pending file transfers.")
            return
        
        self.sysMsg(f"Rejected file transfer for {self.pending_file_transfer['file_name']}")
        
        response = {
            "command": "file_rejected",
            "file_name": self.pending_file_transfer['file_name']
        }
        
        self.chatClient.send(f"\b/file_rejected {json.dumps(response)}")
        self.pending_file_transfer = None
    
    def handle_file_accepted(self, response_data):
        response = json.loads(response_data)
        self.sysMsg(f"Peer accepted file transfer for {response['file_name']}")
        
        self.file_transfer_thread = threading.Thread(target=self.send_file, args=(self.pending_outgoing_file,))
        self.file_transfer_thread.daemon = True
        self.file_transfer_thread.start()
    
    def handle_file_rejected(self, response_data):
        response = json.loads(response_data)
        self.sysMsg(f"Peer rejected file transfer for {response['file_name']}")
        self.pending_outgoing_file = None
    
    def send_file(self, file_path):
        try:
            self.file_transfer_active = True
            
            self.file_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.file_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            self.file_socket.bind((self.hostname, self.file_transfer_port))
            self.file_socket.listen(1)
            
            self.sysMsg(f"Waiting for peer to connect for file transfer on port {self.file_transfer_port}")
            
            conn, addr = self.file_socket.accept()
            self.sysMsg(f"Peer connected from {addr[0]}:{addr[1]} for file transfer")
            
            file_size = os.path.getsize(file_path)
            file_name = os.path.basename(file_path)
            
            metadata = json.dumps({
                "file_name": file_name,
                "file_size": file_size
            }).encode()
            
            conn.send(struct.pack("!I", len(metadata)))
            conn.send(metadata)
            
            with open(file_path, 'rb') as f:
                bytes_sent = 0
                for chunk in iter(lambda: f.read(4096), b''):
                    conn.send(chunk)
                    bytes_sent += len(chunk)
                    self.sysMsg(f"Sent {bytes_sent}/{file_size} bytes ({bytes_sent/file_size*100:.1f}%)")
            
            conn.close()
            self.sysMsg(f"File transfer complete for {file_name}")
            
        except Exception as e:
            self.sysMsg(f"Error during file transfer: {str(e)}")
        finally:
            self.file_transfer_active = False
            if self.file_socket:
                self.file_socket.close()
                self.file_socket = None
            self.pending_outgoing_file = None
    
    def receive_file(self):
        try:
            self.file_transfer_active = True
            
            self.file_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.file_socket.connect((self.peerIP, self.file_transfer_port))
            
            metadata_size = struct.unpack("!I", self.file_socket.recv(4))[0]
            metadata = json.loads(self.file_socket.recv(metadata_size))
            
            file_name = metadata["file_name"]
            file_size = metadata["file_size"]
            
            self.sysMsg(f"Receiving {file_name} ({file_size} bytes)")
            
            file_path = os.path.join(self.download_dir, file_name)
            os.makedirs(os.path.dirname(file_path), exist_ok=True)
            
            with open(file_path, 'wb') as f:
                bytes_received = 0
                while bytes_received < file_size:
                    chunk = self.file_socket.recv(min(4096, file_size - bytes_received))
                    if not chunk:
                        break
                    f.write(chunk)
                    bytes_received += len(chunk)
                    if bytes_received % 40960 == 0:
                        self.sysMsg(f"Received {bytes_received}/{file_size} bytes ({bytes_received/file_size*100:.1f}%)")
            
            self.sysMsg(f"File received and saved to {file_path}")
            
        except Exception as e:
            self.sysMsg(f"Error receiving file: {str(e)}")
        finally:
            self.file_transfer_active = False
            self.pending_file_transfer = None
            if self.file_socket:
                self.file_socket.close()
                self.file_socket = None
    
    def list_downloaded_files(self):
        if not os.path.exists(self.download_dir):
            self.sysMsg(f"Download directory does not exist: {self.download_dir}")
            return
            
        files = os.listdir(self.download_dir)
        if not files:
            self.sysMsg("No downloaded files found")
            return
            
        self.sysMsg(f"Downloaded files in {self.download_dir}:")
        for file in files:
            file_path = os.path.join(self.download_dir, file)
            file_size = os.path.getsize(file_path)
            file_time = datetime.datetime.fromtimestamp(os.path.getmtime(file_path)).strftime('%Y-%m-%d %H:%M:%S')
            self.sysMsg(f"- {file} ({file_size} bytes) - {file_time}")
    
    # VIDEO STREAMING METHODS
    
    def toggle_video(self):
        if not self.chatClient.isConnected:
            self.sysMsg("You need to be connected to a peer to use video.")
            return
            
        if self.video_streaming:
            self.stop_video_streaming()
            self.chatClient.send("\b/video_stop")
            self.sysMsg("Video streaming stopped")
        else:
            try:
                cap = cv2.VideoCapture(0)
                if not cap.isOpened():
                    self.sysMsg("Unable to access camera.")
                    return
                cap.release()
                
                self.chatClient.send("\b/video_start")
                self.sysMsg("Starting video stream...")
                
                self.video_streaming = True
                self.video_thread = threading.Thread(target=self.stream_video)
                self.video_thread.daemon = True
                self.video_thread.start()
                
            except Exception as e:
                self.sysMsg(f"Error accessing camera: {str(e)}")
    
    def handle_video_start(self):
        if self.receiving_video:
            self.sysMsg("Already receiving video from peer.")
            return
            
        self.sysMsg("Peer is starting video stream. Preparing to receive...")
        
        self.receiving_video = True
        self.receive_video_thread = threading.Thread(target=self.receive_video)
        self.receive_video_thread.daemon = True
        self.receive_video_thread.start()
    
    def handle_video_stop(self):
        if not self.receiving_video:
            return
            
        self.receiving_video = False
        self.sysMsg("Peer stopped video stream.")
        cv2.destroyAllWindows()
    
    def stream_video(self):
        try:
            self.video_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.video_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            self.video_socket.bind((self.hostname, self.video_port))
            self.video_socket.listen(1)
            
            self.sysMsg(f"Waiting for peer to connect for video on port {self.video_port}")
            
            conn, addr = self.video_socket.accept()
            self.sysMsg(f"Peer connected from {addr[0]}:{addr[1]} for video")
            
            cap = cv2.VideoCapture(0)
            
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            fps = cap.get(cv2.CAP_PROP_FPS)
            
            metadata = json.dumps({
                "width": width,
                "height": height,
                "fps": fps
            }).encode()
            
            conn.send(struct.pack("!I", len(metadata)))
            conn.send(metadata)
            
            while self.video_streaming:
                ret, frame = cap.read()
                if not ret:
                    break
                    
                frame = cv2.resize(frame, (320, 240))
                
                _, buffer = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
                frame_data = buffer.tobytes()
                
                try:
                    conn.send(struct.pack("!I", len(frame_data)))
                    conn.send(frame_data)
                except:
                    break
                    
                time.sleep(0.1)
            
            cap.release()
            conn.close()
            
        except Exception as e:
            self.sysMsg(f"Error in video streaming: {str(e)}")
        finally:
            self.video_streaming = False
            if hasattr(self, 'video_socket') and self.video_socket:
                self.video_socket.close()
                self.video_socket = None
    
    def receive_video(self):
        try:
            self.video_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.video_socket.connect((self.peerIP, self.video_port))
            
            metadata_size = struct.unpack("!I", self.video_socket.recv(4))[0]
            metadata = json.loads(self.video_socket.recv(metadata_size))
            
            self.sysMsg(f"Receiving video: {metadata['width']}x{metadata['height']} at {metadata['fps']} FPS")
            
            cv2.namedWindow(f"Video from {self.peer or 'Peer'}", cv2.WINDOW_NORMAL)
            
            while self.receiving_video:
                try:
                    size_data = self.video_socket.recv(4)
                    if not size_data:
                        break
                        
                    frame_size = struct.unpack("!I", size_data)[0]
                    
                    frame_data = b''
                    while len(frame_data) < frame_size:
                        chunk = self.video_socket.recv(min(4096, frame_size - len(frame_data)))
                        if not chunk:
                            break
                        frame_data += chunk
                    
                    frame = cv2.imdecode(np.frombuffer(frame_data, dtype=np.uint8), cv2.IMREAD_COLOR)
                    
                    if frame is not None:
                        cv2.imshow(f"Video from {self.peer or 'Peer'}", frame)
                        
                    if cv2.waitKey(1) & 0xFF == ord('q'):
                        break
                        
                except Exception as e:
                    self.sysMsg(f"Error receiving video frame: {str(e)}")
                    break
            
            cv2.destroyAllWindows()
            self.sysMsg("Video stream ended")
            
        except Exception as e:
            self.sysMsg(f"Error in video reception: {str(e)}")
        finally:
            self.receiving_video = False
            if hasattr(self, 'video_socket') and self.video_socket:
                self.video_socket.close()
                self.video_socket = None

if __name__ == "__main__":
    App = ChatApp()
    App.run()
