# Art: what exists, and what the full game would need

`node tools/art-needs.mjs` prints the counts below from the game's own tables.

## What is here now

| | From | Count |
| --- | --- | --- |
| Monster sprites | Pawst Lives, copied as they are | 12 (three you start with, eight met in the garden, the Sprinkler Hydra) |
| Room paintings | Pawst Lives, copied as they are | 8 (the garden is used in fights; all eight appear as the little window in each building) |
| Font | Pawst Lives | Fredoka, with its licence |
| Heirloom (rare colour) sprites | Recoloured in code by `tools/heirlooms.py` | 11 |
| The house-sitter | **Generated for this game** | 4 candidate looks (`sitter_a` to `sitter_d`); the four images agreed so far |

The four candidates used the Pawst Lives sprite style prompt word for word (`tools/art-manifest.mjs`), the same model and the same sizes. They match its outline, shading and colour, but one thing is off and should be decided before more people are painted: **they came out taller and slimmer than the Pawst Lives cats**, about three and a half heads tall where the cats are about two. The next round should ask for "very large head, about two heads tall" so people sit beside the monsters at the same scale.

Everything on the ground in the lane and inside the garden (grass, the stepping-stone path, hedges, trees, lamps, the gate and all nine buildings) is **drawn in code**, in `web/js/ui/scenery.js`. It is drawn with care, in the look of the sprites (a bold outline, flat colour, one band of light and one of shade), and every place has a building of its own: a cottage, a potting shed with a greenhouse, a brick lean-to with bins, a shop with an awning, a launderette with a porthole, a library, a tall townhouse, a clock tower and a boarded-up shed. It is still a stand-in for painted art: painted buildings and ground would sit beside the monsters more naturally.

## New art the full game would need

| Count | What | Notes |
| --- | --- | --- |
| 1 | The house-sitter, final sprite | One of the four candidates, or a repaint at Pawst Lives proportions. |
| 4 | The cast | Great-aunt Maribel, Dov, Ines Tock, Mr. Spick. |
| 40 | Grown-up forms | One per kind. Eleven are named (below); twenty-nine still to design. Bosses do not grow. |
| 1 | The lane | One painted map to walk on. |
| 9 | Buildings seen from the lane | Home and the eight places. |
| 8 | The inside of each place | A painted map to walk through. This is the big new cost of the walk-in world: the Pawst Lives room paintings are side views, good for fights, not for walking on. |
| 13 | Things to walk round | Hedge, tree, gate, lamp, fence, and one special thing per place (the sprinkler, the washing line...). |
| 17 | Icons | Six elements, three Calls, three stats (Health exists), four tabs, the Heirloom mark. |
| 2 | App icon and title art | Once the game has its name. |
| **95** | **new images** | |

Needs **no** new images:

- **Heirlooms**: rare colours for all 40 kinds and their 40 grown forms are recoloured in code (80 sprites, free). A hand-painted one can replace any recolour later.
- **Fights**: the 8 room paintings and all 48 Pawst Lives monster sprites are used as they are.

Optional, not counted: a second and third view of the house-sitter (from the front and from behind) so they turn as they walk, and the same for the cast if they ever walk with you.

## The eleven grown-up forms named so far

| Kind | Grows up into | One line for the painter |
| --- | --- | --- |
| Dust Bunny | Dust Jackalope | The same dust rabbit, bigger, with antlers made of bent wire coat hangers. |
| Sock Eel | Stocking Serpent | A long thigh-high stocking sea serpent with a darning-needle fin. |
| Toast Ghost | Toastie Phantom | A toasted-sandwich ghost trailing a cloak of melted cheese. |
| Dandepuff | Dandemane | A dandelion lion: a full seed-head mane on a leafy body. |
| Thornhog | Bramble Boar | A boar grown from a whole rose hedge, thorn tusks, three roses. |
| Grumblebee | Rumblebee | A heavier, armoured bee with a fencing foil for a sting. |
| Snailor | Snadmiral | The snail in an admiral's hat, its shell a little galleon. |
| Grumpy Gnome | Gnomarch | The gnome crowned with a flowerpot, a wheelbarrow for a throne. |
| Cap Beetle | Corkscrew Stag | A stag beetle with a corkscrew horn and a shell of many caps. |
| Sparkplug | Surge Protector | A knightly power strip: six sockets for a visor, cable for a cape. |
| Ratscal | Ratscallion | The rat in a colander helmet with a spatula halberd. |

## Making art

```sh
NODE_USE_ENV_PROXY=1 node tools/gen-art.mjs   # generates only what is in the manifest and missing. Costs money.
python3 tools/process-art.py                  # trims and sizes art/raw/ into web/assets/, archives originals as WebP
python3 tools/heirlooms.py                    # repaints every Heirloom; contact sheet in art/review/heirlooms.jpg
```

Nothing is generated unless it is listed in `tools/art-manifest.mjs`, and nothing goes on that list until it has been agreed.
