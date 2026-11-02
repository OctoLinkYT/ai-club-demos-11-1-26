# Element Lab

A colorful, offline falling-sand sandbox for an AI club showcase.

## Launch

Open **index.html** directly in a modern browser. No installation, server, internet connection, or build step is needed. Keep `index.html`, `style.css`, `simulation.js`, and `app.js` together.

## Play

- Select Sand, Water, Wall, Fire, Plant, or Eraser, then click/touch and drag inside the sandbox.
- Adjust **Brush size** for finer details or larger strokes. The size is measured in simulation cells, not screen pixels.
- **Pause** freezes physics while still allowing painting. **Resume** continues.
- **Clear** empties the grid. **Load example** resets it to sand above a water basin and a connected plant grove; it preserves the current pause state.
- Try adding fire beside the example plants, or erase part of the basin to release its water.
- Keyboard: Tab through controls; Enter/Space activate buttons. Keys **1–6** select tools. **Space** pauses when focus is outside buttons and the size slider. With the canvas focused, **arrow keys** position the cursor and **Enter** paints.

## Rules

The fixed 240 × 150 grid has closed boundaries. Sand falls, slides diagonally, piles up, and sinks through water. Water falls, moves diagonally, then spreads sideways when blocked. Walls and plants remain stationary. Fire ignites plants in the four immediately neighboring cells, then disappears after its finite lifetime. Adjacent water extinguishes fire. Drawing only fills empty cells; use Eraser to remove existing material. Nothing crosses walls or exits the grid.

The simulation uses typed arrays and a bottom-up update with alternating horizontal traversal. Updates are capped after long frame gaps. Resizing changes the display size without resetting the grid. This is a playful cellular model: water has no pressure simulation, fire does not rise, and plants do not grow. Tall mobile canvases stretch the cells to provide a larger painting area. A single pointer paints at a time.

## Tests

With Node.js installed, run:

```sh
node tests.js
```

This runs ten deterministic simulation checks covering initialization, all material brushes/eraser, sand settling and piling, sideways water flow, stationary walls/plants, fire propagation and burnout, extinguishing, clearing, and boundaries.

For browser integration checks, run:

```sh
node browser-check.js
```

This uses only Node built-ins and a locally installed Chrome. It defaults to the standard Windows Chrome path; set `CHROME_PATH` to your Chrome executable elsewhere. It opens local files, uses a local browser debugging connection, and creates a disposable profile in `.browser-profile/automation`. No external requests are needed by the test or app. The automated Chrome instance runs headlessly with its sandbox disabled for this restricted environment; it visits only this project's local pages.

The harness exercises `tests.html`, checks all tool selections and keyboard brushes, pause/resume and clear, a 375px layout, mouse painting/erasing, and emulated touch dragging. It saves a text report and desktop/narrow screenshots in `verification/`. You can also open `tests.html` manually; browsers that block access between local-file frames require the automated runner above for the interface portion.

### Verified in this build

- All 10 Node simulation checks passed; JavaScript syntax checks passed.
- All browser interface assertions passed in local headless Chrome, including initialization, every tool, material addition, pause/resume, and clearing.
- Native browser mouse drag, eraser drag, and emulated touch drag passed.
- 375px layout assertions passed: no horizontal overflow and all controls within the page width. Desktop (1440px) and narrow (375px) screenshots were visually inspected. Short screens can scroll outside the canvas to reach lower controls.

Not verified: physical touchscreen devices, other browser engines, or screen-reader behavior. No frame-rate benchmark was performed. Browser screenshots and runtime profiles are generated test artifacts, not app dependencies.
