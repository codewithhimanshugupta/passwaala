import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { assertOwnedByShop, requireShopScope } from './shop-scope';

/**
 * Unit tests for the Shop Data Isolation helpers — the enforcement points for
 * the plan's hard "one shop's data stays with that shop" rule.
 */
describe('shop-scope', () => {
  describe('requireShopScope', () => {
    it('returns the shopId when present', () => {
      expect(requireShopScope('shop-1')).toBe('shop-1');
    });

    it('throws 403 when there is no shop scope', () => {
      expect(() => requireShopScope(undefined)).toThrow(ForbiddenException);
    });
  });

  describe('assertOwnedByShop', () => {
    it('returns the row when it belongs to the caller shop', () => {
      const row = { id: 'p-1', shopId: 'shop-1' };
      expect(assertOwnedByShop(row, 'shop-1')).toBe(row);
    });

    it('throws 404 for another shop’s row (no existence leak)', () => {
      const row = { id: 'p-1', shopId: 'shop-2' };
      expect(() => assertOwnedByShop(row, 'shop-1')).toThrow(NotFoundException);
    });

    it('throws 404 when the row is missing', () => {
      expect(() => assertOwnedByShop(null, 'shop-1')).toThrow(NotFoundException);
    });
  });
});
