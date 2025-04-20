# Peps Peckerball - Multiplayer Game

A simple 2D clone of Arcade Volleyball with real-time multiplayer functionality, matchmaking, and multiple 1:1 sessions running simultaneously.

## Features

- Real-time multiplayer gameplay
- Matchmaking system to pair players
- Multiple game sessions running simultaneously
- Simple physics-based gameplay
- Score tracking and game end conditions

## Technology Stack

- **Client:** Three.js, Socket.IO client
- **Server:** Node.js, Express, Socket.IO
- **Build Tools:** Vite

## How to Run

### Install Dependencies

```bash
# Install root dependencies
npm install

# Install client and server dependencies
npm run install:all
```

### Run the Game

#### Development Mode (runs both client and server)

```bash
npm run dev
```

#### Run Server Only

```bash
npm run start:server
```

#### Run Client Only

```bash
npm run start:client
```

## Game Controls

- **Left/Right Arrow Keys:** Move left/right
- **Spacebar:** Jump

## How to Play

1. Click "Find Match" to enter the matchmaking queue
2. Once another player joins, the game will automatically start
3. Use the arrow keys to move and spacebar to jump
4. Hit the ball with your player to send it over the net
5. Score points when the ball hits the ground on your opponent's side
6. First player to 11 points wins

## Architecture

The game uses a client-server architecture with authoritative server-side physics. The server maintains the game state and sends updates to the clients, while clients send input events to the server.

For more details about the implementation, see the [whitepaper](whitepaper.md). 
