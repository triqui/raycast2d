/**
    * @file raycast.test.js, Node runner for the specs.
    *
    * Run with 'npm test'.
*/

import test from 'node:test';

import { specs } from './spec.js';

for (const spec of specs) {
    test(spec.name, () => spec.run());
}
