import './style.css'
import { unzip, type ZipEntry } from '@holmityd/unzip'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<main class="app-shell">
  <section class="topbar">
    <div>
      <p class="eyebrow">Browser ZIP extractor</p>
      <h1>Unzip files locally</h1>
    </div>
    <label class="upload-button" for="zip-input">
      <span aria-hidden="true">+</span>
      Upload ZIP
    </label>
    <input id="zip-input" type="file" accept=".zip,application/zip,application/x-zip-compressed" />
  </section>

  <section id="drop-zone" class="drop-zone" tabindex="0">
    <div class="drop-icon" aria-hidden="true">ZIP</div>
    <div>
      <h2>Drop, paste, or choose a ZIP file</h2>
      <p>The archive is read in this tab. Stored and deflated entries can be downloaded after extraction.</p>
    </div>
  </section>

  <section class="status-panel" aria-live="polite">
    <div>
      <span class="label">Status</span>
      <p id="status">Waiting for a ZIP file.</p>
    </div>
    <button id="clear-button" type="button" disabled>Clear</button>
  </section>

  <section class="results">
    <div class="results-head">
      <h2>Files</h2>
      <span id="summary">No archive loaded</span>
    </div>
    <ul id="file-list" class="file-list"></ul>
  </section>
</main>
`

const input = document.querySelector<HTMLInputElement>('#zip-input')!
const dropZone = document.querySelector<HTMLElement>('#drop-zone')!
const statusEl = document.querySelector<HTMLParagraphElement>('#status')!
const summaryEl = document.querySelector<HTMLSpanElement>('#summary')!
const fileList = document.querySelector<HTMLUListElement>('#file-list')!
const clearButton = document.querySelector<HTMLButtonElement>('#clear-button')!

input.addEventListener('change', () => {
  const file = input.files?.[0]
  if (file) {
    void openZipFile(file)
  }
})

dropZone.addEventListener('click', () => input.click())
dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    input.click()
  }
})

dropZone.addEventListener('dragover', (event) => {
  event.preventDefault()
  dropZone.classList.add('is-dragging')
})

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('is-dragging')
})

dropZone.addEventListener('drop', (event) => {
  event.preventDefault()
  dropZone.classList.remove('is-dragging')
  const file = event.dataTransfer?.files[0]
  if (file) {
    void openZipFile(file)
  }
})

window.addEventListener('paste', (event) => {
  const file = Array.from(event.clipboardData?.files ?? []).find((item) =>
    item.name.toLowerCase().endsWith('.zip') || item.type.includes('zip'),
  )

  if (file) {
    void openZipFile(file)
  }
})

clearButton.addEventListener('click', () => {
  input.value = ''
  statusEl.textContent = 'Waiting for a ZIP file.'
  summaryEl.textContent = 'No archive loaded'
  fileList.replaceChildren()
  clearButton.disabled = true
})

async function openZipFile(file: File): Promise<void> {
  try {
    setBusy(`Reading ${file.name}...`)
    const bytes = new Uint8Array(await file.arrayBuffer())
    const entries = await unzip(bytes)
    renderEntries(entries)
    const fileCount = entries.filter((entry) => !entry.isDirectory).length
    const failedCount = entries.filter((entry) => entry.error).length
    statusEl.textContent = failedCount
      ? `Opened ${file.name}, but ${failedCount} entr${failedCount === 1 ? 'y' : 'ies'} could not be extracted.`
      : `Opened ${file.name}.`
    summaryEl.textContent = `${fileCount} file${fileCount === 1 ? '' : 's'} from ${formatBytes(file.size)}`
    clearButton.disabled = false
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not read this archive.'
    statusEl.textContent = message
    summaryEl.textContent = 'No archive loaded'
    fileList.replaceChildren()
    clearButton.disabled = false
  }
}

function renderEntries(entries: ZipEntry[]): void {
  fileList.replaceChildren()

  if (entries.length === 0) {
    fileList.innerHTML = '<li class="empty">This archive has no entries.</li>'
    return
  }

  for (const entry of entries) {
    const item = document.createElement('li')
    item.className = entry.error ? 'file-row has-error' : 'file-row'

    const details = document.createElement('div')
    details.className = 'file-details'

    const name = document.createElement('span')
    name.className = 'file-name'
    name.textContent = entry.name

    const meta = document.createElement('span')
    meta.className = 'file-meta'
    meta.textContent = entry.isDirectory
      ? 'Folder'
      : `${formatBytes(entry.uncompressedSize)} extracted, ${formatBytes(entry.compressedSize)} zipped`

    details.append(name, meta)
    item.append(details)

    if (entry.error) {
      const error = document.createElement('span')
      error.className = 'file-error'
      error.textContent = entry.error
      item.append(error)
    } else if (entry.blob) {
      const link = document.createElement('a')
      link.className = 'download-button'
      link.href = URL.createObjectURL(entry.blob)
      link.download = getDownloadName(entry.name)
      link.textContent = 'Download'
      item.append(link)
    }

    fileList.append(item)
  }
}

function setBusy(message: string): void {
  statusEl.textContent = message
  summaryEl.textContent = 'Working...'
  fileList.replaceChildren()
}

function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** index
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
}

function getDownloadName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? 'download'
}
