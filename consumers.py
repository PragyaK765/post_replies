import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async

class VideoCallConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.room_id = self.scope['url_route']['kwargs']['room_id']
        self.room_group_name = f'call_{self.room_id}'
        self.user_id = None

        # Join room group
        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )

        await self.accept()
        print(f"WebSocket connected to room: {self.room_id}")

    async def disconnect(self, close_code):
        # Leave room group
        if self.user_id:
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'user_left',
                    'peer_id': self.user_id
                }
            )

        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )
        print(f"WebSocket disconnected from room: {self.room_id}")

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
            action = data.get('action')
            
            print(f"Received action: {action} from user: {data.get('user_id', 'unknown')}")

            if action == 'join':
                await self.handle_join(data)
            elif action == 'ready':
                await self.handle_ready(data)
            elif action == 'offer':
                await self.handle_offer(data)
            elif action == 'answer':
                await self.handle_answer(data)
            elif action == 'ice-candidate':
                await self.handle_ice_candidate(data)
            elif action == 'leave':
                await self.handle_leave(data)
            elif action == 'chat-message':
                await self.handle_chat_message(data)
            elif action == 'emoji-reaction':
                await self.handle_emoji_reaction(data)
            elif action == 'audio-toggle':
                await self.handle_audio_toggle(data)
            elif action == 'video-toggle':
                await self.handle_video_toggle(data)
            else:
                print(f"Unknown action: {action}")

        except json.JSONDecodeError:
            print("Invalid JSON received")
        except Exception as e:
            print(f"Error handling message: {e}")

    async def handle_join(self, data):
        self.user_id = data.get('user_id')
        
        # Notify others that user joined
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'user_joined',
                'peer_id': self.user_id
            }
        )
        
        # Send existing users to the new user
        # In a real implementation, you'd track active users
        # For now, we'll let the frontend handle peer discovery

    async def handle_ready(self, data):
        user_id = data.get('user_id')
        
        # Notify existing users about new peer
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'new_peer',
                'peer_id': user_id
            }
        )

    async def handle_offer(self, data):
        target = data.get('target')
        signal = data.get('signal')
        from_user = data.get('from')
        
        # Send offer to specific target
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'send_offer',
                'target': target,
                'signal': signal,
                'from': from_user
            }
        )

    async def handle_answer(self, data):
        target = data.get('target')
        signal = data.get('signal')
        from_user = data.get('from')
        
        # Send answer to specific target
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'send_answer',
                'target': target,
                'signal': signal,
                'from': from_user
            }
        )

    async def handle_ice_candidate(self, data):
        target = data.get('target')
        candidate = data.get('candidate')
        from_user = data.get('from')
        
        # Send ICE candidate to specific target
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'send_ice_candidate',
                'target': target,
                'candidate': candidate,
                'from': from_user
            }
        )

    async def handle_leave(self, data):
        user_id = data.get('user_id')
        
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'user_left',
                'peer_id': user_id
            }
        )

    async def handle_chat_message(self, data):
        message = data.get('message')
        from_user = data.get('from')
        
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'chat_message',
                'message': message,
                'from': from_user
            }
        )

    async def handle_emoji_reaction(self, data):
        emoji = data.get('emoji')
        from_user = data.get('user_id')
        
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'emoji_reaction',
                'emoji': emoji,
                'from': from_user
            }
        )

    async def handle_audio_toggle(self, data):
        user_id = data.get('user_id')
        enabled = data.get('enabled')
        
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'audio_toggle',
                'user_id': user_id,
                'enabled': enabled
            }
        )

    async def handle_video_toggle(self, data):
        user_id = data.get('user_id')
        enabled = data.get('enabled')
        
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'video_toggle',
                'user_id': user_id,
                'enabled': enabled
            }
        )

    # Message type handlers (called by channel layer)
    async def user_joined(self, event):
        peer_id = event['peer_id']
        
        # Don't send to the user who joined
        if peer_id != self.user_id:
            await self.send(text_data=json.dumps({
                'action': 'user-joined',
                'peer_id': peer_id
            }))

    async def new_peer(self, event):
        peer_id = event['peer_id']
        
        # Don't send to the peer itself
        if peer_id != self.user_id:
            await self.send(text_data=json.dumps({
                'action': 'new-peer',
                'peer_id': peer_id
            }))

    async def send_offer(self, event):
        target = event['target']
        
        # Only send to the target user
        if target == self.user_id:
            await self.send(text_data=json.dumps({
                'action': 'offer',
                'signal': event['signal'],
                'from': event['from']
            }))

    async def send_answer(self, event):
        target = event['target']
        
        # Only send to the target user
        if target == self.user_id:
            await self.send(text_data=json.dumps({
                'action': 'answer',
                'signal': event['signal'],
                'from': event['from']
            }))

    async def send_ice_candidate(self, event):
        target = event['target']
        
        # Only send to the target user
        if target == self.user_id:
            await self.send(text_data=json.dumps({
                'action': 'ice-candidate',
                'candidate': event['candidate'],
                'from': event['from']
            }))

    async def user_left(self, event):
        peer_id = event['peer_id']
        
        # Don't send to the user who left
        if peer_id != self.user_id:
            await self.send(text_data=json.dumps({
                'action': 'user-left',
                'peer_id': peer_id
            }))

    async def chat_message(self, event):
        message = event['message']
        from_user = event['from']
        
        # Don't send back to sender
        if from_user != self.user_id:
            await self.send(text_data=json.dumps({
                'action': 'chat-message',
                'message': message,
                'from': from_user
            }))

    async def emoji_reaction(self, event):
        emoji = event['emoji']
        from_user = event['from']
        
        # Don't send back to sender
        if from_user != self.user_id:
            await self.send(text_data=json.dumps({
                'action': 'emoji-reaction',
                'emoji': emoji,
                'from': from_user
            }))

    async def audio_toggle(self, event):
        user_id = event['user_id']
        enabled = event['enabled']
        
        # Don't send back to sender
        if user_id != self.user_id:
            await self.send(text_data=json.dumps({
                'action': 'audio-toggle',
                'user_id': user_id,
                'enabled': enabled
            }))

    async def video_toggle(self, event):
        user_id = event['user_id']
        enabled = event['enabled']
        
        # Don't send back to sender
        if user_id != self.user_id:
            await self.send(text_data=json.dumps({
                'action': 'video-toggle',
                'user_id': user_id,
                'enabled': enabled
            }))

    # Face recognition alert handler
    async def send_face_alert(self, event):
        """
        Handle face recognition alerts sent from the API
        """
        await self.send(text_data=json.dumps({
            'action': 'face-alert',
            'message': event['message'],
            'alert_type': event['alert_type']
        }))


# Face recognition specific consumer (if you want to separate concerns)
class FaceRecognitionConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        await self.channel_layer.group_add(
            "face_alerts",
            self.channel_name
        )
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(
            "face_alerts",
            self.channel_name
        )

    async def send_alert(self, event):
        message = event['message']
        await self.send(text_data=json.dumps({
            'type': 'face_alert',
            'message': message
        }))