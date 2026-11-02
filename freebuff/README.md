# Element Lab

A playful falling-sand sandbox for the AI club showcase. Pick an element, paint it into the tray, and watch sand pile up, water flow, walls block, and fire burn through plants.

Everything is plain HTML, CSS and JavaScript. There is no build step, no server, no network request and no external asset.

## Launch

Open `index.html` in a modern browser (Chrome, Edge, Firefox or Safari). That is the whole setup.

You can also serve the folder if you prefer a URL:

```sh
python -m http.server 8000
# then visit http://localhost:8000
```

The second option is only a convenience; the app works directly from `file://`.

## How to use

1. Pick an element from the **Elements** panel: Sand, Water, Wall, Fire, Plant or Eraser.
2. Click or drag inside the dark tray. The circular cursor previews your brush.
3. Change the **Brush size** slider to paint bigger or smaller amounts.
4. **Pause** freezes the simulation (painting still works). **Clear** empties the grid completely. **Example** reloads the little demo scene, including a burning bush.

Keyboard and touch:

- `1`–`6` select Sand, Water, Wall, Fire, Plant and Eraser.
- `Space` pauses or resumes (when focus is not on a button).
- `C` clears the grid; `E` reloads the example.
- Tool buttons, the slider and the action buttons are reachable with `Tab` and show a bright focus ring.
- Touch dragging paints; the page does not scroll while your finger is on the tray.

The starting scene contains a sand dune, a water tank held by walls, a plant garden and a small spark. Erase one of the tank walls to let the water out, or paint more fire next to a plant.

## Materials and rules

| Material | Behaviour |
| --- | --- |
| **Sand** | Falls straight down, slides diagonally to form piles, and sinks through water (the water is displaced upward). |
| **Water** | Falls, slides diagonally, and when blocked flows sideways along the row (up to 5 cells per step) until a wall or material stops it. |
| **Wall** | Completely static. Sand, water and fire cannot pass through it or destroy it. |
| **Fire** | Stays in place and burns out after roughly 2.4 seconds (140 simulation steps, with some variation). It always ignites touching plant cells, which then burn for a little longer. Water next to fire puts it out. |
| **Plant** | Stationary until fire touches it. Burning plant becomes fire and eventually leaves empty space. |
| **Eraser** | Removes any material, including walls and fire. |

The grid is bounded on all sides: material can never leave the tray. Out-of-bounds cells behave as solid walls internally.

## Testing

The tests are dependency-free Node scripts. The browser test requires Node 22 or newer because it uses the built-in `fetch` and `WebSocket` APIs; the engine test runs on older Node versions too.

```sh
# Simulation engine: gravity, piling, water flow, walls, fire, boundaries, clear, resize
node tests/sim.test.js

# Real browser check in headless Chrome (UI, painting, pause, clear, fire, touch, narrow layout)
node tests/browser.test.js
```

If Chrome is not in a standard location, set `CHROME_PATH` before running the browser test:

```sh
CHROME_PATH="/path/to/chrome" node tests/browser.test.js
```

The browser test drives `index.html` through the Chrome DevTools Protocol, clicks the real controls and paints with real mouse and touch events. It saves `tests/artifacts/desktop.png` and `tests/artifacts/narrow.png` so the layout can be inspected.

## Known limitations

- The grid is capped at 220 × 150 cells. Larger windows get more cells; very large displays do not keep increasing the resolution.
- The simulation targets about 60 steps per second using `requestAnimationFrame`, but the actual rate depends on the display and device. No fixed frame rate is claimed.
- This is a lightweight cellular sandbox: water has no pressure model, and there is no steam, ash, temperature, wind, save/load or undo.
- Fire ignition is intentionally deterministic (any touching plant catches), rather than probabilistic.
- Resizing anchors surviving material to the bottom-left; shrinking the window can clip material on the right or top.
- Painting requires a pointer (mouse, pen or finger). Keyboard users can operate every button, slider and shortcut, but cannot paint cell-by-cell with the keyboard.
- Audio is not used.
