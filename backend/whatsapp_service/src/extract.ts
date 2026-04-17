/**
 * Extract message content from a Baileys WAMessageInfo.
 * Ported from TestWhatsappGroups/apps/wa-ingest/src/extract.ts
 */

export type MessageType = 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'location' | 'other';

export interface ExtractedMessage {
  type: MessageType;
  text: string | null;
  mediaMime: string | null;
  mediaField: any | null;
  quotedMsgId: string | null;
}

export function extractContent(m: any): ExtractedMessage {
  let msg = m.message;
  if (!msg) return { type: 'other', text: null, mediaMime: null, mediaField: null, quotedMsgId: null };

  // Unwrap ephemeral / view-once layers
  if (msg.ephemeralMessage) msg = msg.ephemeralMessage.message;
  if (msg.viewOnceMessage) msg = msg.viewOnceMessage.message;
  if (msg.viewOnceMessageV2) msg = msg.viewOnceMessageV2.message;

  const quoted = msg.extendedTextMessage?.contextInfo?.quotedMessage
    ? msg.extendedTextMessage.contextInfo.stanzaId || null
    : null;

  // Text
  if (msg.conversation || msg.extendedTextMessage) {
    return {
      type: 'text',
      text: msg.conversation || msg.extendedTextMessage?.text || null,
      mediaMime: null,
      mediaField: null,
      quotedMsgId: quoted,
    };
  }

  // Image
  if (msg.imageMessage) {
    return {
      type: 'image',
      text: msg.imageMessage.caption || null,
      mediaMime: msg.imageMessage.mimetype || 'image/jpeg',
      mediaField: msg.imageMessage,
      quotedMsgId: quoted,
    };
  }

  // Video
  if (msg.videoMessage) {
    return {
      type: 'video',
      text: msg.videoMessage.caption || null,
      mediaMime: msg.videoMessage.mimetype || 'video/mp4',
      mediaField: msg.videoMessage,
      quotedMsgId: quoted,
    };
  }

  // Audio
  if (msg.audioMessage) {
    return {
      type: 'audio',
      text: null,
      mediaMime: msg.audioMessage.mimetype || 'audio/ogg',
      mediaField: msg.audioMessage,
      quotedMsgId: quoted,
    };
  }

  // Document
  if (msg.documentMessage) {
    return {
      type: 'document',
      text: msg.documentMessage.fileName || msg.documentMessage.caption || null,
      mediaMime: msg.documentMessage.mimetype || 'application/octet-stream',
      mediaField: msg.documentMessage,
      quotedMsgId: quoted,
    };
  }

  // Sticker
  if (msg.stickerMessage) {
    return {
      type: 'sticker',
      text: null,
      mediaMime: msg.stickerMessage.mimetype || 'image/webp',
      mediaField: msg.stickerMessage,
      quotedMsgId: quoted,
    };
  }

  // Location
  if (msg.locationMessage || msg.liveLocationMessage) {
    const loc = msg.locationMessage || msg.liveLocationMessage;
    return {
      type: 'location',
      text: `${loc.degreesLatitude},${loc.degreesLongitude}${loc.name ? ' — ' + loc.name : ''}`,
      mediaMime: null,
      mediaField: null,
      quotedMsgId: quoted,
    };
  }

  return { type: 'other', text: null, mediaMime: null, mediaField: null, quotedMsgId: quoted };
}
