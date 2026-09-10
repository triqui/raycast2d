/**
 * @file expect.js — the handful of assertions the specs are written against.
 *
 * Deliberately small and dependency-free, so the same cases run under
 * `node --test` and inside a browser page without changing a line.
 */

/**
 * Raised when an assertion does not hold.
 */
export class AssertionError extends Error {

    /**
     * @param {string} message what went wrong.
     */
    constructor(message) {
        super(message);
        this.name = 'AssertionError';
    }
}

/**
 * Renders a value for an error message.
 *
 * @param {*} value the value to describe.
 * @returns {string} a short readable form.
 * @private
 */
function describe(value) {
    if (typeof value === 'string') {
        return JSON.stringify(value);
    }
    if (value === null || value === undefined || typeof value !== 'object') {
        return String(value);
    }
    if (Array.isArray(value)) {
        return '[' + value.map(describe).join(', ') + ']';
    }
    return value.constructor ? value.constructor.name : 'object';
}

/**
 * Compares two values structurally.
 *
 * @param {*} left  first value.
 * @param {*} right second value.
 * @returns {boolean} true when they hold the same contents.
 * @private
 */
function sameContents(left, right) {
    if (left === right) {
        return true;
    }
    if (Array.isArray(left) && Array.isArray(right)) {
        if (left.length !== right.length) {
            return false;
        }
        return left.every((item, index) => sameContents(item, right[index]));
    }
    return false;
}

/**
 * The assertions the cases are written against — a deliberate handful, so the
 * specs stay portable between Node and a browser.
 *
 * @namespace
 */
export const assert = {

    /**
     * Fails unless the two values are strictly equal.
     *
     * @param {*}      actual   the value produced.
     * @param {*}      expected the value wanted.
     * @param {string} [message] what this check is about.
     */
    equal(actual, expected, message) {
        if (actual !== expected) {
            throw new AssertionError(
                (message ? message + ': ' : '') + describe(actual) + ' should be ' + describe(expected),
            );
        }
    },

    /**
     * Fails when the two values are strictly equal.
     *
     * @param {*}      actual    the value produced.
     * @param {*}      unwanted  the value it must not be.
     * @param {string} [message] what this check is about.
     */
    notEqual(actual, unwanted, message) {
        if (actual === unwanted) {
            throw new AssertionError(
                (message ? message + ': ' : '') + 'should not be ' + describe(unwanted),
            );
        }
    },

    /**
     * Fails unless the two values hold the same contents.
     *
     * @param {*}      actual   the value produced.
     * @param {*}      expected the value wanted.
     * @param {string} [message] what this check is about.
     */
    deepEqual(actual, expected, message) {
        if (!sameContents(actual, expected)) {
            throw new AssertionError(
                (message ? message + ': ' : '') + describe(actual) + ' should be ' + describe(expected),
            );
        }
    },

    /**
     * Fails unless the value is truthy.
     *
     * @param {*}      value     the value to check.
     * @param {string} [message] what this check is about.
     */
    ok(value, message) {
        if (!value) {
            throw new AssertionError(message || 'expected a truthy value, got ' + describe(value));
        }
    },
};


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
 * @returns {{grid: TileGrid, raycaster: Raycaster}} the pair.
 */
function roomCaster(definitions) {
    const grid = new TileGrid({ map: room(), tileSize: 16, definitions });
    return { grid, raycaster: new Raycaster(grid) };
}

