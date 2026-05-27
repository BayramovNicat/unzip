# @holmityd/unzip

A tiny TypeScript ZIP reader for browsers and backend runtimes.

```ts
import { extractZipEntry, findZipEntry, listZipEntries, unzip } from '@holmityd/unzip'
```

## API

- `unzip(bytes)` lists and extracts every non-directory entry.
- `listZipEntries(bytes)` lists entry metadata without extracting file data.
- `findZipEntry(bytes, selector)` finds one entry without extracting file data.
- `extractZipEntry(source, selector)` extracts one entry.
- `extractZipEntry(source, selectors)` extracts entries matching any selector.

Selectors can be an exact filename, a regular expression, or a predicate.

See the repository README for full usage: https://github.com/BayramovNicat/unzip#readme
