export interface MetricDefinition {
  value: number;
  unit: string;
}

export interface CloudWatchMetricDirective {
  Name: string;
  Unit: string;
}

export interface CloudWatchMetricsDirective {
  Namespace: string;
  Dimensions: string[][];
  Metrics: CloudWatchMetricDirective[];
}

export interface AWSMetadataDirective {
  Timestamp: number;
  CloudWatchMetrics: CloudWatchMetricsDirective[];
}

/**
 * emitEMFMetric formats and writes a CloudWatch Embedded Metric Format (EMF) JSON line
 * to stdout (or a custom output sink for testing).
 *
 * Dual Structure Requirement:
 * CloudWatch EMF requires a top-level "_aws" metadata directive alongside flat
 * top-level sibling fields for all dimension keys and metric values in the identical JSON object.
 */
export function emitEMFMetric(
  namespace: string,
  dimensions: Record<string, string>,
  metrics: Record<string, MetricDefinition>,
  out: (line: string) => void = (line: string) => console.log(line)
): void {
  const dimKeys = Object.keys(dimensions).sort();
  const metricNames = Object.keys(metrics).sort();

  const cwMetrics: CloudWatchMetricDirective[] = metricNames.map((name) => ({
    Name: name,
    Unit: metrics[name].unit,
  }));

  const awsDirective: AWSMetadataDirective = {
    Timestamp: Date.now(),
    CloudWatchMetrics: [
      {
        Namespace: namespace,
        Dimensions: dimKeys.length > 0 ? [dimKeys] : [],
        Metrics: cwMetrics,
      },
    ],
  };

  const root: Record<string, unknown> = {
    _aws: awsDirective,
    ...dimensions,
  };

  for (const name of metricNames) {
    root[name] = metrics[name].value;
  }

  out(JSON.stringify(root));
}
