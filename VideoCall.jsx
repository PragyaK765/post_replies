import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import Peer from "simple-peer";
import axios from 'axios';

const REACTIONS = ['👏', '❤️', '🙂', '✋', '👍', '🎉'];

function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== "") {
      const cookies = document.cookie.split(";");
      for (let i = 0; i < cookies.length; i++) {
        const cookie = cookies[i].trim();
        if (cookie.startsWith(name + "=")) {
          cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
          break;
        }
      }
    }
    return cookieValue;
}

const VideoCall = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const localVideoRef = useRef(null);
  const emojiPanelRef = useRef(null);
  const { roomId } = useParams();
  const ws = useRef(null);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [sharingScreen, setSharingScreen] = useState(false);
  const [stream, setStream] = useState(null);
  const [showChat, setShowChat] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputMsg, setInputMsg] = useState('');
  const [floatingEmojis, setFloatingEmojis] = useState([]);
  const [showEmojiPanel, setShowEmojiPanel] = useState(false);
  const [isCreator, setIsCreator] = useState(false);
  const [peers, setPeers] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [participantCount, setParticipantCount] = useState(1);
  const remoteVideoRefs = useRef({});
  const peersRef = useRef([]);

  useEffect(() => {
    peersRef.current = peers;
  }, [peers]);

  // Generate a secure random room ID with uppercase alphabets and digits
  const generateRoomId = (length = 8) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for(let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  // Purpose from navigation state or default
  const purpose = location.state?.purpose || 'Meeting';

  // Generate room number once
  const [roomNumber, setRoomNumber] = useState(`Room-${generateRoomId()}`);
  
  const storeRoomInDB = async (roomIdToSave) => {
    try {
      console.log("📤 Sending POST to backend with ID:", roomIdToSave);

      const accessToken = JSON.parse(localStorage.getItem("user"))?.tokens?.access;
      const csrfToken = getCookie("csrftoken");
      console.log("CSRF token:", csrfToken);

      await axios.post("http://localhost:8000/api/create-room/", 
        { id: roomIdToSave }, 
        {
          withCredentials: true,
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "X-CSRFToken": csrfToken
          }
        }
      );

      console.log("✅ Room ID stored in DB");
    } catch (err) {
      if (err.response) {
        console.error("❌ Backend responded with:", err.response.data);
      } else {
        console.error("❌ Network or other error:", err);
      }
    }
  };

  // Initialize media stream
  useEffect(() => {
    let activeStream;
    
    const initializeMedia = async () => {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({ 
          video: true, 
          audio: true 
        });
        
        setStream(mediaStream);
        activeStream = mediaStream;
        
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = mediaStream;
        }
        
        setConnectionStatus('connected');
      } catch (err) {
        console.error("getUserMedia error:", err);
        setConnectionStatus('error');
        // Try audio only if video fails
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ 
            video: false, 
            audio: true 
          });
          setStream(audioStream);
          activeStream = audioStream;
          setConnectionStatus('audio-only');
        } catch (audioErr) {
          console.error("Audio getUserMedia error:", audioErr);
        }
      }
    };

    initializeMedia();

    return () => {
      if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Room initialization
  useEffect(() => {
    fetch('http://localhost:8000/api/get-csrf-cookie/', {
      credentials: 'include',
    })
      .then(() => {
        console.log('CSRF cookie set');
      })
      .catch((err) => {
        console.error('Failed to get CSRF cookie:', err);
      });

    const navRoomId = location.state?.roomId;
    const creatorFlag = location.state?.isCreator ?? false;
    setIsCreator(creatorFlag);

    if (roomId) {
      setRoomNumber(`Room-${roomId}`);
      storeRoomInDB(roomId);
      return;
    }

    if (navRoomId) {
      setRoomNumber(`Room-${navRoomId}`);
      navigate(`/call/${navRoomId}`, {
        replace: true,
        state: { isCreator: creatorFlag, roomId: navRoomId }
      });
      storeRoomInDB(navRoomId);
      return;
    }

    const generatedId = generateRoomId();
    setRoomNumber(`Room-${generatedId}`);
    navigate(`/call/${generatedId}`, {
      replace: true,
      state: { isCreator: creatorFlag, roomId: generatedId }
    });
    storeRoomInDB(generatedId);
  }, [roomId, location.state, navigate]);

  // WebSocket connection and peer management
  useEffect(() => {
    if (!stream || !roomId) return;

    const socket = new WebSocket(`ws://localhost:8000/ws/call/${roomId}/`);
    ws.current = socket;

    socket.onopen = () => {
      console.log('WebSocket connected');
      setConnectionStatus('connected');
      socket.send(JSON.stringify({ action: "join" }));
      setTimeout(() => {
        socket.send(JSON.stringify({ action: "ready" }));
      }, 500);
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('WebSocket message:', data);

      switch (data.action) {
        case "user-joined":
          setMessages(prev => [...prev, { 
            text: `${data.peer_id} joined the call`, 
            from: 'System',
            timestamp: new Date().toLocaleTimeString()
          }]);
          setParticipantCount(prev => prev + 1);
          break;

        case "new-peer":
        case "initial-peer": {
          const alreadyExists = peersRef.current.find(p => p.userId === data.peer_id);
          if (!alreadyExists && stream) {
            console.log('Creating new peer for:', data.peer_id);
            const peer = createPeer(data.peer_id, true);
            if (peer) {
              setPeers(prev => [...prev, { peer, userId: data.peer_id }]);
            }
          }
          break;
        }

        case "offer": {
          const existingPeer = peersRef.current.find(p => p.userId === data.from);
          if (!existingPeer && stream) {
            console.log('Received offer from:', data.from);
            const peer = createPeer(data.from, false);
            if (peer) {
              peer.signal(data.signal);
              setPeers(prev => [...prev, { peer, userId: data.from }]);
            }
          }
          break;
        }

        case "answer": {
          const peerItem = peersRef.current.find(p => p.userId === data.from);
          if (peerItem) {
            console.log('Received answer from:', data.from);
            peerItem.peer.signal(data.signal);
          }
          break;
        }

        case "candidate": {
          const peerItem = peersRef.current.find(p => p.userId === data.from);
          if (peerItem) {
            console.log('Received ICE candidate from:', data.from);
            peerItem.peer.signal(data.candidate);
          }
          break;
        }

        case "user-left": {
          console.log('User left:', data.peer_id);
          setPeers(prev => {
            const leavingPeer = prev.find(p => p.userId === data.peer_id);
            if (leavingPeer) {
              leavingPeer.peer.destroy();
              // Clean up video ref
              if (remoteVideoRefs.current[data.peer_id]) {
                delete remoteVideoRefs.current[data.peer_id];
              }
            }
            return prev.filter(p => p.userId !== data.peer_id);
          });
          setParticipantCount(prev => Math.max(1, prev - 1));
          setMessages(prev => [...prev, { 
            text: `${data.peer_id} left the call`, 
            from: 'System',
            timestamp: new Date().toLocaleTimeString()
          }]);
          break;
        }

        case "chat-message": {
          setMessages(prev => [...prev, {
            text: data.message,
            from: data.from,
            timestamp: new Date().toLocaleTimeString()
          }]);
          break;
        }

        default:
          console.warn("Unknown socket action:", data.action);
      }
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
      setConnectionStatus('error');
    };

    socket.onclose = () => {
      console.log('WebSocket disconnected');
      setConnectionStatus('disconnected');
    };

    return () => {
      // Clean up peers
      peersRef.current.forEach(({ peer }) => {
        peer.destroy();
      });
      setPeers([]);
      
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ action: "leave" }));
      }
      socket.close();
    };
  }, [stream, roomId]);

  // Close emoji panel on outside click
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (emojiPanelRef.current && !emojiPanelRef.current.contains(event.target)) {
        setShowEmojiPanel(false);
      }
    };
    if (showEmojiPanel) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showEmojiPanel]);

  const createPeer = (peerId, initiator) => {
    if (!stream) {
      console.warn("Stream not ready. Cannot create peer for:", peerId);
      return null;
    }

    console.log(`Creating peer for ${peerId}, initiator: ${initiator}`);
    
    const peer = new Peer({
      initiator,
      trickle: false,
      stream,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      }
    });

    peer.on('signal', signal => {
      console.log(`Sending ${initiator ? 'offer' : 'answer'} to ${peerId}`);
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({
          action: initiator ? 'offer' : 'answer',
          target: peerId,
          signal,
        }));
      }
    });

    peer.on("stream", (remoteStream) => {
      console.log("Received stream from", peerId);
      setTimeout(() => {
        const videoRef = remoteVideoRefs.current[peerId];
        if (videoRef) {
          videoRef.srcObject = remoteStream;
          videoRef.play().catch(console.error);
        } else {
          console.warn("No videoRef found for", peerId);
        }
      }, 100);
    });

    peer.on('connect', () => {
      console.log('Peer connected:', peerId);
    });

    peer.on('error', (err) => {
      console.error('Peer error:', err);
    });

    peer.on('close', () => {
      console.log('Peer closed:', peerId);
    });

    return peer;
  };

  const toggleMic = () => {
    if (stream) {
      stream.getAudioTracks().forEach(track => (track.enabled = !micOn));
      setMicOn(prev => !prev);
      
      // Notify other participants
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({
          action: 'audio-toggle',
          enabled: !micOn
        }));
      }
    }
  };

  const toggleCamera = () => {
    if (stream) {
      stream.getVideoTracks().forEach(track => (track.enabled = !cameraOn));
      setCameraOn(prev => !prev);
      
      // Notify other participants
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({
          action: 'video-toggle',
          enabled: !cameraOn
        }));
      }
    }
  };

  const toggleScreenShare = async () => {
    if (!sharingScreen) {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ 
          video: true,
          audio: true 
        });
        
        const videoTrack = screenStream.getVideoTracks()[0];
        
        // Replace video track in existing peer connections
        peersRef.current.forEach(({ peer }) => {
          const sender = peer._pc.getSenders().find(s => 
            s.track && s.track.kind === 'video'
          );
          if (sender) {
            sender.replaceTrack(videoTrack);
          }
        });

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream;
        }

        videoTrack.onended = () => {
          // Switch back to camera
          if (stream && localVideoRef.current) {
            const cameraTrack = stream.getVideoTracks()[0];
            peersRef.current.forEach(({ peer }) => {
              const sender = peer._pc.getSenders().find(s => 
                s.track && s.track.kind === 'video'
              );
              if (sender) {
                sender.replaceTrack(cameraTrack);
              }
            });
            localVideoRef.current.srcObject = stream;
          }
          setSharingScreen(false);
        };

        setSharingScreen(true);
      } catch (err) {
        console.error('Screen share error:', err);
      }
    } else {
      // Stop screen sharing manually
      if (stream && localVideoRef.current) {
        const cameraTrack = stream.getVideoTracks()[0];
        peersRef.current.forEach(({ peer }) => {
          const sender = peer._pc.getSenders().find(s => 
            s.track && s.track.kind === 'video'
          );
          if (sender) {
            sender.replaceTrack(cameraTrack);
          }
        });
        localVideoRef.current.srcObject = stream;
      }
      setSharingScreen(false);
    }
  };

  const handleLeave = () => {
    // Clean up streams
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    
    // Clean up peers
    peersRef.current.forEach(({ peer }) => {
      peer.destroy();
    });
    
    // Notify server
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ action: "leave" }));
    }
    
    navigate('/user');
  };

  const sendMessage = () => {
    if (inputMsg.trim() && ws.current && ws.current.readyState === WebSocket.OPEN) {
      const message = {
        action: 'chat-message',
        message: inputMsg,
        from: 'You'
      };
      
      ws.current.send(JSON.stringify(message));
      
      setMessages(prev => [...prev, { 
        text: inputMsg, 
        from: 'You',
        timestamp: new Date().toLocaleTimeString()
      }]);
      setInputMsg('');
    }
  };

  const handleEmojiSelect = (emoji) => {
    const id = Date.now();
    setFloatingEmojis(prev => [...prev, { id, emoji }]);
    setShowEmojiPanel(false);
    
    // Send emoji reaction to other participants
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        action: 'emoji-reaction',
        emoji: emoji
      }));
    }
    
    setTimeout(() => {
      setFloatingEmojis(prev => prev.filter(e => e.id !== id));
    }, 2000);
  };

  const getVideoGridClass = () => {
    const totalVideos = peers.length + 1; // +1 for local video
    if (totalVideos === 1) return 'single-video';
    if (totalVideos === 2) return 'two-videos';
    if (totalVideos <= 4) return 'four-videos';
    return 'many-videos';
  };

  return (
    <div style={styles.container}>
      {/* Header with room info and connection status */}
      <div style={styles.header}>
        <div style={styles.roomInfo}>
          <div style={styles.roomTitle}>
            {purpose.charAt(0).toUpperCase() + purpose.slice(1).replace('_', ' ')}
          </div>
          <div style={styles.roomNumber}>{roomNumber}</div>
          <div style={styles.participantCount}>
            {participantCount} participant{participantCount > 1 ? 's' : ''}
          </div>
        </div>
        
        <div style={styles.connectionStatus}>
          <div style={{
            ...styles.statusIndicator,
            backgroundColor: connectionStatus === 'connected' ? '#34a853' : 
                           connectionStatus === 'connecting' ? '#fbbc04' : '#ea4335'
          }} />
          <span style={styles.statusText}>
            {connectionStatus === 'connected' ? 'Connected' :
             connectionStatus === 'connecting' ? 'Connecting...' :
             connectionStatus === 'audio-only' ? 'Audio Only' : 'Connection Error'}
          </span>
        </div>
      </div>

      {/* Video Grid */}
      <div style={{
        ...styles.videoGrid,
        gridTemplateColumns: 
          peers.length === 0 ? '1fr' :
          peers.length === 1 ? 'repeat(2, 1fr)' :
          peers.length <= 3 ? 'repeat(2, 1fr)' :
          'repeat(3, 1fr)'
      }}>
        {/* Local video */}
        <div style={styles.videoContainer}>
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            style={styles.video}
          />
          <div style={styles.videoLabel}>
            <span>You {isCreator && '(Host)'}</span>
            <div style={styles.videoControls}>
              {!micOn && <span style={styles.mutedIcon}>🔇</span>}
              {!cameraOn && <span style={styles.cameraOffIcon}>📷</span>}
              {sharingScreen && <span style={styles.screenShareIcon}>🖥️</span>}
            </div>
          </div>
        </div>

        {/* Remote videos */}
        {peers.map(({ userId }) => (
          <div key={userId} style={styles.videoContainer}>
            <video
              autoPlay
              playsInline
              ref={(el) => {
                if (el) remoteVideoRefs.current[userId] = el;
              }}
              style={styles.video}
            />
            <div style={styles.videoLabel}>
              <span>{userId}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Floating emojis */}
      {floatingEmojis.map(({ id, emoji }) => (
        <div
          key={id}
          style={{
            ...styles.floatingEmoji,
            left: `${Math.random() * 80 + 10}%`,
          }}
        >
          {emoji}
        </div>
      ))}

      {/* Controls */}
      <div style={styles.controlBar}>
        <div style={styles.controlGroup} onClick={toggleMic}>
          <button style={{
            ...styles.controlButton,
            backgroundColor: micOn ? '#fff' : '#ea4335',
            color: micOn ? '#5f6368' : '#fff'
          }}>
            {micOn ? '🎤' : '🔇'}
          </button>
          <span style={styles.controlLabel}>
            {micOn ? 'Mute' : 'Unmute'}
          </span>
        </div>

        <div style={styles.controlGroup} onClick={toggleCamera}>
          <button style={{
            ...styles.controlButton,
            backgroundColor: cameraOn ? '#fff' : '#ea4335',
            color: cameraOn ? '#5f6368' : '#fff'
          }}>
            {cameraOn ? '📹' : '🚫'}
          </button>
          <span style={styles.controlLabel}>
            {cameraOn ? 'Turn off camera' : 'Turn on camera'}
          </span>
        </div>

        <div style={styles.controlGroup} onClick={toggleScreenShare}>
          <button style={{
            ...styles.controlButton,
            backgroundColor: sharingScreen ? '#1a73e8' : '#fff',
            color: sharingScreen ? '#fff' : '#5f6368'
          }}>
            {sharingScreen ? '🛑' : '🖥️'}
          </button>
          <span style={styles.controlLabel}>
            {sharingScreen ? 'Stop sharing' : 'Present now'}
          </span>
        </div>

        <div style={styles.controlGroup} onClick={() => setShowChat(!showChat)}>
          <button style={{
            ...styles.controlButton,
            backgroundColor: showChat ? '#1a73e8' : '#fff',
            color: showChat ? '#fff' : '#5f6368'
          }}>
            💬
          </button>
          <span style={styles.controlLabel}>
            {showChat ? 'Hide chat' : 'Chat'}
          </span>
        </div>

        <div style={styles.controlGroup} ref={emojiPanelRef}>
          <button 
            style={styles.controlButton}
            onClick={() => setShowEmojiPanel(!showEmojiPanel)}
          >
            😊
          </button>
          <span style={styles.controlLabel}>Reactions</span>
          
          {showEmojiPanel && (
            <div style={styles.emojiPanel}>
              {REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => handleEmojiSelect(emoji)}
                  style={styles.emojiButton}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={styles.controlGroup} onClick={handleLeave}>
          <button style={styles.leaveButton}>
            📞
          </button>
          <span style={styles.controlLabel}>Leave call</span>
        </div>
      </div>

      {/* Chat Panel */}
      {showChat && (
        <div style={styles.chatPanel}>
          <div style={styles.chatHeader}>
            <h3>In-call messages</h3>
            <button 
              onClick={() => setShowChat(false)}
              style={styles.chatCloseButton}
            >
              ✕
            </button>
          </div>
          
          <div style={styles.chatMessages}>
            {messages.length === 0 ? (
              <div style={styles.emptyChatMessage}>
                Messages can only be seen by people in the call and are deleted when the call ends.
              </div>
            ) : (
              messages.map((msg, idx) => (
                <div key={idx} style={styles.chatMessage}>
                  <div style={styles.messageHeader}>
                    <span style={styles.messageSender}>{msg.from}</span>
                    <span style={styles.messageTime}>{msg.timestamp}</span>
                  </div>
                  <div style={styles.messageText}>{msg.text}</div>
                </div>
              ))
            )}
          </div>
          
          <div style={styles.chatInputContainer}>
            <input
              value={inputMsg}
              onChange={(e) => setInputMsg(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Send a message to everyone"
              style={styles.chatInput}
            />
            <button
              onClick={sendMessage}
              disabled={!inputMsg.trim()}
              style={{
                ...styles.chatSendButton,
                opacity: inputMsg.trim() ? 1 : 0.5
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}

      {/* Styles */}
      <style>{`
        @keyframes floatUp {
          0% { transform: translateY(0); opacity: 1; }
          100% { transform: translateY(-120px); opacity: 0; }
        }
        
        .single-video {
          grid-template-columns: 1fr !important;
        }
        
        .two-videos {
          grid-template-columns: repeat(2, 1fr) !important;
        }
        
        .four-videos {
          grid-template-columns: repeat(2, 1fr) !important;
        }
        
        .many-videos {
          grid-template-columns: repeat(3, 1fr) !important;
        }
      `}</style>
    </div>
  );
};

const styles = {
  container: {
    width: '100vw',
    height: '100vh',
    backgroundColor: '#202124',
    fontFamily: 'Google Sans, Roboto, Arial, sans-serif',
    color: '#fff',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
  },
  
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 24px',
    backgroundColor: '#303134',
    borderBottom: '1px solid #5f6368',
  },
  
  roomInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  
  roomTitle: {
    fontSize: '18px',
    fontWeight: '500',
    color: '#e8eaed',
  },
  
  roomNumber: {
    fontSize: '14px',
    color: '#9aa0a6',
  },
  
  participantCount: {
    fontSize: '12px',
    color: '#9aa0a6',
  },
  
  connectionStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  
  statusIndicator: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
  
  statusText: {
    fontSize: '14px',
    color: '#9aa0a6',
  },
  
  videoGrid: {
    display: 'grid',
    gap: '8px',
    padding: '16px',
    flex: 1,
    alignContent: 'center',
    justifyContent: 'center',
  },
  
  videoContainer: {
    position: 'relative',
    backgroundColor: '#000',
    borderRadius: '8px',
    overflow: 'hidden',
    minHeight: '200px',
    aspectRatio: '16/9',
  },
  
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  
  videoLabel: {
    position: 'absolute',
    bottom: '8px',
    left: '8px',
    right: '8px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '12px',
    color: '#fff',
  },
  
  videoControls: {
    display: 'flex',
    gap: '4px',
  },
  
  mutedIcon: {
    fontSize: '12px',
  },
  
  cameraOffIcon: {
    fontSize: '12px',
  },
  
  screenShareIcon: {
    fontSize: '12px',
  },
  
  floatingEmoji: {
    position: 'absolute',
    bottom: '120px',
    fontSize: '32px',
    animation: 'floatUp 2s ease-out',
    pointerEvents: 'none',
    zIndex: 1000,
  },
  
  controlBar: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '8px',
    padding: '16px',
    backgroundColor: '#303134',
  },
  
  controlGroup: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    cursor: 'pointer',
    position: 'relative',
  },
  
  controlButton: {
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    border: 'none',
    fontSize: '20px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
    backgroundColor: '#fff',
    color: '#5f6368',
  },
  
  controlLabel: {
    fontSize: '11px',
    color: '#9aa0a6',
    textAlign: 'center',
    maxWidth: '60px',
  },
  
  leaveButton: {
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    border: 'none',
    fontSize: '20px',
    cursor: 'pointer',
    backgroundColor: '#ea4335',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transform: 'rotate(135deg)',
  },
  
  emojiPanel: {
    position: 'absolute',
    bottom: '70px',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: '#fff',
    borderRadius: '8px',
    padding: '8px',
    display: 'flex',
    gap: '4px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    zIndex: 1000,
  },
  
  emojiButton: {
    background: 'none',
    border: 'none',
    fontSize: '24px',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '4px',
    transition: 'background-color 0.2s ease',
  },
  
  chatPanel: {
    position: 'fixed',
    right: '0',
    top: '0',
    width: '320px',
    height: '100vh',
    backgroundColor: '#fff',
    color: '#202124',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '-2px 0 8px rgba(0,0,0,0.2)',
    zIndex: 1000,
  },
  
  chatHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px',
    borderBottom: '1px solid #e0e0e0',
  },
  
  chatCloseButton: {
    background: 'none',
    border: 'none',
    fontSize: '16px',
    cursor: 'pointer',
    color: '#5f6368',
  },
  
  chatMessages: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px',
  },
  
  emptyChatMessage: {
    fontSize: '14px',
    color: '#5f6368',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  
  chatMessage: {
    marginBottom: '16px',
  },
  
  messageHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '4px',
  },
  
  messageSender: {
    fontSize: '12px',
    fontWeight: '500',
    color: '#1a73e8',
  },
  
  messageTime: {
    fontSize: '11px',
    color: '#5f6368',
  },
  
  messageText: {
    fontSize: '14px',
    color: '#202124',
  },
  
  chatInputContainer: {
    display: 'flex',
    padding: '16px',
    borderTop: '1px solid #e0e0e0',
    gap: '8px',
  },
  
  chatInput: {
    flex: 1,
    padding: '8px 12px',
    border: '1px solid #dadce0',
    borderRadius: '4px',
    fontSize: '14px',
    outline: 'none',
  },
  
  chatSendButton: {
    padding: '8px 16px',
    backgroundColor: '#1a73e8',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
    fontWeight: '500',
  },
};

export default VideoCall;