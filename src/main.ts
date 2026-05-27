import { $derived, $effect, $state, cn, component, html, mount, repeat, type Props, type View } from '@holmityd/litcode'
import { unzip, type ZipEntry } from '@holmityd/unzip'
import './style.css'

type UiEntry = ZipEntry & {
  downloadUrl?: string
}

type ButtonProps = Props<Partial<HTMLButtonElement>>

type FileRowProps = {
  entry: UiEntry
}

const entries = $state<UiEntry[]>([])
const status = $state('Waiting for a ZIP file.')
const archiveSummary = $state('No archive loaded')
const isDragging = $state(false)
const hasArchive = $derived(() => entries.value.length > 0 || archiveSummary.value !== 'No archive loaded')
const isClearDisabled = $derived(() => !hasArchive.value)
const shouldShowEmptyArchive = $derived(
  () => entries.value.length === 0 && archiveSummary.value !== 'No archive loaded' && archiveSummary.value !== 'Working...',
)

const Button = component<ButtonProps>(({ children, className }: ButtonProps = {}): View => {
  return html`
    <button
      class="${cn(
        'inline-flex min-h-10 cursor-pointer items-center justify-center rounded-md bg-primary px-4 text-sm font-bold text-primary-foreground transition hover:opacity-90 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-45',
        className,
      )}"
      type="button"
    >
      ${children ?? ''}
    </button>
  `
})

const FileRow = component<FileRowProps>(({ entry }: FileRowProps): View => {
  return html`
    <li
      class="${cn(
        'flex min-h-18 items-center justify-between gap-4 border-b bg-card px-4 py-3 last:border-b-0 max-sm:flex-col max-sm:items-stretch',
        entry.error && 'bg-destructive/5',
      )}"
      key=${entry.name}
    >
      <div class="grid min-w-0 gap-1">
        <span class="wrap-anywhere font-bold text-card-foreground">${entry.name}</span>
        <span class="text-sm text-muted-foreground">
          ${entry.isDirectory
            ? 'Folder'
            : `${formatBytes(entry.uncompressedSize)} extracted, ${formatBytes(entry.compressedSize)} zipped`}
        </span>
      </div>
      ${entry.error
        ? html`
            <span class="max-w-80 rounded-md bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive max-sm:max-w-none">
              ${entry.error}
            </span>
          `
        : entry.blob && entry.downloadUrl
          ? html`
              <a
                class="inline-flex min-h-9 shrink-0 items-center justify-center rounded-md bg-primary px-4 text-sm font-bold text-primary-foreground no-underline transition hover:opacity-90 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none max-sm:w-full"
                href=${entry.downloadUrl}
                download=${getDownloadName(entry.name)}
              >
                Download
              </a>
            `
          : ''}
    </li>
  `
})

function App(): View {
  return html`
    <main class="mx-auto min-h-svh w-[min(1040px,calc(100%-2rem))] py-8 max-sm:w-[calc(100%-1.5rem)] max-sm:py-5">
      <section class="mb-6 flex items-end justify-between gap-6 max-sm:flex-col max-sm:items-stretch">
        <div>
          <p class="text-xs font-extrabold tracking-normal text-muted-foreground uppercase">Browser ZIP extractor</p>
          <h1 class="mt-2 text-[clamp(2.125rem,7vw,4.25rem)] leading-[0.95] font-bold tracking-normal">
            Unzip files locally
          </h1>
        </div>
        <label
          class="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-md bg-primary px-4 font-bold whitespace-nowrap text-primary-foreground transition hover:opacity-90 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none max-sm:w-full"
          for="zip-input"
        >
          <span
            class="mr-2 grid size-5 place-items-center rounded-full bg-primary-foreground text-sm font-black text-primary"
            aria-hidden="true"
          >
            +
          </span>
          Upload ZIP
        </label>
        <input
          id="zip-input"
          class="sr-only"
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          onchange=${handleFileInput}
        />
      </section>

      <label
        class="${() =>
          cn(
            'grid min-h-80 cursor-pointer grid-cols-[minmax(6rem,9.375rem)_minmax(0,27.5rem)] place-items-center gap-6 rounded-lg border-2 border-dashed bg-card/90 p-10 shadow-xl shadow-foreground/10 transition hover:-translate-y-0.5 hover:border-primary max-sm:min-h-75 max-sm:grid-cols-1 max-sm:px-5 max-sm:py-7 max-sm:text-center',
            isDragging.value && '-translate-y-0.5 border-primary bg-accent',
          )}"
        for="zip-input"
        tabindex="0"
        ondragover=${handleDragOver}
        ondragleave=${handleDragLeave}
        ondrop=${handleDrop}
      >
        <div
          class="grid aspect-square w-32 place-items-center rounded-lg border bg-background text-xl font-black text-primary shadow-[inset_0_-12px_0_var(--accent)] max-sm:w-26"
          aria-hidden="true"
        >
          ZIP
        </div>
        <div>
          <h2 class="text-xl leading-tight font-bold tracking-normal">Drop, paste, or choose a ZIP file</h2>
          <p class="mt-2 max-w-[54ch] text-muted-foreground">
            The archive is read in this tab. Stored and deflated entries can be downloaded after extraction.
          </p>
        </div>
      </label>

      <section
        class="mt-5 flex items-center justify-between gap-4 rounded-lg border bg-card p-4 max-sm:flex-col max-sm:items-stretch"
        aria-live="polite"
      >
        <div>
          <span class="text-xs font-extrabold tracking-normal text-muted-foreground uppercase">Status</span>
          <p class="text-muted-foreground">${status}</p>
        </div>
        ${Button({
          className: 'min-h-9 bg-accent text-accent-foreground max-sm:w-full',
          disabled: isClearDisabled,
          onclick: clearArchive,
          children: 'Clear',
        })}
      </section>

      <section class="mt-5 overflow-hidden rounded-lg border bg-card">
        <div class="flex items-center justify-between gap-4 border-b p-4 max-sm:flex-col max-sm:items-stretch">
          <h2 class="text-xl leading-tight font-bold tracking-normal">Files</h2>
          <span class="text-sm text-muted-foreground">${archiveSummary}</span>
        </div>
        <ul class="m-0 list-none p-0">
          ${shouldShowEmptyArchive.value
            ? html`<li class="min-h-18 border-b px-4 py-3 text-sm text-muted-foreground last:border-b-0">
                This archive has no entries.
              </li>`
            : repeat(entries.value, (entry) => entry.name, (entry) => FileRow({ entry }))}
        </ul>
      </section>
    </main>
  `
}

function handleFileInput(event: Event): void {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]

  if (file) {
    void openZipFile(file)
  }
}

function handleDragOver(event: Event): void {
  event.preventDefault()
  isDragging.value = true
}

function handleDragLeave(): void {
  isDragging.value = false
}

function handleDrop(event: Event): void {
  event.preventDefault()
  isDragging.value = false

  const file = event instanceof DragEvent ? event.dataTransfer?.files[0] : undefined
  if (file) {
    void openZipFile(file)
  }
}

function handlePaste(event: Event): void {
  const files = event instanceof ClipboardEvent ? event.clipboardData?.files : undefined
  const file = Array.from(files ?? []).find((item) =>
    item.name.toLowerCase().endsWith('.zip') || item.type.includes('zip'),
  )

  if (file) {
    void openZipFile(file)
  }
}

async function openZipFile(file: File): Promise<void> {
  try {
    setBusy(`Reading ${file.name}...`)
    const bytes = new Uint8Array(await file.arrayBuffer())
    const nextEntries = await unzip(bytes)
    setEntries(nextEntries.map(withDownloadUrl))

    const fileCount = nextEntries.filter((entry) => !entry.isDirectory).length
    const failedCount = nextEntries.filter((entry) => entry.error).length
    status.value = failedCount
      ? `Opened ${file.name}, but ${failedCount} entr${failedCount === 1 ? 'y' : 'ies'} could not be extracted.`
      : `Opened ${file.name}.`
    archiveSummary.value = `${fileCount} file${fileCount === 1 ? '' : 's'} from ${formatBytes(file.size)}`
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not read this archive.'
    status.value = message
    archiveSummary.value = 'No archive loaded'
    setEntries([])
  }
}

function clearArchive(): void {
  const input = document.querySelector<HTMLInputElement>('#zip-input')
  if (input) {
    input.value = ''
  }

  status.value = 'Waiting for a ZIP file.'
  archiveSummary.value = 'No archive loaded'
  setEntries([])
}

function setBusy(message: string): void {
  status.value = message
  archiveSummary.value = 'Working...'
  setEntries([])
}

function setEntries(nextEntries: UiEntry[]): void {
  revokeDownloadUrls(entries.value)
  entries.value = nextEntries
}

function withDownloadUrl(entry: ZipEntry): UiEntry {
  return entry.blob ? { ...entry, downloadUrl: URL.createObjectURL(entry.blob) } : entry
}

function revokeDownloadUrls(items: UiEntry[]): void {
  for (const entry of items) {
    if (entry.downloadUrl) {
      URL.revokeObjectURL(entry.downloadUrl)
    }
  }
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

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('App root not found.')
}

const root = mount(App(), app)

$effect(() => {
  root.update(App())
})

$effect(() => {
  window.addEventListener('paste', handlePaste)

  return () => {
    window.removeEventListener('paste', handlePaste)
    revokeDownloadUrls(entries.value)
  }
})
