from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
import uuid
import random
from datetime import datetime

# ------------------ APP SETUP ------------------

app = Flask(__name__)
app.config["SECRET_KEY"] = "omegle-enhanced-2024"

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="threading"
)

# ------------------ STATE ------------------

waiting_users = []          # queue for human matchmaking
active_pairs = {}           # sid -> partner_sid
active_rooms = {}           # sid -> room_id
ai_rooms = {}               # room_id -> chat data

# ------------------ AI RESPONSES ------------------

AI_RESPONSES = [
    "👋 Hey! I'm your AI chat partner!",
    "🤖 I'm always online. What do you want to talk about?",
    "😊 Nice to meet you!",
    "✨ Ready for an interesting conversation?",
    "💬 Ask me anything!"
]

# ------------------ ROUTES ------------------

@app.route("/")
def home():
    return render_template("index.html")


@app.route("/chat")
def chat():
    return render_template("chat.html")


@app.route("/api/status")
def status():
    return jsonify({
        "status": "online",
        "users": len(waiting_users) + len(active_pairs),
        "time": datetime.now().isoformat()
    })


@app.route("/api/instant-ai")
def instant_ai():
    room_id = str(uuid.uuid4())[:8]
    ai_rooms[room_id] = []

    return jsonify({
        "success": True,
        "room_id": room_id,
        "instant": True
    })

# ------------------ SOCKET EVENTS ------------------

@socketio.on("connect")
def on_connect():
    print(f"✅ Connected: {request.sid}")
    emit("connected", {"status": "ok"})


@socketio.on("join_room")
def join_chat(data):
    room_id = data.get("room")
    if not room_id:
        return

    join_room(room_id)
    active_rooms[request.sid] = room_id
    print(f"🔗 {request.sid} joined room {room_id}")
# ------------------ WEBRTC SIGNALING ------------------

@socketio.on("webrtc_offer")
def webrtc_offer(data):
    partner = active_pairs.get(request.sid)
    if partner:
        emit("webrtc_offer", data, to=partner)

@socketio.on("webrtc_answer")
def webrtc_answer(data):
    partner = active_pairs.get(request.sid)
    if partner:
        emit("webrtc_answer", data, to=partner)

@socketio.on("webrtc_ice_candidate")
def webrtc_ice_candidate(data):
    partner = active_pairs.get(request.sid)
    if partner:
        emit("webrtc_ice_candidate", data, to=partner)

# ------------------ AI CHAT ------------------

@socketio.on("start_ai_chat")
def start_ai_chat():
    room_id = str(uuid.uuid4())[:8]
    join_room(room_id)

    ai_rooms[room_id] = []
    active_rooms[request.sid] = room_id

    emit("ai_connected", {
        "room_id": room_id,
        "welcome": random.choice(AI_RESPONSES)
    })

    print(f"🤖 AI chat started: {room_id}")

# ------------------ HUMAN MATCHMAKING ------------------

@socketio.on("find_human")
def find_human():
    sid = request.sid
    print(f"🔍 {sid} is searching for a stranger")

    # If someone is already waiting → match
    if waiting_users:
        partner_sid = waiting_users.pop(0)
        room_id = str(uuid.uuid4())[:8]

        join_room(room_id, sid=sid)
        join_room(room_id, sid=partner_sid)

        active_pairs[sid] = partner_sid
        active_pairs[partner_sid] = sid

        active_rooms[sid] = room_id
        active_rooms[partner_sid] = room_id

        emit("human_matched", {"room_id": room_id}, to=sid)
        emit("human_matched", {"room_id": room_id}, to=partner_sid)

        print(f"🤝 Matched {sid} ↔ {partner_sid} in room {room_id}")

    else:
        waiting_users.append(sid)
        emit("waiting", {"message": "Waiting for a stranger..."})
        print(f"⏳ {sid} added to waiting queue")

@socketio.on("next_human")
def next_human():
    sid = request.sid
    partner = active_pairs.pop(sid, None)

    if partner:
        active_pairs.pop(partner, None)
        emit("partner_left", {}, to=partner)

    emit("system", {"message": "Finding new stranger..."})
    find_human()

# ------------------ MESSAGING ------------------

@socketio.on("send_message")
def handle_message(data):
    room_id = data.get("room_id")
    message = data.get("message", "").strip()

    if not room_id or not message:
        return

    emit("new_message", {
        "text": message,
        "sender": "user",
        "time": datetime.now().strftime("%H:%M")
    }, room=room_id)

    if room_id in ai_rooms:
        socketio.sleep(random.uniform(0.4, 0.9))
        reply = generate_ai_reply(message)

        emit("ai_message", {
            "text": reply,
            "sender": "ai",
            "time": datetime.now().strftime("%H:%M")
        }, room=room_id)

# ------------------ VIDEO PERMISSION ------------------

@socketio.on("request_video_permission")
def video_permission():
    emit("video_permission_granted", {"status": "ok"})

# ------------------ DISCONNECT CLEANUP ------------------

@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid

    if sid in waiting_users:
        waiting_users.remove(sid)

    partner = active_pairs.pop(sid, None)
    if partner:
        active_pairs.pop(partner, None)
        emit("partner_left", {}, to=partner)

    room = active_rooms.pop(sid, None)
    if room:
        leave_room(room)
        ai_rooms.pop(room, None)

    print(f"❌ Disconnected: {sid}")

# ------------------ AI LOGIC ------------------

def generate_ai_reply(text):
    text = text.lower()

    if "hello" in text or "hi" in text:
        return "Hello! 👋"
    if "how are" in text:
        return "I'm doing great! 😊"
    if "joke" in text:
        return "Why do programmers hate nature? Too many bugs 😄"

    return random.choice(AI_RESPONSES)

# ------------------ RUN ------------------

if __name__ == "__main__":
    print("🚀 Omegle-Style Human Matchmaking Enabled")
    print("🌐 http://localhost:5000")
    socketio.run(app, debug=True, port=5000)
