export interface BatchDownloadEntry {
  nodeUid: string
  title: string
  url: string
  level: number
  pathSegments: string[]
  wikiToken?: string
}

export interface BatchDownloadSeed {
  rootTitle: string
  rootUrl: string
  entries: BatchDownloadEntry[]
  createdAt: string
}

export type BatchDownloadMode = 'fast' | 'complete'

export interface BatchExportAsset {
  filename: string
  content: ArrayBuffer
  mimeType: string
}

export interface BatchExportPayload {
  title: string
  sourceUrl: string
  markdown: string
  assets: BatchExportAsset[]
  childLinks: BatchDiscoveredLink[]
}

export interface BatchExportResultMessage {
  requestId: string
  payload?: BatchExportPayload
  error?: string
}

export interface BatchDiscoveredLink {
  title: string
  url: string
}

interface BatchTreeNode {
  nodeUid: string
  title: string
  level: number
}

export const batchTaskSeedKey = (taskId: string): string =>
  `batch-download.seed.${taskId}`

export const batchRequestDatasetKey = 'cdcBatchExportRequest'
export const batchPageDownloadRequestDatasetKey = 'cdcBatchPageDownloadRequest'

export const parseNodeUid = (nodeUid: string): URLSearchParams =>
  new URLSearchParams(nodeUid)

export const wikiTokenFromNodeUid = (nodeUid: string): string | undefined => {
  const params = parseNodeUid(nodeUid)

  return (
    params.get('wikiToken') ??
    params.get('wiki_token') ??
    params.get('objToken') ??
    params.get('obj_token') ??
    undefined
  )
}

export const normalizeDocUrl = (input: string): string => {
  const url = new URL(input)
  url.hash = ''
  url.search = ''
  return url.toString()
}

export const isDocLikePath = (pathname: string): boolean =>
  /^\/(wiki|docx)\//.test(pathname)

const supportedDocHostSuffixes = [
  '.feishu.cn',
  '.feishu.net',
  '.larksuite.com',
  '.feishu-pre.net',
  '.larkoffice.com',
  '.larkenterprise.com',
]

export const isSupportedDocUrl = (url: URL): boolean =>
  isDocLikePath(url.pathname) &&
  supportedDocHostSuffixes.some(
    suffix => url.hostname === suffix.slice(1) || url.hostname.endsWith(suffix),
  )

export const buildWikiUrl = (origin: string, wikiToken: string): string =>
  new URL(`/wiki/${wikiToken}`, origin).toString()

export const buildBatchEntries = (
  nodes: BatchTreeNode[],
  options: {
    currentUrl: string
    origin: string
  },
): BatchDownloadEntry[] => {
  const { currentUrl, origin } = options

  if (nodes.length === 0) {
    return []
  }

  const rootLevel = nodes[0].level
  const pathStack: string[] = []

  return nodes.flatMap((node, index) => {
    const relativeLevel = node.level - rootLevel
    if (relativeLevel < 0) {
      return []
    }

    pathStack.length = relativeLevel
    pathStack[relativeLevel] = node.title

    const wikiToken = wikiTokenFromNodeUid(node.nodeUid)
    if (!wikiToken && index > 0) {
      return []
    }

    return [
      {
        nodeUid: node.nodeUid,
        title: node.title,
        level: node.level,
        pathSegments: pathStack.slice(0, relativeLevel + 1),
        url:
          index === 0
            ? normalizeDocUrl(currentUrl)
            : buildWikiUrl(origin, wikiToken ?? ''),
        ...(wikiToken ? { wikiToken } : null),
      } satisfies BatchDownloadEntry,
    ]
  })
}
