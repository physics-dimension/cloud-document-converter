<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { configure, fs } from '@zip.js/zip.js'
import normalizeFileName from 'filenamify/browser'
import {
  LoaderCircle,
  Download,
  FolderTree,
  TriangleAlert,
} from 'lucide-vue-next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useInitLocale } from '../shared/i18n'
import { useInitTheme } from '../shared/theme'
import {
  batchTaskSeedKey,
  normalizeDocUrl,
  type BatchDownloadMode,
  type BatchDownloadEntry,
  type BatchDownloadSeed,
} from '@/common/batch-download'
import { type BatchExportForwardMessage } from '@/common/message'

type TaskStatus =
  | 'booting'
  | 'ready'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled'

interface PendingRequest {
  reject: (reason?: unknown) => void
  resolve: (message: BatchExportForwardMessage) => void
  timer: ReturnType<typeof setTimeout>
}

interface ManifestItem {
  title: string
  url: string
  path: string
  status: 'success' | 'failed'
  error?: string
}

interface SelectableEntry extends BatchDownloadEntry {
  selected: boolean
}

const { t } = useInitLocale()
useInitTheme()
configure({
  useWebWorkers: false,
})

const CONCURRENCY_STORAGE_KEY = 'batch.download.concurrency'
const MODE_STORAGE_KEY = 'batch.download.mode'
const CONCURRENCY_OPTIONS = [1, 2, 3, 5] as const
const MODE_OPTIONS: { label: string; value: BatchDownloadMode }[] = [
  {
    label: 'Fast',
    value: 'fast',
  },
  {
    label: 'Complete',
    value: 'complete',
  },
]

const status = ref<TaskStatus>('booting')
const statusMessage = ref('')
const completedCount = ref(0)
const totalCount = ref(0)
const errorMessage = ref('')
const manifest = ref<ManifestItem[]>([])
const logs = ref<string[]>([])
const workerTabIds = ref<(number | null)[]>([])
const workerTitles = ref<string[]>([])
const cancelled = ref(false)
const seed = ref<BatchDownloadSeed | null>(null)
const entries = ref<SelectableEntry[]>([])
const filterQuery = ref('')
const requestedConcurrency = ref(
  Number(localStorage.getItem(CONCURRENCY_STORAGE_KEY) ?? '2'),
)
const requestedMode = ref<BatchDownloadMode>(
  localStorage.getItem(MODE_STORAGE_KEY) === 'complete' ? 'complete' : 'fast',
)

const pendingRequests = new Map<string, PendingRequest>()
const downloadObjectUrls = new Map<number, string>()
const downloadNames = new Map<number, string>()

const taskId = new URLSearchParams(window.location.search).get('taskId') ?? ''

const progress = computed(() => {
  if (totalCount.value === 0) {
    return 0
  }

  return Math.round((completedCount.value / totalCount.value) * 100)
})

const failedCount = computed(
  () => manifest.value.filter(item => item.status === 'failed').length,
)

const selectedCount = computed(
  () => entries.value.filter(entry => entry.selected).length,
)

const filteredEntries = computed(() => {
  const query = filterQuery.value.trim().toLowerCase()
  if (!query) {
    return entries.value
  }

  return entries.value.filter(entry =>
    [entry.title, entry.pathSegments.join('/'), entry.url].some(value =>
      value.toLowerCase().includes(query),
    ),
  )
})

const hasPreparedEntries = computed(() => entries.value.length > 0)

const visibleSelectedCount = computed(
  () => filteredEntries.value.filter(entry => entry.selected).length,
)

const allVisibleSelected = computed(
  () =>
    filteredEntries.value.length > 0 &&
    visibleSelectedCount.value === filteredEntries.value.length,
)

const concurrency = computed(() => {
  const normalized = Math.floor(requestedConcurrency.value)
  if (!Number.isFinite(normalized)) {
    return 2
  }

  return Math.min(Math.max(normalized, 1), 5)
})

const downloadMode = computed<BatchDownloadMode>(() =>
  requestedMode.value === 'complete' ? 'complete' : 'fast',
)

const activeTitles = computed(() =>
  workerTitles.value.filter(title => title.length > 0),
)

const currentTitleSummary = computed(() => {
  if (status.value === 'ready') {
    return `${selectedCount.value} / ${entries.value.length}`
  }

  if (activeTitles.value.length === 0) {
    return '-'
  }

  return activeTitles.value.join(' | ')
})

watch(
  requestedConcurrency,
  value => {
    const normalized = Number.isFinite(value)
      ? Math.min(Math.max(Math.floor(value), 1), 5)
      : 2
    if (normalized !== value) {
      requestedConcurrency.value = normalized
      return
    }

    localStorage.setItem(CONCURRENCY_STORAGE_KEY, String(normalized))
  },
  { immediate: true },
)

watch(
  requestedMode,
  value => {
    const normalized = value === 'complete' ? 'complete' : 'fast'
    if (normalized !== value) {
      requestedMode.value = normalized
      return
    }

    localStorage.setItem(MODE_STORAGE_KEY, normalized)
  },
  { immediate: true },
)

const waitFor = (ms: number) =>
  new Promise<void>(resolve => {
    setTimeout(resolve, ms)
  })

const pushLog = (message: string) => {
  logs.value = logs.value.concat(message).slice(-24)
}

const reloadPage = () => {
  window.location.reload()
}

const sanitizePathSegments = (pathSegments: string[]): string[] =>
  pathSegments.map(segment => normalizeFileName(segment) || 'untitled')

const setWorkerTitle = (workerIndex: number, title: string) => {
  const nextTitles = workerTitles.value.slice()
  nextTitles[workerIndex] = title
  workerTitles.value = nextTitles
}

const loadSeed = async (): Promise<BatchDownloadSeed> => {
  if (!taskId) {
    throw new Error('Batch task id is missing')
  }

  const key = batchTaskSeedKey(taskId)
  const result = await chrome.storage.local.get(key)
  const taskSeed = result[key] as BatchDownloadSeed | undefined

  if (!taskSeed) {
    throw new Error('Batch task seed is missing or has expired')
  }

  await chrome.storage.local.remove(key)

  return taskSeed
}

const waitForTabComplete = async (tabId: number): Promise<void> => {
  const existing = await chrome.tabs.get(tabId)
  if (existing.status === 'complete') {
    return
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      reject(
        new Error('Timed out waiting for the worker tab to finish loading'),
      )
    }, 45 * 1000)

    const listener = (
      updatedTabId: number,
      info: chrome.tabs.TabChangeInfo,
    ) => {
      if (updatedTabId !== tabId || info.status !== 'complete') {
        return
      }

      clearTimeout(timer)
      chrome.tabs.onUpdated.removeListener(listener)
      resolve()
    }

    chrome.tabs.onUpdated.addListener(listener)
  })
}

const ensureWorkerTab = async (
  workerIndex: number,
  url: string,
): Promise<number> => {
  const existingTabId = workerTabIds.value[workerIndex] ?? null

  if (existingTabId === null) {
    const tab = await chrome.tabs.create({
      url,
      active: false,
    })

    if (tab.id === undefined) {
      throw new Error(`Failed to create worker tab ${workerIndex + 1}`)
    }

    const nextTabIds = workerTabIds.value.slice()
    nextTabIds[workerIndex] = tab.id
    workerTabIds.value = nextTabIds
    await waitForTabComplete(tab.id)
    await waitFor(1000)
    return tab.id
  }

  await chrome.tabs.update(existingTabId, {
    url,
    active: false,
  })
  await waitForTabComplete(existingTabId)
  await waitFor(1000)
  return existingTabId
}

const sendTabMessageWithRetry = async (
  tabId: number,
  message: {
    type: 'prepare_batch_export'
    requestId: string
    mode: BatchDownloadMode
  },
): Promise<void> => {
  const maxRetries = 40

  for (let index = 0; index < maxRetries; index++) {
    try {
      await chrome.tabs.sendMessage(tabId, message)
      return
    } catch (error) {
      if (index === maxRetries - 1) {
        throw error
      }

      await waitFor(500)
    }
  }
}

const requestExport = async (
  tabId: number,
  mode: BatchDownloadMode,
): Promise<BatchExportForwardMessage> => {
  const requestId = crypto.randomUUID()

  return await new Promise<BatchExportForwardMessage>(
    async (resolve, reject) => {
      const timer = setTimeout(
        () => {
          pendingRequests.delete(requestId)
          reject(new Error('Timed out waiting for the page export result'))
        },
        4 * 60 * 1000,
      )

      pendingRequests.set(requestId, {
        resolve,
        reject,
        timer,
      })

      try {
        await sendTabMessageWithRetry(tabId, {
          type: 'prepare_batch_export',
          requestId,
          mode,
        })

        await chrome.scripting.executeScript({
          target: {
            tabId,
          },
          files: ['bundles/scripts/export-lark-docx-for-batch.js'],
          world: 'MAIN',
        })
      } catch (error) {
        clearTimeout(timer)
        pendingRequests.delete(requestId)
        reject(error)
      }
    },
  )
}

const closeWorkerTabs = async () => {
  await Promise.all(
    workerTabIds.value
      .filter((tabId): tabId is number => tabId !== null)
      .map(async tabId => {
        try {
          await chrome.tabs.remove(tabId)
        } catch (error) {
          console.error(error)
        }
      }),
  )

  workerTabIds.value = []
  workerTitles.value = []
}

const buildDownloadBaseName = (
  entry: BatchDownloadEntry,
  order: number,
  total: number,
): string => {
  const width = Math.max(2, String(total).length)
  const prefix = String(order + 1).padStart(width, '0')
  const relativeSegments =
    entry.pathSegments.length > 1 ? entry.pathSegments.slice(1) : [entry.title]
  const safeStem = sanitizePathSegments(relativeSegments).join(' - ')

  return `${prefix} - ${safeStem || 'untitled'}`
}

const buildSinglePageBlob = async (
  entry: BatchDownloadEntry,
  message: BatchExportForwardMessage,
  order: number,
  total: number,
): Promise<{ blob: Blob; filename: string }> => {
  if (!message.payload) {
    throw new Error('Batch export payload is missing')
  }

  const baseName = buildDownloadBaseName(entry, order, total)
  const assets = message.payload.assets

  if (assets.length === 0) {
    return {
      blob: new Blob([message.payload.markdown], {
        type: 'text/markdown;charset=utf-8',
      }),
      filename: `${baseName}.md`,
    }
  }

  const zipFs = new fs.FS()
  zipFs.addText('index.md', message.payload.markdown)
  zipFs.addText(
    'meta.json',
    JSON.stringify(
      {
        title: message.payload.title,
        sourceUrl: message.payload.sourceUrl,
        exportedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  )

  for (const asset of assets) {
    zipFs.addBlob(
      asset.filename,
      new Blob([asset.content], {
        type: asset.mimeType,
      }),
    )
  }

  return {
    blob: await zipFs.exportBlob({
      useWebWorkers: false,
    }),
    filename: `${baseName}.zip`,
  }
}

const handleDownloadChanged = (delta: chrome.downloads.DownloadDelta) => {
  if (delta.id === undefined || !downloadObjectUrls.has(delta.id)) {
    return
  }

  if (
    delta.state?.current === 'complete' ||
    delta.state?.current === 'interrupted' ||
    delta.error?.current
  ) {
    const url = downloadObjectUrls.get(delta.id)
    const name = downloadNames.get(delta.id)
    if (url) {
      URL.revokeObjectURL(url)
    }

    if (delta.error?.current) {
      pushLog(
        `Browser download failed for ${name ?? delta.id}: ${delta.error.current}`,
      )
    }

    downloadObjectUrls.delete(delta.id)
    downloadNames.delete(delta.id)
  }
}

const saveBlobAsDownload = async (
  blob: Blob,
  relativeFilename: string,
): Promise<void> => {
  const rootTitle =
    normalizeFileName(seed.value?.rootTitle || '') || 'batch-download'
  const objectUrl = URL.createObjectURL(blob)

  try {
    const downloadId = await chrome.downloads.download({
      url: objectUrl,
      filename: `${rootTitle}/${relativeFilename}`,
      saveAs: false,
      conflictAction: 'uniquify',
    })

    if (downloadId === undefined) {
      throw new Error('Browser refused the download request')
    }

    downloadObjectUrls.set(downloadId, objectUrl)
    downloadNames.set(downloadId, relativeFilename)
  } catch (error) {
    URL.revokeObjectURL(objectUrl)
    throw error
  }
}

const setVisibleSelection = (selected: boolean) => {
  filteredEntries.value.forEach(entry => {
    entry.selected = selected
  })
}

const initializeBatch = async () => {
  const taskSeed = await loadSeed()
  const preparedEntries = taskSeed.entries.slice(1)

  if (preparedEntries.length === 0) {
    throw new Error('No descendant pages were found on this page')
  }

  seed.value = taskSeed
  entries.value = preparedEntries.map(entry => ({
    ...entry,
    selected: true,
  }))
  completedCount.value = 0
  totalCount.value = preparedEntries.length
  status.value = 'ready'
  statusMessage.value =
    'Select the descendant pages to download. Fast mode skips forced full-page preloading. Images and attachments are included by default.'
  logs.value = [
    `Collected ${preparedEntries.length.toFixed()} descendant page(s) from the current page`,
    'The extension saves files itself, so browser site prompts for multiple downloads should be avoided',
    'Images and attachments will be included automatically for each downloaded page',
    `Current mode: ${downloadMode.value}`,
  ]
}

const startBatch = async () => {
  if (!seed.value) {
    throw new Error('Batch task seed is unavailable')
  }

  const queue = entries.value
    .map((entry, order) => ({
      entry,
      order,
    }))
    .filter(item => item.entry.selected)

  if (queue.length === 0) {
    throw new Error('Select at least one page to download')
  }

  cancelled.value = false
  manifest.value = []
  errorMessage.value = ''
  completedCount.value = 0
  totalCount.value = queue.length
  workerTabIds.value = Array.from({ length: concurrency.value }, () => null)
  workerTitles.value = Array.from({ length: concurrency.value }, () => '')
  status.value = 'running'
  statusMessage.value = `${downloadMode.value === 'fast' ? 'Fast mode skips forced full-page preloading before export.' : 'Complete mode waits for the page to fully prepare before export.'} Running ${concurrency.value.toFixed()} concurrent worker(s). Images and attachments stay with each page.`
  logs.value = [
    `Collected ${entries.value.length.toFixed()} descendant page(s) from the current page`,
    `Queued ${queue.length.toFixed()} selected page(s) for download`,
    `Using ${concurrency.value.toFixed()} concurrent worker(s)`,
    `Using ${downloadMode.value} mode`,
  ]

  let nextIndex = 0
  const pullNext = () => {
    const next = queue[nextIndex]
    nextIndex++
    return next
  }

  const runWorker = async (workerIndex: number) => {
    while (!cancelled.value) {
      const item = pullNext()
      if (!item) {
        setWorkerTitle(workerIndex, '')
        return
      }

      const { entry, order } = item
      setWorkerTitle(workerIndex, entry.title)
      pushLog(`Worker ${workerIndex + 1}: opening ${entry.title}`)

      try {
        const tabId = await ensureWorkerTab(
          workerIndex,
          normalizeDocUrl(entry.url),
        )
        const response = await requestExport(tabId, downloadMode.value)

        if (response.error) {
          manifest.value.push({
            title: entry.title,
            url: entry.url,
            path: entry.pathSegments.join('/'),
            status: 'failed',
            error: response.error,
          })
          pushLog(
            `Worker ${workerIndex + 1}: failed ${entry.title}: ${response.error}`,
          )
        } else {
          const download = await buildSinglePageBlob(
            entry,
            response,
            order,
            queue.length,
          )

          await saveBlobAsDownload(download.blob, download.filename)
          manifest.value.push({
            title: entry.title,
            url: entry.url,
            path: entry.pathSegments.join('/'),
            status: 'success',
          })
          pushLog(
            `Worker ${workerIndex + 1}: browser accepted ${download.filename}`,
          )
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        manifest.value.push({
          title: entry.title,
          url: entry.url,
          path: entry.pathSegments.join('/'),
          status: 'failed',
          error: message,
        })
        pushLog(`Worker ${workerIndex + 1}: failed ${entry.title}: ${message}`)
      } finally {
        completedCount.value++
        setWorkerTitle(workerIndex, '')
      }
    }
  }

  try {
    await Promise.all(
      Array.from({ length: concurrency.value }, (_, workerIndex) =>
        runWorker(workerIndex),
      ),
    )
  } finally {
    await closeWorkerTabs()
  }

  if (cancelled.value) {
    status.value = 'cancelled'
    statusMessage.value = 'Stopped after the active workers finished'
    return
  }

  status.value = failedCount.value > 0 ? 'failed' : 'success'
  statusMessage.value =
    failedCount.value > 0
      ? `${failedCount.value.toFixed()} page(s) failed. ${(
          completedCount.value - failedCount.value
        ).toFixed()} page(s) were handed off to the browser.`
      : `The browser accepted ${completedCount.value.toFixed()} page(s) for download.`
}

const handleRuntimeMessage = (message: unknown) => {
  if (
    typeof message !== 'object' ||
    message === null ||
    !('type' in message) ||
    message['type'] !== 'batch_export_result'
  ) {
    return
  }

  const typedMessage = message as BatchExportForwardMessage
  const pending = pendingRequests.get(typedMessage.requestId)

  if (!pending) {
    return
  }

  clearTimeout(pending.timer)
  pendingRequests.delete(typedMessage.requestId)
  pending.resolve(typedMessage)
}

const cancelBatch = () => {
  cancelled.value = true
  statusMessage.value =
    'Stopping after the active workers finish their current pages'
}

onMounted(() => {
  chrome.runtime.onMessage.addListener(handleRuntimeMessage)
  chrome.downloads.onChanged.addListener(handleDownloadChanged)

  initializeBatch().catch(error => {
    console.error(error)
    errorMessage.value =
      error instanceof Error
        ? error.message
        : 'Failed to prepare the batch task'
    status.value = 'failed'
  })
})

onBeforeUnmount(() => {
  chrome.runtime.onMessage.removeListener(handleRuntimeMessage)
  chrome.downloads.onChanged.removeListener(handleDownloadChanged)

  for (const pending of pendingRequests.values()) {
    clearTimeout(pending.timer)
    pending.reject(new Error('Batch page was closed'))
  }

  pendingRequests.clear()

  for (const url of downloadObjectUrls.values()) {
    URL.revokeObjectURL(url)
  }
  downloadObjectUrls.clear()
  downloadNames.clear()

  closeWorkerTabs().catch(console.error)
})
</script>

<template>
  <div class="min-h-screen bg-background p-6">
    <div class="mx-auto flex max-w-5xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle class="flex items-center gap-3">
            <FolderTree class="size-5" />
            {{ t('batch.download.title') }}
          </CardTitle>
        </CardHeader>
        <CardContent class="space-y-5">
          <div class="space-y-2">
            <div
              class="flex items-center justify-between text-sm text-muted-foreground"
            >
              <span>{{ t('batch.download.progress') }}</span>
              <span>{{ completedCount }} / {{ totalCount }}</span>
            </div>
            <div class="h-3 overflow-hidden rounded-full bg-muted">
              <div
                class="h-full rounded-full bg-primary transition-[width] duration-300"
                :style="{ width: `${progress.toFixed()}%` }"
              ></div>
            </div>
          </div>

          <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div class="rounded-lg border p-4">
              <div class="text-sm text-muted-foreground">
                {{ t('batch.download.status') }}
              </div>
              <div class="mt-2 font-medium capitalize">{{ status }}</div>
            </div>
            <div class="rounded-lg border p-4">
              <div class="text-sm text-muted-foreground">
                {{
                  status === 'ready'
                    ? 'Selected Pages'
                    : t('batch.download.current')
                }}
              </div>
              <div class="mt-2 font-medium">
                {{ currentTitleSummary }}
              </div>
            </div>
            <div class="rounded-lg border p-4">
              <div class="text-sm text-muted-foreground">
                {{ t('batch.download.failures') }}
              </div>
              <div class="mt-2 font-medium">
                {{ failedCount }}
              </div>
            </div>
          </div>

          <div
            class="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_160px_160px]"
          >
            <div
              v-if="statusMessage"
              class="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm"
            >
              {{ statusMessage }}
            </div>
            <div class="rounded-lg border px-4 py-3">
              <div class="text-sm text-muted-foreground">Concurrency</div>
              <select
                v-model.number="requestedConcurrency"
                class="mt-2 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                :disabled="status === 'running'"
              >
                <option
                  v-for="value of CONCURRENCY_OPTIONS"
                  :key="value"
                  :value="value"
                >
                  {{ value }}
                </option>
              </select>
            </div>
            <div class="rounded-lg border px-4 py-3">
              <div class="text-sm text-muted-foreground">Mode</div>
              <select
                v-model="requestedMode"
                class="mt-2 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                :disabled="status === 'running'"
              >
                <option
                  v-for="option of MODE_OPTIONS"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </div>
          </div>

          <div
            v-if="errorMessage"
            class="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          >
            <TriangleAlert class="mt-0.5 size-4" />
            <span>{{ errorMessage }}</span>
          </div>

          <div class="flex flex-wrap items-center gap-3">
            <Button
              v-if="status !== 'running' && hasPreparedEntries"
              type="button"
              :disabled="selectedCount === 0 || status === 'booting'"
              @click="startBatch"
            >
              <Download class="size-4" />
              {{ status === 'success' ? 'Download Again' : 'Start Download' }}
            </Button>
            <Button
              v-if="status === 'running'"
              type="button"
              variant="outline"
              @click="cancelBatch"
            >
              {{ t('batch.download.cancel') }}
            </Button>
            <Button
              v-if="status !== 'running' && !hasPreparedEntries"
              type="button"
              variant="outline"
              @click="reloadPage"
            >
              {{ t('batch.download.retry') }}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card
        v-if="
          status === 'ready' ||
          status === 'success' ||
          status === 'failed' ||
          status === 'cancelled'
        "
      >
        <CardHeader>
          <CardTitle>Pages To Download</CardTitle>
        </CardHeader>
        <CardContent class="space-y-4">
          <div
            class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
          >
            <Input
              v-model="filterQuery"
              class="md:max-w-sm"
              placeholder="Search pages"
            />
            <div class="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                :disabled="filteredEntries.length === 0 || allVisibleSelected"
                @click="setVisibleSelection(true)"
              >
                Select Visible
              </Button>
              <Button
                type="button"
                variant="outline"
                :disabled="
                  filteredEntries.length === 0 || visibleSelectedCount === 0
                "
                @click="setVisibleSelection(false)"
              >
                Clear Visible
              </Button>
            </div>
          </div>

          <div class="text-sm text-muted-foreground">
            {{ selectedCount }} of {{ entries.length }} page(s) selected. Images
            and attachments are included by default.
          </div>

          <div class="max-h-[30rem] overflow-auto rounded-lg border">
            <div
              v-if="filteredEntries.length === 0"
              class="px-4 py-6 text-sm text-muted-foreground"
            >
              No pages match the current filter.
            </div>
            <label
              v-for="entry of filteredEntries"
              :key="`${entry.nodeUid}_${entry.url}`"
              class="flex cursor-pointer items-start gap-3 border-b px-4 py-3 last:border-b-0"
            >
              <input
                v-model="entry.selected"
                type="checkbox"
                class="mt-1 size-4 rounded border-input text-primary focus:ring-ring"
              />
              <div class="min-w-0 flex-1">
                <div class="truncate font-medium">{{ entry.title }}</div>
                <div class="mt-1 break-all text-xs text-muted-foreground">
                  {{ entry.pathSegments.join(' / ') }}
                </div>
              </div>
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="flex items-center gap-3">
            <LoaderCircle
              class="size-5"
              :class="{
                'animate-spin': status === 'running' || status === 'booting',
              }"
            />
            {{ t('batch.download.logs') }}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div class="rounded-lg border bg-card p-4">
            <div v-if="logs.length === 0" class="text-sm text-muted-foreground">
              {{ t('batch.download.logs.empty') }}
            </div>
            <ul v-else class="space-y-2 text-sm">
              <li
                v-for="(item, index) of logs"
                :key="`${index}_${item}`"
                class="break-all"
              >
                {{ item }}
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
