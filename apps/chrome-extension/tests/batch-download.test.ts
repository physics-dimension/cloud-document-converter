import { describe, expect, it } from 'vitest'
import {
  buildBatchEntries,
  isSupportedDocUrl,
  wikiTokenFromNodeUid,
} from '../src/common/batch-download'

describe('wikiTokenFromNodeUid', () => {
  it('parses wikiToken from the sidebar node uid', () => {
    expect(
      wikiTokenFromNodeUid(
        'level=2&rootNodeId=SPACE_ROOT&wikiToken=wikcn1234567890',
      ),
    ).toBe('wikcn1234567890')
  })
})

describe('buildBatchEntries', () => {
  it('builds relative zip paths from the visible wiki tree order', () => {
    const entries = buildBatchEntries(
      [
        {
          nodeUid: 'level=1&rootNodeId=SPACE_ROOT&wikiToken=wikcnRootNode0001',
          title: 'Root Page',
          level: 1,
        },
        {
          nodeUid: 'level=2&rootNodeId=SPACE_ROOT&wikiToken=wikcnChildNode0002',
          title: 'Child Page',
          level: 2,
        },
        {
          nodeUid: 'level=3&rootNodeId=SPACE_ROOT&wikiToken=wikcnGrandNode0003',
          title: 'Grandchild Page',
          level: 3,
        },
        {
          nodeUid:
            'level=2&rootNodeId=SPACE_ROOT&wikiToken=wikcnSiblingNode0004',
          title: 'Sibling Page',
          level: 2,
        },
      ],
      {
        currentUrl: 'https://my.feishu.cn/wiki/wikcnRootNode0001?from=share',
        origin: 'https://my.feishu.cn',
      },
    )

    expect(entries).toStrictEqual([
      {
        nodeUid: 'level=1&rootNodeId=SPACE_ROOT&wikiToken=wikcnRootNode0001',
        title: 'Root Page',
        url: 'https://my.feishu.cn/wiki/wikcnRootNode0001',
        level: 1,
        pathSegments: ['Root Page'],
        wikiToken: 'wikcnRootNode0001',
      },
      {
        nodeUid: 'level=2&rootNodeId=SPACE_ROOT&wikiToken=wikcnChildNode0002',
        title: 'Child Page',
        url: 'https://my.feishu.cn/wiki/wikcnChildNode0002',
        level: 2,
        pathSegments: ['Root Page', 'Child Page'],
        wikiToken: 'wikcnChildNode0002',
      },
      {
        nodeUid: 'level=3&rootNodeId=SPACE_ROOT&wikiToken=wikcnGrandNode0003',
        title: 'Grandchild Page',
        url: 'https://my.feishu.cn/wiki/wikcnGrandNode0003',
        level: 3,
        pathSegments: ['Root Page', 'Child Page', 'Grandchild Page'],
        wikiToken: 'wikcnGrandNode0003',
      },
      {
        nodeUid: 'level=2&rootNodeId=SPACE_ROOT&wikiToken=wikcnSiblingNode0004',
        title: 'Sibling Page',
        url: 'https://my.feishu.cn/wiki/wikcnSiblingNode0004',
        level: 2,
        pathSegments: ['Root Page', 'Sibling Page'],
        wikiToken: 'wikcnSiblingNode0004',
      },
    ])
  })
})

describe('isSupportedDocUrl', () => {
  it('accepts doc links from other supported feishu subdomains', () => {
    expect(
      isSupportedDocUrl(
        new URL(
          'https://ycr1lij2cm.feishu.cn/docx/SgbbdQcybombJ4xDON4csoshnAd?from=from_copylink',
        ),
      ),
    ).toBe(true)
  })

  it('rejects non-doc links even on supported hosts', () => {
    expect(
      isSupportedDocUrl(new URL('https://ycr1lij2cm.feishu.cn/sheets/abc123')),
    ).toBe(false)
  })
})
