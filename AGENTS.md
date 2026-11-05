# Notes for AI agents

How this repository is organised and the conventions it follows. Read this before changing anything here.

## What this is

A 2D ray casting library for grids of square tiles and loose axis aligned rectangles. It answers one question in several shapes: what does a ray hit?

The whole library is `src/raycast.js`. It has no dependencies and no build step.

```
src/raycast.js      the library
examples/           ten pages, plus index.html, script.js and style.css
tests/              spec.js, expect.js and the node runner
```

## Running the tests

```
npm test
```

29 specs, run with the Node test runner. There is nothing to install. Run them before committing any change to `src/raycast.js`.

The examples have no automated coverage. They are tested by opening them in a browser, which needs a server because browsers refuse ES modules over `file://`.

## What belongs in the library and what does not

The library holds no state, moves nothing and leaves every decision to the caller. Sweeping a volume, resolving an overlap and deciding which surfaces count as obstacles this frame belong to the code built on top.

Before adding a feature, check whether it can be written as a filter or as a few lines in an example. If it can, it stays out of the library. This is the main design decision of the project, and most proposed additions fail it.

Geometry lives in sources, never in the caster. A source is any object with `nearest`, `collect` and `each`. There is no base class and no registry.

## Conventions in the library

Comments are block comments shaped like this, with the content indented by four spaces:

```js
    /**
        * Casts a ray and returns the nearest contact.
        *
        * @param {number} originX where the ray starts.
    */
```

A block that documents a declaration opens with `/**`, so the JSDoc tags are read by tooling. An explanation inside a function body opens with `/*`.

Other rules that apply to the library: `else` goes on its own line, never on the same line as the closing brace; `else if` is never used, write `else {` and open a new `if` inside it; loop counters are `i`, `j` and `k`, whatever is being iterated; prefer `const`, and use `var` only where the value is reassigned; use single quotes, including inside comments.

## Conventions in the examples

Each page is self contained and imports the library directly from `../src/raycast.js`. The code you read in an example is the code that runs, so the pages carry no comments and no abstractions of their own.

What is shared between pages lives in `examples/script.js`: the list of examples, the drop down menu, the results table and three formatters. What is specific to a page stays in the page, even when it looks similar to another page.

Functions in a page are ordered `generate`, `draw`, `report`, then the functions those call, then the helpers. `pointerAt` and `moveEnd` come last and are identical everywhere.

When adding an example, add an entry to `examples` in `script.js`. The index page and the drop down menu both read from it, so there is no second list to keep in step.

## Things that have broken before

Importing a name from `script.js` and also declaring a function with that name in the same page is a syntax error, and the page silently renders nothing. After adding an import, check that no function in the page shares its name.

`cellOf` takes the grid as a second argument. Calling it with one argument throws inside `report`, which leaves the canvas blank with only a console error to show for it.

Both of those produce a page that looks broken rather than an error anyone would notice, so open every example after touching `script.js` or `style.css`.
