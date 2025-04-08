const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

// Game constants
const TICK_RATE = 30; // You can try 60 if the server can handle it
const COURT_WIDTH = 800;
const COURT_HEIGHT = 480;
const PLAYER_WIDTH = 65;
const PLAYER_HEIGHT = 65;
const BALL_RADIUS = 30;
const NET_WIDTH = 10;
const NET_HEIGHT = 225;
const GRAVITY = 0.4;
const JUMP_VELOCITY = -18;
const MOVE_SPEED = 15;
const MAX_SCORE = 11;

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ['http://localhost:5173', 'https://pepspeckerball-production.up.railway.app'],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['polling', 'websocket'],
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(express.static(path.join(__dirname, '../../client/dist')));

app.get('/health', (req, res) => {
  res.status(200).send('Server is running');
});

app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, '../../client/dist/index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(200).send(`<!DOCTYPE html><html>...</html>`); // Replace with your fallback HTML
  }
});

const waitingPlayers = [];
const activeSessions = new Map();

class GameSession {
  constructor(player1Id, player2Id) {
    this.id = uuidv4();
    this.player1 = {
      id: player1Id,
      x: COURT_WIDTH / 4 - PLAYER_WIDTH / 2,
      y: COURT_HEIGHT - PLAYER_HEIGHT,
      width: PLAYER_WIDTH,
      height: PLAYER_HEIGHT,
      velocity: { x: 0, y: 0 },
      score: 0,
      inputs: { left: false, right: false, jump: false }
    };
    this.player2 = {
      id: player2Id,
      x: COURT_WIDTH * 3/4 - PLAYER_WIDTH / 2,
      y: COURT_HEIGHT - PLAYER_HEIGHT,
      width: PLAYER_WIDTH,
      height: PLAYER_HEIGHT,
      velocity: { x: 0, y: 0 },
      score: 0,
      inputs: { left: false, right: false, jump: false }
    };
    this.ball = {
      x: COURT_WIDTH / 4,
      y: COURT_HEIGHT - (PLAYER_HEIGHT * 2 + BALL_RADIUS),
      radius: BALL_RADIUS,
      velocity: { x: 0, y: 0 }
    };
    this.net = {
      x: COURT_WIDTH / 2 - NET_WIDTH / 2,
      y: COURT_HEIGHT - NET_HEIGHT,
      width: NET_WIDTH,
      height: NET_HEIGHT
    };
    this.servingState = {
      isServing: true,
      servingPlayer: 1
    };
    this.server = 1; // Tracks who serves next
    this.isGameActive = true;
    this.lastUpdateTime = Date.now();
    this.startGameLoop();
  }

  startGameLoop() {
    this.intervalId = setInterval(() => {
      this.update();
    }, 1000 / TICK_RATE);
  }

  update() {
    const now = Date.now();
    const dt = (now - this.lastUpdateTime) / 16.67; // Normalized to ~60 FPS
    this.lastUpdateTime = now;
    if (!this.isGameActive) return;

    this.updatePlayer(this.player1, dt, 0, COURT_WIDTH / 2 - PLAYER_WIDTH);
    this.updatePlayer(this.player2, dt, COURT_WIDTH / 2, COURT_WIDTH - PLAYER_WIDTH);

    if (this.servingState.isServing) {
      // Keep ball stationary above serving player
      if (this.servingState.servingPlayer === 1) {
        this.ball.x = COURT_WIDTH / 4;
      } else {
        this.ball.x = COURT_WIDTH * 3/4;
      }
      this.ball.y = COURT_HEIGHT - (PLAYER_HEIGHT * 2 + BALL_RADIUS);
      this.ball.velocity = { x: 0, y: 0 };
    } else {
      this.updateBall(dt);
    }

    this.checkPlayerBallCollisions();
    this.checkScoring();
    this.broadcastGameState();
  }

  updatePlayer(player, dt, minX, maxX) {
    if (player.inputs.left) {
      player.velocity.x = -MOVE_SPEED;
    } else if (player.inputs.right) {
      player.velocity.x = MOVE_SPEED;
    } else {
      player.velocity.x = 0;
    }

    if (player.inputs.jump && player.y >= COURT_HEIGHT - player.height) {
      player.velocity.y = JUMP_VELOCITY;
      player.inputs.jump = false;
    }

    player.velocity.y += GRAVITY * dt;
    player.x += player.velocity.x * dt;
    player.y += player.velocity.y * dt;

    player.x = Math.max(minX, Math.min(maxX, player.x));
    player.y = Math.min(COURT_HEIGHT - player.height, player.y);
  }

  updateBall(dt) {
    this.ball.velocity.y += GRAVITY * dt;
    this.ball.x += this.ball.velocity.x * dt;
    this.ball.y += this.ball.velocity.y * dt;

    if (this.ball.x - this.ball.radius < 0) {
      this.ball.x = this.ball.radius;
      this.ball.velocity.x = -this.ball.velocity.x * 0.8;
    } else if (this.ball.x + this.ball.radius > COURT_WIDTH) {
      this.ball.x = COURT_WIDTH - this.ball.radius;
      this.ball.velocity.x = -this.ball.velocity.x * 0.8;
    }

    if (this.ball.y - this.ball.radius < 0) {
      this.ball.y = this.ball.radius;
      this.ball.velocity.y = -this.ball.velocity.y * 0.8;
    }

    if (this.checkCollision(
      this.ball.x - this.ball.radius, this.ball.y - this.ball.radius,
      this.ball.radius * 2, this.ball.radius * 2,
      this.net.x, this.net.y, this.net.width, this.net.height
    )) {
      if (this.ball.x < this.net.x) {
        this.ball.x = this.net.x - this.ball.radius;
      } else {
        this.ball.x = this.net.x + this.net.width + this.ball.radius;
      }
      this.ball.velocity.x = -this.ball.velocity.x * 0.8;
    }
  }

  checkCollision(x1, y1, w1, h1, x2, y2, w2, h2) {
    return x1 < x2 + w2 && x1 + w1 > x2 && y1 < y2 + h2 && y1 + h1 > y2;
  }

  checkPlayerBallCollisions() {
    [this.player1, this.player2].forEach((player, index) => {
      const dx = this.ball.x - (player.x + PLAYER_WIDTH / 2);
      const dy = this.ball.y - (player.y + PLAYER_HEIGHT / 2);
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < BALL_RADIUS + PLAYER_WIDTH / 2) {
        if (this.servingState.isServing && (index + 1) === this.servingState.servingPlayer) {
          this.servingState.isServing = false; // Start ball movement only on serving player's hit
        }
        const angle = Math.atan2(dy, dx);
        const speed = Math.sqrt(this.ball.velocity.x ** 2 + this.ball.velocity.y ** 2) || 10; // Default speed if still
        this.ball.velocity.x = Math.cos(angle) * speed * 1.2 + player.velocity.x * 0.5;
        this.ball.velocity.y = Math.sin(angle) * speed * 1.2 + player.velocity.y * 0.5;
        this.ball.x = player.x + PLAYER_WIDTH / 2 + Math.cos(angle) * (BALL_RADIUS + PLAYER_WIDTH / 2 + 1);
        this.ball.y = player.y + PLAYER_HEIGHT / 2 + Math.sin(angle) * (BALL_RADIUS + PLAYER_WIDTH / 2 + 1);
      }
    });
  }

  checkScoring() {
    if (this.ball.y + this.ball.radius >= COURT_HEIGHT) {
      if (this.ball.x < COURT_WIDTH / 2) {
        this.player2.score++;
        this.server = 2;
        this.broadcastScore();
      } else {
        this.player1.score++;
        this.server = 1;
        this.broadcastScore();
      }

      if (this.player1.score >= MAX_SCORE || this.player2.score >= MAX_SCORE) {
        this.endGame();
      } else {
        this.resetBall();
      }
    }
  }

  resetBall() {
    if (this.servingState.servingPlayer === 1) {
      this.ball.x = COURT_WIDTH / 4;
    } else {
      this.ball.x = COURT_WIDTH * 3/4;
    }
    this.ball.y = COURT_HEIGHT - (PLAYER_HEIGHT * 2 + BALL_RADIUS);
    this.ball.velocity = { x: 0, y: 0 };
    this.servingState = {
      isServing: true,
      servingPlayer: this.server
    };
  }

  endGame() {
    this.isGameActive = false;
    clearInterval(this.intervalId);
    io.to(this.id).emit('gameOver', {
      winner: this.player1.score > this.player2.score ? 1 : 2,
      finalScore: [this.player1.score, this.player2.score]
    });
    setTimeout(() => {
      activeSessions.delete(this.id);
    }, 5000);
  }

  broadcastGameState() {
    const state = {
      p1: { x: this.player1.x, y: this.player1.y },
      p2: { x: this.player2.x, y: this.player2.y },
      ball: { x: this.ball.x, y: this.ball.y, visible: true },
      serving: this.servingState.isServing
    };
    io.to(this.id).emit('gameStateUpdate', state);
  }

  broadcastScore() {
    io.to(this.id).emit('scoreUpdate', {
      score: [this.player1.score, this.player2.score]
    });
  }

  handlePlayerInput(playerId, inputData) {
    const player = this.player1.id === playerId ? this.player1 : this.player2;
    if (inputData.action === 'move') {
      player.inputs.left = inputData.direction === 'left';
      player.inputs.right = inputData.direction === 'right';
    } else if (inputData.action === 'jump') {
      player.inputs.jump = true;
    } else if (inputData.action === 'stop') {
      player.inputs.left = false;
      player.inputs.right = false;
    }
  }

  cleanup() {
    clearInterval(this.intervalId);
    this.isGameActive = false;
  }
}

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('disconnect', (reason) => {
    console.log(`Player ${socket.id} disconnected, reason: ${reason}`);

    const waitingIndex = waitingPlayers.indexOf(socket.id);
    if (waitingIndex !== -1) {
      waitingPlayers.splice(waitingIndex, 1);
      console.log(`Removed ${socket.id} from waiting queue`);
    }

    for (const [sessionId, session] of activeSessions.entries()) {
      if (session.player1.id === socket.id || session.player2.id === socket.id) {
        const otherPlayerId = session.player1.id === socket.id ? session.player2.id : session.player1.id;
        const otherPlayerSocket = io.sockets.sockets.get(otherPlayerId);
        if (otherPlayerSocket) {
          otherPlayerSocket.emit('opponentDisconnect', { reason: `Player ${socket.id} disconnected` });
          console.log(`Notified ${otherPlayerId} of opponent disconnect`);
        }
        session.cleanup();
        activeSessions.delete(sessionId);
        console.log(`Session ${sessionId} terminated due to disconnect`);
        break;
      }
    }
  });

  socket.on('findMatch', () => {
    if (!waitingPlayers.includes(socket.id)) {
      waitingPlayers.push(socket.id);
      console.log(`Player ${socket.id} added to waiting queue`);
    }

    if (waitingPlayers.length >= 2) {
      const player1Id = waitingPlayers.shift();
      const player2Id = waitingPlayers.shift();
      const session = new GameSession(player1Id, player2Id);
      activeSessions.set(session.id, session);

      const player1Socket = io.sockets.sockets.get(player1Id);
      const player2Socket = io.sockets.sockets.get(player2Id);

      if (player1Socket) {
        player1Socket.join(session.id);
        player1Socket.emit('matchFound', { sessionId: session.id, playerNum: 1 });
      }
      if (player2Socket) {
        player2Socket.join(session.id);
        player2Socket.emit('matchFound', { sessionId: session.id, playerNum: 2 });
      }
    }
  });

  socket.on('playerInput', (inputData) => {
    for (const session of activeSessions.values()) {
      if (session.player1.id === socket.id || session.player2.id === socket.id) {
        session.handlePlayerInput(socket.id, inputData);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});