import { CHANNEL_TYPES, type ChannelType } from '@switchboard/core';

/**
 * Presentation metadata for each channel.
 *
 * Keyed by `ChannelType` from `@switchboard/core`, so adding a third channel to
 * the canonical union makes this object fail to typecheck until the console
 * accounts for it. That is the intent — a channel the UI silently can't render
 * is worse than a build error.
 */
export const CHANNEL_META: Record<
  ChannelType,
  { label: string; dotClass: string }
> = {
  gmail: { label: 'Gmail', dotClass: 'bg-channel-gmail' },
  whatsapp: { label: 'WhatsApp', dotClass: 'bg-channel-whatsapp' },
};

export const CHANNELS = CHANNEL_TYPES.map((type) => ({
  type,
  ...CHANNEL_META[type],
}));
