import {
  buildBatchEntries,
  isSupportedDocUrl,
  normalizeDocUrl,
  type BatchDiscoveredLink,
  type BatchDownloadEntry,
  type BatchDownloadSeed,
} from './batch-download'

const NODE_SELECTOR = '.workspace-tree-view-node'
const CONTENT_SELECTOR = '.workspace-tree-view-node-content'
const EXPAND_ARROW_SELECTOR = '.workspace-tree-view-node-expand-arrow'
const EXPANDED_CLASS = 'workspace-tree-view-node--expanded'
const ACTIVE_CLASS = 'workspace-tree-view-node--active'

interface VisibleTreeNode {
  element: HTMLElement
  nodeUid: string
  title: string
  level: number
}

interface SubtreeWindow {
  nodes: VisibleTreeNode[]
  reachedBoundary: boolean
}

const FALLBACK_TITLE_SELECTORS = [
  'h1',
  '[data-testid="wiki-title"]',
  '[class*="docx-title"]',
  '[class*="wiki-title"]',
]

const waitFor = (ms: number) =>
  new Promise<void>(resolve => {
    setTimeout(resolve, ms)
  })

const parseLevel = (element: HTMLElement): number =>
  Number(element.dataset.nodeLevel ?? '0')

const parseVisibleTreeNodes = (): VisibleTreeNode[] =>
  Array.from(document.querySelectorAll<HTMLElement>(NODE_SELECTOR))
    .map(element => {
      const title =
        element
          .querySelector<HTMLElement>(CONTENT_SELECTOR)
          ?.innerText.trim() ?? element.innerText.trim()

      return {
        element,
        nodeUid: element.dataset.nodeUid ?? '',
        title,
        level: parseLevel(element),
      }
    })
    .filter(node => node.nodeUid.length > 0 && node.title.length > 0)

const resolveCurrentPageTitle = (): string => {
  for (const selector of FALLBACK_TITLE_SELECTORS) {
    const text = document.querySelector<HTMLElement>(selector)?.innerText.trim()
    if (text) {
      return text
    }
  }

  const title = document.title
    .split(/[-|]/)
    .map(part => part.trim())
    .find(part => part.length > 0)

  return title ?? 'Current Page'
}

const buildFallbackRootEntry = (): BatchDownloadEntry => {
  const title = resolveCurrentPageTitle()

  return {
    nodeUid: `page:${normalizeDocUrl(window.location.href)}`,
    title,
    url: normalizeDocUrl(window.location.href),
    level: 0,
    pathSegments: [title],
  }
}

const findActiveIndex = (nodes: VisibleTreeNode[]): number =>
  nodes.findIndex(node => node.element.classList.contains(ACTIVE_CLASS))

const collectVisibleDocLinks = (
  discovered: Map<string, string>,
  root: ParentNode = document,
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

const isScrollableElement = (element: HTMLElement): boolean => {
  const style = window.getComputedStyle(element)
  const overflowY = style.overflowY

  return (
    (overflowY === 'auto' || overflowY === 'scroll') &&
    element.scrollHeight > element.clientHeight + 200
  )
}

const findDocLinkScrollContainer = (): HTMLElement | null => {
  return (
    Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter(isScrollableElement)
      .map(element => {
        const visibleLinks = new Map<string, string>()
        collectVisibleDocLinks(visibleLinks, element)

        return {
          element,
          docLinkCount: visibleLinks.size,
          overflowDistance: element.scrollHeight - element.clientHeight,
        }
      })
      .sort((left, right) => {
        if (right.docLinkCount !== left.docLinkCount) {
          return right.docLinkCount - left.docLinkCount
        }

        return right.overflowDistance - left.overflowDistance
      })
      .find(candidate => candidate.docLinkCount > 0)?.element ?? null
  )
}

const collectLinkedChildren = async (): Promise<BatchDiscoveredLink[]> => {
  const discovered = new Map<string, string>()
  const scroller =
    findDocLinkScrollContainer() ?? document.scrollingElement ?? null

  collectVisibleDocLinks(discovered)

  if (!scroller) {
    return Array.from(discovered.entries()).map(([url, title]) => ({
      title,
      url,
    }))
  }

  const initialTop = scroller.scrollTop
  const step = Math.max(window.innerHeight * 0.8, 480)
  let stagnantRounds = 0

  scroller.scrollTop = 0
  await waitFor(200)

  while (stagnantRounds < 2) {
    collectVisibleDocLinks(discovered)

    const nextTop = Math.min(
      scroller.scrollTop + step,
      Math.max(scroller.scrollHeight - scroller.clientHeight, 0),
    )

    if (nextTop <= scroller.scrollTop + 1) {
      stagnantRounds++
    } else {
      scroller.scrollTop = nextTop
      stagnantRounds = 0
      await waitFor(200)
    }
  }

  collectVisibleDocLinks(discovered)
  scroller.scrollTop = initialTop

  return Array.from(discovered.entries()).map(([url, title]) => ({
    title,
    url,
  }))
}

const isExpanded = (node: VisibleTreeNode): boolean =>
  node.element.classList.contains(EXPANDED_CLASS)

const isExpandable = (node: VisibleTreeNode): boolean =>
  node.element.querySelector(EXPAND_ARROW_SELECTOR) instanceof HTMLElement

const expandNode = async (node: VisibleTreeNode): Promise<boolean> => {
  const arrow = node.element.querySelector<HTMLElement>(EXPAND_ARROW_SELECTOR)
  if (!arrow) {
    return false
  }

  const beforeSnapshot = parseVisibleTreeNodes()
    .map(item =>
      [item.nodeUid, String(item.level), String(isExpanded(item))].join(':'),
    )
    .join('|')

  node.element.scrollIntoView({
    block: 'center',
    inline: 'nearest',
  })

  arrow.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window,
    }),
  )

  await waitFor(250)

  const afterSnapshot = parseVisibleTreeNodes()
    .map(item =>
      [item.nodeUid, String(item.level), String(isExpanded(item))].join(':'),
    )
    .join('|')

  return beforeSnapshot !== afterSnapshot
}

const findTreeScrollContainer = (
  element: HTMLElement | null,
): HTMLElement | null => {
  let current = element?.parentElement ?? null

  while (current) {
    const style = window.getComputedStyle(current)
    const overflowY = style.overflowY
    const isScrollable =
      (overflowY === 'auto' || overflowY === 'scroll') &&
      current.scrollHeight > current.clientHeight + 1

    if (isScrollable) {
      return current
    }

    current = current.parentElement
  }

  return null
}

const getSubtreeWindow = (
  nodes: VisibleTreeNode[],
  rootNodeUid: string,
  rootLevel: number,
): SubtreeWindow => {
  const rootIndex = nodes.findIndex(node => node.nodeUid === rootNodeUid)
  if (rootIndex !== -1) {
    let end = rootIndex + 1
    while (end < nodes.length && nodes[end].level > rootLevel) {
      end++
    }

    return {
      nodes: nodes.slice(rootIndex, end),
      reachedBoundary: end < nodes.length,
    }
  }

  const firstNode = nodes.at(0)
  if (firstNode && firstNode.level <= rootLevel) {
    return {
      nodes: [],
      reachedBoundary: true,
    }
  }

  const start = nodes.findIndex(node => node.level > rootLevel)
  if (start === -1) {
    return {
      nodes: [],
      reachedBoundary: false,
    }
  }

  let end = start + 1
  while (end < nodes.length && nodes[end].level > rootLevel) {
    end++
  }

  return {
    nodes: nodes.slice(start, end),
    reachedBoundary: end < nodes.length,
  }
}

const expandActiveSubtree = async (): Promise<VisibleTreeNode[]> => {
  const initialNodes = parseVisibleTreeNodes()
  const activeIndex = findActiveIndex(initialNodes)
  if (activeIndex === -1) {
    throw new Error('Failed to locate the active wiki node in the sidebar')
  }

  const root = initialNodes[activeIndex]
  const rootLevel = root.level
  const scrollContainer = findTreeScrollContainer(root.element)
  const discovered = new Map<string, VisibleTreeNode>([[root.nodeUid, root]])
  const attempted = new Set<string>()
  const maxIterations = 80
  let stagnantRounds = 0

  for (let index = 0; index < maxIterations; index++) {
    const snapshot = parseVisibleTreeNodes()
    const tree = getSubtreeWindow(snapshot, root.nodeUid, rootLevel)

    tree.nodes.forEach(node => {
      discovered.set(node.nodeUid, node)
    })

    let changed = false

    for (const node of tree.nodes) {
      if (
        !isExpandable(node) ||
        isExpanded(node) ||
        attempted.has(node.nodeUid)
      ) {
        continue
      }

      attempted.add(node.nodeUid)
      changed = await expandNode(node)

      if (changed) {
        stagnantRounds = 0
        break
      }
    }

    if (!changed) {
      if (!scrollContainer || tree.reachedBoundary) {
        break
      }

      const beforeScrollTop = scrollContainer.scrollTop
      const beforeSnapshot = tree.nodes
        .map(node => [node.nodeUid, String(node.level)].join(':'))
        .join('|')

      scrollContainer.scrollBy({
        top: Math.max(scrollContainer.clientHeight * 0.75, 240),
        behavior: 'auto',
      })

      await waitFor(250)

      const nextWindow = getSubtreeWindow(
        parseVisibleTreeNodes(),
        root.nodeUid,
        rootLevel,
      )
      const afterSnapshot = nextWindow.nodes
        .map(node => [node.nodeUid, String(node.level)].join(':'))
        .join('|')

      if (
        scrollContainer.scrollTop === beforeScrollTop ||
        beforeSnapshot === afterSnapshot
      ) {
        stagnantRounds++
      } else {
        stagnantRounds = 0
      }

      if (stagnantRounds >= 2) {
        break
      }
    }
  }

  return Array.from(discovered.values())
}

export const collectBatchDownloadSeed =
  async (): Promise<BatchDownloadSeed> => {
    let treeEntries: BatchDownloadEntry[] = []

    try {
      const treeNodes = await expandActiveSubtree()
      treeEntries = buildBatchEntries(
        treeNodes.map(node => ({
          nodeUid: node.nodeUid,
          title: node.title,
          level: node.level,
        })),
        {
          currentUrl: window.location.href,
          origin: window.location.origin,
        },
      )
    } catch (error) {
      console.warn(
        'Failed to collect wiki descendants from the sidebar, falling back to body links.',
        error,
      )
    }

    const root = treeEntries.at(0) ?? buildFallbackRootEntry()

    const linkedEntries = (await collectLinkedChildren()).map(
      (link, index) => ({
        nodeUid: `link:${String(index)}:${link.url}`,
        title: link.title,
        url: link.url,
        level: root.level + 1,
        pathSegments: root.pathSegments.concat(link.title),
      }),
    )

    const mergedEntries = [root]
    const visitedUrls = new Set([normalizeDocUrl(root.url)])
    const treeDescendants = treeEntries.slice(1)
    const primaryEntries =
      linkedEntries.length > treeDescendants.length
        ? linkedEntries
        : treeDescendants
    const secondaryEntries =
      primaryEntries === linkedEntries ? treeDescendants : linkedEntries

    for (const candidate of primaryEntries.concat(secondaryEntries)) {
      const normalized = normalizeDocUrl(candidate.url)
      if (visitedUrls.has(normalized)) {
        continue
      }

      visitedUrls.add(normalized)
      mergedEntries.push(candidate)
    }

    if (mergedEntries.length <= 1) {
      throw new Error('No descendant pages were found on this page')
    }

    return {
      rootTitle: root.title,
      rootUrl: root.url,
      entries: mergedEntries,
      createdAt: new Date().toISOString(),
    }
  }

export const hasActiveWikiTree = (): boolean =>
  document.querySelector(`${NODE_SELECTOR}.${ACTIVE_CLASS}`) !== null

export type { BatchDownloadEntry }
