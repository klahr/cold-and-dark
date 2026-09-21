# Cessna 172 — Engine Start Trainer

An interactive 3D cockpit in the browser, built to teach one thing properly:
how to start a light aircraft engine, and why each step of the checklist
exists.

It is not a flight simulator — the aeroplane never moves. But everything from
the battery master to the oil pressure gauge is simulated, the checklist is
verified against that simulation rather than taken on trust, and the mistakes
people actually make are modelled and explained.

| Aircraft | Engine | What it teaches |
|---|---|---|
| Cessna 172N Skyhawk | Carburetted Lycoming O-320 | Primer strokes, carburettor heat, flooded-engine recovery |
| Cessna 172S Skyhawk SP | Fuel-injected Lycoming IO-360 | Boost-pump priming, cranking at idle cutoff, advancing the mixture as it fires |

## Running it

```bash
npm install
npm run dev        # http://localhost:5173

npm test           # simulation test suite (no browser needed)
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production bundle
```

No asset files and no external services: the cockpit geometry, every surface
texture, the instrument faces and the engine sound are generated at runtime.

## Using it

| Action | How |
|---|---|
| Look around | Drag anywhere that is not a control (right-drag always looks) |
| Zoom | Scroll |
| Jump to an area | Number keys `1`–`6`, or the bar along the bottom |
| Operate a switch | Click it |
| Pull or push a knob | Drag it up to push in, down to pull out |
| Turn a selector or the key | Click to step round a detent, or drag |
| Crank the starter | Press **and hold** on the ignition key at START |
| Hide the control wheel | `Y`, or the "Hide yoke" button |
| Free orbit camera (dev) | `Shift`+`O`; `Esc` returns you to the seat |

**Practice** mode highlights the control the current item asks for, verifies
you did it, and explains why the step is there. **Timed** mode runs a clock
from go until the engine is running and the after-start items are done.

| Difficulty | What you get | Mistake penalty |
|---|---|---|
| Easy | Next item, why it matters, control lit up | +5 s |
| Normal | The checklist and your progress — no reasoning, nothing highlighted | +10 s |
| Hard | Nothing. Start it from memory. | +15 s |

Difficulty changes only how much the trainer tells you; the aeroplane behaves
identically at every level. Mistakes cost time rather than ending the run.

There is no "acknowledge" button — every checklist line is a real action,
including the ones usually hand-waved: throwing the seat latch, working the
door handle, pulling the control lock. The propeller-area check reads your
head direction, so you have to actually look out of both windows.

## What is simulated

- **Electrical** — battery charge with voltage sag under a 160 A starter load,
  alternator that only produces above ~900 RPM, split master, per-switch
  current draw, ammeter, low-voltage warning. Continuous cranking flattens the
  battery in about ninety seconds.
- **Fuel** — two tanks, selector valve, carburettor float bowl, primer
  strokes, boost-pump priming on the injected aircraft.
- **Ignition** — magnetos live regardless of the master, spring-loaded START
  detent, starter duty cycle with thermal lockout.
- **Engine** — state machine over `off → cranking → catching → running →
  dying`, with prime charge, flood level, RPM dynamics, oil pressure and
  temperature lags, and the thirty-second oil pressure rule.
- **Vacuum** — engine-driven pump, suction gauge, gyros that take most of a
  minute to erect, heading indicator that precesses and must be reset.

Mistakes it will let you make, each raising a typed fault the coaching layer
turns into plain language:

| What you do | What happens |
|---|---|
| Mixture at idle cutoff (carburetted) | Cranks and cranks, never fires |
| Fuel selector OFF | Catches on the float bowl, runs, then quits |
| Master switch off | Starter does not turn; panel is dead |
| No prime on a cold engine | Will not catch |
| Over-prime (8+ strokes, or 7+ s of boost pump) | Flooded; only the POH clearing procedure recovers it |
| Crank for more than fifteen seconds | Starter thermal lockout, then a cooling period |
| Repeated cranking | Battery sags, starter slows, eventually nothing |
| Hold the key past the catch | Starter grinding against the ring gear |
| Throttle wide open for the start | Warning about firing at high RPM on cold oil |
| Injected: mixture left at cutoff after it fires | Engine dies a few seconds later |

## Virtual reality

Press **Enter VR** with a WebXR headset connected. The reference space is
`local`, so wherever your head is becomes the left seat. Both controllers get
a pointer ray, and every gesture runs through the same `ControlObject`
interface the mouse uses — so the spring-loaded starter detent and the drag
scaling behave identically in VR with no duplicated control logic. Guided
mode moves onto a kneeboard card beside the panel, since the DOM overlay does
not exist inside a headset.

## Architecture

The load-bearing rule is that **`src/sim/` never imports three.js**. The
simulation is pure, deterministic, `tick(dt)`-driven TypeScript, so it can be
unit-tested headlessly and the renderer is a replaceable view of it.

```
src/
  sim/            pure simulation — no three.js, no DOM
    Simulation.ts      root; fixed-substep tick
    ControlState.ts    id → numeric value, the single source of truth
    Checklist.ts       verifies checklist items against the simulation
    Challenge.ts       the timed game: difficulty, penalties, best times
    PilotState.ts      where the pilot is looking, for the prop-area check
    Faults.ts          typed failures with plain-language explanations
    systems/           Electrical, Fuel, Ignition, Engine, Vacuum
  aircraft/       every aeroplane, as data
    types.ts           ControlDef, InstrumentDef, ChecklistItem, params
    registry.ts        the list of available aircraft
    shared/            panel furniture and the steam-gauge panel builder
    c172n/ c172s/      panel, instruments, checklists, systems per type
  render/         three.js; knows about control *kinds*, not aeroplanes
    loft.ts            lofted surfaces
    fuselage.ts        the hull, as cross-sections; drives skin and lining
    panelShape.ts      panel outline, cut to the cabin
    textures.ts        procedural albedo/roughness/normal generation
    airport.ts         the airfield
    postfx.ts          GTAO, vignette and SMAA composer chain
  input/          seated camera, pointer gesture router, WebXR controllers
  audio/          procedural WebAudio engine, starter and switch sounds
  ui/             DOM overlay: checklist, coaching, tooltips, status
```

**Adding an aircraft.** Everything an aeroplane *is* lives under
`src/aircraft/<id>/`: `systems.ts` (engine, electrical, fuel parameters),
`panel.ts` (control layout in panel-local metres, composing the shared
helpers in `aircraft/shared/kit.ts`), `checklists.ts` (the procedure, with a
`satisfied` predicate and a `why` per item), and `index.ts` to assemble them.
Register it in `aircraft/registry.ts`. The renderer switches on `ControlKind`
to pick a mesh factory and a drag gesture, and the simulation only reads
control values by id, so neither needs to change. The C172S is the worked
example: three data modules plus a call to the same panel builder the C172N
uses.

**Coordinates.** World axes are `+X` right, `+Y` up, `−Z` forward, origin on
the cabin floor on the centreline at the seat datum. Panel-mounted things are
authored in *panel space*: a flat `(x, y)` on the panel face, `z = 0` on the
surface, `+z` toward the pilot. See `src/render/frame.ts`.

**Interior geometry** is derived from the hull rather than authored by hand.
`cabinHalfWidthAt(z, y)` in `fuselage.ts` gives the cabin's inner surface, and
the panel outline, the floor pan, the glareshield and the cabin fittings all
take their width from it — so nothing can end up wider than the cabin it sits
in.

## Testing

`npm test` runs headlessly — no browser, no renderer:

- a golden start that follows the POH and asserts the engine runs, makes oil
  pressure and charges the battery;
- one negative test per row of the mistakes table above;
- a shutdown test asserting the aeroplane ends up genuinely dead;
- a determinism test running the same inputs at 30 Hz and 120 Hz;
- a registry test that every aircraft builds and every checklist item
  references a control that exists;
- a panel-fit test that every instrument, control and placard lies inside the
  panel outline, and the outline inside the cabin.

The last is the only test touching `src/render/`; the geometry it checks is
pure arithmetic over the hull loft and needs no DOM.

## Accuracy and its limits

Published figures are used where they exist: usable fuel, RPM limits, the
thirty-second oil pressure rule, the starter duty cycle, the POH checklist
order and wording. Numbers that are not published — how much prime a cold
engine wants, how long the float bowl keeps it alive — are tuned to put the
POH's own guidance in the middle of the working range, with the reasoning
written next to the constants in `src/aircraft/*/systems.ts`.

Airframe dimensions are checked by measuring the assembled scene: length
8.30 m (published 8.28), height 2.73 m (2.72), wingspan 11.18 m (10.92 — the
excess is all in the wingtip fairings). Panel geometry is approximated from
photographs and cabin drawings, not drawings of record.

**This is a teaching aid, not a certified training device.** Fly the real
checklist from the real POH.

## Licence

GNU Affero General Public License v3.0 or later — see [LICENSE](LICENSE).

The AGPL's network clause is the point: this runs in a browser, so anyone you
serve it to is entitled to the source it was built from.

Known compromises, all commented where they live: the beacon and strobes tint
the airframe material rather than using real lights, because three.js filters
lights against the camera's layers rather than per object; the wing casts no
shadow, because the sun's shadow camera only covers the cabin. The airfield is
a plausible light-aircraft field rather than a real one — no identifier, the
runway designators match no magnetic heading, the radio frequencies belong to
nothing, and the ground is flat to the horizon.
