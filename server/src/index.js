const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

// Game constants
const TICK_RATE = 30; // Updates per second
const COURT_WIDTH = 800;
const COURT_HEIGHT = 480;
const PLAYER_WIDTH = 65;
const PLAYER_HEIGHT = 65;
const BALL_RADIUS = 30;
const NET_WIDTH = 10;
const NET_HEIGHT = 225;
const GRAVITY = 0.5;
const JUMP_VELOCITY = -12;
const MOVE_SPEED = 10;
const MAX_SCORE = 11;
const SERVE_DELAY = 1000; // 1 second delay

// Setup Express
const app = express();
const server = http.createServer(app);

// Configure Socket.IO with CORS
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

// Serve static files
app.use(express.static(path.join(__dirname, '../../client/dist')));

// Health check route
app.get('/health', (req, res) => {
  res.status(200).send('Server is running');
});

// Fallback route for SPA
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, '../../client/dist/index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Pepe's Peckerball Server</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
          h1 { color: #333; }
        </style>
      </head>
      <body>
        <h1>Pepe's Peckerball Server is Running</h1>
        <p>The game server is operational and ready for WebSocket connections.</p>
      </body>
      </html>
    `);
  }
});

// Game state
const waitingPlayers = [];
const activeSessions = new Map();

// Game session class
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
      servingPlayer: 1,
      serveTimer: SERVE_DELAY
    };
    this.server = 1;
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
    const dt = Math.min(33, now - this.lastUpdateTime) / 16.67;
    this.lastUpdateTime = now;
    if (!this.isGameActive) return;

    this.updatePlayer(this.player1, dt, 0, COURT_WIDTH / 2 - PLAYER_WIDTH);
    this.updatePlayer(this.player2, dt, COURT_WIDTH / 2, COURT_WIDTH - PLAYER_WIDTH);

    if (this.servingState.isServing) {
      if (this.servingState.servingPlayer === 1) {
        this.ball.x = COURT_WIDTH / 4;
      } else {
        this.ball.x = COURT_WIDTH * 3/4;
      }
      this.ball.y = COURT_HEIGHT - (PLAYER_HEIGHT * 2 + BALL_RADIUS);
      this.ball.velocity = { x: 0, y: 0 };
      this.servingState.serveTimer -= dt * 16.67;
    } else {
      this.updateBall(dt);
    }

    this.checkPlayerBallCollisions();
    this.checkScoring();
    this.broadcastGameState();
  }

  checkPlayerBallCollisions() {
    if (this.checkCollision(
      this.ball.x - this.ball.radius, this.ball.y - this.ball.radius,
      this.ball.radius * 2, this.ball.radius * 2,
      this.player1.x, this.player1.y, this.player1.width, this.player1.height
    )) {
      this.handlePlayerBallCollision(this.player1);
    }
    if (this.checkCollision(
      this.ball.x - this.ball.radius, this.ball.y - this.ball.radius,
      this.ball.radius * 2, this.ball.radius * 2,
      this.player2.x, this.player2.y, this.player2.width, this.player2.height
    )) {
      this.handlePlayerBallCollision(this.player2);
    }
  }

  updateBall(dt) {
    this.ball.velocity.y += GRAVITY * dt;
    this.ball.x += this.ball.velocity.x * dt;
    this.ball.y += this.ball.velocity.y * dt;

    if (this.ball.x - this.ball.radius < 0) {
      this.ball.x = this.ball.radius;
      this.ball.velocity.x = -this.ball.velocity.x * 0.9;
    } else if (this.ball.x + this.ball.radius > COURT_WIDTH) {
      this.ball.x = COURT_WIDTH - this.ball.radius;
      this.ball.velocity.x = -this.ball.velocity.x * 0.9;
    }

    if (this.ball.y - this.ball.radius < 0) {
      this.ball.y = this.ball.radius;
      this.ball.velocity.y = -this.ball.velocity.y * 0.9;
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
      this.ball.velocity.x = -this.ball.velocity.x * 0.9;
    }
  }

  handlePlayerBallCollision(player) {
    if (this.servingState.isServing && this.servingState.serveTimer > 0) return;
    this.servingState.isServing = false;
    const hitPoint = (this.ball.x - (player.x + player.width / 2)) / (player.width / 2);
    if (this.ball.velocity.x === 0) {
      this.ball.velocity.x = (this.servingState.servingPlayer === 1 ? 1 : -1) * Math.abs(hitPoint * 10);
    } else {
      this.ball.velocity.x = hitPoint * 10;
    }
    this.ball.velocity.y = -10 - Math.abs(hitPoint * 4);
    this.ball.y = player.y - this.ball.radius;
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

  checkCollision(x1, y1, w1, h1, x2, y2, w2, h2) {
    return x1 < x2 + w2 && x1 + w1 > x2 && y1 < y2 + h2 && y1 + h1 > y2;
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
      servingPlayer: this.server,
      serveTimer: SERVE_DELAY
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
    const player1Socket = io.sockets.sockets.get(this.player1.id);
    const player2Socket = io.sockets.sockets.get(this.player2.id);
    const gameState = {
      p1: { x: this.player1.x, y: this.player1.y },
      p2: { x: this.player2.x, y: this.player2.y },
      ball: { x: this.ball.x, y: this.ball.y, visible: true },
      serving: this.servingState.isServing
    };
    if (player1Socket) player1Socket.emit('gameStateUpdate', gameState);
    if (player2Socket) player2Socket.emit('gameStateUpdate', gameState);
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
  }
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('disconnect', (reason) => {
    console.log(`Player disconnected: ${socket.id}, Reason: ${reason}`);

    const waitingIndex = waitingPlayers.indexOf(socket.id);
    if (waitingIndex !== -1) {
      waitingPlayers.splice(waitingIndex, 1);
    }

    for (const [sessionId, session] of activeSessions.entries()) {
      if (session.player1.id === socket.id || session.player2.id === socket.id) {
        const otherPlayerId = session.player1.id === socket.id ? session.player2.id : session.player1.id;
        io.to(otherPlayerId).emit('opponentDisconnect');
        session.cleanup();
        activeSessions.delete(sessionId);
        console.log(`Session ${sessionId} cleaned up due to disconnect`);
        break;
      }
    }

    socket.emit('disconnected', { reason });
  });

  socket.on('findMatch', () => {
    if (!waitingPlayers.includes(socket.id)) {
      waitingPlayers.push(socket.id);
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

// Start the server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});