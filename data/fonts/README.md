# Fonts

Two files, committed on purpose, and the reason is a silent failure rather than
convenience.

`@resvg/resvg-js` renders the social cards, and it needs a font to draw text
with. **System font discovery does not work on the deployment image, and it does
not tell you.** Measured on `node:24-slim`, rendering the same SVG:

| | PNG size |
|---|---|
| no fonts installed, `loadSystemFonts: true` | 492 bytes |
| `fonts-dejavu-core` installed, same option | 492 bytes |
| explicit `fontFiles: [...]` | 3,968 bytes |

492 bytes is the background rectangle with the text **dropped**. No error, no
warning, a valid PNG returned. A card renderer written against `loadSystemFonts`
would ship blank cards and pass any test that only checks a PNG came back.

So the font is passed explicitly, which also makes a card render identically on a
laptop and in the container instead of depending on what each has installed.

Committing 810KB beats `apt-get install fonts-liberation2`, which costs 21MB
**and does not work** for the reason above.

## Why Liberation Sans

Metrically compatible with Arial, which is what `lib/style.js` specifies for the
pages themselves — so a card looks like the page it came from.

## Licence

SIL Open Font License 1.1. `LICENSE` here is Debian's copyright file for
`fonts-liberation2`, carrying the full OFL text and the notice the licence
requires be redistributed with the files:

> Digitized data copyright (c) 2010 Google Corporation with Reserved Font Arimo,
> Tinos and Cousine.
> Copyright (c) 2012 Red Hat, Inc. with Reserved Font Name Liberation.

The OFL has a **Reserved Font Name** clause: a modified version may not be called
Liberation. These files are unmodified, copied from `fonts-liberation2`.
