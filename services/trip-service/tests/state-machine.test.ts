import { RideState } from '@ride-dispatch/models';
import { ALLOWED_TRANSITIONS, canTransition } from '../src/state-machine';

describe('state-machine module', () => {
  const allStates: RideState[] = [
    RideState.REQUESTED,
    RideState.MATCHED,
    RideState.DRIVER_EN_ROUTE,
    RideState.IN_PROGRESS,
    RideState.COMPLETED,
    RideState.CANCELLED,
  ];

  it('exports exact allowed transitions mapping', () => {
    expect(ALLOWED_TRANSITIONS[RideState.REQUESTED]).toEqual([
      RideState.MATCHED,
      RideState.CANCELLED,
    ]);
    expect(ALLOWED_TRANSITIONS[RideState.MATCHED]).toEqual([
      RideState.DRIVER_EN_ROUTE,
      RideState.CANCELLED,
    ]);
    expect(ALLOWED_TRANSITIONS[RideState.DRIVER_EN_ROUTE]).toEqual([
      RideState.IN_PROGRESS,
      RideState.CANCELLED,
    ]);
    expect(ALLOWED_TRANSITIONS[RideState.IN_PROGRESS]).toEqual([RideState.COMPLETED]);
    expect(ALLOWED_TRANSITIONS[RideState.COMPLETED]).toEqual([]);
    expect(ALLOWED_TRANSITIONS[RideState.CANCELLED]).toEqual([]);
  });

  describe('exhaustive transition-table matrix (6x6 = 36 combinations)', () => {
    const expectedAllowed: Record<RideState, Set<RideState>> = {
      [RideState.REQUESTED]: new Set([RideState.MATCHED, RideState.CANCELLED]),
      [RideState.MATCHED]: new Set([RideState.DRIVER_EN_ROUTE, RideState.CANCELLED]),
      [RideState.DRIVER_EN_ROUTE]: new Set([RideState.IN_PROGRESS, RideState.CANCELLED]),
      [RideState.IN_PROGRESS]: new Set([RideState.COMPLETED]),
      [RideState.COMPLETED]: new Set(),
      [RideState.CANCELLED]: new Set(),
    };

    allStates.forEach((from) => {
      allStates.forEach((to) => {
        const isAllowed = expectedAllowed[from].has(to);
        const testName = isAllowed
          ? `allows transition ${from} -> ${to}`
          : `rejects transition ${from} -> ${to}`;

        it(testName, () => {
          expect(canTransition(from, to)).toBe(isAllowed);
        });
      });
    });
  });

  it('returns false for invalid/unknown states', () => {
    expect(canTransition('UNKNOWN' as RideState, RideState.MATCHED)).toBe(false);
  });
});
