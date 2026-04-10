<p align="center">
  <p align="center">
    <img width="150" height="150" src="apps/chrome-extension/design/logo.svg" alt="Logo">
  </p>
  <h1 align="center"><b>Cloud Document Converter</b></h1>
</p>

Cloud Document Converter is a browser extension for exporting Lark / Feishu cloud documents as Markdown.

This repository is a fork of [whale4113/cloud-document-converter](https://github.com/whale4113/cloud-document-converter) with an extra focus on bulk knowledge-base export workflows.

[简体中文](./README_ZH.md)

## What This Fork Adds

- Batch download for descendant documents under the current Feishu wiki page
- Page picker before download, with search and selective export
- Configurable batch concurrency: `1`, `2`, `3`, or `5`
- `Fast` and `Complete` export modes for balancing speed and content completeness
- Images and attachments included by default for batch exports
- Batch entry in both the floating page actions and the extension popup

## Core Features

- Download the current Lark / Feishu document as Markdown
- Copy the current document as Markdown
- View the generated Markdown before saving
- Batch export descendant pages as individual Markdown or ZIP downloads

## Batch Export Workflow

1. Open a Feishu / Lark wiki or directory-style document page
2. Click `Download descendants as Markdown`
3. Review the collected child pages in the batch page
4. Choose the pages you want to export
5. Set concurrency and export mode
6. Start the batch download

Notes:

- `Fast` mode skips forced full-page preloading and is best for large batches
- `Complete` mode waits for the page to be fully prepared before export
- Pages with images or attachments are downloaded as per-page ZIP files
- Plain-text pages are downloaded as `.md`

## Install From Source

This fork is intended to be loaded as an unpacked extension.

```bash
pnpm install
pnpm build
```

Then load the unpacked extension from:

```text
apps/chrome-extension/dist
```

In Chrome / Edge:

1. Open `chrome://extensions/` or `edge://extensions/`
2. Turn on Developer Mode
3. Click `Load unpacked`
4. Select `apps/chrome-extension/dist`

## Development

```bash
pnpm test
pnpm build
```

## Compatibility

The underlying Markdown conversion support is inherited from the upstream project. This fork mainly extends the browser extension workflow for batch exporting Feishu wiki descendants.

## Upstream Credit

- Original project: [whale4113/cloud-document-converter](https://github.com/whale4113/cloud-document-converter)

## Disclaimer

This project is provided for informational and educational purposes only. Use it at your own risk and make sure your usage complies with your organization's policies and the target platform's terms.
