/**
 * @file spec.js — everything the library must do.
 *
 * The cases know nothing about the environment they run in: they collect
 * closures and hand them out, so `node --test` and browser/runner.html execute
 * exactly the same assertions instead of two copies that quietly drift apart.
 *
 * @see raycast.test.js      the Node runner, run with `node --test`
 * @see browser/runner.html  the browser page
 */

import { Raycaster, TileGrid, ShapeSet, RayHit, Filters } from '../src/raycast.js';
import { assert } from './expect.js';

export { AssertionError } from './expect.js';

/**
 * Every case in this file, in declaration order.
 *
 * @type {Array<{name: string, run: Function}>}
 */
export const specs = [];

/**
 * Declares one case.
 *
 * @param {string}   name what the library is expected to do.
 * @param {Function} run  the case itself; it throws to fail.
 * @private
 */
function test(name, run) {
    specs.push({ name, run });
}

/**
 * A small walled room with a pillar at cell (3, 3).
 *
 * @returns {number[][]} the map.
 */
function room() {
    return [
        [1, 1, 1, 1, 1, 1],
        [1, 0, 0, 0, 0, 1],
        [1, 0, 0, 0, 0, 1],
        [1, 0, 0, 1, 0, 1],
        [1, 0, 0, 0, 0, 1],
        [1, 1, 1, 1, 1, 1],
    ];
}

/**
 * Builds a caster over the room, at 16 units per cell.
 *
 * @param {object} [definitions] tile definitions to register.
 * @returns {{grid: object, raycaster: object}} the pair.
 */
function roomCaster(definitions) {
    const grid = new TileGrid({ map: room(), tileSize: 16, definitions });
    return { grid, raycaster: new Raycaster(grid) };
}

test('a ray meets the first full cell in its way', () => {
    const { raycaster } = roomCaster();
    const hit = raycaster.cast(56, 24, 0, 1, 500);

    assert.equal(hit.pointY, 48);
    assert.equal(hit.normalY, -1);
    assert.deepEqual([hit.cellX, hit.cellY], [3, 3]);
    assert.equal(hit.tileId, 1);
    assert.equal(hit.normalY, -1);
});

test('the distance and the contact point agree', () => {
    const { raycaster } = roomCaster();
    const hit = raycaster.cast(56, 24, 0, 1, 100);

    assert.equal(hit.distance, 24);
    assert.equal(hit.pointY, 48);
    assert.equal(hit.pointY, 24 + hit.distance, 'the point is the origin plus the distance');
});

test('a ray starting exactly on a boundary leaves the cell behind it', () => {
    const { raycaster } = roomCaster();
    const rightwards = raycaster.cast(48, 56, 1, 0, 100, { ignoreInside: true });
    const leftwards = raycaster.cast(48, 56, -1, 0, 100, { ignoreInside: true });

    assert.equal(rightwards.pointX, 80, 'the wall past the pillar');
    assert.equal(leftwards.pointX, 16, 'the wall behind it');
});

test('a ray reaches nothing beyond its maximum distance', () => {
    const { raycaster } = roomCaster();
    assert.equal(raycaster.cast(56, 24, 0, 1, 10), null);
    assert.notEqual(raycaster.cast(56, 24, 0, 1, 24), null);
});

test('a ray leaving an open map stops instead of walking forever', () => {
    const grid = new TileGrid({ map: [[0, 0], [0, 0]], tileSize: 16 });
    const raycaster = new Raycaster(grid);

    assert.equal(raycaster.cast(8, 8, 0, -1, Infinity), null);
});

test('an out-of-bounds identifier can wall a map in', () => {
    const grid = new TileGrid({ map: [[0, 0], [0, 0]], tileSize: 16, outOfBounds: 1 });
    const hit = new Raycaster(grid).cast(8, 8, 0, -1, 100);

    assert.equal(hit.pointY, 0);
    assert.equal(hit.cellY, -1);
});

test('a ray already inside geometry reports it, unless told to ignore it', () => {
    const { raycaster } = roomCaster();
    const inside = raycaster.cast(56, 56, 1, 0, 100);

    assert.equal(inside.distance, 0);
    assert.equal(inside.startedInside, true);
    assert.equal(raycaster.cast(56, 56, 1, 0, 100, { ignoreInside: true }).pointX, 80);
});

/* ── tile shapes ────────────────────────────────────────────────────────── */

test('the default filter lets tiles marked solid false through', () => {
    const { raycaster } = roomCaster({ 1: { id: 1, solid: false } });
    assert.equal(raycaster.cast(40, 24, 0, 1, 500), null);
});

test('filters can select by layer, by tile identifier and by combination', () => {
    const definitions = {
        1: { id: 1, layer: 1 },
        4: { id: 4, layer: 2 },
    };
    const map = room();
    map[2][2] = 4;
    const grid = new TileGrid({ map, tileSize: 16, definitions });
    const raycaster = new Raycaster(grid);

    const anything = raycaster.cast(40, 24, 0, 1, 500);
    assert.equal(anything.tileId, 4);

    // Both builds keep the mechanism; only the full one ships the sugar.
    const firstLayerOnly = raycaster.cast(40, 24, 0, 1, 500, {
        filter: candidate => ((candidate.userData?.layer ?? 1) & 1) !== 0,
    });
    assert.equal(firstLayerOnly.tileId, 1);

    const withoutFours = raycaster.cast(40, 24, 0, 1, 500, {
        filter: candidate => candidate.tileId !== 4,
    });
    assert.equal(withoutFours.tileId, 1);
});

test('a filter can express a one-way platform without library support', () => {
    const definitions = { 5: { id: 5, oneWay: true } };
    const grid = new TileGrid({ map: [[0], [0], [5], [1]], tileSize: 16, definitions });
    const raycaster = new Raycaster(grid);

    // The rule lives here, in four lines, not in the library.
    const platformer = candidate => {
        if (candidate.userData.oneWay !== true) {
            return true;
        }
        return candidate.normalY < -0.7;
    };

    const fromAbove = raycaster.cast(8, 8, 0, 1, 100, { filter: platformer });
    assert.equal(fromAbove.tileId, 5);
    assert.equal(fromAbove.pointY, 32);

    const fromBelow = raycaster.cast(8, 56, 0, -1, 100, { filter: platformer, ignoreInside: true });
    assert.equal(fromBelow, null);
});

/* ── loose shapes ───────────────────────────────────────────────────────── */

test('a rectangle is met on its near face', () => {
    const shapes = new ShapeSet();
    shapes.addRectangle(100, 40, 20, 20, { name: 'crate' });
    const hit = new Raycaster(shapes).cast(0, 50, 1, 0, 500);

    assert.equal(hit.pointX, 100);
    assert.equal(hit.normalX, -1);
    assert.equal(hit.userData.name, 'crate');
});

test('the nearest collider wins even when it straddles several buckets', () => {
    const shapes = new ShapeSet({ cellSize: 16 });
    const long = shapes.addRectangle(60, 0, 200, 200, 'long');
    shapes.addRectangle(300, 40, 20, 20, 'far');
    const hit = new Raycaster(shapes).cast(0, 50, 1, 0, 500);

    assert.equal(hit.userData, 'long');
    assert.equal(hit.collider, long);
    assert.equal(hit.pointX, 60);
});

test('colliders can be moved and removed', () => {
    const shapes = new ShapeSet({ cellSize: 16 });
    const crate = shapes.addRectangle(100, 40, 20, 20);
    const raycaster = new Raycaster(shapes);

    assert.equal(raycaster.cast(0, 50, 1, 0, 500).pointX, 100);

    crate.x = 200;
    shapes.update(crate);
    assert.equal(raycaster.cast(0, 50, 1, 0, 500).pointX, 200);

    shapes.remove(crate);
    assert.equal(raycaster.cast(0, 50, 1, 0, 500), null);
    assert.equal(shapes.buckets.size, 0, 'no empty buckets are left behind');
});

/* ── several sources at once ────────────────────────────────────────────── */

test('the nearest contact across sources wins, whichever source holds it', () => {
    const grid = new TileGrid({ map: room(), tileSize: 16 });
    const shapes = new ShapeSet();
    const crate = shapes.addRectangle(36, 36, 8, 8, 'crate');
    const raycaster = new Raycaster([grid, shapes]);

    // The box sits before the wall for a ray going down column 2.
    const hit = raycaster.cast(40, 24, 0, 1, 500);
    assert.equal(hit.collider, crate);
    assert.equal(hit.pointY, 36);

    shapes.remove(crate);
    assert.equal(raycaster.cast(40, 24, 0, 1, 500).tileId, 1);
});

test('castAll returns every contact, ordered, across sources', () => {
    const grid = new TileGrid({ map: room(), tileSize: 16 });
    const shapes = new ShapeSet();
    shapes.addRectangle(36, 36, 8, 8, 'crate');
    const raycaster = new Raycaster([grid, shapes]);

    const hits = raycaster.castAll(40, 24, 0, 1, 500);
    const distances = hits.map(hit => hit.distance);

    assert.deepEqual(distances, [...distances].sort((left, right) => left - right));
    assert.equal(hits[0].userData, 'crate');
    assert.equal(hits[1].tileId, 1);
    assert.equal(raycaster.castAll(40, 24, 0, 1, 500, { limit: 1 }).length, 1);
});

/* ── enumeration and sight ──────────────────────────────────────────────── */

test('each visits every cell a ray crosses, empty ones included', () => {
    const { raycaster } = roomCaster();
    const visited = [];
    raycaster.each(20, 20, 1, 1, 40, candidate => {
        visited.push(candidate.cellX + ',' + candidate.cellY);
    }, { filter: Filters.everything });

    // The last cell is reached exactly at the far end of the ray, and the two
    // ties on the way are broken in favour of the vertical step.
    assert.deepEqual(visited, ['1,1', '1,2', '2,2', '2,3', '3,3']);
});

test('each reports empty cells whether one source is attached or two', () => {
    const grid = new TileGrid({ map: room(), tileSize: 16 });
    const shapes = new ShapeSet();
    shapes.addRectangle(300, 300, 4, 4, 'far away and irrelevant');

    const walk = raycaster => {
        const visited = [];
        raycaster.each(20, 20, 1, 1, 40, candidate => {
            visited.push(candidate.cellX + ',' + candidate.cellY);
        }, { filter: () => true });
        return visited;
    };

    assert.deepEqual(walk(new Raycaster([grid, shapes])), walk(new Raycaster(grid)));
});

test('each can stop early', () => {
    const { raycaster } = roomCaster();
    let count = 0;
    raycaster.each(20, 20, 1, 1, 200, () => {
        count++;
        return count < 2;
    }, { filter: Filters.everything });

    assert.equal(count, 2);
});

test('line of sight is clear only when nothing stands between', () => {
    const { raycaster } = roomCaster();

    assert.equal(raycaster.lineOfSight(20, 20, 70, 20), true);
    assert.equal(raycaster.lineOfSight(20, 56, 70, 56), false);
});

/* ── results and edge cases ─────────────────────────────────────────────── */

test('a hit can be written into a reusable object and cloned out of it', () => {
    const { raycaster } = roomCaster();
    const reusable = new RayHit();

    const first = raycaster.cast(40, 24, 0, 1, 500, { target: reusable });
    assert.equal(first, reusable);

    const kept = reusable.clone();
    raycaster.cast(24, 24, 0, 1, 500, { target: reusable });

    assert.equal(kept.cellX, 2);
    assert.equal(reusable.cellX, 1);
});

test('nonsense input is refused rather than traversed', () => {
    const { raycaster } = roomCaster();

    assert.equal(raycaster.cast(40, 24, 0, 0, 100), null);
    assert.equal(raycaster.cast(40, 24, NaN, 1, 100), null);
    assert.equal(raycaster.cast(Infinity, 24, 0, 1, 100), null);
    assert.deepEqual(raycaster.castAll(40, 24, NaN, 1, 100), []);
});

test('an unnormalised direction gives the same answer as a normalised one', () => {
    const { raycaster } = roomCaster();
    const long = raycaster.cast(20, 20, 30, 30, 100);
    const unit = raycaster.cast(20, 20, Math.SQRT1_2, Math.SQRT1_2, 100);

    assert.equal(long.distance, unit.distance);
    assert.equal(long.pointX, unit.pointX);
});

test('a caster with no sources answers nothing without failing', () => {
    const raycaster = new Raycaster();

    assert.equal(raycaster.cast(0, 0, 1, 0, 100), null);
    assert.deepEqual(raycaster.castAll(0, 0, 1, 0, 100), []);
    assert.equal(raycaster.lineOfSight(0, 0, 100, 0), true);
});


test('a cell is 32 units unless told otherwise', () => {
    const grid = new TileGrid({ map: [[0, 1]] });
    const hit = new Raycaster(grid).cast(0, 16, 1, 0, 200);

    assert.equal(grid.tileSize, 32);
    assert.equal(hit.pointX, 32);
});

test('a rectangle is met on its near face', () => {
    const shapes = new ShapeSet();
    shapes.addRectangle(100, 40, 20, 20, { name: 'crate' });
    const hit = new Raycaster(shapes).cast(0, 50, 1, 0, 500);

    assert.equal(hit.pointX, 100);
    assert.equal(hit.normalX, -1);
    assert.equal(hit.userData.name, 'crate');
});

test('a contact normal is always one of the four axis directions', () => {
    const grid = new TileGrid({ map: [[1, 1, 1], [1, 0, 1], [1, 1, 1]], tileSize: 32 });
    const raycaster = new Raycaster(grid);

    for (let step = 0; step < 24; step++) {
        const angle = (step / 24) * Math.PI * 2;
        const hit = raycaster.cast(48, 48, Math.cos(angle), Math.sin(angle), 200);

        assert.ok(hit, 'the ray should always reach a wall of the box');
        assert.equal(Math.abs(hit.normalX) + Math.abs(hit.normalY), 1, 'normal at angle ' + step);
    }
});

test('a source of your own needs no base class, only three methods', () => {
    // An improvised source: an endless wall at x = 50, and nothing else.
    const wall = {
        contact(ray, target) {
            const distance = 50 - ray.originX;
            if (ray.directionX <= 0 || distance < 0 || distance > ray.maxDistance) {
                return null;
            }
            target.reset();
            target.hit = true;
            target.pointX = 50;
            target.pointY = ray.originY + ray.directionY * distance;
            target.normalX = -1;
            target.distance = distance;
            target.source = wall;
            target.userData = { name: 'improvised' };
            return target;
        },
        nearest(ray, filter, target) {
            return this.contact(ray, target);
        },
        collect(ray, filter, results) {
            const hit = this.contact(ray, new RayHit());
            if (hit) {
                results.push(hit);
            }
        },
        each(ray, filter, visit) {
            const hit = this.contact(ray, new RayHit());
            if (hit) {
                visit(hit);
            }
        },
    };

    const raycaster = new Raycaster([wall, new TileGrid({ map: [[0, 0, 1]], tileSize: 32 })]);

    const hit = raycaster.cast(0, 10, 1, 0, 200);
    assert.equal(hit.pointX, 50, 'the improvised wall stands before the tile at 64');
    assert.equal(hit.userData.name, 'improvised');
    assert.equal(hit.normalX, -1);

    const everything = raycaster.castAll(0, 10, 1, 0, 200);
    assert.equal(everything.length, 2, 'and both sources are collected');
    assert.equal(everything[0].pointX, 50);
    assert.equal(everything[1].pointX, 64);
});

test('a rectangle of zero thickness stands in for an axis-aligned line', () => {
    const shapes = new ShapeSet();
    shapes.addRectangle(100, 50, 120, 0, 'rail');
    const raycaster = new Raycaster(shapes);

    const fromAbove = raycaster.cast(150, 0, 0, 1, 400);
    assert.equal(fromAbove.distance, 50);
    assert.equal(fromAbove.normalY, -1, 'the normal turns to face the ray');

    const fromBelow = raycaster.cast(150, 100, 0, -1, 400);
    assert.equal(fromBelow.distance, 50);
    assert.equal(fromBelow.normalY, 1);

    assert.equal(raycaster.cast(250, 0, 0, 1, 400), null, 'and it ends where it ends');
});

test('a ray starting exactly on a line meets it at distance zero', () => {
    // Not an "inside", so ignoreInside will not skip it: a zero-thickness
    // collider has no inside to be in. Keep a body a hair off the surface
    // instead, which is what the skin in examples/move-box.js is for.
    const shapes = new ShapeSet();
    shapes.addRectangle(100, 50, 120, 0, 'rail');
    const raycaster = new Raycaster(shapes);

    const touching = raycaster.cast(150, 50, 0, 1, 400, { ignoreInside: true });
    assert.equal(touching.distance, 0);
    assert.equal(touching.startedInside, false);

    const clear = raycaster.cast(150, 50.02, 0, 1, 400);
    assert.equal(clear, null, 'a hair below and the rail is behind it');
});

