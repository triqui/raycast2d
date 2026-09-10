/**
    * @file raycast.js, 2D ray casting on a grid of squares.
    *
    * A single file that depends on nothing and needs no build step. It answers one
    * question, in several shapes: what does a ray meet?
    *
    * That is the whole of it. The library holds no state of its own, and it leaves
    * every decision to the caller. Sweeping a volume, resolving an overlap and
    * choosing which surfaces count as obstacles this frame all belong to whatever
    * is built on top, and each of them is easier once the geometry query
    * underneath is a separate thing that can be tested on its own.
    *
    * Geometry does not live in the caster. It lives in *sources*, and a caster
    * queries however many it is given, merging their answers by distance:
    *
    *   {@link TileGrid}  a dense grid of square tiles, walked cell by cell;
    *   {@link ShapeSet}  loose axis-aligned rectangles in world space, indexed by
    *                     a spatial hash.
    *
    * Both are duck-typed against three methods, 'nearest', 'collect' and 'each',
    * so a source of your own plugs in the same way. There is nothing to extend and
    * nothing to register. See {@link RaySource}.
    *
    * Everything here is axis-aligned: a tile fills its cell, a collider is a
    * rectangle, and a contact normal always points along one of the four
    * directions. Coordinates are in whatever unit suits you; the examples use
    * pixels. Nothing assumes which way Y points.
    *
    * @example
    * const grid = new TileGrid({ map, tileSize: 32 });
    * const boxes = new ShapeSet();
    * boxes.addRectangle(96, 64, 32, 32, { name: 'crate' });
    *
    * const raycaster = new Raycaster([grid, boxes]);
    * const hit = raycaster.cast(10, 10, 1, 0.4, 400);
    * if (hit) {
    *     console.log(hit.distance, hit.normalX, hit.normalY, hit.userData);
    * }
    *
    * @author Emanuele Feronato
    * @version 1.0.0
    * @license MIT
*/

/**
    * Tolerance used for every floating point comparison in this module.
    *
    * @constant {number}
*/
const EPSILON = 1e-9;

/**
    * What 'indexOf' returns when it finds nothing.
    *
    * @constant {number}
*/
const NOT_FOUND = -1;

/**
    * Reported in place of a cell index by sources that have no grid.
    *
    * @constant {number}
*/
const NO_CELL = -1;

/**
    * Size of a cell when none is given. Powers of two are the cheapest, since the
    * traversal divides by it once per axis.
    *
    * @constant {number}
*/
const DEFAULT_TILE_SIZE = 32;

/**
    * Size of a spatial hash bucket when none is given.
    *
    * @constant {number}
*/
const DEFAULT_BUCKET_SIZE = 64;

/**
    * How many cells or buckets one traversal may visit before giving up. A ray
    * that reaches this has almost certainly been handed nonsense.
    *
    * @constant {number}
*/
const DEFAULT_MAX_STEPS = 2048;

/* ═══════════════════════════════════════════════════════════════════════════
 * Results
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
    * Where a ray met geometry, and what it met.
    *
    * Instances are reusable: pass one as 'options.target' to keep a hot loop free
    * of allocations, and call {@link RayHit#clone} on anything worth keeping past
    * the next cast.
*/
export class RayHit {

    /**
        * Creates an empty, unfilled hit.
    */
    constructor() {
        this.reset();
    }

    /**
        * Clears every field back to its neutral value.
        *
        * @returns {RayHit} this hit, for chaining.
    */
    reset() {
        /**
            * @type {boolean} whether this hit describes real contact.
        */
        this.hit = false;
        /**
            * @type {number} contact point on the first axis.
        */
        this.pointX = 0;
        /**
            * @type {number} contact point on the second axis.
        */
        this.pointY = 0;
        /**
            * @type {number} surface normal, unit length, pointing away from the surface.
        */
        this.normalX = 0;
        /**
            * @type {number} surface normal, unit length, pointing away from the surface.
        */
        this.normalY = 0;
        /**
            * @type {number} how far along the ray the contact sits, in world units.
        */
        this.distance = 0;
        /**
            * @type {boolean} whether the ray was already inside this geometry when it started.
        */
        this.startedInside = false;
        /**
            * @type {?RaySource} the source that owns the geometry.
        */
        this.source = null;
        /**
            * @type {*} the tile definition, or whatever was attached to the collider.
        */
        this.userData = null;
        /**
            * @type {?object} the collider that was met, or null when a grid answered.
        */
        this.collider = null;
        /**
            * @type {number} tile identifier, or 0 when a grid did not answer.
        */
        this.tileId = 0;
        /**
            * @type {number} column of the cell, or -1 when a grid did not answer.
        */
        this.cellX = NO_CELL;
        /**
            * @type {number} row of the cell, or -1 when a grid did not answer.
        */
        this.cellY = NO_CELL;
        return this;
    }

    /**
        * Copies this hit into a fresh instance, so it survives the next cast that
        * reuses the original.
        *
        * @returns {RayHit} an independent copy.
    */
    clone() {
        return Object.assign(new RayHit(), this);
    }
}

/**
    * The ray a source is asked to trace. Its direction is unit length by the time
    * a source sees it.
    *
    * @typedef {object} Ray
    * @property {number}  originX      where the ray starts.
    * @property {number}  originY      where the ray starts.
    * @property {number}  directionX   direction of travel, unit length.
    * @property {number}  directionY   direction of travel, unit length.
    * @property {number}  maxDistance  how far the ray still reaches. A caster
    *                                  shrinks this as nearer contacts are found,
    *                                  so a source queried later only has to look at
    *                                  the stretch still in play.
    * @property {boolean} ignoreInside skip geometry the ray starts inside of.
*/

/**
    * The object handed to a filter for every piece of geometry a ray reaches. The
    * same object is reused between calls, so copy anything worth keeping.
    *
    * @typedef {object} Candidate
    * @property {RaySource} source        the source that owns the geometry.
    * @property {*}         userData      the tile definition, or the collider's payload.
    * @property {?object}   collider      the collider met, or null when a grid answered.
    * @property {number}    tileId        tile identifier, or 0 outside a grid.
    * @property {number}    cellX         column, or -1 outside a grid.
    * @property {number}    cellY         row, or -1 outside a grid.
    * @property {number}    distance      world units from the origin to the contact.
    * @property {number}    normalX       normal of the surface about to be met.
    * @property {number}    normalY       normal of the surface about to be met.
    * @property {boolean}   startedInside whether the ray began inside this geometry.
    * @property {number}    directionX    direction of the ray, unit length.
    * @property {number}    directionY    direction of the ray, unit length.
    * @property {number}    originX       where the ray started.
    * @property {number}    originY       where the ray started.
*/

/**
    * Decides whether a candidate stops the ray.
    *
    * @callback Filter
    * @param {Candidate} candidate the geometry under test.
    * @returns {boolean} true to stop the ray here, false to let it pass.
*/

/**
    * Geometry a {@link Raycaster} can query.
    *
    * Implement these three and your own storage plugs in beside the two that ship
    * here. There is no base class to extend and no registry to join: a source is
    * anything with these methods.
    *
    * @typedef {object} RaySource
    * @property {function(Ray, Filter, RayHit): ?RayHit} nearest reports the nearest
    *           contact this source has with the ray, written into the given hit.
    * @property {function(Ray, Filter, RayHit[]): void}  collect appends every contact
    *           this source has with the ray, in any order.
    * @property {function(Ray, Filter, Function): void}  each    visits everything the
    *           ray reaches, blocking or not, in any order. The visitor returns true
    *           to stop the walk.
*/

/**
    * Creates the mutable object handed to filters, with every field present from
    * the start so its shape stays stable.
    *
    * @returns {Candidate} a blank candidate.
    * @private
*/
function createCandidate() {
    return {
        source: null,
        userData: null,
        collider: null,
        tileId: 0,
        cellX: NO_CELL,
        cellY: NO_CELL,
        distance: 0,
        normalX: 0,
        normalY: 0,
        startedInside: false,
        directionX: 0,
        directionY: 0,
        originX: 0,
        originY: 0,
    };
}

/**
    * Copies a candidate into a hit, working out the contact point on the way.
    *
    * @param {RayHit}    target    hit to overwrite.
    * @param {Candidate} candidate source of the contact data.
    * @returns {RayHit} the filled target.
    * @private
*/
function writeHit(target, candidate) {
    target.hit = true;
    target.pointX = candidate.originX + candidate.directionX * candidate.distance;
    target.pointY = candidate.originY + candidate.directionY * candidate.distance;
    target.normalX = candidate.normalX;
    target.normalY = candidate.normalY;
    target.distance = candidate.distance;
    target.startedInside = candidate.startedInside;
    target.source = candidate.source;
    target.userData = candidate.userData;
    target.collider = candidate.collider;
    target.tileId = candidate.tileId;
    target.cellX = candidate.cellX;
    target.cellY = candidate.cellY;
    return target;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Filters
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
    * The two filters worth shipping.
    *
    * A filter is where the rules of your problem live, and the library ships
    * almost none of them. A surface that only stops rays arriving from one side, a
    * material some rays pass through and others do not, geometry that exists for
    * one query and not the next: each is a few lines reading fields you put on
    * your own tile definitions or collider payloads.
    *
    * @namespace
*/
export const Filters = {

    /**
        * The default. Everything a source reports blocks the ray, unless its
        * payload says otherwise with 'solid: false'.
        *
        * @type {Filter}
    */
    blocking(candidate) {
        if (!candidate.userData) {
            return true;
        }
        return candidate.userData.solid !== false;
    },

    /**
        * Blocks on everything, including geometry marked 'solid: false'.
        *
        * @type {Filter}
    */
    everything() {
        return true;
    },
};

/* ═══════════════════════════════════════════════════════════════════════════
 * Geometry
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
    * Intersects a ray with an axis-aligned rectangle: the one intersection test
    * this module performs.
    *
    * A rectangle of zero width or height is allowed, and behaves as a line.
    *
    * @param {number} originX    ray origin.
    * @param {number} originY    ray origin.
    * @param {number} directionX ray direction, unit length.
    * @param {number} directionY ray direction, unit length.
    * @param {number} left       rectangle bounds.
    * @param {number} top        rectangle bounds.
    * @param {number} right      rectangle bounds.
    * @param {number} bottom     rectangle bounds.
    * @returns {?{distance: number, normalX: number, normalY: number, startedInside: boolean}}
    *          where the ray enters, or null when it misses.
    * @private
*/
function intersectRayAgainstRectangle(originX, originY, directionX, directionY, left, top, right, bottom) {
    let entryX = -Infinity;
    let exitX = Infinity;

    if (Math.abs(directionX) < EPSILON) {
        /*
            * Travelling straight up or down: the ray either stays within the
            * rectangle's horizontal band for its whole length, or never enters it.
        */
        if (originX < left || originX > right) {
            return null;
        }
    }
    else {
        entryX = (left - originX) / directionX;
        exitX = (right - originX) / directionX;
        if (entryX > exitX) {
            const swap = entryX;
            entryX = exitX;
            exitX = swap;
        }
    }

    let entryY = -Infinity;
    let exitY = Infinity;

    if (Math.abs(directionY) < EPSILON) {
        if (originY < top || originY > bottom) {
            return null;
        }
    }
    else {
        entryY = (top - originY) / directionY;
        exitY = (bottom - originY) / directionY;
        if (entryY > exitY) {
            const swap = entryY;
            entryY = exitY;
            exitY = swap;
        }
    }

    const entryDistance = Math.max(entryX, entryY);
    const exitDistance = Math.min(exitX, exitY);

    if (entryDistance > exitDistance || exitDistance < 0) {
        return null;
    }
    if (entryDistance < 0) {
        return { distance: 0, normalX: -directionX, normalY: -directionY, startedInside: true };
    }

    /*
        * Whichever axis was entered last is the face that was met.
    */
    if (entryX > entryY) {
        return {
            distance: entryDistance,
            normalX: directionX > 0 ? -1 : 1,
            normalY: 0,
            startedInside: false,
        };
    }
    return {
        distance: entryDistance,
        normalX: 0,
        normalY: directionY > 0 ? -1 : 1,
        startedInside: false,
    };
}

/**
    * Walks the cells of a uniform grid along a ray, in order, with the
    * Amanatides and Woo digital differential analyser.
    *
    * The visitor is told which cell it is in, at what distance the ray entered it,
    * at what distance it will leave, which face it came in through and which way
    * the walk is going. Returning true stops the walk.
    *
    * Both sources use this: one to visit tiles, the other to visit the buckets of
    * its spatial hash.
    *
    * @param {number}   originX     where the ray starts.
    * @param {number}   originY     where the ray starts.
    * @param {number}   directionX  direction of travel, unit length.
    * @param {number}   directionY  direction of travel, unit length.
    * @param {number}   maxDistance how far the ray reaches.
    * @param {number}   cellSize    size of one cell.
    * @param {number}   maxSteps    cap on the number of cells visited.
    * @param {Function} visit       '(cellX, cellY, entryDistance, exitDistance,
    *                               normalX, normalY, stepX, stepY) => boolean'.
    * @private
*/
function walkGrid(originX, originY, directionX, directionY, maxDistance, cellSize, maxSteps, visit) {
    let cellX = Math.floor(originX / cellSize);
    let cellY = Math.floor(originY / cellSize);

    let stepX = 0;
    if (directionX > 0) {
        stepX = 1;
    }
    else {
        if (directionX < 0) {
            stepX = -1;
        }
    }

    let stepY = 0;
    if (directionY > 0) {
        stepY = 1;
    }
    else {
        if (directionY < 0) {
            stepY = -1;
        }
    }

    /*
        * How much distance one whole cell costs on each axis.
    */
    let cellCostX = Infinity;
    if (stepX !== 0) {
        cellCostX = Math.abs(cellSize / directionX);
    }

    let cellCostY = Infinity;
    if (stepY !== 0) {
        cellCostY = Math.abs(cellSize / directionY);
    }

    /*
        * Distance at which the ray crosses the next boundary on each axis.
    */
    let nextBoundaryX = Infinity;
    if (stepX > 0) {
        nextBoundaryX = ((cellX + 1) * cellSize - originX) / directionX;
    }
    else {
        if (stepX < 0) {
            nextBoundaryX = (cellX * cellSize - originX) / directionX;
        }
    }

    let nextBoundaryY = Infinity;
    if (stepY > 0) {
        nextBoundaryY = ((cellY + 1) * cellSize - originY) / directionY;
    }
    else {
        if (stepY < 0) {
            nextBoundaryY = (cellY * cellSize - originY) / directionY;
        }
    }

    let entryDistance = 0;
    let entryNormalX = -directionX;
    let entryNormalY = -directionY;

    for (let step = 0; step <= maxSteps; step++) {
        if (entryDistance > maxDistance) {
            return;
        }

        const exitDistance = Math.min(nextBoundaryX, nextBoundaryY);
        const stop = visit(
            cellX, cellY, entryDistance, exitDistance,
            entryNormalX, entryNormalY, stepX, stepY,
        );
        if (stop) {
            return;
        }

        if (nextBoundaryX < nextBoundaryY) {
            entryDistance = nextBoundaryX;
            nextBoundaryX += cellCostX;
            cellX += stepX;
            entryNormalX = -stepX;
            entryNormalY = 0;
        }
        else {
            entryDistance = nextBoundaryY;
            nextBoundaryY += cellCostY;
            cellY += stepY;
            entryNormalX = 0;
            entryNormalY = -stepY;
        }
    }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * TileGrid
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
    * A dense grid of square tiles, each one filling its cell whole.
    *
    * Tiles are identified by number, and 0 means empty. Definitions are optional:
    * without them every non-zero identifier is a tile that blocks. A definition
    * carries whatever fields your filters want to read, and reaches them
    * untouched on 'candidate.userData'.
    *
    * @implements {RaySource}
*/
export class TileGrid {

    /**
        * @param {object}     [options]
        * @param {number}     [options.tileSize=32]      size of one cell.
        * @param {number[][]} [options.map]              tile identifiers, indexed as map[row][column].
        * @param {Function}   [options.readTile]         '(cellX, cellY) => tileId', replacing the
        *                                                lookup in 'map'; supply it for chunked or
        *                                                endless grids.
        * @param {object}     [options.definitions]      lookup table of '{ [tileId]: definition }'.
        * @param {Function}   [options.readDefinition]   '(tileId) => definition', replacing the
        *                                                lookup in 'definitions'.
        * @param {number}     [options.outOfBounds=0]    identifier reported for cells outside the
        *                                                map; set it to a blocking id to wall the
        *                                                grid in.
        * @param {number}     [options.maxSteps=2048]    cap on cells visited by one traversal.
    */
    constructor({
        tileSize = DEFAULT_TILE_SIZE,
        map = null,
        readTile = null,
        definitions = null,
        readDefinition = null,
        outOfBounds = 0,
        maxSteps = DEFAULT_MAX_STEPS,
    } = {}) {
        /**
            * @type {number} size of one cell.
        */
        this.tileSize = tileSize;
        /**
            * @type {?number[][]} tile identifiers, indexed as map[row][column].
        */
        this.map = map;
        /**
            * @type {?object} lookup table of tile definitions.
        */
        this.definitions = definitions;
        /**
            * @type {number} identifier reported for cells outside the map.
        */
        this.outOfBounds = outOfBounds;
        /**
            * @type {number} cap on cells visited by one traversal.
        */
        this.maxSteps = maxSteps;

        if (readTile) {
            this.readTile = readTile;
        }
        if (readDefinition) {
            this.readDefinition = readDefinition;
        }

        /**
            * @type {Candidate} object reused for every filter call. @private
        */
        this.candidate = createCandidate();

        this.refresh();
    }

    /**
        * Recomputes the cached bounds of the map. Call it after swapping or
        * resizing the 'map' array, so a traversal can still stop once a ray has
        * left a finite grid for good.
        *
        * @returns {TileGrid} this source, for chaining.
    */
    refresh() {
        if (this.map) {
            /**
                * @type {number} number of rows in the map.
            */
            this.rowCount = this.map.length;
            /**
                * @type {number} length of the longest row in the map.
            */
            this.columnCount = this.map.reduce((widest, row) => Math.max(widest, row.length), 0);
            /**
                * @type {boolean} whether the grid has known finite bounds.
            */
            this.hasBounds = true;
        }
        else {
            this.rowCount = 0;
            this.columnCount = 0;
            this.hasBounds = false;
        }
        return this;
    }

    /**
        * Reads the tile identifier at cell coordinates. Replace it through the
        * constructor to read from something other than a dense array.
        *
        * @param {number} cellX column.
        * @param {number} cellY row.
        * @returns {number} the tile identifier, or the out-of-bounds identifier.
    */
    readTile(cellX, cellY) {
        const row = this.map?.[cellY];
        if (!row) {
            return this.outOfBounds;
        }
        const tileId = row[cellX];
        if (tileId === undefined) {
            return this.outOfBounds;
        }
        return tileId;
    }

    /**
        * Reads the definition of a tile identifier, or null when none is
        * registered, which the default filter reads as 'blocks'.
        *
        * @param {number} tileId identifier to look up.
        * @returns {?object} the definition, or null.
    */
    readDefinition(tileId) {
        return this.definitions?.[tileId] ?? null;
    }

    /**
        * Tells whether a walk has left a finite, unwalled grid and is heading
        * further away from it, in which case there is nothing left to report.
        *
        * @param {number} cellX current column.
        * @param {number} cellY current row.
        * @param {number} stepX horizontal direction of the walk, -1, 0 or 1.
        * @param {number} stepY vertical direction of the walk, -1, 0 or 1.
        * @returns {boolean} true when the walk can stop.
        * @private
    */
    hasLeftTheGridForGood(cellX, cellY, stepX, stepY) {
        if (!this.hasBounds || this.outOfBounds !== 0) {
            return false;
        }
        if (cellX < 0 && stepX <= 0) {
            return true;
        }
        if (cellX >= this.columnCount && stepX >= 0) {
            return true;
        }
        if (cellY < 0 && stepY <= 0) {
            return true;
        }
        if (cellY >= this.rowCount && stepY >= 0) {
            return true;
        }
        return false;
    }

    /**
        * Walks the cells along a ray and offers each one to the visitor.
        *
        * With whole cells there is nothing to clip: the boundary the walk hands
        * back *is* the surface, and its normal is already axis-aligned.
        *
        * @param {Ray}      ray               the ray to trace.
        * @param {Filter}   filter            decides what counts as blocking.
        * @param {Function} visit             '(candidate) => boolean'; true stops the walk.
        * @param {boolean}  reportEmptyCells  offer cells holding tile 0 as well.
        * @private
    */
    traverse(ray, filter, visit, reportEmptyCells) {
        const candidate = this.candidate;
        const reportsEmpty = reportEmptyCells || Boolean(this.definitions?.[0]);

        walkGrid(
            ray.originX, ray.originY, ray.directionX, ray.directionY,
            ray.maxDistance, this.tileSize, this.maxSteps,
            (cellX, cellY, entryDistance, exitDistance, entryNormalX, entryNormalY, stepX, stepY) => {
                const tileId = this.readTile(cellX, cellY);
                const worthReporting = tileId !== 0 || reportsEmpty;

                if (worthReporting) {
                    const startedInside = entryDistance === 0;
                    const skip = startedInside && ray.ignoreInside;

                    if (!skip) {
                        candidate.source = this;
                        candidate.userData = this.readDefinition(tileId);
                        candidate.collider = null;
                        candidate.tileId = tileId;
                        candidate.cellX = cellX;
                        candidate.cellY = cellY;
                        candidate.distance = entryDistance;
                        candidate.normalX = entryNormalX;
                        candidate.normalY = entryNormalY;
                        candidate.startedInside = startedInside;
                        candidate.directionX = ray.directionX;
                        candidate.directionY = ray.directionY;
                        candidate.originX = ray.originX;
                        candidate.originY = ray.originY;

                        if (filter(candidate) && visit(candidate)) {
                            return true;
                        }
                    }
                }

                return this.hasLeftTheGridForGood(cellX, cellY, stepX, stepY);
            },
        );
    }

    /**
        * Reports the nearest tile the ray meets.
        *
        * @param {Ray}    ray    the ray to trace.
        * @param {Filter} filter decides what counts as blocking.
        * @param {RayHit} target hit to fill.
        * @returns {?RayHit} the filled target, or null when the ray meets nothing.
    */
    nearest(ray, filter, target) {
        let found = null;
        this.traverse(ray, filter, candidate => {
            found = writeHit(target, candidate);
            return true;
        }, false);
        return found;
    }

    /**
        * Appends every tile the ray meets. A grid is walked in order, so these
        * come out sorted already.
        *
        * @param {Ray}      ray     the ray to trace.
        * @param {Filter}   filter  decides what counts as blocking.
        * @param {RayHit[]} results array to append to.
    */
    collect(ray, filter, results) {
        this.traverse(ray, filter, candidate => {
            results.push(writeHit(new RayHit(), candidate));
            return false;
        }, false);
    }

    /**
        * Visits every cell the ray crosses, empty ones included.
        *
        * @param {Ray}      ray    the ray to trace.
        * @param {Filter}   filter narrows down what is reported.
        * @param {Function} visit  '(candidate) => boolean'; true stops the walk.
    */
    each(ray, filter, visit) {
        this.traverse(ray, filter, visit, true);
    }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ShapeSet
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
    * Loose axis-aligned rectangles in world space, indexed by a spatial hash so a
    * ray only ever tests what lies near it.
    *
    * Nothing here is tied to a grid: a rectangle may be any size and sit anywhere,
    * straddling as many cells of any other source as it likes. One of zero width
    * or height behaves as a line.
    *
    * Colliders are plain objects you keep a reference to. Move one by editing its
    * fields and calling {@link ShapeSet#update}; drop it with
    * {@link ShapeSet#remove}.
    *
    * @implements {RaySource}
*/
export class ShapeSet {

    /**
        * @param {object} [options]
        * @param {number} [options.cellSize=64]   size of one bucket in the spatial hash.
        *                                         Roughly the size of a typical collider is a
        *                                         good starting point: much smaller and each
        *                                         collider is filed many times, much larger and
        *                                         each bucket holds too many to be worth testing.
        * @param {number} [options.maxSteps=2048] cap on buckets visited by one traversal.
    */
    constructor({ cellSize = DEFAULT_BUCKET_SIZE, maxSteps = DEFAULT_MAX_STEPS } = {}) {
        /**
            * @type {number} size of one bucket in the spatial hash.
        */
        this.cellSize = cellSize;
        /**
            * @type {number} cap on buckets visited by one traversal.
        */
        this.maxSteps = maxSteps;
        /**
            * @type {object[]} every collider in the set.
        */
        this.colliders = [];
        /**
            * @type {Map<string, object[]>} bucket key to the colliders overlapping it.
        */
        this.buckets = new Map();
        /**
            * @type {Candidate} object reused for every filter call. @private
        */
        this.candidate = createCandidate();
        /**
            * @type {number} marks colliders already tested during one traversal. @private
        */
        this.visitStamp = 0;
    }

    /**
        * Adds an axis-aligned rectangle.
        *
        * @param {number} x          left edge.
        * @param {number} y          top edge.
        * @param {number} width      width of the rectangle; 0 makes a vertical line.
        * @param {number} height     height of the rectangle; 0 makes a horizontal line.
        * @param {*}      [userData] payload handed to filters and reported on the hit.
        * @returns {object} the collider, to keep for later updates or removal.
    */
    addRectangle(x, y, width, height, userData = null) {
        const collider = { x, y, width, height, userData, stamp: 0 };
        this.colliders.push(collider);
        this.measureBounds(collider);
        this.fileInBuckets(collider);
        return collider;
    }

    /**
        * Re-indexes a collider after it has moved or been resized.
        *
        * @param {object} collider the collider that changed.
        * @returns {ShapeSet} this source, for chaining.
    */
    update(collider) {
        this.removeFromBuckets(collider);
        this.measureBounds(collider);
        this.fileInBuckets(collider);
        return this;
    }

    /**
        * Removes a collider.
        *
        * @param {object} collider the collider to drop.
        * @returns {boolean} true when it was found and removed.
    */
    remove(collider) {
        const position = this.colliders.indexOf(collider);
        if (position === NOT_FOUND) {
            return false;
        }
        this.colliders.splice(position, 1);
        this.removeFromBuckets(collider);
        return true;
    }

    /**
        * Recomputes the bounds of a collider, which for a rectangle is the
        * rectangle itself.
        *
        * @param {object} collider the collider to measure.
        * @private
    */
    measureBounds(collider) {
        collider.minX = collider.x;
        collider.minY = collider.y;
        collider.maxX = collider.x + collider.width;
        collider.maxY = collider.y + collider.height;
    }

    /**
        * Files a collider into every bucket its bounds overlap.
        *
        * @param {object} collider the collider to file.
        * @private
    */
    fileInBuckets(collider) {
        const cellSize = this.cellSize;
        const firstColumn = Math.floor(collider.minX / cellSize);
        const lastColumn = Math.floor(collider.maxX / cellSize);
        const firstRow = Math.floor(collider.minY / cellSize);
        const lastRow = Math.floor(collider.maxY / cellSize);

        for (let row = firstRow; row <= lastRow; row++) {
            for (let column = firstColumn; column <= lastColumn; column++) {
                const key = column + ':' + row;
                let bucket = this.buckets.get(key);
                if (!bucket) {
                    bucket = [];
                    this.buckets.set(key, bucket);
                }
                bucket.push(collider);
            }
        }
    }

    /**
        * Takes a collider out of every bucket holding it, and drops the buckets
        * left empty.
        *
        * @param {object} collider the collider to unfile.
        * @private
    */
    removeFromBuckets(collider) {
        for (const [key, bucket] of this.buckets) {
            const position = bucket.indexOf(collider);
            if (position !== NOT_FOUND) {
                bucket.splice(position, 1);
                if (bucket.length === 0) {
                    this.buckets.delete(key);
                }
            }
        }
    }

    /**
        * Fills the shared candidate with one contact.
        *
        * @param {Ray}    ray      the ray being traced.
        * @param {object} collider the collider met.
        * @param {object} contact  where the ray entered it.
        * @returns {Candidate} the filled candidate.
        * @private
    */
    fillCandidate(ray, collider, contact) {
        const candidate = this.candidate;
        candidate.source = this;
        candidate.userData = collider.userData;
        candidate.collider = collider;
        candidate.tileId = 0;
        candidate.cellX = NO_CELL;
        candidate.cellY = NO_CELL;
        candidate.distance = contact.distance;
        candidate.normalX = contact.normalX;
        candidate.normalY = contact.normalY;
        candidate.startedInside = contact.startedInside;
        candidate.directionX = ray.directionX;
        candidate.directionY = ray.directionY;
        candidate.originX = ray.originX;
        candidate.originY = ray.originY;
        return candidate;
    }

    /**
        * Intersects a ray with one collider, if it has not been tested already
        * during this traversal.
        *
        * A collider filed in several buckets would otherwise be tested once per
        * bucket the ray crosses.
        *
        * @param {Ray}    ray      the ray to trace.
        * @param {object} collider the collider to test.
        * @param {number} stamp    marks this traversal.
        * @returns {?object} where the ray entered it, or null.
        * @private
    */
    intersectOnce(ray, collider, stamp) {
        if (collider.stamp === stamp) {
            return null;
        }
        collider.stamp = stamp;

        const contact = intersectRayAgainstRectangle(
            ray.originX, ray.originY, ray.directionX, ray.directionY,
            collider.minX, collider.minY, collider.maxX, collider.maxY,
        );
        if (!contact || contact.distance > ray.maxDistance) {
            return null;
        }
        if (contact.startedInside && ray.ignoreInside) {
            return null;
        }
        return contact;
    }

    /**
        * Reports the nearest collider the ray meets.
        *
        * Buckets are walked in order, and the search stops as soon as the best
        * contact so far lies closer than the exit of the current bucket, since
        * nothing further along can beat it.
        *
        * @param {Ray}    ray    the ray to trace.
        * @param {Filter} filter decides what counts as blocking.
        * @param {RayHit} target hit to fill.
        * @returns {?RayHit} the filled target, or null when the ray meets nothing.
    */
    nearest(ray, filter, target) {
        if (this.colliders.length === 0) {
            return null;
        }
        this.visitStamp++;
        const stamp = this.visitStamp;

        let bestDistance = Infinity;
        let found = null;

        walkGrid(
            ray.originX, ray.originY, ray.directionX, ray.directionY,
            ray.maxDistance, this.cellSize, this.maxSteps,
            (cellX, cellY, entryDistance, exitDistance) => {
                const bucket = this.buckets.get(cellX + ':' + cellY);

                if (bucket) {
                    for (const collider of bucket) {
                        const contact = this.intersectOnce(ray, collider, stamp);
                        if (!contact || contact.distance >= bestDistance) {
                            continue;
                        }
                        if (!filter(this.fillCandidate(ray, collider, contact))) {
                            continue;
                        }
                        bestDistance = contact.distance;
                        found = writeHit(target, this.candidate);
                    }
                }

                /*
                    * A collider straddling several buckets can be met before the
                    * ray leaves this one, so the search may only stop once the
                    * best contact lies behind us.
                */
                return bestDistance <= exitDistance;
            },
        );
        return found;
    }

    /**
        * Appends every collider the ray meets, unordered.
        *
        * @param {Ray}      ray     the ray to trace.
        * @param {Filter}   filter  decides what counts as blocking.
        * @param {RayHit[]} results array to append to.
    */
    collect(ray, filter, results) {
        this.each(ray, filter, candidate => {
            results.push(writeHit(new RayHit(), candidate));
            return false;
        });
    }

    /**
        * Visits every collider the ray meets, unordered.
        *
        * @param {Ray}      ray    the ray to trace.
        * @param {Filter}   filter narrows down what is reported.
        * @param {Function} visit  '(candidate) => boolean'; true stops the walk.
    */
    each(ray, filter, visit) {
        if (this.colliders.length === 0) {
            return;
        }
        this.visitStamp++;
        const stamp = this.visitStamp;

        walkGrid(
            ray.originX, ray.originY, ray.directionX, ray.directionY,
            ray.maxDistance, this.cellSize, this.maxSteps,
            (cellX, cellY) => {
                const bucket = this.buckets.get(cellX + ':' + cellY);
                if (!bucket) {
                    return false;
                }
                for (const collider of bucket) {
                    const contact = this.intersectOnce(ray, collider, stamp);
                    if (!contact) {
                        continue;
                    }
                    if (!filter(this.fillCandidate(ray, collider, contact))) {
                        continue;
                    }
                    if (visit(this.candidate)) {
                        return true;
                    }
                }
                return false;
            },
        );
    }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Raycaster
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
    * Casts rays against one or more sources.
    *
    * The caster owns no geometry. It normalises the ray, hands it to each source
    * in turn, and merges the answers by distance, shrinking the reach as it goes,
    * so a source queried later only has to look at the stretch of ray still in
    * play.
*/
export class Raycaster {

    /**
        * @param {RaySource|RaySource[]} [sources]        geometry to query.
        * @param {object}                [options]
        * @param {Filter}                [options.filter] filter used when a query does
        *                                                 not supply one.
    */
    constructor(sources = [], { filter = Filters.blocking } = {}) {
        /**
            * @type {RaySource[]} geometry queried by this caster, in the order given.
        */
        this.sources = Array.isArray(sources) ? sources.slice() : [sources];
        /**
            * @type {Filter} filter used when a query does not supply one.
        */
        this.filter = filter;
        /**
            * @type {Ray} object reused for every cast. @private
        */
        this.ray = {
            originX: 0,
            originY: 0,
            directionX: 1,
            directionY: 0,
            maxDistance: Infinity,
            ignoreInside: false,
        };
        /**
            * @type {RayHit} hit reused by sources that turn out not to be the winner. @private
        */
        this.scratchHit = new RayHit();
    }

    /**
        * Fills the shared ray, normalising the direction and refusing input that
        * cannot describe one.
        *
        * @param {number} originX     where the ray starts.
        * @param {number} originY     where the ray starts.
        * @param {number} directionX  direction of travel, any length.
        * @param {number} directionY  direction of travel, any length.
        * @param {number} maxDistance how far the ray reaches.
        * @param {object} options     options of the calling query.
        * @returns {?Ray} the prepared ray, or null when the input makes no sense.
        * @private
    */
    prepareRay(originX, originY, directionX, directionY, maxDistance, options) {
        const length = Math.hypot(directionX, directionY);
        if (!Number.isFinite(length) || length < EPSILON) {
            return null;
        }
        if (!Number.isFinite(originX) || !Number.isFinite(originY)) {
            return null;
        }

        const ray = this.ray;
        ray.originX = originX;
        ray.originY = originY;
        ray.directionX = directionX / length;
        ray.directionY = directionY / length;
        ray.maxDistance = maxDistance ?? Infinity;
        ray.ignoreInside = options.ignoreInside === true;
        return ray;
    }

    /**
        * Casts a ray and returns the nearest contact across every source.
        *
        * @param {number}  originX                where the ray starts.
        * @param {number}  originY                where the ray starts.
        * @param {number}  directionX             direction of travel, any length.
        * @param {number}  directionY             direction of travel, any length.
        * @param {number}  [maxDistance=Infinity] how far the ray reaches.
        * @param {object}  [options]
        * @param {Filter}  [options.filter]       decides what blocks the ray.
        * @param {boolean} [options.ignoreInside] skip geometry the ray starts inside of,
        *                                         which is what you want when casting from
        *                                         the edge of something already touching it.
        * @param {RayHit}  [options.target]       hit to fill instead of allocating one.
        * @returns {?RayHit} the nearest contact, or null when the ray meets nothing.
    */
    cast(originX, originY, directionX, directionY, maxDistance = Infinity, options = {}) {
        const ray = this.prepareRay(originX, originY, directionX, directionY, maxDistance, options);
        if (!ray) {
            return null;
        }
        const filter = options.filter ?? this.filter;
        const target = options.target ?? new RayHit();

        let found = null;
        for (const source of this.sources) {
            const hit = source.nearest(ray, filter, found ? this.scratchHit : target);
            if (hit) {
                if (found) {
                    Object.assign(found, this.scratchHit);
                }
                else {
                    found = target;
                }
                /*
                    * Whichever source answered shortens the ray for the rest.
                */
                ray.maxDistance = hit.distance;
            }
        }
        return found;
    }

    /**
        * Casts between two points.
        *
        * @param {number} startX    first point of the segment.
        * @param {number} startY    first point of the segment.
        * @param {number} endX      second point of the segment.
        * @param {number} endY      second point of the segment.
        * @param {object} [options] see {@link Raycaster#cast}.
        * @returns {?RayHit} the nearest contact, or null when the segment is clear.
    */
    castTo(startX, startY, endX, endY, options = {}) {
        const directionX = endX - startX;
        const directionY = endY - startY;
        return this.cast(
            startX, startY, directionX, directionY,
            Math.hypot(directionX, directionY), options,
        );
    }

    /**
        * Tells whether the straight segment between two points is unobstructed.
        *
        * @param {number} startX    first point of the segment.
        * @param {number} startY    first point of the segment.
        * @param {number} endX      second point of the segment.
        * @param {number} endY      second point of the segment.
        * @param {object} [options] see {@link Raycaster#cast}.
        * @returns {boolean} true when nothing blocks the segment.
    */
    lineOfSight(startX, startY, endX, endY, options = {}) {
        return this.castTo(startX, startY, endX, endY, options) === null;
    }

    /**
        * Collects every contact along a ray, nearest first.
        *
        * @param {number} originX                where the ray starts.
        * @param {number} originY                where the ray starts.
        * @param {number} directionX             direction of travel, any length.
        * @param {number} directionY             direction of travel, any length.
        * @param {number} [maxDistance=Infinity] how far the ray reaches.
        * @param {object} [options]              see {@link Raycaster#cast}.
        * @param {number} [options.limit]        keep only this many contacts.
        * @returns {RayHit[]} the contacts, ordered by distance.
    */
    castAll(originX, originY, directionX, directionY, maxDistance = Infinity, options = {}) {
        const ray = this.prepareRay(originX, originY, directionX, directionY, maxDistance, options);
        if (!ray) {
            return [];
        }
        const filter = options.filter ?? this.filter;
        const results = [];

        for (const source of this.sources) {
            source.collect(ray, filter, results);
        }
        results.sort((left, right) => left.distance - right.distance);

        if (options.limit !== undefined && results.length > options.limit) {
            results.length = options.limit;
        }
        return results;
    }

    /**
        * Visits everything a ray reaches, blocking or not, calling back once per
        * piece of geometry.
        *
        * This is the only query that reports empty cells, which is what makes it
        * the one to reach for when the floor a ray crosses matters as much as the
        * wall it stops at.
        *
        * With a single source nothing is allocated and the callbacks arrive in
        * traversal order. With several, the contacts are gathered and sorted by
        * distance first.
        *
        * @param {number}   originX     where the ray starts.
        * @param {number}   originY     where the ray starts.
        * @param {number}   directionX  direction of travel, any length.
        * @param {number}   directionY  direction of travel, any length.
        * @param {number}   maxDistance how far the ray reaches.
        * @param {Function} callback    '(candidate) => boolean'; return false to stop early.
        * @param {object}   [options]   see {@link Raycaster#cast}.
    */
    each(originX, originY, directionX, directionY, maxDistance, callback, options = {}) {
        const ray = this.prepareRay(originX, originY, directionX, directionY, maxDistance, options);
        if (!ray) {
            return;
        }
        const filter = options.filter ?? this.filter;

        if (this.sources.length === 1) {
            this.sources[0].each(ray, filter, candidate => callback(candidate) === false);
            return;
        }

        /*
            * Several sources cannot be streamed in order, so their candidates are
            * gathered first. They come from each source's own 'each', not from
            * 'collect', or this query would quietly stop reporting empty cells the
            * moment a second source was attached.
        */
        const results = [];
        for (const source of this.sources) {
            source.each(ray, filter, candidate => {
                results.push(writeHit(new RayHit(), candidate));
                return false;
            });
        }
        results.sort((left, right) => left.distance - right.distance);

        for (const hit of results) {
            if (callback(hit) === false) {
                return;
            }
        }
    }
}

export default Raycaster;