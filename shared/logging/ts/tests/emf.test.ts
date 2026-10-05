import { emitEMFMetric } from '../src/emf';

describe('TypeScript emitEMFMetric', () => {
  it('formats valid EMF JSON with _aws metadata and dual flat sibling fields', () => {
    let capturedLine = '';
    const mockOut = (line: string) => {
      capturedLine = line;
    };

    const namespace = 'RideDispatch/TripService';
    const dimensions = {
      Route: 'request-ride',
      Env: 'test',
    };
    const metrics = {
      RequestCount: { value: 1, unit: 'Count' },
      ProcessingLatencyMs: { value: 28.5, unit: 'Milliseconds' },
    };

    emitEMFMetric(namespace, dimensions, metrics, mockOut);

    expect(capturedLine).toBeTruthy();
    const root = JSON.parse(capturedLine);

    // 1. Verify _aws metadata directive
    expect(root._aws).toBeDefined();
    expect(root._aws.Timestamp).toBeGreaterThan(0);
    expect(Array.isArray(root._aws.CloudWatchMetrics)).toBe(true);
    expect(root._aws.CloudWatchMetrics.length).toBe(1);

    const cw = root._aws.CloudWatchMetrics[0];
    expect(cw.Namespace).toBe(namespace);
    expect(cw.Dimensions).toEqual([['Env', 'Route']]); // sorted keys
    expect(cw.Metrics).toEqual([
      { Name: 'ProcessingLatencyMs', Unit: 'Milliseconds' },
      { Name: 'RequestCount', Unit: 'Count' },
    ]);

    // 2. Verify dual flat top-level sibling fields
    expect(root.Route).toBe('request-ride');
    expect(root.Env).toBe('test');
    expect(root.RequestCount).toBe(1);
    expect(root.ProcessingLatencyMs).toBe(28.5);
  });
});
