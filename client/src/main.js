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

// const SERVER_URL = 'http://localhost:3001';
const SERVER_URL = 'https://pepspeckerball-production.up.railway.app'; // Use this for production

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
  reconnectAttempts = 0; // Reset on successful connect
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
  reconnectAttempts = 0; // Reset on successful reconnect
});

// Use socket.io for lower-level events
socket.io.on('reconnect_attempt', () => {
  reconnectAttempts++;
  console.log(`Reconnect attempt #${reconnectAttempts}`);
  if (reconnectAttempts >= 5) {
    console.error('Reconnection failed after 5 attempts (manual detection)');
    alert('Unable to reconnect to the server. Please refresh the page.');
    gameActive = false;
    reconnectAttempts = 0; // Reset to avoid repeated alerts
  }
});

socket.io.on('reconnect_error', (error) => {
  console.error('Reconnect error:', error.message);
});

// Remove unreliable native 'reconnect_failed' handler since it’s not firing
// socket.on('reconnect_failed', ...) removed

// Game state
let playerNum = 0;
let sessionId = null;
let gameActive = false;
let score = [0, 0];

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
const networkState = {
  p1: { x: 50, y: COURT_HEIGHT - PLAYER_HEIGHT },
  p2: { x: COURT_WIDTH - PLAYER_WIDTH - 50, y: COURT_HEIGHT - PLAYER_HEIGHT },
  ball: { x: 50 + PLAYER_WIDTH / 2, y: COURT_HEIGHT - (2 * PLAYER_HEIGHT), visible: true },
  serving: true
};

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

function animate() {
  requestAnimationFrame(animate);
  if (gameActive) {
    const speedFactor = 0.8;
    const targetP1X = networkState.p1.x + PLAYER_WIDTH / 2;
    const targetP1Y = networkState.p1.y;
    const targetP2X = networkState.p2.x + PLAYER_WIDTH / 2;
    const targetP2Y = networkState.p2.y;
    const targetBallX = networkState.ball.x;
    const targetBallY = networkState.ball.y;

    player1.position.x += (targetP1X - player1.position.x) * 0.3 * speedFactor;
    player1.position.y += (targetP1Y - player1.position.y) * 0.3 * speedFactor;
    player2.position.x += (targetP2X - player2.position.x) * 0.3 * speedFactor;
    player2.position.y += (targetP2Y - player2.position.y) * 0.3 * speedFactor;

    if (networkState.serving) {
      ball.position.x = targetBallX;
      ball.position.y = targetBallY;
    } else {
      ball.position.x += (targetBallX - ball.position.x) * 0.3 * speedFactor;
      ball.position.y += (targetBallY - ball.position.y) * 0.3 * speedFactor;
    }
    ball.visible = networkState.ball.visible;
  }
  renderer.render(scene, camera);
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
});

socket.on('gameStateUpdate', (state) => {
  networkState.p1.x = state.p1.x;
  networkState.p1.y = state.p1.y;
  networkState.p2.x = state.p2.x;
  networkState.p2.y = state.p2.y;
  networkState.ball.x = state.ball.x;
  networkState.ball.y = state.ball.y;
  networkState.ball.visible = state.ball.visible;
  networkState.serving = state.serving;
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

socket.on('opponentDisconnect', () => {
  gameActive = false;
  waitingScreen.classList.add('hidden');
  gameOverScreen.classList.add('hidden');
  scoreDisplay.classList.add('hidden');
  menuScreen.classList.remove('hidden');
  score = [0, 0];
  playerNum = 0;
  sessionId = null;
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