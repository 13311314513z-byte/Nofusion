import { dispatchNotification } from "../../notify/dispatcher.js";
import type { NotifyChannel } from "../../models/project.js";
import type { Logger } from "../../utils/logger.js";

/**
 * Pipeline notification stage — dispatches completion/failure events
 * to configured notification channels (Telegram, Feishu, WeChat Work, Webhook).
 *
 * Extracted from PipelineRunner to keep the notification concern separate.
 */
export interface NotificationInput {
  /** Notification channels from pipeline config */
  channels: NotifyChannel[] | undefined;
  /** Logger instance */
  logger: Logger;
  /** Book ID for context */
  bookId: string;
  /** Chapter number */
  chapterNumber: number;
  /** Chapter title */
  title?: string;
  /** Final word count */
  wordCount?: number;
  /** Whether audit passed */
  auditPassed?: boolean;
  /** Error message (triggers failure notification) */
  error?: string;
}

export async function runNotificationStage(input: NotificationInput): Promise<void> {
  const { channels, logger, bookId, chapterNumber, title, wordCount, auditPassed, error } = input;

  if (!channels || channels.length === 0) return;

  const chapterLabel = title ? `第${chapterNumber}章《${title}》` : `第${chapterNumber}章`;

  if (error) {
    await dispatchNotification(channels, {
      title: `❌ ${bookId} 写作失败`,
      body: `${chapterLabel} 写入失败：${error}`,
    });
  } else {
    const status = auditPassed ? "✅ 审计通过" : "⏳ 待审计";
    await dispatchNotification(channels, {
      title: `📖 ${bookId} 第${chapterNumber}章完成`,
      body: `${chapterLabel}\n字数：${wordCount ?? "?"}\n${status}`,
    });
  }
}
