# Multiplayer Arcade Volleyball Clone - Whitepaper

## 1. Introduction

This document outlines the design and implementation plan for a real-time multiplayer web game, a clone of the classic "Arcade Volleyball". The game will feature matchmaking to pair players for 1:1 sessions and will utilize Three.js for 3D rendering.

## 2. Goals

*   Create a functional clone of Arcade Volleyball gameplay.
*   Implement real-time multiplayer functionality for 1:1 matches.
*   Include a simple matchmaking system to pair waiting players.
*   Utilize web technologies, primarily Three.js for the client and Node.js for the server.
*   Ensure smooth gameplay through efficient state synchronization.

## 3. Technology Stack

*   **Client-Side (Frontend):**
    *   **Rendering:** Three.js (for 3D graphics)
    *   **Language:** JavaScript (ES6+)
    *   **UI:** HTML5, CSS3 (for menus, scores, etc.)
    *   **Communication:** WebSocket API (likely via Socket.IO client library)
*   **Server-Side (Backend):**
    *   **Runtime:** Node.js
    *   **Framework:** Express.js (for handling HTTP requests, serving static files)
    *   **Real-time Communication:** Socket.IO (for WebSocket management, rooms, and event handling)
*   **Physics:** Custom lightweight physics logic (Arcade Volleyball physics are simple enough not to require a full engine like Cannon.js initially).

## 4. System Architecture

The system follows a client-server architecture.

*   **Client:**
    *   Connects to the server via WebSocket.
    *   Renders the game world (court, players, ball) using Three.js based on state received from the server.
    *   Captures user input (keyboard events for movement/jump).
    *   Sends user input actions to the server.
    *   Displays UI elements (score, connection status, menus).
*   **Server:**
    *   Manages WebSocket connections from clients.
    *   Handles the matchmaking queue.
    *   Creates and manages distinct game sessions (rooms) for each pair of players.
    *   Runs the authoritative game simulation for each session:
        *   Processes player inputs.
        *   Updates player positions.
        *   Calculates ball physics (movement, collisions).
        *   Detects scoring conditions.
        *   Maintains the game state (scores, positions).
    *   Broadcasts game state updates to the relevant clients in each session at a regular tick rate (e.g., 30-60Hz).
    *   Validates client inputs to prevent cheating (basic validation).

## 5. Matchmaking Flow

1.  A client connects to the server via WebSocket upon loading the game.
2.  The client sends a "find match" request.
3.  The server adds the client (and their socket ID) to a waiting queue.
4.  If the queue contains two or more players, the server:
    *   Picks two players from the queue.
    *   Creates a unique game session ID (room name).
    *   Assigns each player to a side (e.g., Player 1, Player 2).
    *   Adds both players' sockets to the corresponding Socket.IO room.
    *   Initializes the game state for that session on the server.
    *   Sends a "match found" event to both clients, including the session ID and their assigned player number.
5.  Clients receive the "match found" event and transition to the game screen.

## 6. Game Session Management

*   Each active 1:1 game runs within a dedicated Socket.IO room on the server.
*   The server maintains a data structure (e.g., a Map or Object) mapping session IDs to their respective game states.
*   The game state includes:
    *   Player 1 position & velocity
    *   Player 2 position & velocity
    *   Ball position & velocity
    *   Score
    *   Current server (who serves the ball)
*   A server-side game loop runs for each active session, updating the state based on elapsed time and player inputs.
*   When a game ends (score limit reached), the server notifies clients, updates player stats (if any), and cleans up the session data.
*   Disconnections are handled by notifying the remaining player and potentially ending the match.

## 7. Game Logic & Physics

*   **Representation:** Although rendered in 3D, the core gameplay logic operates on a 2D plane. An orthographic camera in Three.js might be suitable for the classic feel.
*   **Court:** Defined boundaries (walls, floor, net).
*   **Players:** Simple shapes (e.g., spheres or capsules) constrained to their side of the court. Movement is typically horizontal, plus a jump.
*   **Ball:** Subject to gravity. Collision detection with players, net, walls, and floor. Basic reflection physics upon collision.
*   **Scoring:** A point is awarded when the ball hits the floor on the opponent's side or if the opponent fails to return the ball over the net within rules.
*   **Input:** Keyboard controls for left/right movement and jump/hit.

## 8. Real-time Communication Protocol (WebSocket Events)

*   **Client -> Server:**
    *   `connect`: Initial connection.
    *   `findMatch`: Player requests to join the matchmaking queue.
    *   `playerInput`: Sends player actions (e.g., `{ action: 'move', direction: 'left' }`, `{ action: 'jump' }`).
    *   `disconnect`: Client disconnects.
*   **Server -> Client:**
    *   `connect`: Acknowledgment of connection.
    *   `matchFound`: Notifies clients they've been paired (`{ sessionId: '...', playerNum: 1 }`).
    *   `gameStateUpdate`: Broadcasts the current state of the game within a room (`{ p1Pos, p2Pos, ballPos, score }`).
    *   `scoreUpdate`: Sent when a point is scored (`{ score: [p1Score, p2Score] }`).
    *   `gameOver`: Indicates the game has ended (`{ winner: 1 }`).
    *   `opponentDisconnect`: Notifies a player if their opponent disconnects.

## 9. Client-Side (Three.js) Implementation Details

*   **Scene Setup:** Create a `Scene`, `Camera` (likely `OrthographicCamera`), `Renderer` (`WebGLRenderer`).
*   **Assets:** Create `Geometry` and `Material` for the court, net, players (e.g., `SphereGeometry`), and ball (`SphereGeometry`). Add these as `Mesh` objects to the scene.
*   **Rendering Loop:** Use `requestAnimationFrame` to continuously render the scene.
*   **State Synchronization:** On receiving `gameStateUpdate` from the server, smoothly interpolate the positions of players and the ball towards the received state to avoid jittery movement (instead of directly setting positions).
*   **Input Handling:** Add event listeners for keyboard input. Send corresponding actions to the server via WebSocket.

## 10. Deployment Considerations (Optional)

*   Server hosting (e.g., Heroku, AWS EC2, DigitalOcean).
*   Client-side static file hosting (e.g., Netlify, Vercel, GitHub Pages, or served by the Node.js server).
*   WebSocket connection scaling (considerations for >100 concurrent users, though likely not needed initially).

## 11. Future Enhancements (Optional)

*   Improved graphics/animations.
*   Sound effects.
*   Player customization.
*   Ranked matchmaking / Elo system.
*   Spectator mode.
*   Different game modes or courts.
