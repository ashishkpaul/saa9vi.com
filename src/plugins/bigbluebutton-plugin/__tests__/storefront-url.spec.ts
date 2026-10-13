/**
 * Storefront URL / BBB `logoutURL` resolution.
 *
 * Infrastructure-free by design (no Postgres, Redis or BBB): the module is
 * pure, and this spec pins the rule all three call sites now share
 * (attendee join URL, moderator join URL, and the `/create` call).
 *
 * Regression this exists for: the `/create` call built
 * `${STOREFRONT_URL}/bbb-logout` WITHOUT stripping a trailing slash, so a
 * config value ending in `/` produced `https://host//bbb-logout`. It also
 * never read the documented `storefrontUrl` plugin option — that option had
 * zero read sites.
 */

import { describe, expect, it } from 'vitest';
import {
  normaliseBaseUrl,
  resolveLogoutUrl,
  resolveStorefrontBaseUrl,
} from '../services/storefront-url';

describe('storefront-url policy', () => {
  describe('normaliseBaseUrl', () => {
    it('resolves missing/blank input to undefined instead of an empty string', () => {
      expect(normaliseBaseUrl(undefined)).toBeUndefined();
      expect(normaliseBaseUrl(null)).toBeUndefined();
      expect(normaliseBaseUrl('')).toBeUndefined();
      expect(normaliseBaseUrl('   ')).toBeUndefined();
      expect(normaliseBaseUrl('/')).toBeUndefined();
    });

    it('trims and strips every trailing slash', () => {
      expect(normaliseBaseUrl('https://store.example.com')).toBe(
        'https://store.example.com',
      );
      expect(normaliseBaseUrl('https://store.example.com/')).toBe(
        'https://store.example.com',
      );
      expect(normaliseBaseUrl('https://store.example.com///')).toBe(
        'https://store.example.com',
      );
      expect(normaliseBaseUrl('  https://store.example.com/  ')).toBe(
        'https://store.example.com',
      );
    });
  });

  describe('resolveStorefrontBaseUrl', () => {
    it('prefers the explicit plugin option over the environment variable', () => {
      expect(
        resolveStorefrontBaseUrl('https://option.example.com', 'https://env.example.com'),
      ).toBe('https://option.example.com');
    });

    it('falls back to the env var when the option is absent or blank', () => {
      expect(resolveStorefrontBaseUrl(undefined, 'https://env.example.com')).toBe(
        'https://env.example.com',
      );
      expect(resolveStorefrontBaseUrl('', 'https://env.example.com')).toBe(
        'https://env.example.com',
      );
      expect(resolveStorefrontBaseUrl('   ', 'https://env.example.com')).toBe(
        'https://env.example.com',
      );
    });

    it('normalises BOTH sources, so either may carry a trailing slash', () => {
      expect(resolveStorefrontBaseUrl(undefined, 'https://env.example.com/')).toBe(
        'https://env.example.com',
      );
      expect(resolveStorefrontBaseUrl('https://option.example.com/', undefined)).toBe(
        'https://option.example.com',
      );
    });

    it('returns undefined when neither source is configured', () => {
      expect(resolveStorefrontBaseUrl(undefined, undefined)).toBeUndefined();
      expect(resolveStorefrontBaseUrl('', '')).toBeUndefined();
    });
  });

  describe('resolveLogoutUrl', () => {
    it('always emits exactly one slash before bbb-logout', () => {
      // The /create regression: no slash stripping produced a doubled slash.
      expect(resolveLogoutUrl(undefined, 'https://store.example.com/')).toBe(
        'https://store.example.com/bbb-logout',
      );
      expect(resolveLogoutUrl(undefined, 'https://store.example.com')).toBe(
        'https://store.example.com/bbb-logout',
      );
      expect(resolveLogoutUrl('https://store.example.com///', undefined)).toBe(
        'https://store.example.com/bbb-logout',
      );
    });

    it('honours the plugin option first, then the env var', () => {
      expect(
        resolveLogoutUrl('https://option.example.com', 'https://env.example.com'),
      ).toBe('https://option.example.com/bbb-logout');
      expect(
        resolveLogoutUrl(undefined, 'https://env.example.com'),
      ).toBe('https://env.example.com/bbb-logout');
    });

    it('is undefined when no storefront is configured (BBB uses its own default)', () => {
      expect(resolveLogoutUrl(undefined, undefined)).toBeUndefined();
      expect(resolveLogoutUrl('', '')).toBeUndefined();
    });
  });
});
