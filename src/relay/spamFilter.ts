import { Platform, RelayMessage } from '../types';

/**
 * Spam filter for the relay.
 *
 * Goal: stop the well-known Twitch follow/view-bot spam (the "cheap
 * viewers/followers at <site>" messages from throwaway accounts) from being
 * relayed to Telegram/Discord/etc. in the FIRST place.
 *
 * This NEVER deletes anything — a matched message is simply not relayed. Worst
 * case (a false positive) is one Twitch message not relaying; it is logged so
 * it can be audited, and the patterns below tuned. There is no data loss.
 *
 * Patterns are intentionally SPECIFIC (multi-word phrases / known spam domains)
 * so they don't match things a real person would plausibly type. Only applied
 * to messages that ORIGINATE on Twitch.
 */

// Known domains used by the follow-bot spam networks. These rotate often, so
// extra ones can be added at runtime via the TWITCH_SPAM_EXTRA_DOMAINS env var
// (comma-separated, e.g. "newspamsite.com,anotherone.net").
const KNOWN_SPAM_DOMAINS = [
  'streamboo', 'bigfollows', 'hypeviews', 'streamrise', 'dogehype',
  'streamheroes', 'uppviews', 'followsfast', 'cheapviewers', 'streampump',
  'streamboost', 'viewerboss', 'streambooster', 'getviewers',
];

function extraDomains(): string[] {
  return (process.env.TWITCH_SPAM_EXTRA_DOMAINS || '')
    .split(',')
    .map(d => d.trim().toLowerCase())
    .filter(Boolean);
}

// High-precision phrase patterns for the promotional selling language these
// bots use. Each must be distinctive enough that legit chat won't trigger it.
const SPAM_PHRASE_PATTERNS: RegExp[] = [
  /\bbest\s+viewers,?\s+followers/i,
  /\bcheap\s+(viewers|followers|primes)\b/i,
  /\bviewers,?\s+followers,?\s+(and\s+)?(primes|chatters|chat\s*bots)/i,
  /\bbecome\s+famous\b[\s\S]{0,40}\b(viewers|followers)\b/i,
  // promotional verb + selling target + "on/at" + a link/domain
  /\b(buy|get|promote|increase)\b[\s\S]{0,40}\b(viewers|followers|primes)\b[\s\S]{0,40}\b(on|at)\b[\s\S]{0,25}(https?:\/\/|\.(com|net|org|io|gg|tv|shop|store|xyz))/i,
];

function matchesKnownDomain(content: string): boolean {
  const lower = content.toLowerCase();
  return [...KNOWN_SPAM_DOMAINS, ...extraDomains()].some(d => lower.includes(d));
}

/**
 * Returns true if the message is Twitch follow/view-bot spam that should NOT be
 * relayed. Only ever returns true for messages originating on Twitch.
 */
export function isFollowBotSpam(message: RelayMessage): boolean {
  if (message.platform !== Platform.Twitch) return false;
  const content = message.content || '';
  if (!content) return false;

  if (matchesKnownDomain(content)) return true;
  return SPAM_PHRASE_PATTERNS.some(re => re.test(content));
}
