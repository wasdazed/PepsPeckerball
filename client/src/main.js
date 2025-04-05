import { io } from 'socket.io-client';
import * as THREE from 'three';

// Game constants (match server)
const COURT_WIDTH = 800;
const COURT_HEIGHT = 480;
const PLAYER_WIDTH = 65;
const PLAYER_HEIGHT = 65;
const BALL_RADIUS = 30;
const NET_WIDTH = 10;
const NET_HEIGHT = 225;
const GROUND_HEIGHT = 15;

//const SERVER_URL = 'http://localhost:3001';
const SERVER_URL = 'pepspeckerball-production.up.railway.app'; // Replace with your production server URL

// Socket.IO connection
console.log('Setting up Socket.IO connection to:', SERVER_URL);
const socket = io(SERVER_URL, {
  withCredentials: true,
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000
});

// Track reconnection attempts manually
let reconnectAttempts = 0;

socket.on('connect', () => {
  console.log('Connected to server with socket ID:', socket.id);
  reconnectAttempts = 0;
  if (!document.getElementById('waiting-screen').classList.contains('hidden')) {
    console.log('Reconnected while waiting, re-emitting findMatch');
    socket.emit('findMatch');
  }
});

socket.on('connect_error', (error) => {
  console.error('Connection error:', error.message);
});

socket.on('disconnect', (reason) => {
  console.log('Disconnected from server:', reason);
});

socket.on('reconnect', (attemptNumber) => {
  console.log(`Reconnected after ${attemptNumber} attempts`);
  reconnectAttempts = 0;
});

socket.io.on('reconnect_attempt', () => {
  reconnectAttempts++;
  console.log(`Reconnect attempt #${reconnectAttempts}`);
  if (reconnectAttempts >= 5) {
    console.error('Reconnection failed after 5 attempts (manual detection)');
    alert('Unable to reconnect to the server. Please refresh the page.');
    gameActive = false;
    reconnectAttempts = 0;
  }
});

socket.io.on('reconnect_error', (error) => {
  console.error('Reconnect error:', error.message);
});

// Game state
let playerNum = 0;
let sessionId = null;
let gameActive = false;
let score = [0, 0];

// Interpolation state
const SERVER_TICK_RATE = 30; // Matches server TICK_RATE (test 60 if you want)
const SERVER_TICK_MS = 1000 / SERVER_TICK_RATE; // ~33.33ms at 30Hz
let previousState = null;
let currentState = null;
let interpolationTime = 0;

// DOM elements
const menuScreen = document.getElementById('menu-screen');
const waitingScreen = document.getElementById('waiting-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const scoreDisplay = document.getElementById('score-display');
const player1ScoreElem = document.getElementById('player1-score');
const player2ScoreElem = document.getElementById('player2-score');
const winnerTextElem = document.getElementById('winner-text');
const finalScoreElem = document.getElementById('final-score');
const findMatchBtn = document.getElementById('find-match-btn');
const playAgainBtn = document.getElementById('play-again-btn');

// Three.js setup
const canvas = document.getElementById('gameCanvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(COURT_WIDTH, COURT_HEIGHT);
renderer.setClearColor(0x87CEEB);

const gameContainer = document.getElementById('game-container');
gameContainer.appendChild(canvas);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(0, COURT_WIDTH, 0, COURT_HEIGHT, 1, 1000);
camera.position.z = 100;

const player1 = createPlayer(0x7777ff);
const player2 = createPlayer(0xff7777);
const ball = createBall();
const net = createNet();
const court = createCourt();

player1.position.set(COURT_WIDTH / 4, COURT_HEIGHT - PLAYER_HEIGHT, 5);
player2.position.set(COURT_WIDTH * 3/4, COURT_HEIGHT - PLAYER_HEIGHT, 5);
ball.position.set(COURT_WIDTH / 4, COURT_HEIGHT - PLAYER_HEIGHT - PLAYER_HEIGHT - BALL_RADIUS, 6);
net.position.set(COURT_WIDTH / 2, COURT_HEIGHT - NET_HEIGHT / 2, 5);

scene.add(court);
scene.add(net);
scene.add(player1);
scene.add(player2);
scene.add(ball);

const keyState = { left: false, right: false, jump: false };

function createPlayer(color) {
  const geometry = new THREE.CircleGeometry(PLAYER_WIDTH / 2, 32);
  const material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
  return new THREE.Mesh(geometry, material);
}

function createBall() {
  const geometry = new THREE.CircleGeometry(BALL_RADIUS, 32);
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  return new THREE.Mesh(geometry, material);
}

function createNet() {
  const geometry = new THREE.BoxGeometry(NET_WIDTH, NET_HEIGHT, 10);
  const material = new THREE.MeshBasicMaterial({ color: 0xcccccc, side: THREE.DoubleSide });
  return new THREE.Mesh(geometry, material);
}

function createCourt() {
  const groundGeometry = new THREE.BoxGeometry(COURT_WIDTH, GROUND_HEIGHT, 20);
  const groundMaterial = new THREE.MeshBasicMaterial({ color: 0x008800, side: THREE.DoubleSide });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.position.set(COURT_WIDTH / 2, COURT_HEIGHT - GROUND_HEIGHT * 2, 0);

  const leftWallGeometry = new THREE.BoxGeometry(20, COURT_HEIGHT, 20);
  const wallMaterial = new THREE.MeshBasicMaterial({ color: 0x888888, side: THREE.DoubleSide });
  const leftWall = new THREE.Mesh(leftWallGeometry, wallMaterial);
  leftWall.position.set(-10, COURT_HEIGHT / 2, 0);

  const rightWallGeometry = new THREE.BoxGeometry(20, COURT_HEIGHT, 20);
  const rightWall = new THREE.Mesh(rightWallGeometry, wallMaterial);
  rightWall.position.set(COURT_WIDTH + 10, COURT_HEIGHT / 2, 0);

  const ceilingGeometry = new THREE.BoxGeometry(COURT_WIDTH, 20, 20);
  const ceilingMaterial = new THREE.MeshBasicMaterial({ color: 0x888888, side: THREE.DoubleSide });
  const ceiling = new THREE.Mesh(ceilingGeometry, ceilingMaterial);
  ceiling.position.set(COURT_WIDTH / 2, -20, 0);

  const court = new THREE.Group();
  court.add(ground);
  court.add(leftWall);
  court.add(rightWall);
  court.add(ceiling);
  return court;
}

let lastFrameTime = performance.now();

function animate() {
  const now = performance.now();
  const deltaTime = (now - lastFrameTime) / 1000; // Seconds
  lastFrameTime = now;

  requestAnimationFrame(animate);

  if (gameActive) {
    if (previousState && currentState) {
      interpolationTime += deltaTime * 1000; // ms
      const alpha = Math.min(interpolationTime / SERVER_TICK_MS, 1); // 0 to 1

      // Interpolate Player 1
      const p1X = lerp(previousState.p1.x + PLAYER_WIDTH / 2, currentState.p1.x + PLAYER_WIDTH / 2, alpha);
      const p1Y = lerp(previousState.p1.y, currentState.p1.y, alpha);
      player1.position.x = p1X;
      player1.position.y = p1Y;

      // Interpolate Player 2
      const p2X = lerp(previousState.p2.x + PLAYER_WIDTH / 2, currentState.p2.x + PLAYER_WIDTH / 2, alpha);
      const p2Y = lerp(previousState.p2.y, currentState.p2.y, alpha);
      player2.position.x = p2X;
      player2.position.y = p2Y;

      // Interpolate Ball
      if (currentState.serving) {
        ball.position.x = currentState.ball.x;
        ball.position.y = currentState.ball.y;
      } else {
        const ballX = lerp(previousState.ball.x, currentState.ball.x, alpha);
        const ballY = lerp(previousState.ball.y, currentState.ball.y, alpha);
        ball.position.x = ballX;
        ball.position.y = ballY;
      }
      ball.visible = currentState.ball.visible;

      // Reset interpolation when fully caught up
      if (alpha >= 1) {
        interpolationTime -= SERVER_TICK_MS; // Carry over excess time
      }
    } else if (currentState) {
      // First update: Snap to position
      player1.position.x = currentState.p1.x + PLAYER_WIDTH / 2;
      player1.position.y = currentState.p1.y;
      player2.position.x = currentState.p2.x + PLAYER_WIDTH / 2;
      player2.position.y = currentState.p2.y;
      ball.position.x = currentState.ball.x;
      ball.position.y = currentState.ball.y;
      ball.visible = currentState.ball.visible;
    }
  }

  renderer.render(scene, camera);
}

function lerp(start, end, alpha) {
  return start + (end - start) * alpha;
}

animate();

menuScreen.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
waitingScreen.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
gameOverScreen.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';

socket.on('matchFound', (data) => {
  sessionId = data.sessionId;
  playerNum = data.playerNum;
  gameActive = true;
  waitingScreen.classList.add('hidden');
  scoreDisplay.classList.remove('hidden');
  score = [0, 0];
  updateScoreDisplay();
  previousState = null;
  currentState = null;
  interpolationTime = 0;
});

socket.on('gameStateUpdate', (state) => {
  previousState = currentState || state; // Use currentState if available, else state
  currentState = state;
  interpolationTime = 0;
});

socket.on('scoreUpdate', (data) => {
  score = data.score;
  updateScoreDisplay();
});

socket.on('gameOver', (data) => {
  gameActive = false;
  gameOverScreen.classList.remove('hidden');
  scoreDisplay.classList.add('hidden');
  winnerTextElem.textContent = `Player ${data.winner} wins!`;
  finalScoreElem.textContent = `Final Score: ${data.finalScore[0]} - ${data.finalScore[1]}`;
  if ((playerNum === 1 && data.winner === 1) || (playerNum === 2 && data.winner === 2)) {
    winnerTextElem.textContent += ' (You win!)';
  } else {
    winnerTextElem.textContent += ' (You lose!)';
  }
});

socket.on('opponentDisconnect', (data) => {
  gameActive = false;
  waitingScreen.classList.add('hidden');
  gameOverScreen.classList.add('hidden');
  scoreDisplay.classList.add('hidden');
  menuScreen.classList.remove('hidden');
  score = [0, 0];
  playerNum = 0;
  sessionId = null;
  console.log('Opponent disconnected:', data.reason);
});

function handleKeyDown(e) {
  if (!gameActive) return;
  switch (e.key) {
    case 'ArrowLeft':
      if (!keyState.left) {
        keyState.left = true;
        socket.emit('playerInput', { action: 'move', direction: 'left' });
      }
      break;
    case 'ArrowRight':
      if (!keyState.right) {
        keyState.right = true;
        socket.emit('playerInput', { action: 'move', direction: 'right' });
      }
      break;
    case ' ':
      e.preventDefault();
      if (!keyState.jump) {
        keyState.jump = true;
        socket.emit('playerInput', { action: 'jump' });
      }
      break;
  }
}

function handleKeyUp(e) {
  if (!gameActive) return;
  switch (e.key) {
    case 'ArrowLeft':
      keyState.left = false;
      if (keyState.right) {
        socket.emit('playerInput', { action: 'move', direction: 'right' });
      } else {
        socket.emit('playerInput', { action: 'stop' });
      }
      break;
    case 'ArrowRight':
      keyState.right = false;
      if (keyState.left) {
        socket.emit('playerInput', { action: 'move', direction: 'left' });
      } else {
        socket.emit('playerInput', { action: 'stop' });
      }
      break;
    case ' ':
      keyState.jump = false;
      break;
  }
}

function updateScoreDisplay() {
  player1ScoreElem.textContent = score[0];
  player2ScoreElem.textContent = score[1];
}

findMatchBtn.addEventListener('click', () => {
  menuScreen.classList.add('hidden');
  waitingScreen.classList.remove('hidden');
  socket.emit('findMatch');
});

playAgainBtn.addEventListener('click', () => {
  gameOverScreen.classList.add('hidden');
  menuScreen.classList.remove('hidden');
});

window.addEventListener('keydown', handleKeyDown);
window.addEventListener('keyup', handleKeyUp);

animate();