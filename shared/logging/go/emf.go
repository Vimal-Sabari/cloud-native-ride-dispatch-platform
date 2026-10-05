package logging

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sort"
	"time"
)

// MetricDefinition describes a single custom CloudWatch metric value and unit.
type MetricDefinition struct {
	Value float64
	Unit  string
}

// CloudWatchMetricDirective models the metric descriptor in CloudWatch EMF metadata.
type CloudWatchMetricDirective struct {
	Name string `json:"Name"`
	Unit string `json:"Unit,omitempty"`
}

// CloudWatchMetricsDirective models the namespace, dimension set, and metric list in CloudWatch EMF metadata.
type CloudWatchMetricsDirective struct {
	Namespace  string                      `json:"Namespace"`
	Dimensions [][]string                  `json:"Dimensions"`
	Metrics    []CloudWatchMetricDirective `json:"Metrics"`
}

// AWSMetadataDirective models the root "_aws" metadata object required by CloudWatch EMF.
type AWSMetadataDirective struct {
	Timestamp         int64                        `json:"Timestamp"`
	CloudWatchMetrics []CloudWatchMetricsDirective `json:"CloudWatchMetrics"`
}

// EmitEMFMetric formats and writes a CloudWatch Embedded Metric Format (EMF) JSON line
// to os.Stdout (or an injected io.Writer for testing).
//
// Dual Structure Requirement:
// EMF requires a top-level "_aws" metadata directive alongside flat top-level sibling fields
// for all dimension keys and metric values in the identical JSON object.
func EmitEMFMetric(
	namespace string,
	dimensions map[string]string,
	metrics map[string]MetricDefinition,
	writers ...io.Writer,
) {
	out := io.Writer(os.Stdout)
	if len(writers) > 0 && writers[0] != nil {
		out = writers[0]
	}

	// 1. Collect and sort dimension keys for deterministic output
	dimKeys := make([]string, 0, len(dimensions))
	for k := range dimensions {
		dimKeys = append(dimKeys, k)
	}
	sort.Strings(dimKeys)

	// 2. Collect and sort metric descriptors for deterministic output
	metricNames := make([]string, 0, len(metrics))
	for name := range metrics {
		metricNames = append(metricNames, name)
	}
	sort.Strings(metricNames)

	cwMetrics := make([]CloudWatchMetricDirective, 0, len(metricNames))
	for _, name := range metricNames {
		cwMetrics = append(cwMetrics, CloudWatchMetricDirective{
			Name: name,
			Unit: metrics[name].Unit,
		})
	}

	// 3. Construct _aws metadata directive
	nowMs := time.Now().UnixMilli()
	dimArray := [][]string{}
	if len(dimKeys) > 0 {
		dimArray = [][]string{dimKeys}
	}

	awsDirective := AWSMetadataDirective{
		Timestamp: nowMs,
		CloudWatchMetrics: []CloudWatchMetricsDirective{
			{
				Namespace:  namespace,
				Dimensions: dimArray,
				Metrics:    cwMetrics,
			},
		},
	}

	// 4. Construct flat root object containing _aws plus flat dimension and metric siblings
	root := make(map[string]interface{}, len(dimensions)+len(metrics)+1)
	root["_aws"] = awsDirective

	for k, v := range dimensions {
		root[k] = v
	}
	for name, m := range metrics {
		root[name] = m.Value
	}

	data, err := json.Marshal(root)
	if err != nil {
		_, _ = fmt.Fprintf(out, "ERROR: failed to marshal EMF metric for %s: %v\n", namespace, err)
		return
	}

	data = append(data, '\n')
	_, _ = out.Write(data)
}
