import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';

const PreCallSettings = () => {
  const navigate = useNavigate();
  const { roomName } = useParams();
  const location = useLocation();
  const purpose = location.state?.purpose || 'general';

  const [micOn, setMicOn] = useState(true);
  const [videoOn, setVideoOn] = useState(true);
  const [stream, setStream] = useState(null);
  const [cameraError, setCameraError] = useState(null);
  const [isMobile, setIsMobile] = useState(false);

  const videoRef = useRef();

  // Responsive detection
  useEffect(() => {
    const checkDevice = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    checkDevice();
    window.addEventListener('resize', checkDevice);
    return () => window.removeEventListener('resize', checkDevice);
  }, []);

  // getUserMedia only runs once on mount
  useEffect(() => {
    let activeStream;

    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((mediaStream) => {
        activeStream = mediaStream;
        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      })
      .catch((err) => {
        console.error("Error accessing media devices:", err);
        setCameraError("Camera or microphone access was denied. Please allow permission and refresh the page.");
      });

    return () => {
      if (activeStream) {
        activeStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // Control mic
  useEffect(() => {
    if (stream) {
      stream.getAudioTracks().forEach((track) => {
        track.enabled = micOn;
      });
    }
  }, [micOn, stream]);

  // Control camera
  useEffect(() => {
    if (stream) {
      stream.getVideoTracks().forEach((track) => {
        track.enabled = videoOn;
      });
    }
  }, [videoOn, stream]);

  const toggleMic = () => {
    setMicOn((prev) => !prev);
  };

  const toggleVideo = () => {
    setVideoOn((prev) => !prev);
  };

  const handleStartCall = () => {
    console.log('Starting call with settings:', { purpose, micOn, videoOn });
    
    // Clean up the current stream before navigating
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    
    navigate(`/call/${roomName}`, {
      state: { 
        purpose, 
        micOn, 
        videoOn,
        isCreator: location.state?.isCreator ?? false,
        roomId: roomName
      },
    });
  };

  return (
    <div style={{
      ...styles.page,
      ...(isMobile && styles.mobilePage)
    }}>
      <main style={{
        ...styles.card,
        ...(isMobile && styles.mobileCard)
      }}>
        {cameraError && <p style={{
          ...styles.error,
          ...(isMobile && styles.mobileError)
        }}>{cameraError}</p>}

        <h2 style={{
          ...styles.title,
          ...(isMobile && styles.mobileTitle)
        }}>Prepare Your Settings</h2>
        
        <p style={{
          ...styles.purposeText,
          ...(isMobile && styles.mobilePurposeText)
        }}>
          Purpose of this call is <strong>{purpose.replace('_', ' ')}</strong>. 
          Please ensure your microphone and camera are ready.
        </p>

        <div style={{
          ...styles.videoContainer,
          ...(isMobile && styles.mobileVideoContainer)
        }}>
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{
              ...styles.video,
              ...(isMobile && styles.mobileVideo)
            }}
          />
          
          {/* Video status overlay */}
          {!videoOn && (
            <div style={{
              ...styles.videoOverlay,
              ...(isMobile && styles.mobileVideoOverlay)
            }}>
              <div style={styles.videoOffIcon}>📷</div>
              <div style={{
                ...styles.videoOffText,
                ...(isMobile && styles.mobileVideoOffText)
              }}>Camera is off</div>
            </div>
          )}
        </div>

        <div style={{
          ...styles.buttonsRow,
          ...(isMobile && styles.mobileButtonsRow)
        }}>
          <button
            onClick={toggleMic}
            style={{
              ...styles.toggleBtn,
              ...(isMobile && styles.mobileToggleBtn),
              backgroundColor: micOn ? '#1a73e8' : '#d93025',
              boxShadow: micOn ? '0 0 12px rgba(26,115,232,0.3)' : '0 0 12px rgba(217,48,37,0.3)',
              color: 'white',
            }}
            aria-pressed={micOn}
            aria-label="Toggle microphone"
          >
            <span style={{
              ...styles.icon,
              ...(isMobile && styles.mobileIcon)
            }}>{micOn ? '🎤' : '🔇'}</span>
            {!isMobile && (micOn ? 'Mic ON' : 'Mic OFF')}
          </button>

          <button
            onClick={toggleVideo}
            style={{
              ...styles.toggleBtn,
              ...(isMobile && styles.mobileToggleBtn),
              backgroundColor: videoOn ? '#1a73e8' : '#d93025',
              boxShadow: videoOn ? '0 0 12px rgba(26,115,232,0.3)' : '0 0 12px rgba(217,48,37,0.3)',
              color: 'white',
            }}
            aria-pressed={videoOn}
            aria-label="Toggle camera"
          >
            <span style={{
              ...styles.icon,
              ...(isMobile && styles.mobileIcon)
            }}>{videoOn ? '📹' : '🚫'}</span>
            {!isMobile && (videoOn ? 'Video ON' : 'Video OFF')}
          </button>
        </div>

        <button
          onClick={handleStartCall}
          style={{
            ...styles.startBtn,
            ...(isMobile && styles.mobileStartBtn)
          }}
          aria-label="Start call"
        >
          Start Call
        </button>
        
        {/* Settings summary for mobile */}
        {isMobile && (
          <div style={styles.settingsSummary}>
            <div style={styles.settingItem}>
              <span style={styles.settingIcon}>{micOn ? '🎤' : '🔇'}</span>
              <span style={styles.settingLabel}>Mic {micOn ? 'ON' : 'OFF'}</span>
            </div>
            <div style={styles.settingItem}>
              <span style={styles.settingIcon}>{videoOn ? '📹' : '🚫'}</span>
              <span style={styles.settingLabel}>Video {videoOn ? 'ON' : 'OFF'}</span>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

const styles = {
  page: {
    minHeight: '100vh',
    backgroundColor: '#f1f3f4',
    fontFamily: "'Google Sans', 'Roboto', sans-serif",
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 1rem 2rem',
  },
  
  mobilePage: {
    padding: '1rem 0.5rem',
    justifyContent: 'flex-start',
    paddingTop: '2rem',
  },
  
  card: {
    backgroundColor: 'white',
    width: '100%',
    maxWidth: '900px',
    borderRadius: '16px',
    boxShadow: '0 8px 24px rgba(32,33,36,0.28)',
    padding: '3rem 4rem',
    boxSizing: 'border-box',
    textAlign: 'center',
  },
  
  mobileCard: {
    maxWidth: '100%',
    borderRadius: '12px',
    padding: '2rem 1.5rem',
    margin: '0 0.5rem',
  },
  
  title: {
    fontSize: '2rem',
    fontWeight: '700',
    marginBottom: '0.25rem',
    color: '#202124',
  },
  
  mobileTitle: {
    fontSize: '1.5rem',
    marginBottom: '0.5rem',
  },
  
  purposeText: {
    fontSize: '1rem',
    color: '#3c4043',
    marginBottom: '2rem',
    lineHeight: 1.5,
  },
  
  mobilePurposeText: {
    fontSize: '0.9rem',
    marginBottom: '1.5rem',
  },
  
  error: {
    color: '#d93025',
    fontWeight: 500,
    marginBottom: '1rem',
    fontSize: '1rem',
    padding: '1rem',
    backgroundColor: '#fce8e6',
    borderRadius: '8px',
    border: '1px solid #f9ab00',
  },
  
  mobileError: {
    fontSize: '0.9rem',
    padding: '0.75rem',
  },
  
  videoContainer: {
    position: 'relative',
    marginBottom: '2rem',
  },
  
  mobileVideoContainer: {
    marginBottom: '1.5rem',
  },
  
  video: {
    width: '100%',
    height: '450px',
    maxHeight: '70vh',
    borderRadius: '16px',
    border: '3px solid #1a73e8',
    boxShadow: '0 0 30px rgba(26, 115, 232, 0.7)',
    objectFit: 'cover',
    backgroundColor: '#000',
  },
  
  mobileVideo: {
    height: '300px',
    maxHeight: '50vh',
    borderRadius: '12px',
    border: '2px solid #1a73e8',
    boxShadow: '0 0 20px rgba(26, 115, 232, 0.5)',
  },
  
  videoOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '16px',
    color: 'white',
  },
  
  mobileVideoOverlay: {
    borderRadius: '12px',
  },
  
  videoOffIcon: {
    fontSize: '4rem',
    marginBottom: '1rem',
  },
  
  videoOffText: {
    fontSize: '1.2rem',
    fontWeight: '500',
  },
  
  mobileVideoOffText: {
    fontSize: '1rem',
  },
  
  buttonsRow: {
    display: 'flex',
    justifyContent: 'center',
    gap: '2rem',
    flexWrap: 'wrap',
    marginBottom: '2rem',
  },
  
  mobileButtonsRow: {
    gap: '1rem',
    marginBottom: '1.5rem',
  },
  
  toggleBtn: {
    flex: '1 1 180px',
    maxWidth: '200px',
    padding: '14px 32px',
    fontSize: '1.2rem',
    fontWeight: '600',
    border: 'none',
    borderRadius: '12px',
    cursor: 'pointer',
    transition: 'all 0.3s ease',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.75rem',
    minHeight: '56px',
  },
  
  mobileToggleBtn: {
    flex: '1 1 auto',
    maxWidth: 'none',
    padding: '16px 20px',
    fontSize: '1rem',
    borderRadius: '50px',
    gap: '0.5rem',
    minHeight: '52px',
    minWidth: '52px',
  },
  
  icon: {
    fontSize: '1.6rem',
    transition: 'transform 0.3s',
  },
  
  mobileIcon: {
    fontSize: '1.4rem',
  },
  
  startBtn: {
    padding: '16px 64px',
    fontSize: '1.25rem',
    fontWeight: '700',
    backgroundColor: '#1a73e8',
    color: 'white',
    borderRadius: '16px',
    border: 'none',
    cursor: 'pointer',
    boxShadow: '0 6px 20px rgba(26,115,232,0.6)',
    transition: 'all 0.3s ease',
    minHeight: '56px',
  },
  
  mobileStartBtn: {
    width: '100%',
    padding: '16px 32px',
    fontSize: '1.1rem',
    borderRadius: '12px',
    marginBottom: '1rem',
  },
  
  settingsSummary: {
    display: 'flex',
    justifyContent: 'center',
    gap: '2rem',
    marginTop: '1rem',
    padding: '1rem',
    backgroundColor: '#f8f9fa',
    borderRadius: '8px',
  },
  
  settingItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  
  settingIcon: {
    fontSize: '1.2rem',
  },
  
  settingLabel: {
    fontSize: '0.9rem',
    fontWeight: '500',
    color: '#5f6368',
  },
};

export default PreCallSettings;