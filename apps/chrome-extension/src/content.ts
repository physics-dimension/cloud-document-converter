import { chunk } from 'es-toolkit/array'
import {
  EventName,
  portImpl,
  type PrepareBatchPageDownloadMessage,
  type PrepareBatchExportMessage,
  type RuntimeMessage,
} from './common/message'
import {
  batchPageDownloadRequestDatasetKey,
  batchRequestDatasetKey,
  batchTaskSeedKey,
} from './common/batch-download'
import { collectBatchDownloadSeed } from './common/batch-download-dom'

const COMMENT_BUTTON_CLASS = '.docx-comment__first-comment-btn'
const HELP_BLOCK_CLASS = '.help-block'
const DEFAULT_BUTTON_SIZE = 36
const DEFAULT_BUTTON_GAP = 14
const DEFAULT_BUTTON_RIGHT = 24
const DEFAULT_BUTTON_BOTTOM = 24

let disposables: (() => void)[] = []

const dispose = (): void => {
  disposables.forEach(disposable => {
    disposable()
  })

  disposables = []
}

interface Button {
  element: HTMLElement
  width: number
  height: number
}

interface ButtonPosition {
  right: number
  bottom: number
}

const startBatchDownload = async (): Promise<void> => {
  const seed = await collectBatchDownloadSeed()
  const taskId = crypto.randomUUID()

  await chrome.storage.local.set({
    [batchTaskSeedKey(taskId)]: seed,
  })

  await chrome.runtime.sendMessage({
    type: 'open_batch_download_page',
    taskId,
  })
}

const initButtons = (): void => {
  const root = document.body

  const isReady = () => root.isConnected

  const render = () => {
    const style = document.createElement('style')
    style.innerHTML = `
  [data-CDC-button-type] {
    position: fixed;
    display: flex;
    justify-content: center;
    align-items: center;
    border: 1px solid var(--line-border-card);
    border-radius: 50%;
    background-color: var(--bg-body);
    box-shadow: var(--shadow-s4-down);
    cursor: pointer;
    text-align: center;
    color: var(--text-title);
    z-index: 3;
  }

  [data-CDC-button-type]:hover {
    color: var(--colorful-blue);
  }
  `

    const operates = [
      {
        type: 'copy',
        innerHtml: `<svg aria-hidden="true" focusable="false" role="img" class="octicon octicon-copy" viewBox="0 0 16 16" width="16"
          height="16" fill="currentColor">
          <path
              d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z">
          </path>
          <path
              d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z">
          </path>
          </svg>`,
        action: () => {
          chrome.runtime
            .sendMessage({ flag: 'copy_docx_as_markdown' })
            .catch(console.error)
        },
      },
      {
        type: 'view',
        innerHtml: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" 
        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" 
        class="octicon octicon-view" fill="currentColor">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
        `,
        action: () => {
          chrome.runtime
            .sendMessage({ flag: 'view_docx_as_markdown' })
            .catch(console.error)
        },
      },
      {
        type: 'download',
        innerHtml: `<svg aria-hidden="true" focusable="false" role="img" class="octicon octicon-download" viewBox="0 0 16 16"
        width="16" height="16" fill="currentColor">
        <path
          d="M2.75 14A1.75 1.75 0 0 1 1 12.25v-2.5a.75.75 0 0 1 1.5 0v2.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 1.5 0v2.5A1.75 1.75 0 0 1 13.25 14Z">
        </path>
        <path
          d="M7.25 7.689V2a.75.75 0 0 1 1.5 0v5.689l1.97-1.969a.749.749 0 1 1 1.06 1.06l-3.25 3.25a.749.749 0 0 1-1.06 0L4.22 6.78a.749.749 0 1 1 1.06-1.06l1.97 1.969Z">
        </path>
      </svg>`,
        action: () => {
          chrome.runtime
            .sendMessage({ flag: 'download_docx_as_markdown' })
            .catch(console.error)
        },
      },
      {
        type: 'batch-download',
        innerHtml: `<svg aria-hidden="true" focusable="false" role="img" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
        <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v2.5C0 6.216.784 7 1.75 7h2.5C5.216 7 6 6.216 6 5.25v-2.5A1.75 1.75 0 0 0 4.25 1h-2.5Zm0 1.5h2.5a.25.25 0 0 1 .25.25v2.5a.25.25 0 0 1-.25.25h-2.5a.25.25 0 0 1-.25-.25v-2.5a.25.25 0 0 1 .25-.25Zm10 0A1.75 1.75 0 0 1 16 2.75v2.5A1.75 1.75 0 0 1 14.25 7h-2.5A1.75 1.75 0 0 1 10 5.25v-2.5A1.75 1.75 0 0 1 11.75 1h2.5Zm0 1.5h2.5a.25.25 0 0 1 .25.25v2.5a.25.25 0 0 1-.25.25h-2.5a.25.25 0 0 1-.25-.25v-2.5a.25.25 0 0 1 .25-.25Zm-10 7A1.75 1.75 0 0 0 0 12.75v2.5C0 16.216.784 17 1.75 17h2.5C5.216 17 6 16.216 6 15.25v-2.5A1.75 1.75 0 0 0 4.25 11h-2.5Zm0 1.5h2.5a.25.25 0 0 1 .25.25v2.5a.25.25 0 0 1-.25.25h-2.5a.25.25 0 0 1-.25-.25v-2.5a.25.25 0 0 1 .25-.25Zm7.53-1.28a.75.75 0 0 1 1.06 0l1.16 1.16V10.75a.75.75 0 0 1 1.5 0v1.63l1.16-1.16a.75.75 0 1 1 1.06 1.06l-2.44 2.44a.75.75 0 0 1-1.06 0l-2.44-2.44a.75.75 0 0 1 0-1.06ZM10.75 15a.75.75 0 0 1 .75.75v.75h2.75a.75.75 0 0 1 0 1.5H11.5v.75a.75.75 0 0 1-1.5 0v-.75H7.25a.75.75 0 0 1 0-1.5H10v-.75a.75.75 0 0 1 .75-.75Z" transform="translate(0 -1)"></path>
        </svg>`,
        action: () => {
          startBatchDownload().catch((error: unknown) => {
            console.error(error)
            window.alert(
              error instanceof Error
                ? error.message
                : 'Failed to start batch download',
            )
          })
        },
      },
    ]

    const buttons = operates.map<Button>(({ type, innerHtml, action }) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.setAttribute('data-CDC-button-type', type)
      btn.innerHTML = innerHtml

      btn.style.width = '36px'
      btn.style.height = '36px'

      btn.addEventListener('click', action)

      return {
        element: btn,
        width: 36,
        height: 36,
      }
    })

    const getDefaultBtnPos = (buttons: Button[]): ButtonPosition[] =>
      buttons.map((_, index) => ({
        right: DEFAULT_BUTTON_RIGHT,
        bottom:
          DEFAULT_BUTTON_BOTTOM +
          index * (DEFAULT_BUTTON_GAP + DEFAULT_BUTTON_SIZE),
      }))

    const getOriginalBtnPos = (buttons: Button[]): ButtonPosition[] => {
      const helpBlock: HTMLDivElement | null =
        root.querySelector(HELP_BLOCK_CLASS)
      const commentButton: HTMLDivElement | null =
        root.querySelector(COMMENT_BUTTON_CLASS)

      if (!helpBlock && !commentButton) {
        return getDefaultBtnPos(buttons)
      }

      const windowWidth = window.innerWidth
      const windowHeight = window.innerHeight
      const defaultBtnHeight = DEFAULT_BUTTON_SIZE
      const defaultGap = DEFAULT_BUTTON_GAP

      if (!helpBlock) {
        const commentButtonRect = commentButton?.getBoundingClientRect()

        if (!commentButtonRect) {
          return getDefaultBtnPos(buttons)
        }

        const initialBottom = Math.max(
          windowHeight - commentButtonRect.bottom,
          DEFAULT_BUTTON_BOTTOM,
        )

        return buttons.map((_, index) => ({
          right: windowWidth - commentButtonRect.right,
          bottom:
            initialBottom +
            (index + 1) * (defaultGap + commentButtonRect.height),
        }))
      }

      const helpBlockRect = helpBlock.getBoundingClientRect()

      // Comment button may not be displayed
      if (!commentButton) {
        const startBottom = windowHeight - helpBlockRect.bottom
        const right = windowWidth - helpBlockRect.right

        return buttons.map((_, index) => ({
          right,
          bottom: startBottom + (index + 1) * (defaultGap + defaultBtnHeight),
        }))
      }

      const commentButtonRect = commentButton.getBoundingClientRect()

      if (commentButtonRect.right === helpBlockRect.right) {
        const btnHeight = commentButtonRect.height
        const gap =
          Math.abs(helpBlockRect.bottom - commentButtonRect.bottom) - btnHeight
        const initialBottom = Math.max(
          windowHeight - commentButtonRect.bottom,
          windowHeight - helpBlockRect.bottom,
        )

        return buttons.map((_, index) => ({
          right: windowWidth - commentButtonRect.right,
          bottom: initialBottom + (index + 1) * (gap + btnHeight),
        }))
      } else if (commentButtonRect.bottom === helpBlockRect.bottom) {
        let bottom = windowHeight - commentButtonRect.bottom

        return chunk(buttons, 2)
          .map(items => {
            bottom += defaultGap + defaultBtnHeight

            if (items.length === 2) {
              return [
                { right: windowWidth - commentButtonRect.right, bottom },
                { right: windowWidth - helpBlockRect.right, bottom },
              ]
            }

            const minRight =
              windowWidth -
              Math.max(commentButtonRect.right, helpBlockRect.right)

            return [
              {
                right: minRight,
                bottom,
              },
            ]
          })
          .flat(1)
      }

      return getDefaultBtnPos(buttons)
    }

    const layout = (buttons: Button[]) => {
      const pos = getOriginalBtnPos(buttons)

      buttons.forEach((button, index) => {
        button.element.style.right = pos[index].right.toFixed() + 'px'
        button.element.style.bottom = pos[index].bottom.toFixed() + 'px'
      })
    }

    // When the width of the docx's visible content is too narrow, the position of the comment button changes.
    const autoLayoutObserver = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (
          mutation.type === 'attributes' &&
          mutation.attributeName === 'class'
        ) {
          layout(buttons)
        }
      }
    })
    const autoLayout = () => {
      const commentButton = root.querySelector(COMMENT_BUTTON_CLASS)
      if (!commentButton) {
        return
      }

      autoLayoutObserver.observe(commentButton, {
        attributes: true,
        attributeFilter: ['class'],
      })
    }

    layout(buttons)
    autoLayout()

    root.appendChild(style)
    buttons.forEach(button => {
      root.appendChild(button.element)
    })

    const handleResize = () => {
      layout(buttons)
    }

    window.addEventListener('resize', handleResize)

    const unmount = () => {
      autoLayoutObserver.disconnect()
      window.removeEventListener('resize', handleResize)

      buttons.forEach(button => {
        if (root.contains(button.element)) {
          root.removeChild(button.element)
        }
      })

      if (root.contains(style)) {
        root.removeChild(style)
      }
    }

    disposables.push(unmount)

    return unmount
  }

  let unmount: (() => void) | null = null
  const init = () => {
    // Rendering may be called multiple times
    if (unmount) {
      unmount()

      unmount = null
    }

    unmount = render()
  }

  const initObserver = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          if (
            node instanceof HTMLElement &&
            (node.matches(COMMENT_BUTTON_CLASS) ||
              node.matches(HELP_BLOCK_CLASS)) &&
            isReady()
          ) {
            init()
            return
          }
        }
      }
    }
  })

  if (isReady()) {
    init()
  }

  initObserver.observe(root, {
    childList: true,
    subtree: true,
  })

  disposables.push(() => {
    initObserver.disconnect()
  })
}

function initContent(): void {
  initButtons()
}

window.addEventListener('load', initContent, false)

// For SPA, some page content updates do not trigger page reloads
let lastPathname: string = location.pathname
const urlChangeObserver: MutationObserver = new MutationObserver(() => {
  const pathname = location.pathname

  if (pathname !== lastPathname) {
    lastPathname = pathname

    dispose()

    initContent()
  }
})
urlChangeObserver.observe(document.body, { childList: true })

portImpl.receiver.on(EventName.GetSettings, async keys => {
  return await chrome.storage.sync.get(keys)
})

portImpl.receiver.on(EventName.BatchExportResult, async result => {
  await chrome.runtime.sendMessage({
    type: 'batch_export_result',
    ...result,
  })
})

portImpl.receiver.on(EventName.BatchPageDownloadResult, async result => {
  await chrome.runtime.sendMessage({
    type: 'batch_page_download_result',
    ...result,
  })
})

chrome.runtime.onMessage.addListener((rawMessage, _sender, sendResponse) => {
  const message = rawMessage as RuntimeMessage

  if (message.type === 'start_batch_download') {
    startBatchDownload()
      .then(() => {
        sendResponse({
          ok: true,
        })
      })
      .catch((error: unknown) => {
        console.error(error)
        sendResponse({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to start batch download',
        })
      })

    return true
  }

  if (message.type === 'prepare_batch_export') {
    document.documentElement.dataset[batchRequestDatasetKey] = JSON.stringify({
      requestId: (message as PrepareBatchExportMessage).requestId,
      mode: (message as PrepareBatchExportMessage).mode,
    })

    sendResponse({
      ok: true,
    })

    return true
  }

  if (message.type === 'prepare_batch_page_download') {
    document.documentElement.dataset[batchPageDownloadRequestDatasetKey] =
      JSON.stringify({
        requestId: (message as PrepareBatchPageDownloadMessage).requestId,
      })

    sendResponse({
      ok: true,
    })

    return true
  }

  return false
})

if (import.meta.env.DEV) {
  portImpl.receiver.on(EventName.Console, data => {
    console.log('MAIN World Console:', ...data)
  })
}
