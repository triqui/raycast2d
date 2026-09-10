# raycast2d

[![JavaScript](https://img.shields.io/badge/javascript-ES2020-yellow)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Tests](https://img.shields.io/badge/tests-node--test-green)](https://nodejs.org/api/test.html)
[![License](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)
[![Status](https://img.shields.io/badge/status-active-brightgreen)](https://github.com/triqui/raycast2d)

Lightweight **2D ray casting** for grids of squares and loose AABB rectangles.

A single file, with no depencencies. It answers one question, in several shapes: **what does a ray meet?**

Ideal for:

- line of sight and field of view
- vision cones for enemies and guards
- fog of war
- bullets, lasers and reflections
- moving a rectangle without a physics engine

Features:

- one dense tile grid, walked cell by cell
- loose axis-aligned rectangles, indexed by a spatial hash
- any number of sources queried together, merged by distance
- filters, so the rules of your game stay in your game
- reusable hit objects for allocation-free loops
- fully typed through JSDoc, no TypeScript required

---

## Live examples

<https://triqui.github.io/raycast2d/examples/>

| | | |
| --- | --- | --- |
| [01](https://triqui.github.io/raycast2d/examples/01.html) | A ray between two points |
| [02](https://triqui.github.io/raycast2d/examples/02.html) | Every contact along a ray |
| [03](https://triqui.github.io/raycast2d/examples/03.html) | Two sources at once |
| [04](https://triqui.github.io/raycast2d/examples/04.html) | A fan of rays |
| [05](https://triqui.github.io/raycast2d/examples/05.html) | Moving a rectangle |
| [06](https://triqui.github.io/raycast2d/examples/06.html) | A ray that bounces |
| [07](https://triqui.github.io/raycast2d/examples/07.html) | Definitions and filters |
| [08](https://triqui.github.io/raycast2d/examples/08.html) | Fog of war |
| [09](https://triqui.github.io/raycast2d/examples/09.html) | Thin walls and one-way surfaces |
| [10](https://triqui.github.io/raycast2d/examples/10.html) | A cone of vision |

---

## Installation

Clone the repository:

```
git clone https://github.com/triqui/raycast2d.git
```

Or copy the single source file into your project:

```
src/raycast.js
```

---

## Basic usage

```js
import { Raycaster, TileGrid } from './raycast.js';

const map = [
    [0, 0, 0, 0],
    [0, 1, 1, 0],
    [0, 0, 0, 0]
];

const grid = new TileGrid({ map, tileSize: 32 });
const raycaster = new Raycaster(grid);

const hit = raycaster.cast(16, 16, 1, 1, 400);

if (hit) {
    console.log(hit.pointX, hit.pointY, hit.distance, hit.cellX, hit.cellY);
}
```

A hit reports where the ray stopped, how far it traveled, the normal of the surface it met, and what it met.

---

## Between two points

```js
const hit = raycaster.castTo(16, 16, 300, 200);
const clear = raycaster.lineOfSight(16, 16, 300, 200);
```

`castTo` is `cast` with the direction and the length worked out from the second point. `lineOfSight` is the same question reduced to a boolean.

---

## Every contact along a ray

```js
const hits = raycaster.castAll(16, 16, 1, 0, 400);
```

Returns an array ordered from the nearest. `options.limit` keeps only the first few.

---

## Cells crossed, empty ones included

```js
raycaster.each(16, 16, 1, 0, 400, candidate => {
    console.log(candidate.cellX, candidate.cellY);
});
```

The only query that reports empty cells, which is what a fog of war or a line drawing algorithm needs.

---

## Loose AABB rectangles

Nothing is tied to the grid: a rectangle may be any size and sit anywhere.

```js
import { Raycaster, TileGrid, ShapeSet } from './raycast.js';

const shapes = new ShapeSet();
const crate = shapes.addRectangle(96, 64, 44, 17, { name: 'crate' });

const raycaster = new Raycaster([grid, shapes]);

crate.x += 10;
shapes.update(crate);
```

The caster asks every source in turn and keeps the nearest answer. The hit says which one replied: `collider` and `userData` come from a shape set, `tileId` and `cellX` and `cellY` from a grid.

---

## Filters

A filter answers one question: does this stop the ray? That is where the rules of your game live.

```js
const definitions = {
    1: { name: 'wall', stopsSight: true },
    2: { name: 'glass', stopsSight: false }
};

const grid = new TileGrid({ map, tileSize: 32, definitions });

const seen = raycaster.lineOfSight(x1, y1, x2, y2, {
    filter: candidate => Boolean(candidate.userData) && candidate.userData.stopsSight
});
```

The library reads none of the fields you put on a definition. It hands them to the filter on `candidate.userData` and lets you decide.

---

## API

### Raycaster

| Method | Returns |
| --- | --- |
| `cast(originX, originY, directionX, directionY, maxDistance, options)` | nearest `RayHit`, or `null` |
| `castTo(startX, startY, endX, endY, options)` | nearest `RayHit`, or `null` |
| `lineOfSight(startX, startY, endX, endY, options)` | `boolean` |
| `castAll(originX, originY, directionX, directionY, maxDistance, options)` | `RayHit[]`, nearest first |
| `each(originX, originY, directionX, directionY, maxDistance, callback, options)` | nothing, calls back per cell |

Options: `filter`, `ignoreInside`, `target`, and `limit` on `castAll`.

### TileGrid

`new TileGrid({ map, tileSize, definitions, readTile, readDefinition, outOfBounds, maxSteps })`

`outOfBounds` says what lies beyond the map. Set it to a blocking identifier to wall the grid in.

### ShapeSet

`new ShapeSet({ cellSize, maxSteps })`, then `addRectangle`, `update` and `remove`.

A rectangle of zero width or height blocks along a line rather than across a cell.

### RayHit

`hit`, `pointX`, `pointY`, `normalX`, `normalY`, `distance`, `startedInside`, `source`, `userData`, `collider`, `tileId`, `cellX`, `cellY`.

Instances are reusable: pass one as `options.target` to keep a hot loop free of allocations, and call `clone()` on anything worth keeping past the next cast.

---

## Requirements

- ES modules
- Node 18+ to run the tests
- a server to open the examples, since browsers refuse modules over `file://`

---

## Running tests

```
npm test
```

29 specs, run with the Node test runner. No dependencies to install.

---

## Author

Written by **Emanuele Feronato**

- Blog: <https://www.emanueleferonato.com>
- GitHub: <https://github.com/triqui>
- X: <https://x.com/triqui>
- itch.io: <https://triqui.itch.io/> 

---

## License

MIT License. See the [LICENSE](LICENSE) file for details.
