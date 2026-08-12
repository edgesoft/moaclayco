# Banner assets

## Sources

- `source/background3-original.jpg` is the untouched original banner.
- `reference/chatgpt-element-reference.png` is the supplied, AI-generated
  element sheet. It is a useful high-resolution interpretation, but it is not
  pixel-identical to the original drawing.

## Original-based animation layers

- `master/banner-master.svg` is the complete vectorized original banner.
- `animation-svg/` contains 24 transparent layers split from the original:
  five bees, two suns, two snail groups and fifteen connected garden layers.
- `animation-elements.json` contains file paths, view boxes and animation
  anchors for those layers.
- `animation-element-sheet.png` renders every layer on both white and dark
  backgrounds for visual QA.

## Supplied-reference elements

- `reference-elements-png/` contains 48 cleaned transparent cutouts from the
  supplied element sheet.
- `reference-elements-svg/` contains path-based SVG versions of all 48
  cutouts.
- `reference-elements.json` is their manifest.
- `reference-element-sheet.png` and `reference-svg-sheet.png` are the PNG and
  SVG visual QA sheets.

The live header has not been switched to these assets yet. That should happen
only after choosing whether the final animation uses the original-based layers,
the polished reference interpretation, or a deliberate combination of both.
