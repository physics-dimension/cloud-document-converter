import { Port } from '@dolphin/common/message'
import type {
  BatchDownloadMode,
  BatchDownloadSeed,
  BatchExportResultMessage,
} from './batch-download'

export enum Flag {
  ExecuteViewScript = 'view_docx_as_markdown',
  ExecuteCopyScript = 'copy_docx_as_markdown',
  ExecuteDownloadScript = 'download_docx_as_markdown',
  ExecuteBatchDownload = 'download_docx_descendants_as_markdown',
}

interface ExecuteScriptMessage {
  flag: Flag
}

export type Message = ExecuteScriptMessage

export enum EventName {
  Console = 'console',
  GetSettings = 'get_settings',
  BatchExportResult = 'batch_export_result',
  BatchPageDownloadResult = 'batch_page_download_result',
}

export interface Events extends Record<string, unknown> {
  [EventName.Console]: unknown[]
  [EventName.GetSettings]: string[]
  [EventName.BatchExportResult]: BatchExportResultMessage
  [EventName.BatchPageDownloadResult]: BatchExportResultMessage
}

export interface OpenBatchPageMessage {
  type: 'open_batch_download_page'
  taskId: string
}

export interface PrepareBatchExportMessage {
  type: 'prepare_batch_export'
  requestId: string
  mode: BatchDownloadMode
}

export interface PrepareBatchPageDownloadMessage {
  type: 'prepare_batch_page_download'
  requestId: string
}

export interface StartBatchDownloadMessage {
  type: 'start_batch_download'
}

export interface BatchExportForwardMessage extends BatchExportResultMessage {
  type: 'batch_export_result'
}

export interface BatchPageDownloadForwardMessage
  extends BatchExportResultMessage {
  type: 'batch_page_download_result'
}

export type RuntimeMessage =
  | Message
  | OpenBatchPageMessage
  | PrepareBatchExportMessage
  | PrepareBatchPageDownloadMessage
  | StartBatchDownloadMessage
  | BatchExportForwardMessage
  | BatchPageDownloadForwardMessage

export type BatchSeedStorage = Record<string, BatchDownloadSeed>

class PortImpl {
  private _sender: Port<Events> | null = null
  private _receiver: Port<Events> | null = null

  get sender(): Port<Events> {
    this._sender ??= new Port<Events>('sender', 'receiver')
    return this._sender
  }

  get receiver(): Port<Events> {
    this._receiver ??= new Port<Events>('receiver', 'sender')
    return this._receiver
  }
}

export const portImpl: PortImpl = /* @__PURE__ */ new PortImpl()
