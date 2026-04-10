<p align="center">
  <p align="center">
    <img width="150" height="150" src="apps/chrome-extension/design/logo.svg" alt="Logo">
  </p>
  <h1 align="center"><b>Cloud Document Converter</b></h1>
</p>

Cloud Document Converter 是一个把飞书 / Lark 云文档导出为 Markdown 的浏览器扩展。

这个仓库基于 [whale4113/cloud-document-converter](https://github.com/whale4113/cloud-document-converter) fork，并在此基础上增强了批量导出知识库子文档的工作流。

[English](./README.md)

## 这个 Fork 增加了什么

- 支持批量下载当前飞书知识库页面下的子文档
- 批量下载前可勾选页面，并支持搜索过滤
- 支持批量并发设置：`1`、`2`、`3`、`5`
- 支持 `Fast` 和 `Complete` 两种批量模式
- 批量下载默认包含图片和附件
- 页面右侧悬浮按钮和扩展弹窗里都提供批量下载入口

## 核心能力

- 将当前飞书 / Lark 文档下载为 Markdown
- 将当前文档复制为 Markdown
- 先预览 Markdown，再决定是否保存
- 将子文档批量导出为单独的 Markdown 或 ZIP 文件

## 批量导出流程

1. 打开飞书知识库页面或目录型文档页面
2. 点击 `Download descendants as Markdown`
3. 在批量页里查看采集到的子页面
4. 勾选需要导出的页面
5. 设置并发数和导出模式
6. 开始批量下载

说明：

- `Fast` 模式不会强制整页预加载，更适合大批量快速导出
- `Complete` 模式会等待页面尽量加载完整后再导出
- 含图片或附件的页面会按单页 ZIP 下载
- 纯文本页面会直接下载为 `.md`

## 从源码安装

这个 fork 目前更适合以“已解压扩展”的方式加载。

```bash
pnpm install
pnpm build
```

然后在浏览器里加载这个目录：

```text
apps/chrome-extension/dist
```

Chrome / Edge 操作步骤：

1. 打开 `chrome://extensions/` 或 `edge://extensions/`
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择 `apps/chrome-extension/dist`

## 开发与验证

```bash
pnpm test
pnpm build
```

## 兼容性

Markdown 转换能力继承自上游项目，这个 fork 主要增强的是飞书知识库子文档的批量导出体验。

## 上游项目

- 原项目：[whale4113/cloud-document-converter](https://github.com/whale4113/cloud-document-converter)

## 免责声明

本项目仅供学习、研究和效率工具场景使用。请自行评估风险，并确保使用方式符合你所在组织的规范以及目标平台的相关条款。
