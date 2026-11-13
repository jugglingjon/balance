# Balance

A yoga pose balance simulator. Drag the joints of a simple mannequin and watch
its centre of gravity move: a pose is balanceable only while the centre of
gravity stays above whatever is touching the floor.

Live: https://jugglingjon.github.io/balance/

## Develop

```bash
npm install
npm run dev
```

`npm run build` writes the static site to `dist/`. Pushing to `main` deploys it
to GitHub Pages.

## How it works

- `src/skeleton.js` – the body as 16 rigid segments with masses and floor contacts
- `src/presets.js` – starting poses
- `src/balance.js` – centre of gravity, base of support and the balance test
- `src/rig.js`, `src/handles.js` – drag handles, anchored at what is on the floor
- `src/constraints.js` – planted hands and feet (two-bone IK), the floor and joint limits
- `src/mannequin.js` – draws the figure by driving the model's bones
- `tools/build-rig.mjs` – offline step that prepares the model (see below)

## Credits

The mannequin is the [Open 3D Mannequin](https://github.com/gdquest-demos/godot-3d-mannequin)
by GDQuest and contributors (https://www.gdquest.com/), character by Luciano Muñoz,
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Changes made here: the animation clips and unused vertex attributes were removed
and the mesh was quantized (`tools/build-rig.mjs`). At run time some bones are
scaled to give the figure adult proportions (smaller head, longer arms, slimmer
chest). The original file is kept in `assets-src/`.
