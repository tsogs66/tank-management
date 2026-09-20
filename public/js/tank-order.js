/**
 * The order tanks are listed in.
 *
 * A chief's list is not alphabetical and not the order tanks were imported:
 * it is the order they are sounded in, which follows the walk around the
 * engine room. That order is kept as the order of the stored array, because
 * that is what every page already reads — Monitoring, Bunkering, the sounding
 * card, the category tables all take `bundle.tanks.fuel` as it comes.
 *
 * So most pages need nothing from this file. It is here for the two things
 * the array alone cannot say:
 *
 *   - whether a chief has set an order at all, which is what tells the pages
 *     that sort on their own account (the fuel mock-up sorts by tank number)
 *     to stand down;
 *   - how to put a list back in order after something has re-sorted it, or
 *     after a round trip through CSV where the array order was not kept.
 *
 * A tank carries `sortIndex` once an order has been set. Until then there is
 * no order to honour and the app's own arrangement is the better one.
 */
const TankOrder = (() => {
  /** Has a chief set an order for this list? */
  function isOrdered(list) {
    const tanks = (list || []).filter(Boolean);
    if (tanks.length < 2) return false;
    return tanks.every((t) => Number.isFinite(Number(t.sortIndex)));
  }

  /**
   * The list in the chief's order, or as it came when there is none.
   *
   * Stable: tanks without a place keep the order they arrived in, behind
   * those that have one, so a tank added since the order was set is listed
   * last rather than first.
   */
  function sorted(list) {
    const tanks = (list || []).filter(Boolean);
    if (!isOrdered(tanks)) return tanks;
    return tanks
      .map((tank, arrived) => ({ tank, arrived }))
      .sort((a, b) => {
        const av = Number(a.tank.sortIndex);
        const bv = Number(b.tank.sortIndex);
        if (av !== bv) return av - bv;
        return a.arrived - b.arrived;
      })
      .map((x) => x.tank);
  }

  /**
   * Sort a list the app's own way, unless a chief has said otherwise.
   *
   * The fuel mock-up arranges storage tanks by tank number and side; a report
   * groups by role. Those arrangements are good defaults and poor overrides,
   * so they apply only while no order has been set.
   */
  function sortedOr(list, fallbackSort) {
    const tanks = (list || []).filter(Boolean);
    if (isOrdered(tanks)) return sorted(tanks);
    return typeof fallbackSort === 'function' ? fallbackSort(tanks) : tanks;
  }

  return { isOrdered, sorted, sortedOr };
})();

if (typeof module === 'object' && module.exports) module.exports = TankOrder;
if (typeof window !== 'undefined') window.TankOrder = TankOrder;
