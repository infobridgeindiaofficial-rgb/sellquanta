# Third-party notices

SellQuanta's own source code is released under the MIT License (see `LICENSE`).
It depends on third-party open-source components that keep their own licenses.
The license text of each npm package is shipped inside that package in `node_modules`
and is included in the installed application where the package is bundled.

## Runtime components bundled in the Windows installer

| Component | License |
|---|---|
| Electron (includes Chromium and its bundled third-party libraries; see `LICENSES.chromium.html` in the installed app) | MIT (Electron); various permissive licenses and LGPL-2.1 for FFmpeg, as listed by Chromium |
| express, cors, multer and their dependencies | MIT / ISC / BSD-3-Clause |
| xlsx (SheetJS Community Edition 0.18.5) and its dependencies | Apache-2.0 |
| React, React DOM, scheduler | MIT |
| pdf.js (`pdfjs-dist`) | Apache-2.0 |
| NSIS (installer runtime, via electron-builder) | zlib/libpng |

## Icons

The outline icons in `client/src/icons.jsx` are drawn in the style of, and some paths follow,
[Lucide](https://lucide.dev) (ISC License, which includes parts derived from Feather Icons, MIT License).

ISC License — Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

## Optional external software (not bundled)

[Ollama](https://ollama.com) and vision models such as `qwen2.5vl:3b` are optional, installed separately by the user,
and are not distributed with SellQuanta.
