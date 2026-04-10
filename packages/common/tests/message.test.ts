import { afterEach, describe, expect, it } from 'vitest'
import { Port } from '../src/message'

interface TestEvents extends Record<string, unknown> {
  echo: {
    id: string
    delay: number
  }
}

type MessageListener = (event: { source: unknown; data: unknown }) => void

const createFakeWindow = (): Window => {
  const listeners = new Set<MessageListener>()

  const fakeWindow = {
    addEventListener: (type: string, listener: MessageListener) => {
      if (type === 'message') {
        listeners.add(listener)
      }
    },
    postMessage: (data: unknown) => {
      queueMicrotask(() => {
        listeners.forEach(listener => {
          listener({
            source: fakeWindow,
            data,
          })
        })
      })
    },
  }

  return fakeWindow as unknown as Window
}

const originalWindow = globalThis.window

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
    writable: true,
  })
})

describe('Port', () => {
  it('resolves async responses by message id', async () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: createFakeWindow(),
      writable: true,
    })

    const sender = new Port<TestEvents>('sender', 'receiver', {
      timeout: 2 * 1000,
    })
    const receiver = new Port<TestEvents>('receiver', 'sender', {
      timeout: 2 * 1000,
    })

    receiver.on('echo', async data => {
      await new Promise(resolve => {
        setTimeout(resolve, data.delay)
      })

      return data.id
    })

    const first = sender.sendAsync<'echo', string>('echo', {
      id: 'slow',
      delay: 30,
    })
    const second = sender.sendAsync<'echo', string>('echo', {
      id: 'fast',
      delay: 0,
    })

    await expect(second).resolves.toBe('fast')
    await expect(first).resolves.toBe('slow')
  })
})
