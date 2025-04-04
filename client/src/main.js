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

// Determine the server URL
const SERVER_URL = 'https://pepspeckerball-production.up.railway.app';

// Socket.IO connection
console.log('Setting up Socket.IO connection to:', SERVER_URL);
const socket = io(SERVER_URL, {
  withCredentials: true,
  transports: ['websocket', 'polling'],
  reconnectionAttempts: 5,
  reconnectionDelay: 1000
});

socket.on('connect', () => {
  console.log('Connected to server with socket ID:', socket.id);
  console.log('Transport used:', socket.io.engine.transport.name);
  
  socket.io.engine.on('upgrade', (transport) => {
    console.log('Transport upgraded to:', transport.name);
  });
  
  if (document.getElementById('waiting-screen').classList.contains('visible') || 
      !document.getElementById('waiting-screen').classList.contains('hidden')) {
    console.log('Reconnected while waiting for match, re-emitting findMatch');
    socket.emit('findMatch');
  }
});

socket.on('connect_error', (error) => {
  console.error('Socket connection error:', error.message);
  console.error('Error details:', error);
  if (error.message === 'xhr poll error') {
    console.log('Polling failed - likely due to server not serving /socket.io/ or CORS misconfiguration');
  }
});

socket.on('disconnect', (reason) => {
  console.log('Disconnected from server:', reason);
});

socket.on('reconnect', (attemptNumber) => {
  console.log(`Reconnected to server after ${attemptNumber} attempts`);
});

socket.on('reconnect_attempt', (attemptNumber) => {
  console.log(`Reconnection attempt #${attemptNumber}`);
});

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

const camera = new THREE.OrthographicCamera(
  0, COURT_WIDTH, 0, COURT_HEIGHT, 1, 1000
);
camera.position.z = 100;

console.log('Creating game objects...');
const player1 = createPlayer(0x7777ff);
const player2 = createPlayer(0xff7777);
const ball = createBall();
const net = createNet();
const court = createCourt();

player1.position.set(COURT_WIDTH / 4, COURT_HEIGHT - PLAYER_HEIGHT, 5);
player2.position.set(COURT_WIDTH * 3/4, COURT_HEIGHT - PLAYER_HEIGHT, 5);
ball.position.set(COURT_WIDTH / 4, COURT_HEIGHT - PLAYER_HEIGHT - PLAYER_HEIGHT - BALL_RADIUS, 6);
net.position.set(COURT_WIDTH / 2, COURT_HEIGHT - NET_HEIGHT / 2, 5);

console.log('Adding objects to scene...');
scene.add(court);
scene.add(net);
scene.add(player1);
scene.add(player2);
scene.add(ball);

const keyState = {
  left: false,
  right: false,
  jump: false
};

const networkState = {
  p1: { x: 50, y: COURT_HEIGHT - PLAYER_HEIGHT },
  p2: { x: COURT_WIDTH - PLAYER_WIDTH - 50, y: COURT_HEIGHT - PLAYER_HEIGHT },
  ball: { x: 50 + PLAYER_WIDTH / 2, y: COURT_HEIGHT - (2 * PLAYER_HEIGHT), visible: true },
  serving: true
};

function createPlayer(color) {
  const geometry = new THREE.CircleGeometry(PLAYER_WIDTH / 2, 32);
  const material = new THREE.MeshBasicMaterial({ 
    color,
    side: THREE.DoubleSide
  });
  return new THREE.Mesh(geometry, material);
}

function createBall() {
  const geometry = new THREE.CircleGeometry(BALL_RADIUS, 32);
  const material = new THREE.MeshBasicMaterial({ 
    color: 0xffffff,
    side: THREE.DoubleSide
  });
  return new THREE.Mesh(geometry, material);
}

function createNet() {
  const geometry = new THREE.BoxGeometry(NET_WIDTH, NET_HEIGHT, 10);
  const material = new THREE.MeshBasicMaterial({ 
    color: 0xcccccc,
    side: THREE.DoubleSide
  });
  const net = new THREE.Mesh(geometry, material);
  return net;
}

function createCourt() {
  const groundGeometry = new THREE.BoxGeometry(COURT_WIDTH, GROUND_HEIGHT, 20);
  const groundMaterial = new THREE.MeshBasicMaterial({ 
    color: 0x008800,
    side: THREE.DoubleSide
  });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.position.set(COURT_WIDTH / 2, COURT_HEIGHT - GROUND_HEIGHT *2, 0);

  const leftWallGeometry = new THREE.BoxGeometry(20, COURT_HEIGHT, 20);
  const wallMaterial = new THREE.MeshBasicMaterial({ 
    color: 0x888888,
    side: THREE.DoubleSide
  });
  const leftWall = new THREE.Mesh(leftWallGeometry, wallMaterial);
  leftWall.position.set(-10, COURT_HEIGHT / 2, 0);

  const rightWallGeometry = new THREE.BoxGeometry(20, COURT_HEIGHT, 20);
  const rightWall = new THREE.Mesh(rightWallGeometry, wallMaterial);
  rightWall.position.set(COURT_WIDTH + 10, COURT_HEIGHT / 2, 0);

  const ceilingGeometry = new THREE.BoxGeometry(COURT_WIDTH, 20, 20);
  const ceilingMaterial = new THREE.MeshBasicMaterial({ 
    color: 0x888888,
    side: THREE.DoubleSide
  });
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
    const lerpFactor = 0.2;
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

console.log('Game objects created:', {
  player1: player1.position,
  player2: player2.position,
  ball: ball.position,
  net: net.position,
  court: court.position
});

console.log('Rendering scene...');
renderer.render(scene, camera);

console.log('Canvas size:', {
  width: canvas.width,
  height: canvas.height,
  styleWidth: canvas.style.width,
  styleHeight: canvas.style.height
});

console.log('Game container:', {
  exists: !!gameContainer,
  width: gameContainer.offsetWidth,
  height: gameContainer.offsetHeight
});

socket.on('matchFound', (data) => {
  console.log('Match found with data:', data);
  sessionId = data.sessionId;
  playerNum = data.playerNum;
  gameActive = true;
  waitingScreen.classList.add('hidden');
  scoreDisplay.classList.remove('hidden');
  score = [0, 0];
  updateScoreDisplay();
  console.log('Game is now active, player number:', playerNum);
});

socket.on('gameStateUpdate', (state) => {
  if (Math.random() < 0.02) {
    console.log('Game state update:', {
      p1: { x: state.p1.x.toFixed(2), y: state.p1.y.toFixed(2) },
      p2: { x: state.p2.x.toFixed(2), y: state.p2.y.toFixed(2) },
      ball: { 
        x: state.ball.x.toFixed(2), 
        y: state.ball.y.toFixed(2),
        visible: state.ball.visible
      },
      serving: state.serving
    });
  }
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
  console.log(`Key down: ${e.key}`);
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
  console.log(`Key up: ${e.key}`);
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
  console.log('Find Match button clicked, emitting findMatch event');
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