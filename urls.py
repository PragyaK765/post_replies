# urls.py (main app urls)
from django.urls import path, include
from . import views
from .face_recognition_api import face_recognition_api, reset_face_tracking, face_recognition_status

urlpatterns = [
    # Existing video feed endpoint
    path('api/video-feed/', views.video_feed, name='video_feed'),
    
    # Face recognition API endpoints
    path('api/face-recognition/', face_recognition_api, name='face_recognition_api'),
    path('api/face-recognition/reset/', reset_face_tracking, name='reset_face_tracking'),
    path('api/face-recognition/status/', face_recognition_status, name='face_recognition_status'),
    
    # Other existing endpoints...
    path('api/create-room/', views.create_room, name='create_room'),
    path('api/get-csrf-cookie/', views.get_csrf_cookie, name='get_csrf_cookie'),
]

# routing.py (WebSocket routing)
from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(r'ws/call/(?P<room_id>\w+)/$', consumers.VideoCallConsumer.as_asgi()),
    re_path(r'ws/face-alerts/$', consumers.FaceRecognitionConsumer.as_asgi()),
]