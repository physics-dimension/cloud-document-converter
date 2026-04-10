import { Docx, docx, type mdast } from '@dolphin/lark'
import { OneHundred, Second, waitFor } from '@dolphin/common'
import { cluster } from 'radash'
import {
  transformMentionUsers,
  UniqueFileName,
  withSignal,
  transformTableBySettings,
} from '../common/utils'
import { getSettings, Grid, SettingKey } from '../common/settings'
import { EventName, portImpl } from '../common/message'
import {
  type BatchDownloadMode,
  batchRequestDatasetKey,
  isSupportedDocUrl,
  normalizeDocUrl,
  type BatchDiscoveredLink,
  type BatchExportAsset,
} from '../common/batch-download'

const uniqueFileName = new UniqueFileName()

interface ProgressOptions {
  onProgress?: (progress: number) => void
  onComplete?: () => void
}

interface DownloadResult {
  filename: string
  content: Blob
}

type ExportedFile = mdast.Image | mdast.Link

const arrayBufferToAsset = async (
  asset: DownloadResult,
): Promise<BatchExportAsset> => ({
  filename: asset.filename,
  content: await asset.content.arrayBuffer(),
  mimeType: asset.content.type || 'application/octet-stream',
})

async function toBlob(
  response: Response,
  options: ProgressOptions = {},
): Promise<Blob> {
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status.toFixed()}`)
  }

  if (!response.body) {
    throw new Error('This request has no response body.')
  }

  const { onProgress, onComplete } = options

  const reader = response.body.getReader()
  const contentLength = parseInt(
    response.headers.get('Content-Length') ?? '0',
    10,
  )

  let receivedLength = 0
  const chunks = []

  for (;;) {
    const result = await reader.read()

    if (result.done) {
      onComplete?.()
      break
    }

    chunks.push(result.value)
    receivedLength += result.value.length

    if (contentLength > 0) {
      onProgress?.(receivedLength / contentLength)
    }
  }

  return new Blob(chunks)
}

const downloadImage = async (
  image: mdast.Image,
  options: {
    signal?: AbortSignal
    useUUID?: boolean
    markdownFileName?: string
  } = {},
): Promise<DownloadResult | null> => {
  if (!image.data) return null

  const { signal, useUUID = false, markdownFileName = '' } = options
  const { name: originName, fetchSources, fetchBlob } = image.data

  return await withSignal(
    async isAborted => {
      try {
        if (fetchBlob) {
          if (isAborted()) return null

          const content = await fetchBlob()
          if (!content) return null

          const baseName = markdownFileName
            ? `${markdownFileName}-diagram.png`
            : 'diagram.png'
          const name = useUUID
            ? uniqueFileName.generateWithUUID(baseName)
            : uniqueFileName.generate(baseName)
          const filename = `images/${name}`

          image.url = filename

          return {
            filename,
            content,
          }
        }

        if (originName && fetchSources) {
          if (isAborted()) return null

          const sources = await fetchSources()
          if (!sources) return null

          const baseName = markdownFileName
            ? `${markdownFileName}-${originName}`
            : originName
          const name = useUUID
            ? uniqueFileName.generateWithUUID(baseName)
            : uniqueFileName.generate(baseName)
          const filename = `images/${name}`

          if (isAborted()) return null

          const response = await fetch(sources.src, {
            signal,
          })
          const blob = await toBlob(response)

          image.url = filename

          return {
            filename,
            content: blob,
          }
        }

        return null
      } catch (error) {
        const aborted =
          isAborted() ||
          (error instanceof DOMException && error.name === 'AbortError')

        if (!aborted) {
          console.error(error)
        }

        return null
      }
    },
    { signal },
  )
}

const downloadFile = async (
  file: mdast.Link,
  options: {
    signal?: AbortSignal
    useUUID?: boolean
    markdownFileName?: string
  } = {},
): Promise<DownloadResult | null> => {
  if (!file.data?.name || !file.data.fetchFile) return null

  const { signal, useUUID = false, markdownFileName = '' } = options
  const { name, fetchFile } = file.data

  let controller = new AbortController()

  const cancel = () => {
    controller.abort()
  }

  const result = await withSignal(
    async () => {
      try {
        const baseName = markdownFileName ? `${markdownFileName}-${name}` : name
        const filename = `files/${
          useUUID
            ? uniqueFileName.generateWithUUID(baseName)
            : uniqueFileName.generate(baseName)
        }`

        const response = await fetchFile({
          signal: controller.signal,
        })
        const blob = await toBlob(response)

        file.url = filename

        return {
          filename,
          content: blob,
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.error(error)
        }

        return null
      }
    },
    {
      signal,
      onAbort: cancel,
    },
  )

  // @ts-expect-error release reference
  controller = null

  return result
}

const downloadFiles = async (
  files: ExportedFile[],
  options: {
    batchSize?: number
    signal?: AbortSignal
    useUUID?: boolean
    markdownFileName?: string
  } = {},
): Promise<DownloadResult[]> => {
  const {
    batchSize = 3,
    signal,
    useUUID = false,
    markdownFileName = '',
  } = options

  const results = await withSignal(
    async isAborted => {
      const downloaded: DownloadResult[] = []

      for (const batch of cluster(files, batchSize)) {
        if (isAborted()) {
          break
        }

        await Promise.allSettled(
          batch.map(async file => {
            const result =
              file.type === 'image'
                ? await downloadImage(file, {
                    signal,
                    useUUID,
                    markdownFileName,
                  })
                : await downloadFile(file, {
                    signal,
                    useUUID,
                    markdownFileName,
                  })

            if (result) {
              downloaded.push(result)
            }
          }),
        )
      }

      return downloaded
    },
    { signal },
  )

  return results ?? []
}

const collectVisibleDocLinks = (
  discovered: Map<string, string>,
  root: ParentNode,
) => {
  const currentUrl = normalizeDocUrl(window.location.href)

  Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]')).forEach(
    anchor => {
      const href = anchor.getAttribute('href')
      if (!href) {
        return
      }

      let url: URL
      try {
        url = new URL(href, window.location.href)
      } catch {
        return
      }

      if (!isSupportedDocUrl(url)) {
        return
      }

      const normalized = normalizeDocUrl(url.toString())
      if (normalized === currentUrl) {
        return
      }

      const titleAttribute = anchor.getAttribute('title')
      const title =
        titleAttribute === null
          ? anchor.textContent.trim()
          : titleAttribute.trim()

      if (!title) {
        return
      }

      const previous = discovered.get(normalized)
      if (!previous || previous.length < title.length) {
        discovered.set(normalized, title)
      }
    },
  )
}

const collectChildLinks = async (): Promise<BatchDiscoveredLink[]> => {
  const root = docx.container ?? document.body
  const discovered = new Map<string, string>()

  collectVisibleDocLinks(discovered, root)

  if (!docx.container) {
    return Array.from(discovered.entries()).map(([url, title]) => ({
      title,
      url,
    }))
  }

  const initialTop = docx.container.scrollTop
  const step = Math.max(docx.container.clientHeight * 0.85, 480)
  let stagnantRounds = 0

  docx.scrollTo({
    top: 0,
    behavior: 'instant',
  })
  await waitFor(200)

  while (stagnantRounds < 2) {
    collectVisibleDocLinks(discovered, root)

    const nextTop = Math.min(
      docx.container.scrollTop + step,
      Math.max(docx.container.scrollHeight - docx.container.clientHeight, 0),
    )

    if (nextTop <= docx.container.scrollTop + 1) {
      stagnantRounds++
    } else {
      docx.scrollTo({
        top: nextTop,
        behavior: 'instant',
      })
      stagnantRounds = 0
      await waitFor(200)
    }
  }

  collectVisibleDocLinks(discovered, root)
  docx.scrollTo({
    top: initialTop,
    behavior: 'instant',
  })

  return Array.from(discovered.entries()).map(([url, title]) => ({
    title,
    url,
  }))
}

interface PrepareResult {
  canExport: boolean
  isReady: boolean
  recoverScrollTop?: () => void
}

const prepare = async (mode: BatchDownloadMode): Promise<PrepareResult> => {
  const checkIsReady = () => docx.isReady({ checkWhiteboard: true })

  if (mode === 'fast') {
    if (checkIsReady()) {
      return {
        canExport: true,
        isReady: true,
      }
    }

    await waitFor(2 * Second)

    return {
      canExport: true,
      isReady: checkIsReady(),
    }
  }

  let recoverScrollTop

  if (!checkIsReady()) {
    const initialScrollTop = docx.container?.scrollTop ?? 0
    recoverScrollTop = () => {
      docx.scrollTo({
        top: initialScrollTop,
        behavior: 'instant',
      })
    }

    let top = 0

    docx.scrollTo({
      top,
      behavior: 'instant',
    })

    const maxTryTimes = OneHundred
    let tryTimes = 0

    while (!checkIsReady() && tryTimes <= maxTryTimes) {
      docx.scrollTo({
        top,
        behavior: 'smooth',
      })

      await waitFor(0.4 * Second)

      tryTimes++
      top = docx.container?.scrollHeight ?? 0
    }
  }

  return {
    canExport: checkIsReady(),
    isReady: checkIsReady(),
    recoverScrollTop,
  }
}

interface PreparedBatchExportRequest {
  requestId: string
  mode: BatchDownloadMode
}

const evaluateRequest = (): PreparedBatchExportRequest => {
  const raw = document.documentElement.dataset[batchRequestDatasetKey]

  if (!raw) {
    throw new Error('Batch export request was not prepared')
  }

  const json = JSON.parse(raw) as {
    requestId?: string
    mode?: BatchDownloadMode
  }

  if (!json.requestId) {
    throw new Error('Batch export request id is missing')
  }

  return {
    requestId: json.requestId,
    mode: json.mode === 'complete' ? 'complete' : 'fast',
  }
}

const main = async () => {
  const { requestId, mode } = evaluateRequest()

  try {
    if (docx.isDoc) {
      throw new Error('Old version Lark documents are not supported')
    }

    if (!docx.isDocx) {
      throw new Error('This page is not a Lark document')
    }

    const { canExport, recoverScrollTop } = await prepare(mode)

    if (!canExport) {
      throw new Error('Document content is still loading')
    }

    const settings = await getSettings([
      SettingKey.Table,
      SettingKey.Grid,
      SettingKey.TextHighlight,
      SettingKey.DownloadFileWithUniqueName,
    ])

    const { root, images, files, tableWithParents, mentionUsers } =
      docx.intoMarkdownAST({
        whiteboard: true,
        diagram: true,
        file: true,
        highlight: settings[SettingKey.TextHighlight],
        flatGrid: settings[SettingKey.Grid] === Grid.Flatten,
      })

    await transformMentionUsers(mentionUsers)

    const markdownFileName = docx.pageTitle?.slice(0, OneHundred) ?? 'doc'
    const [imageResults, fileResults] = await Promise.all([
      downloadFiles(images, {
        batchSize: 12,
        useUUID: settings[SettingKey.DownloadFileWithUniqueName],
        markdownFileName,
      }),
      downloadFiles(files, {
        batchSize: 3,
        useUUID: settings[SettingKey.DownloadFileWithUniqueName],
        markdownFileName,
      }),
    ])

    transformTableBySettings(tableWithParents, settings)

    const markdown = Docx.stringify(root)
    const assets = await Promise.all(
      imageResults.concat(fileResults).map(arrayBufferToAsset),
    )
    const childLinks = mode === 'complete' ? await collectChildLinks() : []

    recoverScrollTop?.()

    portImpl.sender.send(EventName.BatchExportResult, {
      requestId,
      payload: {
        title: docx.pageTitle ?? markdownFileName,
        sourceUrl: window.location.href,
        markdown,
        assets,
        childLinks,
      },
    })
  } catch (error) {
    portImpl.sender.send(EventName.BatchExportResult, {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    Reflect.deleteProperty(
      document.documentElement.dataset,
      batchRequestDatasetKey,
    )
  }
}

main().catch((error: unknown) => {
  console.error(error)
})
