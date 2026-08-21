# vendor

`public/index.html` uses these two libraries for Markdown rendering and HTML sanitization.
They used to be loaded from the jsdelivr CDN with a floating major version
(`marked@9`, `dompurify@3`) and no Subresource Integrity — since the version was
floating, no fixed SRI hash could be pinned, so an update on the CDN side could
silently change the code pocket-claude serves. Vendoring pins an exact version
and removes the runtime dependency on any external network access.

| File | Library | Version | License |
|---|---|---|---|
| `marked.min.js` | [marked](https://github.com/markedjs/marked) | 9.1.6 | MIT |
| `purify.min.js` | [DOMPurify](https://github.com/cure53/DOMPurify) | 3.4.14 | Apache-2.0 OR MPL-2.0 |

Both files were fetched unmodified from jsdelivr's pinned-version URLs:

```
https://cdn.jsdelivr.net/npm/marked@9.1.6/marked.min.js
https://cdn.jsdelivr.net/npm/dompurify@3.4.14/dist/purify.min.js
```

Each file still carries its original license header at the top. To update,
fetch a newer pinned version from the same source and update the version
numbers here.
