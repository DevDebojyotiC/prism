# Prism Logo Kit (3D)

The mark is the site's 3D glass prism: extruded front and side faces, a lit
top edge, specular streak, entry glow where the beam strikes the glass,
internal pre-split dispersion, exit glows, and soft dispersion cones behind
each of the four beams.

All type is converted to vector paths, so every file renders identically
everywhere with zero font dependencies. SVGs are the masters; PNGs are
pre-rendered for platforms that need raster.

## Files

svg/ and png/
- prism-mark-dark / prism-mark-light: icon only, transparent background.
  Dark = for dark surfaces (white beam), Light = for light surfaces.
- prism-avatar-dark / prism-avatar-light: 512px square profile picture,
  circle-crop safe (X, GitHub, Discord, LinkedIn). @2x = 1024px.
- prism-lockup-dark / prism-lockup-light: horizontal mark + wordmark,
  transparent background. For README headers, docs, slides.
- prism-banner-1500x500: X/Twitter header. @2x for retina.
- prism-social-1280x640: GitHub social preview and Open Graph image. @2x too.

## Colors

Spectrum (wordmark, triangle stroke, beams):
violet #b06bf9 > blue #5b8bf7 > teal #2dd4bf > amber #f5a524
Light-surface variants use the darker set:
#8f4de6 / #3e6ee8 / #0aa79a / #d9880c... (mark/lockup-light use site light tokens)
Backgrounds: #050508 to #0c0c16.

## Type and licenses

Wordmark: Clash Display Bold (Indian Type Foundry via Fontshare,
Fontshare Free Font License: free for personal and commercial use).
Small text: JetBrains Mono (SIL Open Font License 1.1).
Both licenses permit logo and commercial usage. Outlined text in these
files is a derivative allowed by both licenses.

## Usage notes

- Prefer the avatar files for anything that circle-crops.
- Keep clear space around the lockup of at least the triangle's width / 3.
- Do not recolor the beams individually; they are the four caption voices
  (Formal, Sarcastic, Tech, Everyday) and match the product UI.
