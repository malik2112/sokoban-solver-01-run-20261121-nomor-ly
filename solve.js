// Sokoban solver for make.fun hallway-and-rooms levels (nomor-ly entry).
//
// Every generated level is one straight hallway with small rooms opening
// off it. A crate pushed out of its room into the hallway can never be
// pushed back, so crates never leave their room and the level optimum
// P* is the sum of the room optima. This solver therefore locates the
// rooms, solves each one separately with a breadth-first search over
// pushes (push-optimal by construction), and joins the room answers
// with plain walks through the hallway. A board that does not split
// into rooms falls back to one global push search.
//
// Two sound prunings keep the searches small: dead squares (a crate
// there can never reach any goal, found by pulling crates backwards
// from the goals) and frozen 2x2 blocks of walls and crates that trap
// a crate off its goal. Work is budgeted in searched states, never in
// seconds, and every tie breaks in one fixed order, so repeated runs
// produce identical output bytes.

const MOVES = [
  { dx: -1, dy: 0, walk: 'l', push: 'L' },
  { dx: 1, dy: 0, walk: 'r', push: 'R' },
  { dx: 0, dy: -1, walk: 'u', push: 'U' },
  { dx: 0, dy: 1, walk: 'd', push: 'D' },
];

const ROOM_BUDGET = 450000;
const GLOBAL_BUDGET = 1100000;

/** Parse XSB text into a flat board. Cells are indexed y * width + x. */
export function loadBoard(text) {
  const lines = String(text).split('\n').filter((line) => line.length > 0);
  const height = lines.length;
  const width = lines.reduce((m, line) => Math.max(m, line.length), 0);
  const wall = new Uint8Array(width * height).fill(1);
  const goals = [];
  const boxes = [];
  let player = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < lines[y].length; x++) {
      const ch = lines[y][x];
      if (ch === '#') continue;
      const cell = y * width + x;
      wall[cell] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(cell);
      if (ch === '$' || ch === '*') boxes.push(cell);
      if (ch === '@' || ch === '+') player = cell;
    }
  }
  for (let x = 0; x < width; x++) {
    wall[x] = 1;
    wall[(height - 1) * width + x] = 1;
  }
  for (let y = 0; y < height; y++) {
    wall[y * width] = 1;
    wall[y * width + width - 1] = 1;
  }
  boxes.sort((a, b) => a - b);
  goals.sort((a, b) => a - b);
  return { width, height, wall, goals, boxes, player };
}

/**
 * Mark every cell from which a single crate could still be pushed onto
 * a goal. Work backwards from the goals: a cell is live when the crate
 * can be pushed from it onto a live cell with room for the player
 * behind it. Crates on dead cells can never finish, so pushes onto
 * them are pruned.
 */
function pullbackLive(board) {
  const { width, wall, goals } = board;
  const live = new Uint8Array(wall.length);
  const queue = [];
  for (const goal of goals) {
    live[goal] = 1;
    queue.push(goal);
  }
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head];
    for (const step of MOVES) {
      const delta = step.dy * width + step.dx;
      const from = cell - delta;
      const stand = from - delta;
      if (from < 0 || stand < 0 || from >= wall.length || stand >= wall.length) continue;
      if (wall[from] || wall[stand] || live[from]) continue;
      live[from] = 1;
      queue.push(from);
    }
  }
  return live;
}

/** Flood the cells the player can walk to; returns the smallest cell id. */
function walkReach(board, blocked, start) {
  const { width, wall } = board;
  const seen = new Uint8Array(wall.length);
  const stack = [start];
  seen[start] = 1;
  let low = start;
  while (stack.length > 0) {
    const cell = stack.pop();
    if (cell < low) low = cell;
    const neighbours = [cell - width, cell + width, cell - 1, cell + 1];
    for (const next of neighbours) {
      if (next < 0 || next >= wall.length) continue;
      if (wall[next] || blocked[next] || seen[next]) continue;
      seen[next] = 1;
      stack.push(next);
    }
  }
  return { low, seen };
}

/** Shortest walk string between two cells, or null when unreachable. */
function routeWalk(board, blocked, from, to) {
  const { width, wall } = board;
  if (from === to) return '';
  const prev = new Int32Array(wall.length).fill(-1);
  const letter = new Array(wall.length).fill('');
  const queue = [from];
  prev[from] = from;
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head];
    if (cell === to) break;
    for (const step of MOVES) {
      const next = cell + step.dy * width + step.dx;
      if (next < 0 || next >= wall.length) continue;
      if (wall[next] || blocked[next] || prev[next] !== -1) continue;
      prev[next] = cell;
      letter[next] = step.walk;
      queue.push(next);
    }
  }
  if (prev[to] === -1) return null;
  let path = '';
  for (let cell = to; cell !== from; cell = prev[cell]) path = letter[cell] + path;
  return path;
}

/**
 * True when the crate just pushed onto `target` locks a 2x2 block of
 * walls and crates while some crate in the block sits off its goal.
 * Such a block can never move again, so the push is a dead end.
 */
function squareFrozen(board, blocked, onGoal, target) {
  const { width, wall } = board;
  const corners = [target, target - 1, target - width, target - width - 1];
  for (const topLeft of corners) {
    if (topLeft < 0) continue;
    const cells = [topLeft, topLeft + 1, topLeft + width, topLeft + width + 1];
    if (cells[3] >= wall.length) continue;
    if (!cells.every((c) => wall[c] || blocked[c])) continue;
    if (cells.some((c) => blocked[c] && !onGoal[c])) return true;
  }
  return false;
}

/**
 * Breadth-first search over pushes for one board. A state is the sorted
 * crate cells plus the player's reachable region reduced to its lowest
 * cell, which keeps equivalent positions merged. Because states expand
 * in push order, the first solved state found uses the fewest pushes.
 * Returns { pushes, moves } or null when the state budget runs out.
 */
function bfsPush(board, budget) {
  const { width, wall, goals } = board;
  const size = wall.length;
  const onGoal = new Uint8Array(size);
  for (const goal of goals) onGoal[goal] = 1;
  const live = pullbackLive(board);
  if (board.boxes.some((box) => !live[box])) return null;
  const solved = (boxes) => boxes.every((box) => onGoal[box] === 1);

  const blocked = new Uint8Array(size);
  const startBoxes = board.boxes.slice().sort((a, b) => a - b);
  const nodes = [{ boxes: startBoxes, player: board.player, parent: -1 }];
  const visited = new Set();
  for (const box of startBoxes) blocked[box] = 1;
  const startLow = walkReach(board, blocked, board.player).low;
  for (const box of startBoxes) blocked[box] = 0;
  visited.add(startBoxes.join('|') + '@' + startLow);
  let found = solved(startBoxes) ? 0 : -1;

  for (let head = 0; found < 0 && head < nodes.length; head++) {
    const node = nodes[head];
    const boxes = node.boxes;
    for (const box of boxes) blocked[box] = 1;
    const region = walkReach(board, blocked, node.player).seen;
    for (let i = 0; i < boxes.length && found < 0; i++) {
      const box = boxes[i];
      for (const step of MOVES) {
        const delta = step.dy * width + step.dx;
        const stand = box - delta;
        const target = box + delta;
        if (stand < 0 || stand >= size || target < 0 || target >= size) continue;
        if (!region[stand] || wall[target] || blocked[target] || !live[target]) continue;
        blocked[box] = 0;
        blocked[target] = 1;
        const frozen = squareFrozen(board, blocked, onGoal, target);
        let nextBoxes = null;
        let key = '';
        if (!frozen) {
          nextBoxes = boxes.slice();
          nextBoxes[i] = target;
          nextBoxes.sort((a, b) => a - b);
          const low = walkReach(board, blocked, box).low;
          key = nextBoxes.join('|') + '@' + low;
        }
        blocked[target] = 0;
        blocked[box] = 1;
        if (frozen || visited.has(key)) continue;
        if (nodes.length >= budget) {
          for (const b of boxes) blocked[b] = 0;
          return null;
        }
        visited.add(key);
        nodes.push({ boxes: nextBoxes, player: box, parent: head });
        if (solved(nextBoxes)) found = nodes.length - 1;
      }
    }
    for (const box of boxes) blocked[box] = 0;
  }
  if (found < 0) return null;

  const chain = [];
  for (let at = found; at > 0; at = nodes[at].parent) chain.push(at);
  chain.reverse();
  let moves = '';
  let player = board.player;
  let boxes = startBoxes;
  for (const at of chain) {
    const nextBoxes = nodes[at].boxes;
    const nextSet = new Set(nextBoxes);
    const boxSet = new Set(boxes);
    const from = boxes.find((b) => !nextSet.has(b));
    const to = nextBoxes.find((b) => !boxSet.has(b));
    const delta = to - from;
    const step = MOVES.find((s) => s.dy * width + s.dx === delta);
    for (const b of boxes) blocked[b] = 1;
    const walk = routeWalk(board, blocked, player, from - delta);
    for (const b of boxes) blocked[b] = 0;
    if (walk === null || !step) return null;
    moves += walk + step.push;
    player = from;
    boxes = nextBoxes;
  }
  return { pushes: chain.length, moves };
}

/** Cell the player occupies after following a move string. */
function playerAfterMoves(width, start, moves) {
  let cell = start;
  for (const ch of moves.toLowerCase()) {
    if (ch === 'u') cell -= width;
    else if (ch === 'd') cell += width;
    else if (ch === 'l') cell -= 1;
    else cell += 1;
  }
  return cell;
}

/**
 * Split the board into rooms. The hallway is the player's row; its dead
 * cells are cut away, and each connected piece of remaining floor is a
 * room. Returns null when the board is not a set of rooms (a crate sits
 * in the hallway, or some piece holds a different number of crates than
 * goals), in which case the caller solves the whole board at once.
 */
function partitionRooms(board) {
  const { width, wall, goals, boxes, player } = board;
  const live = pullbackLive(board);
  const hallwayRow = Math.floor(player / width);
  const cut = new Uint8Array(wall.length);
  for (let cell = hallwayRow * width; cell < (hallwayRow + 1) * width; cell++) {
    if (!wall[cell] && !live[cell]) cut[cell] = 1;
  }
  if (boxes.some((box) => cut[box])) return null;
  const partOf = new Int32Array(wall.length).fill(-1);
  const rooms = [];
  for (let seed = 0; seed < wall.length; seed++) {
    if (wall[seed] || cut[seed] || partOf[seed] >= 0) continue;
    const cells = [seed];
    partOf[seed] = rooms.length;
    for (let i = 0; i < cells.length; i++) {
      for (const step of MOVES) {
        const next = cells[i] + step.dy * width + step.dx;
        if (next < 0 || next >= wall.length) continue;
        if (wall[next] || cut[next] || partOf[next] >= 0) continue;
        partOf[next] = rooms.length;
        cells.push(next);
      }
    }
    rooms.push({ boxes: [], goals: [], finished: false });
  }
  for (const box of boxes) rooms[partOf[box]].boxes.push(box);
  for (const goal of goals) {
    if (partOf[goal] < 0) return null;
    rooms[partOf[goal]].goals.push(goal);
  }
  if (rooms.some((room) => room.boxes.length !== room.goals.length)) return null;
  return rooms.filter((room) => room.boxes.length > 0);
}

/**
 * Solve room by room. While one room is being solved, the other rooms'
 * crates count as walls (their goals once finished), so the searches
 * stay small and independent. The player simply walks on from wherever
 * the previous room left it.
 */
function solvePartitioned(board) {
  const rooms = partitionRooms(board);
  if (rooms === null) return bfsPush(board, GLOBAL_BUDGET);
  let player = board.player;
  let pushes = 0;
  let moves = '';
  for (const room of rooms) {
    const wall = board.wall.slice();
    for (const other of rooms) {
      if (other === room) continue;
      for (const cell of other.finished ? other.goals : other.boxes) wall[cell] = 1;
    }
    const subBoard = {
      width: board.width,
      height: board.height,
      wall,
      goals: room.goals.slice().sort((a, b) => a - b),
      boxes: room.boxes.slice().sort((a, b) => a - b),
      player,
    };
    const result = bfsPush(subBoard, ROOM_BUDGET);
    if (result === null) return null;
    pushes += result.pushes;
    moves += result.moves;
    player = playerAfterMoves(board.width, player, result.moves);
    room.finished = true;
  }
  return { pushes, moves };
}

/**
 * Solve one XSB level and return its LURD move string. An empty string
 * means no solution was found within budget; it is still valid format.
 * Never throws.
 */
export function solveLevel(text) {
  try {
    const board = loadBoard(text);
    if (board.player < 0 || board.boxes.length === 0) return '';
    if (board.boxes.length !== board.goals.length) return '';
    const byRooms = solvePartitioned(board);
    if (byRooms !== null) return byRooms.moves;
    const whole = bfsPush(board, GLOBAL_BUDGET);
    return whole !== null ? whole.moves : '';
  } catch {
    return '';
  }
}

export const solve = solveLevel;
