import cv2
import pickle
import numpy as np
import time
from datetime import date
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from sklearn.neighbors import KNeighborsClassifier
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
import json
import base64
from io import BytesIO
from PIL import Image

# Store last face detection times per user to track alerts
user_face_tracking = {}

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def face_recognition_api(request):
    """
    API endpoint to process video frames for face recognition
    """
    try:
        # Get the uploaded frame
        if 'frame' not in request.FILES:
            return JsonResponse({'error': 'No frame provided'}, status=400)
        
        frame_file = request.FILES['frame']
        room_id = request.POST.get('room_id')
        user_id = request.POST.get('user_id')
        
        if not room_id or not user_id:
            return JsonResponse({'error': 'Missing room_id or user_id'}, status=400)
        
        # Convert uploaded file to OpenCV format
        image = Image.open(frame_file)
        frame = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
        
        # Initialize face detector
        facedetect = cv2.CascadeClassifier('./data/haarcascade_frontalface_default.xml')
        
        # Load known faces data and labels
        try:
            with open('./data/names.pkl', 'rb') as f:
                names = pickle.load(f)
            with open('./data/faces_data.pkl', 'rb') as f:
                faces = pickle.load(f)
        except FileNotFoundError:
            return JsonResponse({
                'error': 'Face recognition data not found. Please train the model first.',
                'recognized_faces': [],
                'alerts': [],
                'timestamp': time.time()
            }, status=200)
        
        # Initialize KNN classifier
        knn = KNeighborsClassifier(n_neighbors=5)
        knn.fit(faces, names)
        
        # Convert frame to grayscale for face detection
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        face_rects = facedetect.detectMultiScale(gray, 1.3, 5)
        
        recognized_faces = []
        alerts = []
        current_time = time.time()
        
        # Initialize user tracking if not exists
        if user_id not in user_face_tracking:
            user_face_tracking[user_id] = {
                'last_face_time': current_time,
                'face_missing_alert_sent': False,
                'unknown_face_alert_sent': False,
                'recognized_today': set()
            }
        
        user_data = user_face_tracking[user_id]
        
        if len(face_rects) > 0:
            # Update timestamp since face detected
            user_data['last_face_time'] = current_time
            user_data['face_missing_alert_sent'] = False  # Reset if face appears
            
            for (x, y, w, h) in face_rects:
                # Extract and resize face region
                crop_img = frame[y:y+h, x:x+w, :]
                resized_img = cv2.resize(crop_img, (50, 50)).flatten().reshape(1, -1)
                
                try:
                    # Predict using KNN
                    output = knn.predict(resized_img)
                    confidence = knn.predict_proba(resized_img)
                    max_confidence = np.max(confidence)
                    
                    # Set confidence threshold
                    if max_confidence > 0.6:  # Adjust threshold as needed
                        name = output[0]
                    else:
                        name = "Unknown"
                        
                except Exception as e:
                    print(f"Prediction error: {e}")
                    name = "Unknown"
                
                # Handle unknown face detection
                if name == "Unknown" and not user_data['unknown_face_alert_sent']:
                    alerts.append("Unrecognized face detected")
                    user_data['unknown_face_alert_sent'] = True
                    
                    # Send WebSocket alert
                    send_face_alert(room_id, "Unrecognized face detected", "warning")
                    
                elif name != "Unknown":
                    user_data['unknown_face_alert_sent'] = False  # Reset if recognized face appears
                    recognized_faces.append(name)
                    
                    # Record attendance
                    today = date.today()
                    if name not in user_data['recognized_today']:
                        try:
                            from .models import Attendance  # Lazy import to avoid circular import
                            if not Attendance.objects.filter(student_name=name, date=today).exists():
                                Attendance.objects.create(student_name=name, date=today)
                                user_data['recognized_today'].add(name)
                                alerts.append(f"Attendance recorded for {name}")
                                
                                # Send WebSocket alert for attendance
                                send_face_alert(room_id, f"Attendance recorded for {name}", "success")
                        except Exception as e:
                            print(f"Attendance recording error: {e}")
        
        else:
            # No face detected – check if >4 seconds have passed
            if (current_time - user_data['last_face_time'] > 4 and 
                not user_data['face_missing_alert_sent']):
                alerts.append("No face detected for over 4 seconds")
                user_data['face_missing_alert_sent'] = True
                
                # Send WebSocket alert
                send_face_alert(room_id, "No face detected for over 4 seconds", "info")
        
        # Remove duplicates from recognized faces
        recognized_faces = list(set(recognized_faces))
        
        return JsonResponse({
            'success': True,
            'recognized_faces': recognized_faces,
            'alerts': alerts,
            'timestamp': current_time,
            'faces_detected': len(face_rects)
        })
        
    except Exception as e:
        print(f"Face recognition API error: {e}")
        return JsonResponse({
            'error': f'Face recognition processing failed: {str(e)}',
            'recognized_faces': [],
            'alerts': [],
            'timestamp': time.time()
        }, status=500)


def send_face_alert(room_id, message, alert_type="info"):
    """
    Send face recognition alert via WebSocket
    """
    try:
        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f"call_{room_id}",  # Use the same group as video call
            {
                "type": "send_face_alert",
                "message": message,
                "alert_type": alert_type
            }
        )
    except Exception as e:
        print(f"WebSocket alert error: {e}")


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def reset_face_tracking(request):
    """
    Reset face tracking data for a user (useful for testing)
    """
    user_id = request.data.get('user_id')
    
    if user_id and user_id in user_face_tracking:
        del user_face_tracking[user_id]
        return JsonResponse({'success': True, 'message': 'Face tracking reset'})
    
    return JsonResponse({'error': 'User not found'}, status=404)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def face_recognition_status(request):
    """
    Get current face recognition status and statistics
    """
    return JsonResponse({
        'active_users': len(user_face_tracking),
        'users': list(user_face_tracking.keys()),
        'status': 'active'
    })